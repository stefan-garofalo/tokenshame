import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { hasColumns } from "./copilot";
import { environmentFolder } from "./env";
import { readFiles, toCount, unknownModel } from "./pi";
import type { ParseFile } from "./pi";
import { openReadOnly } from "./sqlite";
import type { Row, SqliteError } from "./sqlite";
import type { Reader, ReadResult, SkippedSource, UsageRecord } from "./types";

const agent = "opencode";

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

/** One usage row, as every query below names its columns. `id` is the message id. */
const UsageRow = Schema.Struct({
  at: Schema.Int,
  cacheRead: Count,
  cacheWrite: Count,
  id: Schema.String,
  input: Count,
  model: Schema.String,
  output: Count,
  session: Schema.String,
});
type Usage = typeof UsageRow.Type;

// Token counts are read with `json_extract` so prompt text never reaches this process.
// `CASE WHEN json_valid` keeps one malformed row from failing the whole query.
// opencode keeps reasoning out of `tokens.output`, so it is added to `output`.
const usageColumns = (model: string) => `
    COALESCE(json_extract(data, '$.id'), id) AS id,
    session_id AS session,
    COALESCE(${model}, '${unknownModel}') AS model,
    CAST(COALESCE(json_extract(data, '$.time.created'), time_created) AS INTEGER) AS at,
    COALESCE(json_extract(data, '$.tokens.input'), 0) AS input,
    COALESCE(json_extract(data, '$.tokens.output'), 0)
      + COALESCE(json_extract(data, '$.tokens.reasoning'), 0) AS output,
    COALESCE(json_extract(data, '$.tokens.cache.read'), 0) AS cacheRead,
    COALESCE(json_extract(data, '$.tokens.cache.write'), 0) AS cacheWrite`;

const messageUsage = `
  SELECT ${usageColumns("json_extract(data, '$.modelID')")}
  FROM message
  WHERE CASE WHEN json_valid(data)
    THEN json_extract(data, '$.role') = 'assistant' AND json_type(data, '$.tokens') = 'object'
    ELSE 0 END
  ORDER BY time_created, id`;

// Newer opencode builds also have `session_message`: the role is the `type` column and the
// model id may sit in `model.id`.
const sessionMessageUsage = `
  SELECT ${usageColumns("COALESCE(json_extract(data, '$.modelID'), json_extract(data, '$.model.id'))")}
  FROM session_message
  WHERE type = 'assistant'
    AND CASE WHEN json_valid(data) THEN json_type(data, '$.tokens') = 'object' ELSE 0 END
  ORDER BY time_created, id`;

const sessionUsage = (columns: ReadonlySet<string>) => `
  SELECT
    id,
    id AS session,
    COALESCE(CASE WHEN json_valid(model) THEN json_extract(model, '$.id') END, '${unknownModel}') AS model,
    time_created AS at,
    tokens_input AS input,
    tokens_output + ${columns.has("session.tokens_reasoning") ? "COALESCE(tokens_reasoning, 0)" : "0"} AS output,
    tokens_cache_read AS cacheRead,
    tokens_cache_write AS cacheWrite
  FROM session
  ORDER BY time_created, id`;

const allColumns = `
  SELECT m.name || '.' || p.name AS name
  FROM sqlite_master m, pragma_table_info(m.name) p
  WHERE m.type = 'table'`;

const decodeUsageRow = Schema.decodeUnknownOption(UsageRow);
const decodeColumn = Schema.decodeUnknownOption(Schema.Struct({ name: Schema.String }));

const hasTokens = (usage: Usage): boolean =>
  usage.input + usage.output + usage.cacheRead + usage.cacheWrite > 0;

/** Rows that do not decode or hold no tokens are dropped: they carry no usage. */
const toUsage = (rows: readonly Row[]): Usage[] =>
  rows.flatMap((row) => Option.toArray(decodeUsageRow(row))).filter(hasTokens);

const toRecord = ({ id: _id, ...usage }: Usage): UsageRecord => ({
  ...usage,
  session: `${agent}:${usage.session}`,
});

