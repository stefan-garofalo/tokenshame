import { assert, describe, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import type * as Scope from "effect/Scope";
import { DatabaseSync } from "node:sqlite";
import { zstdCompressSync } from "node:zlib";

import { readBb } from "./bb";
import { readDevin } from "./devin";
import { readForge } from "./forge";
import { readHermes } from "./hermes";
import { readKilo } from "./kilo";
import { readMimoCode, readMimoDesktop } from "./mimo";
import { readQuickDesk } from "./quickdesk";
import type { ReadResult, Reader, UsageRecord } from "./types";
import { makeReadZed, readZed } from "./zed";

// Fixtures are built per test in a temp folder. Every table holds only the columns a
// reader may touch, copied from the agent's schema as tokscale and codeburn read it.

type Counts = Pick<UsageRecord, "cacheRead" | "cacheWrite" | "input" | "output">;

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

/** Totals per model, and the distinct sessions: what the summary builder takes from records. */
const summary = (rows: readonly UsageRecord[]) => ({
  models: Object.fromEntries(
    [...new Set(rows.map((row) => row.model))].map((model) => [
      model,
      totals(rows.filter((row) => row.model === model)),
    ]),
  ),
  sessions: [...new Set(rows.map((row) => row.session))].toSorted(),
});

const records = (result: ReadResult): readonly UsageRecord[] => {
  assert.strictEqual(result._tag, "Read", result._tag === "Skipped" ? result.detail : "");
  return result._tag === "Read" ? result.records : [];
};

const assertSkipped = (result: ReadResult, agent: string, reason: "no-data" | "unreadable") => {
  assert.strictEqual(result._tag, "Skipped");
  if (result._tag === "Skipped") {
    assert.strictEqual(result.agent, agent);
    assert.strictEqual(result.reason, reason);
    if (reason === "unreadable") {
      assert.isAbove(result.detail.length, 0);
    }
  }
};

/** An empty environment, so no test reads the real one. */
const environment = (env: Readonly<Record<string, string>>) =>
  ConfigProvider.layer(ConfigProvider.fromEnv({ env }));

/** Runs a scenario on the real file system with the given environment variables. */
const provide = <A, E>(
  effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path | Scope.Scope>,
  env: Readonly<Record<string, string>> = {},
) => effect.pipe(Effect.provide(Layer.mergeAll(NodeServices.layer, environment(env))));

/** A SQLite database below a fake home, made by `fill`; the writer stays open until the scope ends. */
const makeDatabase = (
  home: string,
  parts: readonly string[],
  fill: (db: DatabaseSync) => void,
  journalMode: "wal" | "delete" = "delete",
) =>
  Effect.gen(function* buildDatabase() {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const file = path.join(home, ...parts);
    yield* fs.makeDirectory(path.dirname(file), { recursive: true });
    const writer = yield* Effect.acquireRelease(
      Effect.sync(() => new DatabaseSync(file)),
      (db) =>
        Effect.sync(() => {
          db.close();
        }),
    );
    writer.exec(`PRAGMA journal_mode = ${journalMode}`);
    fill(writer);
    return { file, writer };
  });

const makeHome = Effect.gen(function* buildHome() {
  const fs = yield* FileSystem.FileSystem;
  return yield* fs.makeTempDirectoryScoped();
});

const writeText = (home: string, parts: readonly string[], text: string) =>
  Effect.gen(function* writeFixture() {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const file = path.join(home, ...parts);
    yield* fs.makeDirectory(path.dirname(file), { recursive: true });
    yield* fs.writeFileString(file, text);
    return file;
  });

const garbage = "this is not a database, it is only text. ".repeat(100);

type Cell = string | number | Uint8Array | null;

/** A JSON value, as a fixture writes it into a payload column or a log line. */
type Json = string | number | boolean | null | readonly Json[] | { readonly [key: string]: Json };

/** Inserts each row into `table(columns...)`. */
const insert = (
  db: DatabaseSync,
  table: string,
  columns: readonly string[],
  rows: readonly (readonly Cell[])[],
) => {
  const statement = db.prepare(
    `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
  );
  for (const row of rows) {
    statement.run(...row);
  }
};

/** The shared failure cases of every database-backed reader. */
const databaseFailures = (
  agent: string,
  read: Reader,
  databaseParts: readonly string[],
  fill: (db: DatabaseSync) => void,
) => {
  it.effect("skips with no-data when the database is missing", () =>
    provide(
      Effect.gen(function* scenario() {
        const home = yield* makeHome;
        assertSkipped(yield* read(home), agent, "no-data");
      }),
    ),
  );

  it.effect("skips with no-data when the database holds no usage", () =>
    provide(
      Effect.gen(function* scenario() {
        const home = yield* makeHome;
        yield* makeDatabase(home, databaseParts, () => {});
        assertSkipped(yield* read(home), agent, "no-data");
      }),
    ),
  );

  it.effect("skips with unreadable, and never throws, when the file is not a database", () =>
    provide(
      Effect.gen(function* scenario() {
        const home = yield* makeHome;
        yield* writeText(home, databaseParts, garbage);
        assertSkipped(yield* read(home), agent, "unreadable");
      }),
    ),
  );

  it.effect("reads a database with a live write-ahead log and an open writer", () =>
    provide(
      Effect.gen(function* scenario() {
        const home = yield* makeHome;
        const { writer } = yield* makeDatabase(
          home,
          databaseParts,
          (db) => {
            db.exec("PRAGMA wal_autocheckpoint = 0");
            fill(db);
          },
          "wal",
        );
        writer.exec("BEGIN");
        const result = yield* read(home);
        writer.exec("ROLLBACK");
        assert.strictEqual(result._tag, "Read");
      }),
    ),
  );
};

const at = 1_772_359_200_000;

// ---------------------------------------------------------------------------------------
// Kilo CLI
// ---------------------------------------------------------------------------------------

const kiloParts = [".local", "share", "kilo", "kilo.db"];

const kiloMessage = (
  session: string,
  model: string,
  tokens: Json,
  time: number | null,
  role = "assistant",
) =>
  JSON.stringify({
    modelID: model,
    role,
    session_id: session,
    time: time === null ? null : { created: time },
    tokens,
  });

const fillKilo = (db: DatabaseSync) => {
  db.exec(
    "CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, time_created INTEGER, data TEXT NOT NULL)",
  );
  const cached = { cache: { read: 30, write: 10 }, input: 100, output: 20, reasoning: 5 };
  const legacy = { cache: { read: 0, write: 0 }, input: 0, output: 0 };
  insert(
    db,
    "message",
    ["id", "session_id", "data"],
    [
      ["k1", "ses_a", kiloMessage("ses_a", "model-a", cached, at)],
      ["k2", "ses_b", kiloMessage("ses_b", "model-b", { input: 50, output: 10 }, at + 1000)],
      ["k3", "ses_a", kiloMessage("ses_a", "model-a", { input: 9, output: 9 }, at, "user")],
      ["k4", "ses_a", "{not json"],
      ["k5", "ses_migrated_1", kiloMessage("ses_migrated_1", "legacy", legacy, null)],
    ],
  );
};

describe(readKilo, () => {
  it.effect("maps assistant turns, with reasoning added to output", () =>
    provide(
      Effect.gen(function* scenario() {
        const home = yield* makeHome;
        yield* makeDatabase(home, kiloParts, fillKilo);
        const rows = records(yield* readKilo(home));
        assert.deepStrictEqual(summary(rows), {
          models: {
            "model-a": { cacheRead: 30, cacheWrite: 10, input: 100, output: 25 },
            "model-b": { cacheRead: 0, cacheWrite: 0, input: 50, output: 10 },
          },
          sessions: ["kilo:ses_a", "kilo:ses_b"],
        });
        assert.deepStrictEqual(
          rows.map((row) => row.at),
          [at, at + 1000],
        );
      }),
    ),
  );

  it.effect("uses the file's last change for a turn without a time", () =>
    provide(
      Effect.gen(function* scenario() {
        const home = yield* makeHome;
        const fs = yield* FileSystem.FileSystem;
        const { file } = yield* makeDatabase(home, kiloParts, (db) => {
          fillKilo(db);
          insert(
            db,
            "message",
            ["id", "session_id", "data"],
            [["k6", "ses_c", kiloMessage("ses_c", "model-c", { input: 1, output: 1 }, null)]],
          );
        });
        const modified = Option.getOrThrow((yield* fs.stat(file)).mtime).getTime();
        const rows = records(yield* readKilo(home));
        assert.strictEqual(rows.find((row) => row.session === "kilo:ses_c")?.at, modified);
      }),
    ),
  );

  it.effect("follows XDG_DATA_HOME", () =>
    provide(
      Effect.gen(function* scenario() {
        const home = yield* makeHome;
        const path = yield* Path.Path;
        yield* makeDatabase(home, ["data", "kilo", "kilo.db"], fillKilo);
        const rows = records(
          yield* provide(readKilo(home), { XDG_DATA_HOME: path.join(home, "data") }),
        );
        assert.strictEqual(rows.length, 2);
      }),
    ),
  );

  databaseFailures("Kilo CLI", readKilo, kiloParts, fillKilo);
});

// ---------------------------------------------------------------------------------------
// Zed Agent
// ---------------------------------------------------------------------------------------

const zedParts = [".local", "share", "zed", "threads", "threads.db"];
const zedMacParts = ["Library", "Application Support", "Zed", "threads", "threads.db"];
const zedColumns = ["id", "updated_at", "data_type", "data"];

const zedSchema =
  "CREATE TABLE threads (id TEXT PRIMARY KEY, summary TEXT, updated_at TEXT NOT NULL, data_type TEXT NOT NULL, data BLOB NOT NULL)";

const bytes = (text: string) => new TextEncoder().encode(text);

const zedThreads = {
  // The running total holds more than the per-request map: the larger counts win.
  t1: {
    cumulative_token_usage: {
      cache_creation_input_tokens: 200,
      cache_read_input_tokens: 1000,
      input_tokens: 300,
      output_tokens: 60,
    },
    model: { model: "claude-x", provider: "zed.dev" },
    request_token_usage: {
      m1: {
        cache_creation_input_tokens: 200,
        cache_read_input_tokens: 400,
        input_tokens: 100,
        output_tokens: 20,
      },
    },
  },
  // No running total: the sum of the per-request map.
  t2: {
    model: { model: "claude-y", provider: "anthropic" },
    request_token_usage: {
      a: { input_tokens: 10, output_tokens: 5 },
      b: { input_tokens: 20, output_tokens: 5 },
    },
  },
  // Imported from an external agent, which logs its own usage.
  t3: {
    cumulative_token_usage: { input_tokens: 999, output_tokens: 999 },
    imported: true,
    model: { model: "claude-y", provider: "anthropic" },
  },
};

const zedRow = (id: keyof typeof zedThreads, updated: string): readonly Cell[] => [
  id,
  updated,
  "json",
  bytes(JSON.stringify(zedThreads[id])),
];

const fillZed = (db: DatabaseSync) => {
  db.exec(zedSchema);
  insert(db, "threads", zedColumns, [
    ["t1", "2026-03-01T10:00:00Z", "zstd", zstdCompressSync(bytes(JSON.stringify(zedThreads.t1)))],
    zedRow("t2", "2026-03-01T11:00:00Z"),
    zedRow("t3", "2026-03-01T12:00:00Z"),
    ["t4", "2026-03-01T12:00:00Z", "json", bytes("not json")],
    // An older Zed stored JSON threads as text.
    ["t5", "2026-03-01T13:00:00Z", "json", JSON.stringify(zedThreads.t2)],
  ]);
};

describe(readZed, () => {
  it.effect("maps each thread, compressed or not, and skips imported threads", () =>
    provide(
      Effect.gen(function* scenario() {
        const home = yield* makeHome;
        yield* makeDatabase(home, zedParts, fillZed);
        const rows = records(yield* readZed(home));
        assert.deepStrictEqual(summary(rows), {
          models: {
            "claude-x": { cacheRead: 1000, cacheWrite: 200, input: 300, output: 60 },
            "claude-y": { cacheRead: 0, cacheWrite: 0, input: 60, output: 20 },
          },
          sessions: ["zed:t1", "zed:t2", "zed:t5"],
        });
        assert.strictEqual(rows[0]?.at, Date.parse("2026-03-01T10:00:00Z"));
      }),
    ),
  );

  it.effect("finds the database in the macOS application folder too", () =>
    provide(
      Effect.gen(function* scenario() {
        const home = yield* makeHome;
        yield* makeDatabase(home, zedMacParts, fillZed);
        assert.strictEqual(records(yield* readZed(home)).length, 3);
      }),
    ),
  );

  it.effect("skips with unreadable when a thread is compressed and Node.js has no zstd", () =>
    provide(
      Effect.gen(function* scenario() {
        const home = yield* makeHome;
        yield* makeDatabase(home, zedParts, fillZed);
        assertSkipped(yield* makeReadZed()(home), "Zed Agent", "unreadable");
      }),
    ),
  );

  it.effect("reads uncompressed threads without zstd", () =>
    provide(
      Effect.gen(function* scenario() {
        const home = yield* makeHome;
        yield* makeDatabase(home, zedParts, (db) => {
          db.exec(zedSchema);
          insert(db, "threads", zedColumns, [zedRow("t2", "2026-03-01T11:00:00Z")]);
        });
        assert.strictEqual(records(yield* makeReadZed()(home)).length, 1);
      }),
    ),
  );

  databaseFailures("Zed Agent", readZed, zedParts, fillZed);
});

// ---------------------------------------------------------------------------------------
// Hermes Agent
// ---------------------------------------------------------------------------------------

const hermesParts = [".hermes", "state.db"];

const hermesSchema = `
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY, model TEXT, started_at REAL NOT NULL, input_tokens INTEGER,
    output_tokens INTEGER, cache_read_tokens INTEGER, cache_write_tokens INTEGER,
    reasoning_tokens INTEGER);
  CREATE TABLE session_model_usage (
    session_id TEXT NOT NULL, model TEXT NOT NULL, billing_provider TEXT NOT NULL DEFAULT '',
    task TEXT NOT NULL DEFAULT '', input_tokens INTEGER, output_tokens INTEGER,
    cache_read_tokens INTEGER, cache_write_tokens INTEGER, reasoning_tokens INTEGER);
`;

const hermesSessionColumns = [
  "id",
  "model",
  "started_at",
  "input_tokens",
  "output_tokens",
  "cache_read_tokens",
  "cache_write_tokens",
  "reasoning_tokens",
];
const hermesUsageColumns = [
  "session_id",
  "model",
  "billing_provider",
  "task",
  "input_tokens",
  "output_tokens",
  "cache_read_tokens",
  "cache_write_tokens",
  "reasoning_tokens",
];

/** A Hermes database with one session of totals only. */
const hermesSession = (id: string) => (db: DatabaseSync) => {
  db.exec(hermesSchema);
  insert(db, "sessions", hermesSessionColumns, [[id, "model-p", 1_772_359_400, 1, 1, 0, 0, 0]]);
};

const fillHermes = (db: DatabaseSync) => {
  db.exec(hermesSchema);
  insert(db, "sessions", hermesSessionColumns, [
    // h1 has per-model rows; its session totals repeat the main loop and are not read.
    ["h1", "model-a", 1_772_359_200.5, 100, 20, 50, 0, 4],
    // h2 has only a per-model row with no tokens: its session totals count.
    ["h2", "model-c", 1_772_359_300, 70, 7, 0, 3, 0],
  ]);
  insert(db, "session_model_usage", hermesUsageColumns, [
    ["h1", "model-a", "", "", 100, 20, 50, 0, 4],
    ["h1", "model-a", "openrouter", "", 10, 2, 0, 0, 0],
    ["h1", "model-b", "", "compression", 5, 1, 0, 0, 0],
    ["h2", "model-c", "", "", 0, 0, 0, 0, 0],
  ]);
};

describe(readHermes, () => {
  it.effect("sums per-model usage, and session totals only for sessions without it", () =>
    provide(
      Effect.gen(function* scenario() {
        const home = yield* makeHome;
        yield* makeDatabase(home, hermesParts, fillHermes);
        const rows = records(yield* readHermes(home));
        assert.deepStrictEqual(summary(rows), {
          models: {
            "model-a": { cacheRead: 50, cacheWrite: 0, input: 110, output: 22 },
            "model-b": { cacheRead: 0, cacheWrite: 0, input: 5, output: 1 },
            "model-c": { cacheRead: 0, cacheWrite: 3, input: 70, output: 7 },
          },
          sessions: ["hermes:h1", "hermes:h2"],
        });
        assert.strictEqual(rows[0]?.at, 1_772_359_200_500);
      }),
    ),
  );

  it.effect("reads named profiles beside the default database", () =>
    provide(
      Effect.gen(function* scenario() {
        const home = yield* makeHome;
        yield* makeDatabase(home, hermesParts, fillHermes);
        yield* makeDatabase(home, [".hermes", "profiles", "work", "state.db"], hermesSession("p1"));
        assert.include(summary(records(yield* readHermes(home))).sessions, "hermes:p1");
      }),
    ),
  );

  it.effect("reads HERMES_HOME alone when set", () =>
    provide(
      Effect.gen(function* scenario() {
        const home = yield* makeHome;
        const path = yield* Path.Path;
        yield* makeDatabase(home, hermesParts, fillHermes);
        yield* makeDatabase(home, ["custom", "state.db"], hermesSession("c1"));
        const rows = records(
          yield* provide(readHermes(home), { HERMES_HOME: path.join(home, "custom") }),
        );
        assert.deepStrictEqual(summary(rows).sessions, ["hermes:c1"]);
      }),
    ),
  );

  it.effect("reads only the profile HERMES_HOME names, not its siblings", () =>
    provide(
      Effect.gen(function* scenario() {
        const home = yield* makeHome;
        const path = yield* Path.Path;
        yield* makeDatabase(home, [".hermes", "profiles", "a", "state.db"], hermesSession("a1"));
        yield* makeDatabase(home, [".hermes", "profiles", "b", "state.db"], hermesSession("b1"));
        const profile = path.join(home, ".hermes", "profiles", "a");
        const rows = records(yield* provide(readHermes(home), { HERMES_HOME: profile }));
        assert.deepStrictEqual(summary(rows).sessions, ["hermes:a1"]);
      }),
    ),
  );

  databaseFailures("Hermes Agent", readHermes, hermesParts, fillHermes);
});

// ---------------------------------------------------------------------------------------
// MiMo Code and Xiaomi MiMo AI
// ---------------------------------------------------------------------------------------

const mimoParts = [".local", "share", "mimocode", "mimocode.db"];
const mimoMessageColumns = ["id", "session_id", "data"];

const mimoMessage = (id: string, session: string, created: number, input: number, output: number) =>
  JSON.stringify({
    id,
    modelID: "mimo-v2",
    role: "assistant",
    sessionID: session,
    time: { completed: created + 1, created },
    tokens: { input, output, reasoning: 2 },
  });

const mimoSchema = `
  CREATE TABLE session (id TEXT PRIMARY KEY, version TEXT, time_created INTEGER);
  CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, time_created INTEGER, data TEXT NOT NULL);
`;

const fillMimo = (db: DatabaseSync) => {
  db.exec(mimoSchema);
  insert(
    db,
    "session",
    ["id", "version", "time_created"],
    [
      ["s1", "1.0.0", at - 200_000],
      // s2 forked s1: it holds a copy of s1's turn, older than s2 itself.
      ["s2", "1.0.0", at + 300_000],
      ["d1", "desktop-0.3.1", at - 200_000],
    ],
  );
  insert(db, "message", mimoMessageColumns, [
    // The copy comes first in the table; the original in s1 is still the one kept.
    ["row1", "s2", mimoMessage("msg9", "s2", at, 100, 10)],
    ["row2", "s1", mimoMessage("msg1", "s1", at, 100, 10)],
    ["row3", "s2", mimoMessage("msg2", "s2", at + 400_000, 40, 2)],
    // Some MiMo builds write seconds.
    ["row4", "d1", mimoMessage("msg3", "d1", (at + 100_000) / 1000, 7, 1)],
  ]);
};

describe(readMimoCode, () => {
  it.effect("counts a forked copy once, in the session that made the call", () =>
    provide(
      Effect.gen(function* scenario() {
        const home = yield* makeHome;
        yield* makeDatabase(home, mimoParts, fillMimo);
        const rows = records(yield* readMimoCode(home));
        assert.deepStrictEqual(summary(rows), {
          models: { "mimo-v2": { cacheRead: 0, cacheWrite: 0, input: 140, output: 16 } },
          sessions: ["mimo:s1", "mimo:s2"],
        });
      }),
    ),
  );

  it.effect("reads channel databases and drops a turn they repeat by id", () =>
    provide(
      Effect.gen(function* scenario() {
        const home = yield* makeHome;
        yield* makeDatabase(home, mimoParts, fillMimo);
        yield* makeDatabase(home, [".local", "share", "mimocode", "mimocode-beta.db"], (db) => {
          db.exec(mimoSchema);
          insert(db, "message", mimoMessageColumns, [
            ["x1", "s1", mimoMessage("msg1", "s1", at + 5, 100, 10)],
            ["x2", "b1", mimoMessage("msg7", "b1", at, 1, 1)],
          ]);
        });
        const rows = records(yield* readMimoCode(home));
        assert.deepStrictEqual(summary(rows).sessions, ["mimo:b1", "mimo:s1", "mimo:s2"]);
        assert.strictEqual(totals(rows).input, 141);
      }),
    ),
  );

  it.effect("reads orca's hook copy and counts a turn both copies hold once", () =>
    provide(
      Effect.gen(function* scenario() {
        const home = yield* makeHome;
        const orca = ["Library", "Application Support", "orca", "mimocode-hooks", "shared", "data"];
        yield* makeDatabase(home, mimoParts, fillMimo);
        yield* makeDatabase(home, [...orca, "mimocode.db"], (db) => {
          db.exec(mimoSchema);
          insert(db, "message", mimoMessageColumns, [
            ["x1", "s1", mimoMessage("msg1", "s1", at + 5, 100, 10)],
            ["x2", "o1", mimoMessage("msg8", "o1", at, 2, 1)],
          ]);
        });
        const rows = records(yield* readMimoCode(home));
        assert.deepStrictEqual(summary(rows).sessions, ["mimo:o1", "mimo:s1", "mimo:s2"]);
        assert.strictEqual(totals(rows).input, 142);
      }),
    ),
  );

  databaseFailures("MiMo Code", readMimoCode, mimoParts, fillMimo);
});

describe(readMimoDesktop, () => {
  it.effect("keeps only sessions made by the desktop app", () =>
    provide(
      Effect.gen(function* scenario() {
        const home = yield* makeHome;
        yield* makeDatabase(home, mimoParts, fillMimo);
        assert.deepStrictEqual(records(yield* readMimoDesktop(home)), [
          {
            at: at + 100_000,
            cacheRead: 0,
            cacheWrite: 0,
            input: 7,
            model: "mimo-v2",
            output: 3,
            session: "mimo:d1",
          },
        ]);
      }),
    ),
  );

  it.effect("skips with no-data when the store has no desktop session", () =>
    provide(
      Effect.gen(function* scenario() {
        const home = yield* makeHome;
        yield* makeDatabase(home, mimoParts, (db) => {
          db.exec(mimoSchema);
          insert(db, "message", mimoMessageColumns, [
            ["row2", "s1", mimoMessage("msg1", "s1", at, 100, 10)],
          ]);
        });
        assertSkipped(yield* readMimoDesktop(home), "Xiaomi MiMo AI", "no-data");
      }),
    ),
  );
});

// ---------------------------------------------------------------------------------------
// Devin (CLI and Desktop)
// ---------------------------------------------------------------------------------------

const devinParts = [".local", "share", "devin", "cli", "sessions.db"];

const devinNode = (metadata: Json, role = "assistant") =>
  JSON.stringify({ content: "reply", metadata, role });

const devinMetrics = (input: number, output: number, cacheRead = 0, cacheWrite = 0) => ({
  cache_creation_tokens: cacheWrite,
  cache_read_tokens: cacheRead,
  input_tokens: input,
  output_tokens: output,
});

const fillDevin = (db: DatabaseSync) => {
  db.exec(`
    CREATE TABLE sessions (id TEXT PRIMARY KEY, model TEXT, title TEXT);
    CREATE TABLE message_nodes (
      row_id INTEGER PRIMARY KEY, node_id INTEGER, session_id TEXT NOT NULL,
      chat_message TEXT NOT NULL, created_at INTEGER NOT NULL);
  `);
  insert(
    db,
    "sessions",
    ["id", "model", "title"],
    [
      ["d1", "adaptive", "Build the release"],
      ["d2", "claude-z", null],
      // Sessions with no usage rows: only Desktop event files name them.
      ["d3", "gpt-5", " Write the docs "],
      ["d4", "gpt-5", "Untitled"],
      ["d5", "gpt-5", "Untitled"],
    ],
  );
  const seconds = at / 1000;
  const metered = {
    generation_model: "gpt-x",
    metrics: devinMetrics(100, 20, 300, 50),
    request_id: "r1",
  };
  insert(
    db,
    "message_nodes",
    ["session_id", "chat_message", "created_at"],
    [
      ["d1", devinNode(metered), seconds],
      // The same request stored again (a retry node): counted once.
      ["d1", devinNode(metered), seconds + 1],
      // No generation model, and the session model is a routing mode.
      ["d1", devinNode({ metrics: devinMetrics(10, 1), request_id: "r2" }), seconds + 2],
      ["d2", devinNode({ metrics: devinMetrics(5, 5) }), seconds + 3],
      ["d2", devinNode({ is_user_input: true }, "user"), seconds + 4],
      // `num_tokens` alone has no split: not counted.
      ["d2", devinNode({ num_tokens: 900 }), seconds + 5],
    ],
  );
};

const devinEvents = ["Library", "Application Support", "Devin", "User", "acp-events"];

const devinEventLines = (...notifications: readonly Json[]) =>
  notifications.map((notification) => JSON.stringify({ notification })).join("\n");

const devinTitle = (title: string) => ({ sessionUpdate: "session_info_update", title });

const devinUsage = (input: number, output: number, cacheRead: number) => ({
  _meta: {
    "cognition.ai/cachedReadTokens": cacheRead,
    "cognition.ai/inputTokens": input,
    "cognition.ai/outputTokens": output,
  },
  sessionUpdate: "usage_update",
});

describe(readDevin, () => {
  it.effect("maps assistant metrics, once per request", () =>
    provide(
      Effect.gen(function* scenario() {
        const home = yield* makeHome;
        yield* makeDatabase(home, devinParts, fillDevin);
        const rows = records(yield* readDevin(home));
        assert.deepStrictEqual(summary(rows), {
          models: {
            "claude-z": { cacheRead: 0, cacheWrite: 0, input: 5, output: 5 },
            "gpt-x": { cacheRead: 300, cacheWrite: 50, input: 100, output: 20 },
            unknown: { cacheRead: 0, cacheWrite: 0, input: 10, output: 1 },
          },
          sessions: ["devin:d1", "devin:d2"],
        });
        assert.strictEqual(rows[0]?.at, at);
      }),
    ),
  );

  it.effect("follows XDG_DATA_HOME, and reads the Windows folder", () =>
    provide(
      Effect.gen(function* scenario() {
        const home = yield* makeHome;
        yield* makeDatabase(home, ["data", "devin", "cli", "sessions.db"], fillDevin);
        yield* makeDatabase(home, ["AppData", "Roaming", "devin", "cli", "sessions.db"], (db) => {
          db.exec(`
            CREATE TABLE sessions (id TEXT PRIMARY KEY, model TEXT);
            CREATE TABLE message_nodes (
              row_id INTEGER PRIMARY KEY, session_id TEXT NOT NULL,
              chat_message TEXT NOT NULL, created_at INTEGER NOT NULL);
          `);
          insert(db, "sessions", ["id", "model"], [["w1", "claude-z"]]);
          insert(
            db,
            "message_nodes",
            ["session_id", "chat_message", "created_at"],
            [["w1", devinNode({ metrics: devinMetrics(1, 1) }), at / 1000]],
          );
        });
        const path = yield* Path.Path;
        const rows = records(
          yield* provide(readDevin(home), { XDG_DATA_HOME: path.join(home, "data") }),
        );
        assert.deepStrictEqual(summary(rows).sessions, ["devin:d1", "devin:d2", "devin:w1"]);
      }),
    ),
  );

  it.effect("adds Desktop event files, and drops a file the CLI database already counts", () =>
    provide(
      Effect.gen(function* scenario() {
        const home = yield* makeHome;
        yield* makeDatabase(home, devinParts, fillDevin);
        // Titled as d1, which has CLI usage: the same calls, dropped.
        yield* writeText(
          home,
          [...devinEvents, "e1.ndjson"],
          devinEventLines(devinTitle("Build the release"), devinUsage(999, 9, 0)),
        );
        // Titled as d3, which has no CLI usage: counted as d3, with its model.
        yield* writeText(
          home,
          [...devinEvents, "e2.ndjson"],
          devinEventLines(
            devinTitle("Write the docs"),
            devinUsage(100, 7, 20),
            devinUsage(150, 8, 30),
          ),
        );
        // A title two sessions share names neither: the file is its own session.
        yield* writeText(
          home,
          [...devinEvents, "e3.ndjson"],
          devinEventLines(devinTitle("Untitled"), devinUsage(10, 1, 0)),
        );
        // An older capture: metrics embedded per call.
        yield* writeText(
          home,
          [...devinEvents, "e4.ndjson"],
          devinEventLines(
            {
              metadata: {
                created_at: "2026-03-01T10:00:00Z",
                generation_model: "gpt-old",
                input_tokens: 4,
                output_tokens: 2,
              },
            },
            {
              content: { metadata: { metrics: { input_tokens: 4, output_tokens: 2 } } },
              metadata: { generation_model: "gpt-old" },
            },
            { metadata: { input_tokens: 0, output_tokens: 0 } },
          ),
        );
        const rows = records(yield* readDevin(home));
        assert.deepStrictEqual(summary(rows), {
          models: {
            "claude-z": { cacheRead: 0, cacheWrite: 0, input: 5, output: 5 },
            "gpt-5": { cacheRead: 30, cacheWrite: 0, input: 120, output: 15 },
            "gpt-old": { cacheRead: 0, cacheWrite: 0, input: 8, output: 4 },
            "gpt-x": { cacheRead: 300, cacheWrite: 50, input: 100, output: 20 },
            unknown: { cacheRead: 0, cacheWrite: 0, input: 20, output: 2 },
          },
          sessions: ["devin:d1", "devin:d2", "devin:d3", "devin:e3", "devin:e4"],
        });
        assert.isTrue(rows.some((row) => row.at === Date.parse("2026-03-01T10:00:00Z")));
      }),
    ),
  );

  it.effect("reads Desktop event files without a CLI database, from every folder once", () =>
    provide(
      Effect.gen(function* scenario() {
        const home = yield* makeHome;
        const usage = devinEventLines(devinUsage(10, 1, 4));
        yield* writeText(home, [...devinEvents, "e1.ndjson"], usage);
        yield* writeText(home, [".config", "devin", "User", "acp-events", "e1.ndjson"], usage);
        yield* writeText(
          home,
          ["AppData", "Roaming", "Devin", "User", "acp-events", "e2.ndjson"],
          usage,
        );
        const rows = records(yield* readDevin(home));
        assert.deepStrictEqual(summary(rows), {
          models: { unknown: { cacheRead: 8, cacheWrite: 0, input: 12, output: 2 } },
          sessions: ["devin:e1", "devin:e2"],
        });
      }),
    ),
  );

  it.effect("skips with unreadable when no Desktop event file parses", () =>
    provide(
      Effect.gen(function* scenario() {
        const home = yield* makeHome;
        yield* writeText(home, [...devinEvents, "e1.ndjson"], "not json\n");
        assertSkipped(yield* readDevin(home), "Devin", "unreadable");
      }),
    ),
  );

  databaseFailures("Devin", readDevin, devinParts, fillDevin);
});

// ---------------------------------------------------------------------------------------
// BB
// ---------------------------------------------------------------------------------------

const bbParts = [".bb", "bb.db"];

const bbSchema = `
  CREATE TABLE threads (
    id TEXT PRIMARY KEY, project_id TEXT, provider_id TEXT NOT NULL, model_override TEXT,
    title TEXT, parent_thread_id TEXT, created_at INTEGER NOT NULL);
  CREATE TABLE project_execution_defaults (
    project_id TEXT NOT NULL, provider_id TEXT NOT NULL, model TEXT NOT NULL,
    service_tier TEXT NOT NULL);
  CREATE TABLE events (
    id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, turn_id TEXT, sequence INTEGER NOT NULL,
    type TEXT NOT NULL, data TEXT NOT NULL, created_at INTEGER NOT NULL);
`;

const tokenUsage = "thread/tokenUsage/updated";
const bbColumns = ["id", "thread_id", "turn_id", "sequence", "type", "data", "created_at"];

/** One usage event of `thread`, created `offset` milliseconds after `at`. */
const bbUsage = (
  id: string,
  thread: string,
  turn: string,
  sequence: number,
  usage: Json,
): readonly Cell[] => [
  id,
  thread,
  turn,
  sequence,
  tokenUsage,
  JSON.stringify({ tokenUsage: usage }),
  at + sequence,
];

// Codex style: cache inside input, reasoning inside output (total = input + output).
const codexCall = {
  cachedInputTokens: 40,
  inputTokens: 100,
  outputTokens: 30,
  reasoningOutputTokens: 10,
  totalTokens: 130,
};

// Claude style: cache and reasoning apart.
const claudeCall = {
  cacheReadInputTokens: 5,
  cacheWriteInputTokens: 3,
  inputTokens: 20,
  outputTokens: 8,
  reasoningOutputTokens: 2,
};

const fillBb = (db: DatabaseSync) => {
  db.exec(bbSchema);
  insert(
    db,
    "threads",
    ["id", "project_id", "provider_id", "model_override", "parent_thread_id", "created_at"],
    [
      ["tp", "p1", "pi", null, null, at],
      ["tc", "p1", "claude-code", "claude-opus", null, at],
      ["tf", "p1", "pi", null, "tp", at],
    ],
  );
  insert(
    db,
    "project_execution_defaults",
    ["project_id", "provider_id", "model", "service_tier"],
    [["p1", "pi", "pi-default", "standard"]],
  );
  const fallback = JSON.stringify({ fallbackModel: "pi-fallback" });
  insert(db, "events", bbColumns, [
    bbUsage("e1", "tp", "u1", 1, { last: codexCall, total: codexCall }),
    ["e2", "tp", "u2", 2, "provider/modelFallback", fallback, at + 2],
    bbUsage("e3", "tp", "u2", 3, { last: claudeCall }),
    // Only a total: its growth since the previous total (60 input, 30 output).
    bbUsage("e4", "tp", "u3", 4, { total: { inputTokens: 130, outputTokens: 40 } }),
    // Claude Code logs this thread's calls itself.
    bbUsage("e5", "tc", "u4", 1, { last: { inputTokens: 999, outputTokens: 999 } }),
    // A fork copies the parent's event: same turn, sequence and counts.
    bbUsage("e6", "tf", "u1", 1, { last: codexCall, total: codexCall }),
    bbUsage("e7", "tf", "u9", 2, { last: { inputTokens: 1, outputTokens: 1 } }),
  ]);
};

describe(readBb, () => {
  it.effect("maps usage events, and skips mirrored threads and forked copies", () =>
    provide(
      Effect.gen(function* scenario() {
        const home = yield* makeHome;
        yield* makeDatabase(home, bbParts, fillBb);
        const rows = records(yield* readBb(home));
        assert.deepStrictEqual(summary(rows), {
          models: {
            "pi-default": { cacheRead: 40, cacheWrite: 0, input: 61, output: 31 },
            "pi-fallback": { cacheRead: 5, cacheWrite: 3, input: 90, output: 20 },
          },
          sessions: ["bb:tf", "bb:tp"],
        });
        assert.strictEqual(rows[0]?.at, at + 1);
      }),
    ),
  );

  it.effect("reads development instances and drops events another database repeats", () =>
    provide(
      Effect.gen(function* scenario() {
        const home = yield* makeHome;
        yield* makeDatabase(home, bbParts, fillBb);
        yield* makeDatabase(home, [".bb-dev", "one", "bb.db"], fillBb);
        yield* makeDatabase(home, [".bb-dev", "two", "bb.db"], (db) => {
          db.exec(bbSchema);
          insert(db, "events", bbColumns, [
            bbUsage("n1", "tn", "u7", 1, { last: { inputTokens: 4, outputTokens: 4 } }),
          ]);
        });
        const rows = records(yield* readBb(home));
        assert.deepStrictEqual(summary(rows).sessions, ["bb:tf", "bb:tn", "bb:tp"]);
        assert.strictEqual(totals(rows).input, 155);
      }),
    ),
  );

  databaseFailures("BB", readBb, bbParts, fillBb);
});

// ---------------------------------------------------------------------------------------
// Forge
// ---------------------------------------------------------------------------------------

const forgeParts = [".forge", ".forge.db"];

const forgeContext = JSON.stringify({
  messages: [
    { message: { text: { content: "hello", role: "User" } } },
    {
      message: { text: { content: "reply", model: "model-f", role: "Assistant" } },
      usage: {
        cached_tokens: { actual: 800 },
        completion_tokens: { actual: 50 },
        prompt_tokens: { actual: 1000 },
      },
    },
    // Estimated counts only: not read.
    {
      message: { text: { content: "reply", model: "model-f", role: "Assistant" } },
      usage: { completion_tokens: { approx: 20 }, prompt_tokens: { approx: 500 } },
    },
  ],
});

const fillForge = (db: DatabaseSync) => {
  db.exec(`
    CREATE TABLE conversations (
      conversation_id TEXT PRIMARY KEY NOT NULL, title TEXT, workspace_id BIGINT NOT NULL,
      context TEXT, created_at TIMESTAMP NOT NULL, updated_at TIMESTAMP);
  `);
  insert(
    db,
    "conversations",
    ["conversation_id", "workspace_id", "context", "created_at", "updated_at"],
    [
      ["c1", 1, forgeContext, "2026-03-01 09:00:00", "2026-03-01 10:00:00"],
      ["c2", 1, "not json", "2026-03-01 09:00:00", null],
    ],
  );
};

describe(readForge, () => {
  it.effect("maps actual usage of assistant messages, with cache taken out of input", () =>
    provide(
      Effect.gen(function* scenario() {
        const home = yield* makeHome;
        yield* makeDatabase(home, forgeParts, fillForge);
        assert.deepStrictEqual(records(yield* readForge(home)), [
          {
            at: Date.parse("2026-03-01T10:00:00Z"),
            cacheRead: 800,
            cacheWrite: 0,
            input: 200,
            model: "model-f",
            output: 50,
            session: "forge:c1",
          },
        ]);
      }),
    ),
  );

  databaseFailures("Forge", readForge, forgeParts, fillForge);
});

// ---------------------------------------------------------------------------------------
// Quick Desktop
// ---------------------------------------------------------------------------------------

const metricsParts = [".quickwork", "metrics", "metrics-2026-03-01.jsonl"];

const metricsLines = (...lines: readonly Json[]) =>
  lines.map((line) => JSON.stringify(line)).join("\n");

describe(readQuickDesk, () => {
  it.effect("maps usage lines of the store's and each profile's metrics files", () =>
    provide(
      Effect.gen(function* scenario() {
        const home = yield* makeHome;
        const usage = { InputTokens: 100, Model: "claude-sonnet-4-5", OutputTokens: 20 };
        yield* writeText(
          home,
          metricsParts,
          `${metricsLines(
            { ...usage, _aws: { Timestamp: at }, session_id: "q1" },
            { ToolName: "readFile", session_id: "q1" },
            { InputTokens: 10, Model: "claude-sonnet-4-5", OutputTokens: 1 },
          )}\n{broken\n`,
        );
        yield* writeText(
          home,
          [".quickwork", "profiles", "work", "metrics", "metrics-2026-03-02.jsonl"],
          metricsLines({
            InputTokens: 5,
            Model: "quickdesk-auto",
            OutputTokens: 5,
            session_id: "q2",
          }),
        );
        const rows = records(yield* readQuickDesk(home));
        assert.deepStrictEqual(summary(rows), {
          models: {
            "claude-sonnet-4-5": { cacheRead: 0, cacheWrite: 0, input: 110, output: 21 },
            "quickdesk-auto": { cacheRead: 0, cacheWrite: 0, input: 5, output: 5 },
          },
          sessions: ["quickdesk:metrics/metrics-2026-03-01.jsonl", "quickdesk:q1", "quickdesk:q2"],
        });
        assert.include(
          rows.map((row) => row.at),
          Date.parse("2026-03-02T00:00:00Z"),
        );
      }),
    ),
  );

  it.effect("follows QUICKWORK_HOME", () =>
    provide(
      Effect.gen(function* scenario() {
        const home = yield* makeHome;
        const path = yield* Path.Path;
        yield* writeText(
          home,
          ["store", "metrics", "metrics-2026-03-01.jsonl"],
          metricsLines({ InputTokens: 1, Model: "m", OutputTokens: 1 }),
        );
        const store = path.join(home, "store");
        const rows = records(yield* provide(readQuickDesk(home), { QUICKWORK_HOME: store }));
        assert.strictEqual(rows.length, 1);
      }),
    ),
  );

  it.effect("skips with no-data when the store is missing", () =>
    provide(
      Effect.gen(function* scenario() {
        const home = yield* makeHome;
        assertSkipped(yield* readQuickDesk(home), "Quick Desktop", "no-data");
      }),
    ),
  );

  it.effect("skips with unreadable when no metrics file parses", () =>
    provide(
      Effect.gen(function* scenario() {
        const home = yield* makeHome;
        yield* writeText(home, metricsParts, garbage);
        assertSkipped(yield* readQuickDesk(home), "Quick Desktop", "unreadable");
      }),
    ),
  );
});
