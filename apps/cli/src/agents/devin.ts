import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { hasColumns } from "./copilot";
import { columnsOf, readDatabases, rowsOf, sqlCount, sqlEpochMs, UsageRow } from "./databases";
import { environmentFolder } from "./env";
import { mergeResults, readFolders } from "./folders";
import { decodeLines, exclusive, stemOf, toCount, toEpochMs, unknownModel } from "./pi";
import type { ParseFile } from "./pi";
import type { UsageRecord, Reader } from "./types";

const agent = "Devin";

const NodeRow = Schema.Struct({
  ...UsageRow.fields,
  request: Schema.String,
});
const decodeNodeRow = Schema.decodeUnknownOption(NodeRow);

const TitleRow = Schema.Struct({
  id: Schema.String,
  model: Schema.NullOr(Schema.String),
  title: Schema.String,
});
const decodeTitleRow = Schema.decodeUnknownOption(TitleRow);

// `sessions.model` may be `adaptive`, a routing mode and not a model id.
const routingModes = new Set(["", "adaptive"]);

const field = (path: string): string => `json_extract(m.chat_message, '$.${path}')`;

const nodesQuery = (fallbackMs: number): string => `
  SELECT
    'devin:' || m.session_id AS session,
    COALESCE(
      NULLIF(${field("metadata.generation_model")}, ''),
      CASE WHEN s.model NOT IN ('', 'adaptive') THEN s.model END,
      '${unknownModel}') AS model,
    ${sqlEpochMs("m.created_at", fallbackMs)} AS at,
    COALESCE('request:' || NULLIF(${field("metadata.request_id")}, ''), 'row:' || m.rowid) AS request,
    ${sqlCount(field("metadata.metrics.input_tokens"))} AS input,
    ${sqlCount(field("metadata.metrics.output_tokens"))} AS output,
    ${sqlCount(field("metadata.metrics.cache_read_tokens"))} AS cacheRead,
    ${sqlCount(field("metadata.metrics.cache_creation_tokens"))} AS cacheWrite
  FROM message_nodes m
  LEFT JOIN sessions s ON s.id = m.session_id
  WHERE CASE WHEN json_valid(m.chat_message)
    THEN ${field("role")} = 'assistant' AND json_type(m.chat_message, '$.metadata.metrics') = 'object'
    ELSE 0 END
  ORDER BY m.rowid`;

const titlesQuery = `
  SELECT id, model, TRIM(title) AS title FROM sessions
  WHERE title IS NOT NULL AND TRIM(title) != ''`;

/** A CLI session a Desktop title names: its id and model. */
interface TitledSession {
  readonly id: string;
  readonly model: string | null;
}

/** CLI sessions by title. A title more than one session has maps to null: it names none. */
type Titles = Map<string, TitledSession | null>;

const addTitle = (titles: Titles, row: typeof TitleRow.Type) => {
  const known = titles.get(row.title);
  if (known === undefined) {
    titles.set(row.title, { id: row.id, model: row.model });
  } else if (known !== null && known.id !== row.id) {
    titles.set(row.title, null);
  }
};

// ---------------------------------------------------------------------------------------
// Devin Desktop ACP event files
// ---------------------------------------------------------------------------------------

const Count = Schema.optionalKey(Schema.Finite);
const Text = Schema.optionalKey(Schema.String);

const Line = Schema.Struct({
  notification: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
});
const decodeLine = Schema.decodeUnknownOption(Schema.fromJsonString(Line));

const InfoUpdate = Schema.Struct({
  sessionUpdate: Schema.Literal("session_info_update"),
  title: Text,
});

/** ACP `usage_update`: input and cache counts are running totals, output is per step. */
const UsageUpdate = Schema.Struct({
  _meta: Schema.Struct({
    "cognition.ai/cachedReadTokens": Count,
    "cognition.ai/cachedWriteTokens": Count,
    "cognition.ai/inputTokens": Count,
    "cognition.ai/model": Text,
    "cognition.ai/outputTokens": Count,
  }),
  sessionUpdate: Schema.Literal("usage_update"),
});

