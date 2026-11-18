import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { openReadOnly } from "./sqlite";
import type { Row, SqliteError } from "./sqlite";
import type { Reader, ReadResult, SkippedSource, UsageRecord } from "./types";

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

/** One usage row, as the queries of `copilot.ts` and `goose.ts` name their columns. */
const UsageRow = Schema.Struct({
  at: Schema.Int,
  cacheRead: Count,
  cacheWrite: Count,
  input: Count,
  model: Schema.String,
  output: Count,
  session: Schema.String,
});

const ColumnRow = Schema.Struct({ column: Schema.String, table: Schema.String });

const decodeUsageRow = Schema.decodeUnknownOption(UsageRow);
const decodeColumnRow = Schema.decodeUnknownOption(ColumnRow);

/** Rows that do not decode or hold no tokens are dropped: they carry no usage. */
const toRecords = (rows: readonly Row[]): UsageRecord[] =>
  rows.flatMap((row) =>
    Option.match(decodeUsageRow(row), {
      onNone: () => [],
      onSome: (usage) =>
        usage.input + usage.output + usage.cacheRead + usage.cacheWrite > 0 ? [usage] : [],
    }),
  );

// Every column of every table, as `table.column`, so a query only names what this version
// of the agent has. Agents add columns and tables between releases.
const allColumns = `
  SELECT m.name AS "table", p.name AS "column"
  FROM sqlite_master m, pragma_table_info(m.name) p
  WHERE m.type = 'table'`;

/**
 * The SQL that lists usage rows for the columns a database has, or none when the database
 * is too old to hold usage. Columns it names are `session`, `model`, `at` (epoch
 * milliseconds), `input`, `output`, `cacheRead`, `cacheWrite`.
 */
export type BuildQuery = (columns: ReadonlySet<string>) => Option.Option<string>;

/** True when `table` has every one of the named columns. */
export const hasColumns = (
  columns: ReadonlySet<string>,
  table: string,
  names: readonly string[],
): boolean => names.every((name) => columns.has(`${table}.${name}`));

/**
 * SQL for the part of an input count that is not cache. The count includes cache reads and
 * writes; when those exceed it, the count is taken to exclude them already.
 */
export const uncachedInput = (input: string, cacheRead: string, cacheWrite: string): string =>
  `CASE WHEN COALESCE(${cacheRead}, 0) + COALESCE(${cacheWrite}, 0) <= COALESCE(${input}, 0)
    THEN COALESCE(${input}, 0) - COALESCE(${cacheRead}, 0) - COALESCE(${cacheWrite}, 0)
    ELSE COALESCE(${input}, 0) END`;

const skipped = (
  agent: string,
  path: string,
  reason: SkippedSource["reason"],
  detail: string,
): SkippedSource => ({ _tag: "Skipped", agent, detail, path, reason });

const readRows = (
  agent: string,
  file: string,
  buildQuery: BuildQuery,
): Effect.Effect<ReadResult, SqliteError> =>
  Effect.scoped(
    Effect.gen(function* scopedRead() {
      const db = yield* openReadOnly(file);
      const columns = new Set(
        (yield* db.all(allColumns)).flatMap((row) =>
          Option.toArray(
            Option.map(decodeColumnRow(row), (found) => `${found.table}.${found.column}`),
          ),
        ),
      );
      const query = buildQuery(columns);
      const records = Option.isSome(query) ? toRecords(yield* db.all(query.value)) : [];
      return records.length > 0
        ? ({ _tag: "Read", records } satisfies ReadResult)
        : skipped(agent, file, "no-data", "");
    }),
  );

/**
 * Reads usage rows from the first of `files` that exists, through the shared read-only
 * SQLite helper. Shared by the readers whose agent keeps one usage database.
 *
 * - No file exists, or the database holds no usage: `Skipped` with `no-data`.
 * - The file is not a database, is locked, or a query fails: `Skipped` with `unreadable`.
 */
export const readUsageDatabase = (
  agent: string,
  files: readonly string[],
  buildQuery: BuildQuery,
): Effect.Effect<ReadResult, never, FileSystem.FileSystem> =>
  Effect.gen(function* readDatabase() {
    const fs = yield* FileSystem.FileSystem;
    for (const file of files) {
      if (yield* fs.exists(file).pipe(Effect.orElseSucceed(() => false))) {
        return yield* readRows(agent, file, buildQuery).pipe(
          Effect.catch((error) =>
            Effect.succeed(skipped(agent, file, "unreadable", error.message)),
          ),
        );
      }
    }
    return skipped(agent, files[0] ?? "", "no-data", "");
  });

const usageColumns = [
  "cache_read_tokens",
  "cache_write_tokens",
  "created_at",
  "input_tokens",
  "model",
  "output_tokens",
  "session_id",
];

// Copilot's own columns hold no prompt text: this table is token and cost metering only.
const usageEvents = `
  SELECT
    'copilot:' || session_id AS session,
    model,
    CAST(unixepoch(created_at, 'subsec') * 1000 AS INTEGER) AS at,
    ${uncachedInput("input_tokens", "cache_read_tokens", "cache_write_tokens")} AS input,
    COALESCE(output_tokens, 0) AS output,
    COALESCE(cache_read_tokens, 0) AS cacheRead,
    COALESCE(cache_write_tokens, 0) AS cacheWrite
  FROM assistant_usage_events
  ORDER BY id`;

/**
 * GitHub Copilot CLI keeps usage in `~/.copilot/session-store.db`, table
 * `assistant_usage_events`, one row per model call (sub-agent calls too). Schema read from
 * a real install (schema and numeric columns only). Mapping:
 * - `session` = `copilot:` + `session_id`, `model` = `model`;
 * - `at` = `created_at`, an ISO text time, read by SQLite's `unixepoch`;
 * - `input_tokens` counts cache inside it (it equals uncached + `cache_read_tokens` +
 *   `cache_write_tokens`, checked against the row's `token_details_json`), so
 *   `input` = `input_tokens` - cache reads - cache writes;
 * - `output` = `output_tokens` (`reasoning_tokens` is part of it, not added).
 * A store without that table (an older Copilot CLI) is `no-data`.
 */
export const readCopilot: Reader = (home) =>
  Effect.gen(function* readFromHome() {
    const path = yield* Path.Path;
    return yield* readUsageDatabase(
      "Copilot CLI",
      [path.join(home, ".copilot", "session-store.db")],
      (columns) =>
        hasColumns(columns, "assistant_usage_events", usageColumns)
          ? Option.some(usageEvents)
          : Option.none(),
    );
  });
