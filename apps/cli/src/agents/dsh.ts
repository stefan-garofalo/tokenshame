import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";

import { environmentFolder } from "./env";
import { NullableCount, NullableText, countOf } from "./json-tools";
import { unknownModel } from "./pi";
import type { ReadResult, Reader, SkippedSource, UsageRecord } from "./types";
import { zstdDecompress } from "./zstd";

const agent = "DeepSeek Harness";

const Usage = Schema.Struct({
  cacheReadTokens: NullableCount,
  cacheWriteTokens: NullableCount,
  inputTokens: NullableCount,
  outputTokens: NullableCount,
});
const OptionalUsage = Schema.optionalKey(Schema.NullOr(Usage));

const DshEvent = Schema.Struct({
  data: Schema.optionalKey(
    Schema.NullOr(
      Schema.Struct({
        attemptId: NullableText,
        compactionId: NullableText,
        header: Schema.optionalKey(
          Schema.NullOr(
            Schema.Struct({
              config: Schema.optionalKey(Schema.NullOr(Schema.Struct({ model: NullableText }))),
            }),
          ),
        ),
        inherited: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
        message: Schema.optionalKey(
          Schema.NullOr(
            Schema.Struct({
              id: NullableText,
              source: Schema.optionalKey(
                Schema.NullOr(
                  Schema.Struct({
                    model: NullableText,
                    replayState: Schema.optionalKey(
                      Schema.NullOr(
                        Schema.Struct({
                          response: Schema.optionalKey(
                            Schema.NullOr(Schema.Struct({ responseModel: NullableText })),
                          ),
                        }),
                      ),
                    ),
                  }),
                ),
              ),
            }),
          ),
        ),
        retryId: NullableText,
        step: NullableCount,
        stream: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.Unknown))),
        turn: NullableCount,
        usage: OptionalUsage,
      }),
    ),
  ),
  id: NullableText,
  seedLength: NullableCount,
  seq: NullableCount,
  time: NullableCount,
  type: NullableText,
  version: NullableCount,
});

const StreamRecord = Schema.Struct({
  chunk: Schema.optionalKey(
    Schema.NullOr(Schema.Struct({ type: NullableText, usage: OptionalUsage })),
  ),
  type: NullableText,
});

const decodeEvent = Schema.decodeUnknownOption(Schema.fromJsonString(DshEvent));
const decodeStreamRecord = Schema.decodeUnknownOption(StreamRecord);

type DshEventValue = typeof DshEvent.Type;
type UsageValue = typeof Usage.Type;

/** DSH's token meter charges the last usage chunk of a compact Assistant stream; earlier chunks are partial. */
const lastStreamUsage = (event: DshEventValue): UsageValue | undefined =>
  (event.data?.stream ?? [])
    .flatMap((raw) => {
      const record = Option.getOrUndefined(decodeStreamRecord(raw));
      const usage = record?.chunk?.usage;
      return record?.type === "chunk" &&
        record.chunk?.type === "usage" &&
        Predicate.isNotNullish(usage)
        ? [usage]
        : [];
    })
    .at(-1);

const usageOf = (event: DshEventValue): UsageValue | undefined => {
  if (event.type === "assistant/message") {
    return event.data?.usage ?? lastStreamUsage(event);
  }
  return event.type === "assistant/attempt"
    ? lastStreamUsage(event)
    : (event.data?.usage ?? undefined);
};

/** The per-call id a fork copies verbatim, so a copied call is counted once across files. */
const callId = (event: DshEventValue): string | undefined => {
  const { data } = event;
  if (event.type === "assistant/attempt") {
    const id = data?.attemptId ?? data?.retryId;
    return Predicate.isNotNullish(id) ? `attempt:${id}` : undefined;
  }
  const messageId = data?.message?.id;
  if (Predicate.isNotNullish(messageId)) {
    return `message:${messageId}`;
  }
  const compactionId = data?.compactionId;
  return event.type === "compaction/summary" && Predicate.isNotNullish(compactionId)
    ? `compaction:${compactionId}`
    : undefined;
};

const nonEmpty = (text: string | null | undefined): string | undefined =>
  Predicate.isNotNullish(text) && text.trim() !== "" ? text.trim() : undefined;

interface KeyedRecord {
  readonly key: string | undefined;
  readonly record: UsageRecord;
}

const settlementTypes = new Set(["assistant/message", "assistant/attempt", "compaction/summary"]);

/** Reading state of one transcript. */
interface Transcript {
  session: string;
  /** The last `seq` a fork copied from its parent; -1 for a session that was not forked. */
  inheritedThrough: number;
  requestModel: string | undefined;
  /** The `(turn, step)` slot of the last settlement and its index: a later sample replaces it. */
  lastSlot: { readonly slot: string; readonly index: number } | undefined;
  readonly records: KeyedRecord[];
}