const Metrics = Schema.Struct({
  cache_creation_tokens: Count,
  cache_read_tokens: Count,
  input_tokens: Count,
  output_tokens: Count,
});

const Metadata = Schema.Struct({
  ...Metrics.fields,
  created_at: Text,
  generation_model: Text,
  metrics: Schema.optionalKey(Metrics),
});

/** Older captures: the call's metrics embedded in the notification. */
const Embedded = Schema.Struct({
  ...Metrics.fields,
  content: Schema.optionalKey(Schema.Struct({ metadata: Schema.optionalKey(Metadata) })),
  created_at: Text,
  metadata: Schema.optionalKey(Metadata),
  timestamp: Text,
});

const decodeInfo = Schema.decodeUnknownOption(InfoUpdate);
const decodeUsage = Schema.decodeUnknownOption(UsageUpdate);
const decodeEmbedded = Schema.decodeUnknownOption(Embedded);

/** One event line, parsed into the shapes this reader reads; a shape that does not fit is none. */
interface Notification {
  readonly info: Option.Option<typeof InfoUpdate.Type>;
  readonly acp: Option.Option<typeof UsageUpdate.Type>;
  readonly event: Option.Option<typeof Embedded.Type>;
}

const decodeNotification = (line: string): Option.Option<Notification> =>
  Option.map(decodeLine(line), ({ notification }) => ({
    acp: Option.flatMap(Option.fromUndefinedOr(notification), decodeUsage),
    event: Option.flatMap(Option.fromUndefinedOr(notification), decodeEmbedded),
    info: Option.flatMap(Option.fromUndefinedOr(notification), decodeInfo),
  }));

type Counts = Pick<UsageRecord, "cacheRead" | "cacheWrite" | "input" | "output">;

const countsOf = (metrics: typeof Metrics.Type): Counts => ({
  cacheRead: toCount(metrics.cache_read_tokens),
  cacheWrite: toCount(metrics.cache_creation_tokens),
  input: toCount(metrics.input_tokens),
  output: toCount(metrics.output_tokens),
});

const hasTokens = (counts: Counts): boolean =>
  counts.input + counts.output + counts.cacheRead + counts.cacheWrite > 0;

/** The first of the places older captures put metrics in that holds tokens. */
const embeddedCounts = (event: typeof Embedded.Type): Option.Option<Counts> => {
  const candidates = [
    event.content?.metadata?.metrics,
    event.metadata?.metrics,
    event.content?.metadata,
    event.metadata,
    event,
  ];
  return Option.fromUndefinedOr(
    candidates
      .flatMap((metrics) => (metrics === undefined ? [] : [countsOf(metrics)]))
      .find(hasTokens),
  );
};

/** One call: its counts, time, and the model the event names, if any. */
interface Call extends Counts {
  at: number;
  model: string | undefined;
}

/** What one event file holds: its last title, its ACP running totals, its embedded calls. */
interface FileUsage {
  title: string | undefined;
  acp: Call | undefined;
  readonly embedded: Call[];
}

const usableModel = (model: string | null | undefined): string | undefined =>
  model === null || model === undefined || routingModes.has(model) ? undefined : model;

