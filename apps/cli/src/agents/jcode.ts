import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { environmentFolder } from "./env";
import { decodeLines, exclusive, toCount, toEpochMs, unknownModel } from "./pi";
import type { Reader, ReadResult, SkippedSource, UsageRecord } from "./types";

const Count = Schema.optionalKey(Schema.Finite);
const Text = Schema.optionalKey(Schema.String);
const Messages = Schema.optionalKey(Schema.Array(Schema.Unknown));

const Message = Schema.Struct({
  id: Text,
  timestamp: Text,
  token_usage: Schema.optionalKey(
    Schema.Struct({
      cache_creation_input_tokens: Count,
      cache_read_input_tokens: Count,
      input_tokens: Count,
      output_tokens: Count,
    }),
  ),
});

const Snapshot = Schema.Struct({ id: Text, messages: Messages, model: Text });
const JournalLine = Schema.Struct({
  append_messages: Messages,
  meta: Schema.optionalKey(Schema.Struct({ model: Text })),
});

// Each message decodes on its own, so one malformed message drops only itself.
const decodeMessage = Schema.decodeUnknownOption(Message);
const decodeSnapshot = Schema.decodeUnknownOption(Schema.fromJsonString(Snapshot));
const decodeJournalLine = Schema.decodeUnknownOption(Schema.fromJsonString(JournalLine));

interface Context {
  readonly session: string;
  readonly model: string;
  readonly mtimeMs: number;
}

/** The message's id, or its place in the file when it has none, and its usage record. */
const toRecord = (
  message: typeof Message.Type,
  place: string,
  context: Context,
): Option.Option<readonly [string, UsageRecord]> => {
  const usage = message.token_usage;
  if (usage === undefined) {
    return Option.none();
  }
  const reported = toCount(usage.input_tokens);
  const cacheRead = toCount(usage.cache_read_input_tokens);
  // Anthropic-style usage keeps the cache-creation field and counts cache outside the
  // input; OpenAI-style usage leaves it out and counts cache reads inside the input.
  const cacheApart = usage.cache_creation_input_tokens !== undefined || cacheRead > reported;
  return Option.some([
    message.id ?? place,
    {
      at: toEpochMs(message.timestamp, context.mtimeMs),
      cacheRead,
      cacheWrite: toCount(usage.cache_creation_input_tokens),
      input: cacheApart ? reported : exclusive(reported, cacheRead),
      model: context.model,
      output: toCount(usage.output_tokens),
      session: context.session,
    },
  ] as const);
};

/**
 * The calls of one session: its snapshot, then its journal. A journal line repeats a message
 * id to correct its usage, so the journal's copy replaces the snapshot's.
 */
const sessionRecords = (
  snapshot: typeof Snapshot.Type,
  name: string,
  snapshotMtimeMs: number,
  journal: Option.Option<{ readonly text: string; readonly mtimeMs: number }>,
): readonly UsageRecord[] => {
  const calls = new Map<string, UsageRecord>();
  const session = `jcode:${snapshot.id ?? name}`;
  let model = snapshot.model ?? unknownModel;
  for (const [index, value] of (snapshot.messages ?? []).entries()) {
    const context = { model, mtimeMs: snapshotMtimeMs, session };
    for (const message of Option.toArray(decodeMessage(value))) {
      for (const [id, record] of Option.toArray(toRecord(message, `snapshot:${index}`, context))) {
        if (!calls.has(id)) {
          calls.set(id, record);
        }
      }
    }
  }
  if (Option.isSome(journal)) {
    const lines = Option.getOrElse(decodeLines(journal.value.text, decodeJournalLine), () => []);
    for (const [lineIndex, line] of lines.entries()) {
      model = line.meta?.model ?? model;
      const context = { model, mtimeMs: journal.value.mtimeMs, session };
      for (const [index, value] of (line.append_messages ?? []).entries()) {
        const place = `journal:${lineIndex}:${index}`;
        for (const message of Option.toArray(decodeMessage(value))) {
          for (const [id, record] of Option.toArray(toRecord(message, place, context))) {
            calls.set(id, record);
          }
        }
      }
    }
  }
  return [...calls.values()].filter(
    (record) => record.input + record.output + record.cacheRead + record.cacheWrite > 0,
  );
};

