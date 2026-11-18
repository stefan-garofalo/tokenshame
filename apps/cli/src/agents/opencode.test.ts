import { assert, describe, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { DatabaseSync } from "node:sqlite";

import { readOpencode } from "./opencode";
import type { ReadResult, UsageRecord } from "./types";

// A synthetic subset of the opencode schema: only what the reader may touch.
const schema = `
  CREATE TABLE session (
    id TEXT PRIMARY KEY,
    time_created INTEGER NOT NULL,
    model TEXT,
    tokens_input INTEGER NOT NULL DEFAULT 0,
    tokens_output INTEGER NOT NULL DEFAULT 0,
    tokens_cache_read INTEGER NOT NULL DEFAULT 0,
    tokens_cache_write INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE message (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    time_created INTEGER NOT NULL,
    data TEXT NOT NULL
  );
`;

interface Turn {
  readonly session: string;
  readonly model: string;
  readonly at: number;
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
}

const turns: readonly Turn[] = [
  {
    at: 1_700_000_000_000,
    cacheRead: 30,
    cacheWrite: 40,
    input: 10,
    model: "model-a",
    output: 20,
    session: "s1",
  },
  {
    at: 1_700_000_060_000,
    cacheRead: 3,
    cacheWrite: 4,
    input: 1,
    model: "model-a",
    output: 2,
    session: "s1",
  },
  {
    at: 1_700_003_600_000,
    cacheRead: 300,
    cacheWrite: 400,
    input: 100,
    model: "model-b",
    output: 200,
    session: "s2",
  },
];

const assistantData = (turn: Turn): string =>
  JSON.stringify({
    modelID: turn.model,
    role: "assistant",
    time: { created: turn.at },
    tokens: {
      cache: { read: turn.cacheRead, write: turn.cacheWrite },
      input: turn.input,
      output: turn.output,
      reasoning: 5,
    },
  });

const insertMessages = (db: DatabaseSync, rows: readonly Turn[]) => {
  const insert = db.prepare("INSERT INTO message VALUES (?, ?, ?, ?)");
  for (const [index, turn] of rows.entries()) {
    insert.run(`m${index}`, turn.session, turn.at, assistantData(turn));
  }
};

type Counts = Pick<Turn, "cacheRead" | "cacheWrite" | "input" | "output">;

const totals = (rows: readonly Counts[]): Counts => {
  const sum = { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 };
  for (const row of rows) {
    sum.cacheRead += row.cacheRead;
    sum.cacheWrite += row.cacheWrite;
    sum.input += row.input;
    sum.output += row.output;
  }
  return sum;
};

/** Session rows carry the same totals as the messages: opencode keeps both in step. */
const insertSessions = (db: DatabaseSync, rows: readonly Turn[]) => {
  const insert = db.prepare("INSERT INTO session VALUES (?, ?, ?, ?, ?, ?, ?)");
  for (const id of new Set(rows.map((turn) => turn.session))) {
    const own = rows.filter((turn) => turn.session === id);
    const sum = totals(own);
    insert.run(
      id,
      own[0]?.at ?? 0,
      JSON.stringify({ id: own[0]?.model }),
      sum.input,
      sum.output,
      sum.cacheRead,
      sum.cacheWrite,
    );
  }
};

/** A fake home with an opencode database made by `fill`; returns the home and the database path. */
const makeHome = (fill: (db: DatabaseSync) => void, journalMode: "wal" | "delete" = "delete") =>
  Effect.gen(function* buildHome() {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const home = yield* fs.makeTempDirectoryScoped();
    const folder = path.join(home, ".local", "share", "opencode");
    yield* fs.makeDirectory(folder, { recursive: true });
    const file = path.join(folder, "opencode.db");
    const writer = yield* Effect.acquireRelease(
      Effect.sync(() => new DatabaseSync(file)),
      (db) =>
        Effect.sync(() => {
          db.close();
        }),
    );
    writer.exec(`PRAGMA journal_mode = ${journalMode}`);
    writer.exec(schema);
    fill(writer);
    return { file, home, writer };
  });

const records = (result: ReadResult): readonly UsageRecord[] => {
  assert.strictEqual(result._tag, "Read");
  return result._tag === "Read" ? result.records : [];
};

const expectedTotals = { cacheRead: 333, cacheWrite: 444, input: 111, output: 222 };

describe(readOpencode, () => {
  it.effect("counts a database whose session and message rows agree once, not twice", () =>
    Effect.gen(function* scenario() {
      const { home } = yield* makeHome((db) => {
        insertSessions(db, turns);
        insertMessages(db, turns);
      });
      const result = yield* readOpencode(home);
      assert.deepStrictEqual(totals(records(result)), expectedTotals);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("gives one record per model turn with an agent-prefixed session key", () =>
    Effect.gen(function* scenario() {
      const { home } = yield* makeHome((db) => {
        insertSessions(db, turns);
        insertMessages(db, turns);
      });
      const rows = records(yield* readOpencode(home));
      assert.deepStrictEqual(rows, [
        {
          at: 1_700_000_000_000,
          cacheRead: 30,
          cacheWrite: 40,
          input: 10,
          model: "model-a",
          output: 20,
          session: "opencode:s1",
        },
        {
          at: 1_700_000_060_000,
          cacheRead: 3,
          cacheWrite: 4,
          input: 1,
          model: "model-a",
          output: 2,
          session: "opencode:s1",
        },
        {
          at: 1_700_003_600_000,
          cacheRead: 300,
          cacheWrite: 400,
          input: 100,
          model: "model-b",
          output: 200,
          session: "opencode:s2",
        },
      ]);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("falls back to session totals when no message holds usage", () =>
    Effect.gen(function* scenario() {
      const { home } = yield* makeHome((db) => {
        insertSessions(db, turns);
      });
      const rows = records(yield* readOpencode(home));
      assert.deepStrictEqual(totals(rows), expectedTotals);
      assert.deepStrictEqual(
        rows.map((row) => row.session),
        ["opencode:s1", "opencode:s2"],
      );
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("ignores user messages, messages without usage, and malformed message data", () =>
    Effect.gen(function* scenario() {
      const { home } = yield* makeHome((db) => {
        insertMessages(db, turns);
        const insert = db.prepare("INSERT INTO message VALUES (?, ?, ?, ?)");
        insert.run("u1", "s1", 1, JSON.stringify({ role: "user" }));
        insert.run("a-none", "s1", 2, JSON.stringify({ modelID: "model-a", role: "assistant" }));
        insert.run("bad", "s1", 3, "{not json");
      });
      const result = yield* readOpencode(home);
      assert.deepStrictEqual(totals(records(result)), expectedTotals);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("reads a database with a live write-ahead log and an open writer", () =>
    Effect.gen(function* scenario() {
      const { home, writer } = yield* makeHome((db) => {
        db.exec("PRAGMA wal_autocheckpoint = 0");
        insertSessions(db, turns);
        insertMessages(db, turns);
      }, "wal");
      writer.exec("BEGIN");
      const result = yield* readOpencode(home);
      writer.exec("ROLLBACK");
      assert.deepStrictEqual(totals(records(result)), expectedTotals);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("skips with no-data when the database is missing", () =>
    Effect.gen(function* scenario() {
      const fs = yield* FileSystem.FileSystem;
      const home = yield* fs.makeTempDirectoryScoped();
      const result = yield* readOpencode(home);
      assert.strictEqual(result._tag, "Skipped");
      if (result._tag === "Skipped") {
        assert.strictEqual(result.agent, "opencode");
        assert.strictEqual(result.reason, "no-data");
        assert.isTrue(result.path.endsWith("opencode.db"));
      }
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("skips with no-data when the database holds no usage", () =>
    Effect.gen(function* scenario() {
      const { home } = yield* makeHome(() => {});
      const result = yield* readOpencode(home);
      assert.strictEqual(result._tag, "Skipped");
      if (result._tag === "Skipped") {
        assert.strictEqual(result.reason, "no-data");
      }
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("skips with unreadable, and never throws, when the file is not a database", () =>
    Effect.gen(function* scenario() {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* fs.makeTempDirectoryScoped();
      const folder = path.join(home, ".local", "share", "opencode");
      yield* fs.makeDirectory(folder, { recursive: true });
      yield* fs.writeFileString(
        path.join(folder, "opencode.db"),
        "this is not a database, it is only text. ".repeat(100),
      );
      const result = yield* readOpencode(home);
      assert.strictEqual(result._tag, "Skipped");
      if (result._tag === "Skipped") {
        assert.strictEqual(result.reason, "unreadable");
        assert.isAbove(result.detail.length, 0);
      }
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("skips with unreadable while another connection locks the database", () =>
    Effect.gen(function* scenario() {
      const { home, writer } = yield* makeHome((db) => {
        insertMessages(db, turns);
      });
      writer.exec("BEGIN EXCLUSIVE");
      const result = yield* readOpencode(home);
      writer.exec("ROLLBACK");
      assert.strictEqual(result._tag, "Skipped");
      if (result._tag === "Skipped") {
        assert.strictEqual(result.reason, "unreadable");
      }
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