/** Folds one ACP `usage_update` into the file's totals. False when it holds no count. */
const addAcp = (
  usage: FileUsage,
  meta: typeof UsageUpdate.Type._meta,
  hint: { at: number | undefined; model: string | undefined },
): boolean => {
  const input = meta["cognition.ai/inputTokens"];
  const cacheRead = meta["cognition.ai/cachedReadTokens"];
  const cacheWrite = meta["cognition.ai/cachedWriteTokens"];
  const output = meta["cognition.ai/outputTokens"];
  if ([input, cacheRead, cacheWrite, output].every((count) => count === undefined)) {
    return false;
  }
  const acp = usage.acp ?? {
    at: 0,
    cacheRead: 0,
    cacheWrite: 0,
    input: 0,
    model: undefined,
    output: 0,
  };
  usage.acp = {
    at: hint.at ?? acp.at,
    cacheRead: cacheRead === undefined ? acp.cacheRead : toCount(cacheRead),
    cacheWrite: cacheWrite === undefined ? acp.cacheWrite : toCount(cacheWrite),
    input: input === undefined ? acp.input : toCount(input),
    model: acp.model ?? hint.model ?? meta["cognition.ai/model"],
    output: acp.output + toCount(output),
  };
  return true;
};

const eventTime = (event: typeof Embedded.Type): string | undefined =>
  event.content?.metadata?.created_at ??
  event.metadata?.created_at ??
  event.created_at ??
  event.timestamp;

const eventModel = (event: typeof Embedded.Type): string | undefined =>
  event.content?.metadata?.generation_model ?? event.metadata?.generation_model;

/** Folds one notification into the file's usage. */
const addNotification = (usage: FileUsage, notification: Notification, mtimeMs: number) => {
  if (Option.isSome(notification.info)) {
    const title = notification.info.value.title?.trim() ?? "";
    usage.title = title === "" ? usage.title : title;
    return;
  }
  const event = Option.getOrUndefined(notification.event);
  const time = event === undefined ? undefined : eventTime(event);
  const hint = {
    at: time === undefined ? undefined : toEpochMs(time, mtimeMs),
    model: event === undefined ? undefined : eventModel(event),
  };
  if (Option.isSome(notification.acp) && addAcp(usage, notification.acp.value._meta, hint)) {
    return;
  }
  if (event !== undefined) {
    for (const counts of Option.toArray(embeddedCounts(event))) {
      usage.embedded.push({ ...counts, at: hint.at ?? mtimeMs, model: hint.model });
    }
  }
};

/**
 * A parser for Devin Desktop event files. A file whose title names one CLI session is that
 * session; when the CLI database already has usage for it, the file is dropped, as the CLI
 * logged the same calls. A file name is read once, so a folder found twice counts once.
 */
const desktopParser = (titles: Titles, cliSessions: ReadonlySet<string>): ParseFile => {
  const seenFiles = new Set<string>();
  return (file) =>
    Option.map(decodeLines(file.text, decodeNotification), (lines) => {
      const stem = stemOf(file.segments, ".ndjson");
      if (seenFiles.has(stem)) {
        return [];
      }
      seenFiles.add(stem);
      const usage: FileUsage = { acp: undefined, embedded: [], title: undefined };
      for (const notification of lines) {
        addNotification(usage, notification, file.mtimeMs);
      }
      const titled = usage.title === undefined ? undefined : titles.get(usage.title);
      const session = `devin:${titled?.id ?? stem}`;
      if (cliSessions.has(session)) {
        return [];
      }
      // ACP `inputTokens` holds the cache reads; one record per file from the running totals.
      const calls =
        usage.acp === undefined
          ? usage.embedded
          : [
              {
                ...usage.acp,
                at: usage.acp.at > 0 ? usage.acp.at : file.mtimeMs,
                input: exclusive(usage.acp.input, usage.acp.cacheRead),
              },
            ];
      return calls.map((call): UsageRecord => ({
        at: call.at,
        cacheRead: call.cacheRead,
        cacheWrite: call.cacheWrite,
        input: call.input,
        model: usableModel(titled?.model) ?? usableModel(call.model) ?? unknownModel,
        output: call.output,
        session,
      }));
    });
};