/** The served model: the response's own model, else the configured one, else the request's. */
const modelOf = (event: DshEventValue, requestModel: string | undefined): string => {
  const source = event.data?.message?.source;
  return (
    nonEmpty(source?.replayState?.response?.responseModel) ??
    nonEmpty(source?.model) ??
    requestModel ??
    unknownModel
  );
};

const settle = (state: Transcript, event: DshEventValue, mtimeMs: number): void => {
  // A fork copies its parent's first events verbatim: they are the parent's calls.
  if (Predicate.isNotNullish(event.seq) && event.seq <= state.inheritedThrough) {
    return;
  }
  const usage = usageOf(event);
  if (usage === undefined) {
    return;
  }
  const time = countOf(event.time);
  const entry: KeyedRecord = {
    key: callId(event),
    record: {
      at: time > 0 ? time : mtimeMs,
      cacheRead: countOf(usage.cacheReadTokens),
      cacheWrite: countOf(usage.cacheWriteTokens),
      input: countOf(usage.inputTokens),
      model: modelOf(event, state.requestModel),
      output: countOf(usage.outputTokens),
      session: state.session,
    },
  };
  const { turn, step } = event.data ?? {};
  if (
    event.type === "compaction/summary" ||
    !Predicate.isNotNullish(turn) ||
    !Predicate.isNotNullish(step)
  ) {
    state.records.push(entry);
    if (event.type !== "compaction/summary") {
      state.lastSlot = undefined;
    }
    return;
  }
  const slot = `${turn}.${step}`;
  if (state.lastSlot?.slot === slot) {
    state.records[state.lastSlot.index] = entry;
    return;
  }
  state.lastSlot = { index: state.records.length, slot };
  state.records.push(entry);
};

/**
 * The last `seq` a fork inherited. Format 2 and later mark it with a `session/end-seed` event
 * (`data.inherited`); older formats give the count of copied events as the header's `seedLength`.
 */
const inheritedThrough = (events: readonly DshEventValue[]): number => {
  const header = events.find((event) => event.type === "session");
  if (countOf(header?.version) >= 2) {
    const marker = events.findLast(
      (event) => event.type === "session/end-seed" && event.data?.inherited === true,
    );
    return Predicate.isNotNullish(marker?.seq) ? marker.seq : -1;
  }
  return countOf(header?.seedLength) - 1;
};

const parseTranscript = (
  text: string,
  folder: string,
  mtimeMs: number,
): KeyedRecord[] | undefined => {
  const lines = text.split("\n").filter((line) => line.trim() !== "");
  const events = lines.flatMap((line) => Option.toArray(decodeEvent(line)));
  if (lines.length > 0 && events.length === 0) {
    return undefined;
  }
  const state: Transcript = {
    inheritedThrough: inheritedThrough(events),
    lastSlot: undefined,
    records: [],
    requestModel: undefined,
    session: `dsh:${folder}`,
  };
  for (const event of events) {
    if (event.type === "session") {
      state.session = `dsh:${nonEmpty(event.id) ?? folder}`;
    } else if (event.type === "request/header") {
      state.requestModel = nonEmpty(event.data?.header?.config?.model) ?? state.requestModel;
    } else if (event.type === "llm/retry-started") {
      // A retry is a second provider call for the same slot: it adds, it does not replace.
      if (state.lastSlot?.slot === `${event.data?.turn}.${event.data?.step}`) {
        state.lastSlot = undefined;
      }
    } else if (settlementTypes.has(event.type ?? "")) {
      settle(state, event, mtimeMs);
    }
  }
  return state.records;
};

const zstdMagic = [0x28, 0xb5, 0x2f, 0xfd];

/** The transcript text, or why it could not be had. */
type Decoded = { readonly text: string } | { readonly failure: "corrupt" | "no-zstd" };

const decodeBytes = (bytes: Uint8Array): Decoded => {
  const compressed = zstdMagic.every((byte, index) => bytes[index] === byte);
  if (!compressed) {
    return { text: new TextDecoder().decode(bytes) };
  }
  if (zstdDecompress === undefined) {
    return { failure: "no-zstd" };
  }
  try {
    return { text: new TextDecoder().decode(zstdDecompress(bytes)) };
  } catch {
    return { failure: "corrupt" };
  }
};

const transcriptName = /^session(?:\.v(?<version>\d+))?\.jsonl(?<zstd>\.zstd)?$/u;

/**
 * The transcript of each session folder. A folder can keep `session.jsonl` and newer
 * `session.v<N>.jsonl` generations (each plain or `.zstd`) of one log, so only the newest
 * generation is read, the compressed one first, as DSH loads it.
 */
