import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { hasTokens } from "./pi";
import { openReadOnly } from "./sqlite";
import type { ReadOnlyDatabase, Row } from "./sqlite";
import type { ReadResult, SkippedSource, UsageRecord } from "./types";

// Shared by the readers of agents that keep usage in one or more SQLite databases each
// (Kilo CLI, Zed Agent, Hermes Agent, MiMo, Devin CLI, BB, Forge).

/** A database that exists: its path and last change, the fallback time for undated usage. */
export interface DatabaseFile {
  readonly file: string;
  readonly mtimeMs: number;
}

/** Why a database could not be read, as a short cause for a Skipped result. */
export interface ReadFailure {
  readonly message: string;
}

/** Reads the usage of one open database. */
export type ReadDatabase = (
  db: ReadOnlyDatabase,
  source: DatabaseFile,
) => Effect.Effect<readonly UsageRecord[], ReadFailure>;

const ColumnRow = Schema.Struct({ column: Schema.String, table: Schema.String });
const decodeColumnRow = Schema.decodeUnknownOption(ColumnRow);

/** The rows that decode; the others are dropped. */
export const rowsOf = <A>(rows: readonly Row[], decode: (row: Row) => Option.Option<A>): A[] =>
  rows.flatMap((row) => Option.toArray(decode(row)));

/**
 * Every column of every table, as `table.column`, so a query names only what this version
 * of the agent has. Agents add tables and columns between releases.
 */
export const columnsOf = (db: ReadOnlyDatabase) =>
  Effect.map(
    db.all(`
      SELECT m.name AS "table", p.name AS "column"
      FROM sqlite_master m, pragma_table_info(m.name) p
      WHERE m.type = 'table'`),
    (rows) =>
      new Set(rowsOf(rows, decodeColumnRow).map((found) => `${found.table}.${found.column}`)),
  );

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

/** One usage row, as the queries of this batch name their columns. */
export const UsageRow = Schema.Struct({
  at: Schema.Int,
  cacheRead: Count,
  cacheWrite: Count,
  input: Count,
  model: Schema.String,
  output: Count,
  session: Schema.String,
});

/** The usage rows that decode. */
export const usageRows = (rows: readonly Row[]): UsageRecord[] =>
  rowsOf(rows, Schema.decodeUnknownOption(UsageRow));

/** A token count read by SQL: whole, and 0 when missing or negative. */
export const sqlCount = (expression: string): string =>
  `MAX(CAST(COALESCE(${expression}, 0) AS INTEGER), 0)`;

/** Epoch milliseconds by SQL, from a number in seconds or milliseconds; `fallback` when missing. */
export const sqlEpochMs = (expression: string, fallback: number): string =>
  `CAST(CASE
    WHEN ${expression} IS NULL OR ${expression} <= 0 THEN ${fallback}
    WHEN ${expression} < 100000000000 THEN ${expression} * 1000
    ELSE ${expression} END AS INTEGER)`;

const skipped = (
  agent: string,
  path: string,
  reason: SkippedSource["reason"],
  detail: string,
): SkippedSource => ({ _tag: "Skipped", agent, detail, path, reason });

const readOne = (read: ReadDatabase, source: DatabaseFile) =>
  Effect.scoped(Effect.flatMap(openReadOnly(source.file), (db) => read(db, source))).pipe(
    Effect.result,
  );

/**
 * Reads every database of `files` that exists, each path once, and joins their usage.
 *
 * - No file exists, or none holds usage: `Skipped` with `no-data`.
 * - No database holds usage and one could not be opened or read: `Skipped` with `unreadable`.
 * - Otherwise the records of the databases that read. A failed database never throws.
 */
export const readDatabases = (
  agent: string,
  files: readonly string[],
  read: ReadDatabase,
): Effect.Effect<ReadResult, never, FileSystem.FileSystem> =>
  Effect.gen(function* readAll() {
    const fs = yield* FileSystem.FileSystem;
    const present = (file: string) =>
      Effect.option(fs.stat(file)).pipe(
        Effect.map(Option.filter((stat) => stat.type === "File")),
        Effect.map(
          Option.map((stat): DatabaseFile => ({
            file,
            mtimeMs: stat.mtime.pipe(
              Option.map((time) => time.getTime()),
              Option.getOrElse(() => 0),
            ),
          })),
        ),
      );
    // The unicorn rules mistake `Effect.forEach` for `Array#forEach`.
    // oxlint-disable-next-line unicorn/no-array-for-each, unicorn/no-array-method-this-argument
    const found = yield* Effect.forEach([...new Set(files)], present);
    const sources = found.flatMap((source) => Option.toArray(source));
    // Sequential, so a reader that drops repeated usage across databases sees them in order.
    // oxlint-disable-next-line unicorn/no-array-for-each, unicorn/no-array-method-this-argument
    const results = yield* Effect.forEach(sources, (source) => readOne(read, source));

    const records = results
      .flatMap((result) => (Result.isSuccess(result) ? result.success : []))
      .filter(hasTokens);
    if (records.length > 0) {
      return { _tag: "Read", records } satisfies ReadResult;
    }
    const failure = results.find(Result.isFailure);
    const path = sources[0]?.file ?? files[0] ?? "";
    return failure === undefined
      ? skipped(agent, path, "no-data", "")
      : skipped(agent, path, "unreadable", failure.failure.message);
  });