/** What one database holds: per-turn messages, else (and only then) its session totals. */
interface DatabaseUsage {
  readonly messages: readonly Usage[];
  readonly totals: readonly Usage[];
}

const readDatabase = (file: string): Effect.Effect<DatabaseUsage, SqliteError> =>
  Effect.scoped(
    Effect.gen(function* scopedRead() {
      const db = yield* openReadOnly(file);
      const columns = new Set(
        (yield* db.all(allColumns)).flatMap((row) =>
          Option.toArray(Option.map(decodeColumn(row), (column) => column.name)),
        ),
      );
      const fromTable = (table: string, sql: string) =>
        hasColumns(columns, table, ["data", "id", "session_id", "time_created"])
          ? Effect.map(db.all(sql), toUsage)
          : Effect.succeed([]);
      const messages = [
        ...(yield* fromTable("message", messageUsage)),
        ...(yield* fromTable("session_message", sessionMessageUsage)),
      ];
      // opencode keeps the same tokens on message rows (per model turn) and on `session` rows
      // (summed). Session totals stand in only when no message holds usage: never both.
      const hasTotals = hasColumns(columns, "session", [
        "id",
        "model",
        "time_created",
        "tokens_cache_read",
        "tokens_cache_write",
        "tokens_input",
        "tokens_output",
      ]);
      const totals =
        messages.length === 0 && hasTotals ? toUsage(yield* db.all(sessionUsage(columns))) : [];
      return { messages, totals };
    }),
  );

const OptionalCount = Schema.optionalKey(Schema.Finite);
const Text = Schema.optionalKey(Schema.String);

/** One legacy `storage/message/<session>/<message>.json` file. */
const LegacyMessage = Schema.Struct({
  id: Text,
  modelID: Text,
  role: Text,
  sessionID: Text,
  time: Schema.optionalKey(Schema.Struct({ created: OptionalCount })),
  tokens: Schema.optionalKey(
    Schema.Struct({
      cache: Schema.optionalKey(Schema.Struct({ read: OptionalCount, write: OptionalCount })),
      input: OptionalCount,
      output: OptionalCount,
      reasoning: OptionalCount,
    }),
  ),
});

const decodeLegacyMessage = Schema.decodeUnknownOption(Schema.fromJsonString(LegacyMessage));

/** The same turn in a channel database, the legacy files, or a forked session copy. */
const fingerprint = (usage: Usage): string =>
  [usage.model, usage.at, usage.input, usage.output, usage.cacheRead, usage.cacheWrite].join("|");

/**
 * Keeps each turn once across every source of one read: by message id (the same id in a
 * database and in the legacy files) and by fingerprint (a forked session copies turns
 * under new ids).
 */
const makeDeduplicator = () => {
  const ids = new Set<string>();
  const prints = new Set<string>();
  return (usage: Usage): boolean => {
    const print = fingerprint(usage);
    if (ids.has(usage.id) || prints.has(print)) {
      return false;
    }
    ids.add(usage.id);
    prints.add(print);
    return true;
  };
};

const parseLegacy =
  (isNew: (usage: Usage) => boolean): ParseFile =>
  (file) =>
    Option.map(decodeLegacyMessage(file.text), (message) => {
      const { tokens } = message;
      if (message.role !== "assistant" || tokens === undefined) {
        return [];
      }
      const created = toCount(message.time?.created);
      const usage: Usage = {
        at: created > 0 ? created : file.mtimeMs,
        cacheRead: toCount(tokens.cache?.read),
        cacheWrite: toCount(tokens.cache?.write),
        id: message.id ?? file.segments.join("/"),
        input: toCount(tokens.input),
        model: message.modelID ?? unknownModel,
        output: toCount(tokens.output) + toCount(tokens.reasoning),
        session: message.sessionID ?? file.segments[0] ?? "",
      };
      return hasTokens(usage) && isNew(usage) ? [toRecord(usage)] : [];
    });

const channelDatabase = /^opencode(?:-[\w.-]+)?\.db$/u;

