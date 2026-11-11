import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";
import { DatabaseSync } from "node:sqlite";
import type { SQLOutputValue } from "node:sqlite";

// NOTE: `node:sqlite` is experimental until Node 24 and prints an ExperimentalWarning
// the first time it loads on Node >=22.13. This module does not hide it; the CLI entry
// owns the one narrow warning filter (AC-017).

/**
 * A SQLite source that could not be opened or read: missing, not a database, locked,
 * or refused a write. `message` is the short cause a reader puts into a Skipped result.
 */
export class SqliteError extends Data.TaggedError("SqliteError")<{
  readonly path: string;
  readonly message: string;
}> {}

/** One result row: column name to value. */
export type Row = Readonly<Record<string, SQLOutputValue>>;

export interface ReadOnlyDatabase {
  /** Runs one SQL statement and returns all rows. A write statement fails with `SqliteError`. */
  readonly all: (sql: string) => Effect.Effect<readonly Row[], SqliteError>;
}

/**
 * Opens an agent's SQLite database for reading and closes it when the scope closes.
 *
 * Read-only at the SQLite level (`readOnly: true`), so no statement can write. It never
 * sets `?immutable=1`: an agent may write while this runs, and `immutable` would skip
 * the write-ahead log and return stale or torn data. A database with a live write-ahead
 * log and an open writer reads fine.
 *
 * A file that is not a database or is locked can open fine and fail on first read, so
 * every `all` failure is a `SqliteError` as well.
 */
export const openReadOnly = (
  path: string,
): Effect.Effect<ReadOnlyDatabase, SqliteError, Scope.Scope> => {
  const failure = (error: Error): SqliteError => new SqliteError({ message: error.message, path });
  return Effect.acquireRelease(
    Effect.try({
      catch: (error) => failure(error instanceof Error ? error : new Error(String(error))),
      try: () => new DatabaseSync(path, { readOnly: true }),
    }),
    (db) =>
      Effect.ignore(
        Effect.try(() => {
          db.close();
        }),
      ),
  ).pipe(
    Effect.map((db) => ({
      all: (sql) =>
        Effect.try({
          catch: (error) => failure(error instanceof Error ? error : new Error(String(error))),
          try: () => db.prepare(sql).all(),
        }),
    })),
  );
};
