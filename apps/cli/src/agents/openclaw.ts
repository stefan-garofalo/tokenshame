import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { countOnce, toCount, toEpochMs, unknownModel } from "./pi";
import type { PiCall } from "./pi";
import { openReadOnly } from "./sqlite";
import type { Reader, ReadResult, SkippedSource, UsageRecord } from "./types";
import { zstdDecompress, zstdMissing } from "./zstd";

const Count = Schema.optionalKey(Schema.Finite);
const Text = Schema.optionalKey(Schema.String);

/** The part of an OpenClaw transcript event the reader uses; the same in SQLite and JSONL. */
const Event = Schema.Struct({
  customType: Text,
  data: Schema.optionalKey(Schema.Struct({ modelId: Text })),
  id: Text,
  message: Schema.optionalKey(
    Schema.Struct({
      model: Text,
      role: Text,
      timestamp: Count,
      usage: Schema.optionalKey(
        Schema.Struct({ cacheRead: Count, cacheWrite: Count, input: Count, output: Count }),
      ),
    }),
  ),
  modelId: Text,
  timestamp: Text,
  type: Text,
});

const decodeEvent = Schema.decodeUnknownOption(Schema.fromJsonString(Event));

const Bytes = Schema.NullOr(Schema.Uint8Array);
const Time = Schema.NullOr(Schema.Finite);

const EventRow = Schema.Struct({
  createdAt: Time,
  json: Schema.NullOr(Schema.String),
  model: Schema.NullOr(Schema.String),
  session: Schema.String,
  zstd: Bytes,
});

const ArchiveRow = Schema.Struct({
  blob: Bytes,
  createdAt: Time,
  encoding: Schema.String,
  session: Schema.String,
});

const ColumnRow = Schema.Struct({ column: Schema.String, table: Schema.String });

const decodeEventRow = Schema.decodeUnknownOption(EventRow);
const decodeArchiveRow = Schema.decodeUnknownOption(ArchiveRow);
const decodeColumnRow = Schema.decodeUnknownOption(ColumnRow);

/** Times below this are epoch seconds, not milliseconds. */
const millisecondsFrom = 1e12;

const epochMs = (time: number): number => Math.trunc(time < millisecondsFrom ? time * 1000 : time);

/** The model a session runs, carried from event to event as OpenClaw reads it. */
interface ModelState {
  current: string | undefined;
}

interface SessionContext {
  readonly session: string;
  /** When the event has no time of its own. */
  readonly fallbackMs: number;
  /** The session's current model as the store records it: the last fallback. */
  readonly storeModel: string | undefined;
}

/**
 * Feeds one event through the session's model state and returns its call, if it is one. The
 * key names the event across both stores and fork copies: its id, its own time, and counts.
 */
const ingest = (
  event: typeof Event.Type,
  state: ModelState,
  context: SessionContext,
): readonly PiCall[] => {
  if (event.type === "model_change") {
    state.current = event.modelId ?? state.current;
    return [];
  }
  if (event.type === "custom" && event.customType === "model-snapshot") {
    state.current = event.data?.modelId ?? state.current;
    return [];
  }
  const { message } = event;
  const usage = message?.usage;
  if (event.type !== "message" || message?.role !== "assistant" || usage === undefined) {
    return [];
  }
  const model = message.model ?? state.current ?? context.storeModel ?? unknownModel;
  state.current = message.model ?? state.current;
  const record: UsageRecord = {
    at:
      message.timestamp === undefined
        ? toEpochMs(event.timestamp, context.fallbackMs)
        : Math.trunc(message.timestamp),
    cacheRead: toCount(usage.cacheRead),
    cacheWrite: toCount(usage.cacheWrite),
    input: toCount(usage.input),
    model,
    output: toCount(usage.output),
    session: `openclaw:${context.session}`,
  };
  const key =
    event.id === undefined
      ? undefined
      : `${event.id}:${message.timestamp ?? ""}:${record.input}:${record.output}`;
  return [{ id: event.id, key, record }];
};