/**
 * opencode keeps usage in its data folder: `$XDG_DATA_HOME/opencode` when set, else
 * `~/.local/share/opencode` (the same on every platform). It reads:
 * - every channel database there: `opencode.db` and `opencode-<channel>.db` (for example
 *   `opencode-stable.db`), plus the file `OPENCODE_DB` names (absolute, or relative to the
 *   data folder). Tables `message` (role in `data.role`) and `session_message` (role in
 *   `type`), opened read-only through the shared SQLite helper;
 * - the legacy JSON files `storage/message/<session>/<message>.json` of installs that have
 *   not moved to SQLite.
 *
 * Mapping, from assistant messages with `tokens`: `model` = `modelID` (else `model.id`),
 * `session` = `opencode:` + session id, `at` = `time.created`. opencode keeps cache out of
 * `tokens.input` and reasoning out of `tokens.output`, so `input` = `input`, `output` =
 * `output` + `reasoning`, `cacheRead`/`cacheWrite` = `cache.read`/`cache.write`.
 * A database with no message usage falls back to its `session` totals (`tokens_*`).
 *
 * A turn counts once: by message id across databases and legacy files, and by its
 * model, time, and counts, since a forked session copies turns under new ids.
 */
export const readOpencode: Reader = (home) =>
  Effect.gen(function* readFromHome() {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const dataHome = Option.getOrElse(yield* environmentFolder("XDG_DATA_HOME"), () =>
      path.join(home, ".local", "share"),
    );
    const folder = path.join(dataHome, "opencode");
    const defaultFile = path.join(folder, "opencode.db");
    const skipped = (file: string, reason: SkippedSource["reason"], detail: string) =>
      ({ _tag: "Skipped", agent, detail, path: file, reason }) satisfies SkippedSource;

    const listed = yield* fs.readDirectory(folder).pipe(Effect.orElseSucceed((): string[] => []));
    const named = (yield* environmentFolder("OPENCODE_DB")).pipe(
      Option.filter((db) => db !== ":memory:"),
    );
    const candidates = [
      ...listed.filter((name) => channelDatabase.test(name)).toSorted(),
      ...Option.toArray(named),
    ].map((name) => (path.isAbsolute(name) ? name : path.join(folder, name)));
    const files: string[] = [];
    for (const file of new Set(candidates)) {
      if (yield* fs.exists(file).pipe(Effect.orElseSucceed(() => false))) {
        files.push(file);
      }
    }

    // oxlint-disable-next-line unicorn/no-array-for-each, unicorn/no-array-method-this-argument
    const databases = yield* Effect.forEach(files, (file) =>
      readDatabase(file).pipe(
        Effect.result,
        Effect.map((result) => ({ file, result })),
      ),
    );
    const isNew = makeDeduplicator();
    const read = databases.flatMap(({ result }) =>
      result._tag === "Success" ? [result.success] : [],
    );
    const messages = read
      .flatMap((usage) => usage.messages)
      .filter(isNew)
      .map(toRecord);
    const legacy = yield* readFiles(
      agent,
      folder,
      ["storage", "message"],
      (segments) => segments.length === 2 && segments[1]?.endsWith(".json") === true,
      parseLegacy(isNew),
    );
    const fromMessages = [...messages, ...(legacy._tag === "Read" ? legacy.records : [])];
    const sessions = new Set(fromMessages.map((record) => record.session));
    const totals = read
      .flatMap((usage) => usage.totals)
      .map(toRecord)
      .filter((record) => !sessions.has(record.session));
    const records = [...fromMessages, ...totals];
    if (records.length > 0) {
      return { _tag: "Read", records } satisfies ReadResult;
    }
    const failed = databases.find(({ result }) => result._tag === "Failure");
    if (failed !== undefined && failed.result._tag === "Failure") {
      return skipped(failed.file, "unreadable", failed.result.failure.message);
    }
    return legacy._tag === "Skipped" && legacy.reason === "unreadable"
      ? legacy
      : skipped(defaultFile, "no-data", "");
  });