const newestTranscripts = (entries: readonly string[], path: Path.Path): string[] => {
  const byFolder = new Map<string, { readonly entry: string; readonly rank: number }>();
  for (const entry of entries) {
    const groups = transcriptName.exec(path.basename(entry))?.groups;
    if (groups !== undefined) {
      const rank = Number(groups.version ?? 0) * 2 + (groups.zstd === undefined ? 0 : 1);
      const folder = path.dirname(entry);
      const best = byFolder.get(folder);
      if (best === undefined || rank > best.rank) {
        byFolder.set(folder, { entry, rank });
      }
    }
  }
  return [...byFolder.values()].map(({ entry }) => entry).toSorted();
};

/**
 * DeepSeek Harness (DSH). Reads every transcript below `<dsh>/sessions/` (layout
 * `<encoded-cwd>/<session>/session.jsonl.zstd`), where `<dsh>` is `DSH_HOME` when set, else
 * `~/.dsh` (the same on every platform), one transcript per session folder: the newest
 * `session.v<N>.jsonl` generation, else `session.jsonl`, compressed (`.zstd`) before plain; the
 * zstd frame header decides how to decode. A Node without `zlib.zstdDecompressSync` cannot read the
 * compressed ones: if nothing else has usage, the source is `unreadable`.
 *
 * Mapping, from `assistant/message`, `assistant/attempt` and `compaction/summary` events (a
 * summary is a real model call): usage is `data.usage`, else the last `usage` chunk of
 * `data.stream`. `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens` map to
 * `input`, `output`, `cacheRead`, `cacheWrite` (DSH keeps cache out of `inputTokens`, and
 * `outputTokens` already holds `reasoningTokens`). `model` =
 * `data.message.source.replayState.response.responseModel`, else `source.model`, else the
 * latest `request/header` model. `at` = the event `time` (epoch ms), else the file time.
 * `session` = `dsh:` + the `session` event id, else the folder name.
 *
 * Each call counts once: a later settlement for the same `data.turn`/`data.step` replaces the
 * earlier sample, unless an `llm/retry-started` for that slot came between (a retry is another
 * call). A fork copies its parent's first events (through the `session/end-seed` marker from
 * format 2, else the header's `seedLength` events), which are skipped, and a call id
 * (`data.message.id`, `compactionId`, `attemptId`) is counted once across transcripts.
 */
export const readDsh: Reader = (home) =>
  Effect.gen(function* readFromHome() {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const dshHome = yield* environmentFolder("DSH_HOME");
    const root = path.join(
      Option.getOrElse(dshHome, () => path.join(home, ".dsh")),
      "sessions",
    );
    const skipped = (reason: SkippedSource["reason"], detail: string): SkippedSource => ({
      _tag: "Skipped",
      agent,
      detail,
      path: root,
      reason,
    });

    const present = yield* fs.exists(root).pipe(Effect.orElseSucceed(() => false));
    if (!present) {
      return skipped("no-data", "");
    }
    const listed = yield* Effect.result(fs.readDirectory(root, { recursive: true }));
    if (listed._tag === "Failure") {
      return skipped("unreadable", listed.failure.message);
    }
    const files = newestTranscripts(listed.success, path);

    const seen = new Set<string>();
    const records: UsageRecord[] = [];
    let corrupt = 0;
    let noZstd = 0;
    for (const entry of files) {
      const file = path.join(root, entry);
      const bytes = yield* Effect.option(fs.readFile(file));
      const mtimeMs = yield* fs.stat(file).pipe(
        Effect.map((info) => Option.getOrElse(info.mtime, () => new Date()).getTime()),
        Effect.orElseSucceed(() => Date.now()),
      );
      const decoded = Option.match(bytes, {
        onNone: (): Decoded => ({ failure: "corrupt" }),
        onSome: decodeBytes,
      });
      const parsed =
        "text" in decoded
          ? parseTranscript(decoded.text, path.basename(path.dirname(file)), mtimeMs)
          : undefined;
      if ("failure" in decoded && decoded.failure === "no-zstd") {
        noZstd += 1;
      } else if (parsed === undefined) {
        corrupt += 1;
      }
      for (const { key, record } of parsed ?? []) {
        if (key === undefined || !seen.has(key)) {
          records.push(record);
        }
        if (key !== undefined) {
          seen.add(key);
        }
      }
    }

    const withTokens = records.filter(
      (record) => record.input + record.output + record.cacheRead + record.cacheWrite > 0,
    );
    if (withTokens.length > 0) {
      return { _tag: "Read", records: withTokens } satisfies ReadResult;
    }
    if (noZstd > 0) {
      return skipped(
        "unreadable",
        `this Node.js cannot read zstd (${noZstd} compressed transcripts)`,
      );
    }
    return corrupt > 0
      ? skipped("unreadable", `${corrupt} of ${files.length} files could not be parsed`)
      : skipped("no-data", "");
  });