/** The calls of one JSONL transcript text; none when it has lines and none decode. */
const transcriptCalls = (
  text: string,
  context: SessionContext,
): Option.Option<readonly PiCall[]> => {
  const lines = text.split("\n").filter((line) => line.trim() !== "");
  const events = lines.flatMap((line) => Option.toArray(decodeEvent(line)));
  if (lines.length > 0 && events.length === 0) {
    return Option.none();
  }
  const state: ModelState = { current: undefined };
  return Option.some(events.flatMap((event) => ingest(event, state, context)));
};

/** The text of a stored payload, or the cause it could not be read. */
interface Unpacked {
  readonly text?: string;
  readonly failure?: string;
}

/** Text of a zstd payload, or the cause it could not be read. */
const unzstd = (bytes: Uint8Array): Unpacked => {
  if (zstdDecompress === undefined) {
    return { failure: zstdMissing };
  }
  try {
    return { text: new TextDecoder().decode(zstdDecompress(bytes)) };
  } catch {
    return { failure: "a compressed transcript could not be decoded" };
  }
};

/** The event text of a `transcript_events` row: `event_json`, else the `event_zstd` blob. */
const eventText = (json: string | null, zstd: Uint8Array | null): Unpacked => {
  if (json !== null) {
    return { text: json };
  }
  return zstd === null ? {} : unzstd(zstd);
};

/** The JSONL text of a `session_transcript_archives` blob, `identity` or `zstd` encoded. */
const archiveText = (encoding: string, blob: Uint8Array | null): Unpacked => {
  if (blob === null) {
    return {};
  }
  return encoding === "zstd" ? unzstd(blob) : { text: new TextDecoder().decode(blob) };
};

/** A part that could not be read: no calls, and its cause. */
const failed = (error: { readonly message: string }): Found => ({
  calls: [],
  failures: [error.message],
});

// Every column of every table, as `table.column`, so the queries name only what this store has.
const allColumns = `
  SELECT m.name AS "table", p.name AS "column"
  FROM sqlite_master m, pragma_table_info(m.name) p
  WHERE m.type = 'table'`;

const has = (columns: ReadonlySet<string>, table: string, names: readonly string[]): boolean =>
  names.every((name) => columns.has(`${table}.${name}`));

const eventsQuery = (columns: ReadonlySet<string>): string => {
  const zstd = has(columns, "transcript_events", ["event_zstd"]) ? "e.event_zstd" : "NULL";
  const store = ["session_windows", "sessions"].find((table) =>
    has(columns, table, ["session_id", "model"]),
  );
  return `
    SELECT e.session_id AS session, e.event_json AS json, ${zstd} AS zstd,
      e.created_at AS createdAt, ${store === undefined ? "NULL" : "s.model"} AS model
    FROM transcript_events e
    ${store === undefined ? "" : `LEFT JOIN ${store} s ON s.session_id = e.session_id`}
    WHERE e.event_json IS NULL
      OR instr(e.event_json, '"usage"') > 0
      OR instr(e.event_json, '"model_change"') > 0
      OR instr(e.event_json, '"model-snapshot"') > 0
    ORDER BY e.session_id, e.seq`;
};

const archivesQuery = `
  SELECT session_id AS session, encoding, archive_blob AS blob, created_at AS createdAt
  FROM session_transcript_archives
  ORDER BY session_id, generation`;

interface Found {
  readonly calls: readonly PiCall[];
  /** Causes of the parts that could not be read. */
  readonly failures: readonly string[];
}

/**
 * The calls in one per-agent database: live `transcript_events` (JSON text or zstd blobs) and
 * the transcripts of deleted or reset sessions in `session_transcript_archives`.
 */
