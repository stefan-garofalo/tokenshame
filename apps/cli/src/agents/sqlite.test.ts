import { assert, describe, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Scope from "effect/Scope";
import { DatabaseSync } from "node:sqlite";

import { openReadOnly, SqliteError } from "./sqlite";

/** A temp folder per test; removed when the test scope closes. */
const tempFolder = Effect.gen(function* buildFolder() {
  const fs = yield* FileSystem.FileSystem;
  return yield* fs.makeTempDirectoryScoped();
});

/** A database file with one `usage` table holding two rows, made with `node:sqlite` itself. */
const makeDatabase = (journalMode: "wal" | "delete") =>
  Effect.gen(function* buildDatabase() {
    const path = (yield* Path.Path).join(yield* tempFolder, "fixture.db");
    const writer = yield* Effect.acquireRelease(
      Effect.sync(() => new DatabaseSync(path)),
      (db) =>
        Effect.sync(() => {
          db.close();
        }),
    );
    writer.exec(`PRAGMA journal_mode = ${journalMode}`);
    writer.exec("CREATE TABLE usage (model TEXT NOT NULL, tokens INTEGER NOT NULL)");
    writer.exec("INSERT INTO usage VALUES ('model-a', 10), ('model-b', 20)");
    return { path, writer };
  });

describe(openReadOnly, () => {
  it.effect("reads rows from a database", () =>
    Effect.gen(function* scenario() {
      const { path } = yield* makeDatabase("delete");
      const db = yield* openReadOnly(path);
      const rows = yield* db.all("SELECT model, tokens FROM usage ORDER BY model");
      assert.deepStrictEqual(
        rows.map((row) => ({ ...row })),
        [
          { model: "model-a", tokens: 10 },
          { model: "model-b", tokens: 20 },
        ],
      );
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("reads rows still in the write-ahead log of a database with a live writer", () =>
    Effect.gen(function* scenario() {
      const { path, writer } = yield* makeDatabase("wal");
      // Keep new rows in the write-ahead log: no checkpoint may fold them into the main file.
      writer.exec("PRAGMA wal_autocheckpoint = 0");
      writer.exec("INSERT INTO usage VALUES ('model-c', 30)");
      const db = yield* openReadOnly(path);
      const rows = yield* db.all("SELECT SUM(tokens) AS total FROM usage");
      assert.strictEqual(rows[0]?.total, 60);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("fails with SqliteError when the file is missing", () =>
    Effect.gen(function* scenario() {
      const path = (yield* Path.Path).join(yield* tempFolder, "missing.db");
      const error = yield* Effect.flip(openReadOnly(path));
      assert.instanceOf(error, SqliteError);
      assert.strictEqual(error.path, path);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("fails with SqliteError when the file is not a database", () =>
    Effect.gen(function* scenario() {
      const fs = yield* FileSystem.FileSystem;
      const path = (yield* Path.Path).join(yield* tempFolder, "corrupt.db");
      yield* fs.writeFileString(path, "this is not a database, it is only text. ".repeat(100));
      const error = yield* Effect.flip(
        Effect.flatMap(openReadOnly(path), (db) => db.all("SELECT 1")),
      );
      assert.instanceOf(error, SqliteError);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("fails with SqliteError while another connection locks the database", () =>
    Effect.gen(function* scenario() {
      const { path, writer } = yield* makeDatabase("delete");
      writer.exec("BEGIN EXCLUSIVE");
      const error = yield* Effect.flip(
        Effect.flatMap(openReadOnly(path), (db) => db.all("SELECT model FROM usage")),
      );
      assert.instanceOf(error, SqliteError);
      writer.exec("ROLLBACK");
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("never writes", () =>
    Effect.gen(function* scenario() {
      const { path } = yield* makeDatabase("delete");
      const db = yield* openReadOnly(path);
      const error = yield* Effect.flip(db.all("INSERT INTO usage VALUES ('model-z', 1)"));
      assert.instanceOf(error, SqliteError);
      const rows = yield* db.all("SELECT COUNT(*) AS rows FROM usage");
      assert.strictEqual(rows[0]?.rows, 2);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("closes the database when the scope closes", () =>
    Effect.gen(function* scenario() {
      const { path } = yield* makeDatabase("delete");
      const scope = yield* Scope.make();
      const db = yield* openReadOnly(path).pipe(Scope.provide(scope));
      yield* db.all("SELECT 1");
      yield* Scope.close(scope, Exit.void);
      const error = yield* Effect.flip(db.all("SELECT 1"));
      assert.instanceOf(error, SqliteError);
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