/**
 * Jcode keeps one JSON snapshot per session, `<home>/sessions/session_<id>.json`, and the
 * changes since its last checkpoint in `session_<id>.journal.jsonl` beside it. The folder is
 * `JCODE_HOME`, else `~/.jcode`.
 *
 * Mapping, from each message with `token_usage` (snapshot `messages`, then journal
 * `append_messages`): `session` = `jcode:` + snapshot `id`, `model` = the session `model`
 * (a journal line's `meta.model` changes it for the messages after it), `at` = message
 * `timestamp`. `output` = `output_tokens` (`reasoning_output_tokens` is part of it).
 * `cacheRead` = `cache_read_input_tokens`, `cacheWrite` = `cache_creation_input_tokens`.
 * When the usage has a `cache_creation_input_tokens` field, `input` = `input_tokens`; when it
 * does not (OpenAI style, cache reads inside the input), `input` = `input_tokens` - cache reads.
 * A journal message with the id of a snapshot message replaces it.
 */
export const readJcode: Reader = (home) =>
  Effect.gen(function* readFromHome() {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const jcodeHome = Option.getOrElse(yield* environmentFolder("JCODE_HOME"), () =>
      path.join(home, ".jcode"),
    );
    const root = path.join(jcodeHome, "sessions");
    const skipped = (reason: SkippedSource["reason"], detail: string): SkippedSource => ({
      _tag: "Skipped",
      agent: "Jcode",
      detail,
      path: root,
      reason,
    });
    const readText = (file: string) =>
      Effect.gen(function* readWithTime() {
        const text = yield* fs.readFileString(file);
        const info = yield* fs.stat(file);
        return { mtimeMs: Option.getOrElse(info.mtime, () => new Date()).getTime(), text };
      }).pipe(Effect.option);

    const readSession = (name: string) =>
      Effect.gen(function* readOneSession() {
        const file = yield* readText(path.join(root, name));
        if (Option.isNone(file)) {
          return Option.none<readonly UsageRecord[]>();
        }
        const snapshot = decodeSnapshot(file.value.text);
        if (Option.isNone(snapshot)) {
          return Option.none<readonly UsageRecord[]>();
        }
        const stem = name.slice(0, -".json".length);
        const journal = yield* readText(path.join(root, `${stem}.journal.jsonl`));
        return Option.some(sessionRecords(snapshot.value, stem, file.value.mtimeMs, journal));
      });

    const present = yield* fs.exists(root).pipe(Effect.orElseSucceed(() => false));
    if (!present) {
      return skipped("no-data", "");
    }
    const listed = yield* fs.readDirectory(root).pipe(Effect.result);
    if (listed._tag === "Failure") {
      return skipped("unreadable", listed.failure.message);
    }
    const names = listed.success.filter(
      (name) => name.startsWith("session_") && name.endsWith(".json"),
    );
    // The unicorn rules mistake `Effect.forEach` for `Array#forEach`.
    // oxlint-disable-next-line unicorn/no-array-for-each, unicorn/no-array-method-this-argument
    const parsed = yield* Effect.forEach(names, readSession, { concurrency: 8 });
    const records = parsed.flatMap((session) => Option.getOrElse(session, () => []));
    if (records.length > 0) {
      return { _tag: "Read", records } satisfies ReadResult;
    }
    const corrupt = parsed.filter(Option.isNone).length;
    return corrupt > 0
      ? skipped("unreadable", `${corrupt} of ${names.length} files could not be parsed`)
      : skipped("no-data", "");
  });