const readDatabase = (file: string, mtimeMs: number): Effect.Effect<Found> =>
  Effect.scoped(
    Effect.gen(function* scopedRead() {
      const db = yield* openReadOnly(file);
      const columns = new Set(
        (yield* db.all(allColumns)).flatMap((row) =>
          Option.toArray(decodeColumnRow(row)).map(({ column, table }) => `${table}.${column}`),
        ),
      );
      const calls: PiCall[] = [];
      const failures: string[] = [];
      if (has(columns, "transcript_events", ["session_id", "seq", "event_json", "created_at"])) {
        const states = new Map<string, ModelState>();
        for (const row of yield* db.all(eventsQuery(columns))) {
          for (const event of Option.toArray(decodeEventRow(row))) {
            const state = states.get(event.session) ?? { current: undefined };
            states.set(event.session, state);
            const { failure, text } = eventText(event.json, event.zstd);
            failures.push(...(failure === undefined ? [] : [failure]));
            const context = {
              fallbackMs: event.createdAt === null ? mtimeMs : epochMs(event.createdAt),
              session: event.session,
              storeModel: event.model ?? undefined,
            };
            for (const found of Option.toArray(decodeEvent(text ?? ""))) {
              calls.push(...ingest(found, state, context));
            }
          }
        }
      }
      if (has(columns, "session_transcript_archives", ["session_id", "encoding", "archive_blob"])) {
        for (const row of yield* db.all(archivesQuery)) {
          for (const archive of Option.toArray(decodeArchiveRow(row))) {
            const { failure, text } = archiveText(archive.encoding, archive.blob);
            failures.push(...(failure === undefined ? [] : [failure]));
            const context = {
              fallbackMs: archive.createdAt === null ? mtimeMs : epochMs(archive.createdAt),
              session: archive.session,
              storeModel: undefined,
            };
            calls.push(...Option.getOrElse(transcriptCalls(text ?? "", context), () => []));
          }
        }
      }
      return { calls, failures };
    }),
  ).pipe(Effect.match({ onFailure: failed, onSuccess: (found) => found }));

const transcriptMark = ".jsonl";

/**
 * True for a transcript and every copy OpenClaw makes by adding a suffix to its name
 * (`.jsonl.deleted.<time>`, `.jsonl.reset.<time>`, `.jsonl.zst`, doctor backups), but not the
 * `.json` sidecars, and not the Codex homes OpenClaw keeps inside an agent folder.
 */
const isTranscript = (segments: readonly string[]): boolean => {
  const name = segments.at(-1) ?? "";
  const mark = name.indexOf(transcriptMark);
  const suffix = name.slice(mark + transcriptMark.length);
  const insideCodexHome = segments.some(
    (segment, index) =>
      segments[index - 1] === "agent" && (segment === "codex-home" || segment === "cli-auth"),
  );
  return (
    mark > 0 &&
    !insideCodexHome &&
    (suffix === "" ||
      (suffix.startsWith(".") && !suffix.endsWith(".json") && !suffix.endsWith(".json.migrated")))
  );
};

/**
 * OpenClaw (and its earlier names Clawdbot and Moltbot) keeps one folder per agent below
 * `~/.openclaw/agents`, `~/.clawdbot/agents`, `~/.moltbot/agents` and `~/.moldbot/agents`;
 * all are read. Each agent folder holds:
 * - `agent/openclaw-agent.sqlite` (current OpenClaw): table `transcript_events`, one event per
 *   row as `event_json` text or an `event_zstd` blob, and `session_transcript_archives`, the
 *   transcripts of deleted or reset sessions (`identity` or `zstd` blobs);
 * - `sessions/<id>.jsonl` (older OpenClaw), plus archived copies such as
 *   `<id>.jsonl.deleted.<time>` and `<id>.jsonl.zst`.
 * zstd needs Node 22.15 or newer; on an older Node those parts are skipped.
 *
 * Mapping, from `message` events with `role: "assistant"` and `message.usage`: `input`,
 * `output`, `cacheRead`, `cacheWrite` map to the same-named fields (cache is apart from
 * input; reasoning is part of output). `model` = `message.model`, else the last
 * `model_change` `modelId` or `model-snapshot` `data.modelId`, else the session's model in
 * `session_windows` (or `sessions`). `at` = `message.timestamp` (epoch ms), else the event
 * `timestamp`, else the row's `created_at` or the file time. `session` = `openclaw:` + the
 * row's `session_id`, or the file name before `.jsonl`.
 *
 * OpenClaw imports JSONL history into SQLite and keeps the files, and `/fork` copies events
 * into a new session, so an event is counted once by its id, its own time and its counts:
 * the database copy first.
 */