/**
 * Devin (Cognition). Two sources, read together:
 *
 * Devin CLI keeps sessions in SQLite `sessions.db` in `$XDG_DATA_HOME/devin/cli`, else
 * `~/.local/share/devin/cli`, and `~/AppData/Roaming/devin/cli` (Windows). Table
 * `message_nodes` (`session_id`, `chat_message` JSON, `created_at` epoch seconds) has one row
 * per message; an assistant message carries its call's usage in
 * `chat_message.metadata.metrics`. Mapping: `session` = `devin:` + `session_id`, `model` =
 * `metadata.generation_model` (else `sessions.model` unless it is the `adaptive` routing
 * mode, else unknown), `at` = `created_at`; `input_tokens` (excludes cache reads),
 * `output_tokens`, `cache_read_tokens`, `cache_creation_tokens` map to input, output,
 * cache read, cache write. Devin can store one response in several rows (retries,
 * branches): rows with the same `metadata.request_id` in a session count once.
 * `metadata.num_tokens` alone has no split, so a row without metrics is not counted.
 *
 * Devin Desktop runs the CLI and streams its ACP events to `User/acp-events/*.ndjson` below
 * `~/Library/Application Support/Devin` (macOS), `~/.config/Devin` or `~/.config/devin`
 * (Linux), `~/AppData/Roaming/Devin` (Windows). One record per file: ACP `usage_update`
 * events hold running totals of input (cache reads inside it) and cache, and per-step
 * output, so `input` = last `inputTokens` - last `cachedReadTokens`, `cacheRead` = last
 * `cachedReadTokens`, `cacheWrite` = last `cachedWriteTokens`, `output` = sum of
 * `outputTokens`. Older captures embed per-call `metrics` instead, one record each. A file
 * whose `session_info_update` title matches exactly one CLI session (`sessions.title`) is
 * that session and takes its model; when the CLI database has usage for that session, the
 * file is dropped, as the same calls are already counted. Otherwise the session is
 * `devin:` + the file name.
 */
export const readDevin: Reader = (home) =>
  Effect.gen(function* readFromHome() {
    const path = yield* Path.Path;
    const dataHome = Option.getOrElse(yield* environmentFolder("XDG_DATA_HOME"), () =>
      path.join(home, ".local", "share"),
    );
    const titles: Titles = new Map();
    const cli = yield* readDatabases(
      agent,
      [
        path.join(dataHome, "devin", "cli", "sessions.db"),
        path.join(home, "AppData", "Roaming", "devin", "cli", "sessions.db"),
      ],
      (db, source) =>
        Effect.gen(function* readNodes() {
          const columns = yield* columnsOf(db);
          if (hasColumns(columns, "sessions", ["id", "model", "title"])) {
            for (const row of rowsOf(yield* db.all(titlesQuery), decodeTitleRow)) {
              addTitle(titles, row);
            }
          }
          if (
            !hasColumns(columns, "message_nodes", ["chat_message", "created_at", "session_id"]) ||
            !hasColumns(columns, "sessions", ["id", "model"])
          ) {
            return [];
          }
          const seen = new Set<string>();
          const records: UsageRecord[] = [];
          for (const { request, ...record } of rowsOf(
            yield* db.all(nodesQuery(source.mtimeMs)),
            decodeNodeRow,
          )) {
            const key = `${record.session}:${request}`;
            if (!seen.has(key)) {
              seen.add(key);
              records.push(record);
            }
          }
          return records;
        }),
    );
    const cliSessions = new Set(cli._tag === "Read" ? cli.records.map((row) => row.session) : []);
    const events = ["User", "acp-events"];
    const desktop = yield* readFolders(
      agent,
      [
        path.join(home, "Library", "Application Support", "Devin", ...events),
        path.join(home, ".config", "Devin", ...events),
        path.join(home, ".config", "devin", ...events),
        path.join(home, "AppData", "Roaming", "Devin", ...events),
      ],
      (segments) => segments.at(-1)?.endsWith(".ndjson") === true,
      desktopParser(titles, cliSessions),
    );
    return mergeResults([cli, desktop]);
  });