export const readOpenClaw: Reader = (home) =>
  Effect.gen(function* readFromHome() {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const roots = [".openclaw", ".clawdbot", ".moltbot", ".moldbot"].map((name) =>
      path.join(home, name, "agents"),
    );
    const skipped = (reason: SkippedSource["reason"], detail: string): SkippedSource => ({
      _tag: "Skipped",
      agent: "OpenClaw",
      detail,
      path: roots[0] ?? home,
      reason,
    });
    const exists = (file: string) => fs.exists(file).pipe(Effect.orElseSucceed(() => false));
    const mtimeOf = (file: string) =>
      fs.stat(file).pipe(
        Effect.map(({ mtime }) => Option.getOrElse(mtime, () => new Date()).getTime()),
        Effect.orElseSucceed(() => Date.now()),
      );

    const readTranscript = (root: string, segments: readonly string[]) =>
      Effect.gen(function* readOneTranscript() {
        const file = path.join(root, ...segments);
        const name = segments.at(-1) ?? "";
        const context = {
          fallbackMs: yield* mtimeOf(file),
          session: name.slice(0, name.indexOf(transcriptMark)),
          storeModel: undefined,
        };
        const unpacked = name.endsWith(".zst")
          ? unzstd(yield* fs.readFile(file))
          : { text: yield* fs.readFileString(file) };
        if (unpacked.text === undefined) {
          return { calls: [], failures: [unpacked.failure ?? zstdMissing] } satisfies Found;
        }
        return Option.match(transcriptCalls(unpacked.text, context), {
          onNone: () => ({ calls: [], failures: [`${name} could not be parsed`] }),
          onSome: (calls) => ({ calls, failures: [] }),
        }) satisfies Found;
      }).pipe(Effect.match({ onFailure: failed, onSuccess: (found) => found }));

    const readRoot = (root: string) =>
      Effect.gen(function* readAgentsFolder() {
        const found: Found[] = [];
        const agents = yield* fs.readDirectory(root);
        for (const agent of agents) {
          const database = path.join(root, agent, "agent", "openclaw-agent.sqlite");
          if (yield* exists(database)) {
            found.push(yield* readDatabase(database, yield* mtimeOf(database)));
          }
        }
        const transcripts = (yield* fs.readDirectory(root, { recursive: true }))
          .map((entry) => entry.split(path.sep))
          .filter(isTranscript);
        // The unicorn rules mistake `Effect.forEach` for `Array#forEach`.
        // oxlint-disable-next-line unicorn/no-array-for-each, unicorn/no-array-method-this-argument
        const read = yield* Effect.forEach(
          transcripts,
          (segments) => readTranscript(root, segments),
          {
            concurrency: 8,
          },
        );
        return [...found, ...read];
      }).pipe(Effect.match({ onFailure: (error) => [failed(error)], onSuccess: (found) => found }));

    const seen = new Set<string>();
    const records: UsageRecord[] = [];
    const failures: string[] = [];
    for (const root of roots) {
      if (yield* exists(root)) {
        for (const found of yield* readRoot(root)) {
          records.push(...countOnce(seen, found.calls));
          failures.push(...found.failures);
        }
      }
    }
    const usage = records.filter(
      (record) => record.input + record.output + record.cacheRead + record.cacheWrite > 0,
    );
    if (usage.length > 0) {
      return { _tag: "Read", records: usage } satisfies ReadResult;
    }
    return failures.length > 0 ? skipped("unreadable", failures[0] ?? "") : skipped("no-data", "");
  });
