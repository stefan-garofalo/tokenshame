import { assert, describe, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import type * as Scope from "effect/Scope";
import { DatabaseSync } from "node:sqlite";

import { readAntigravity } from "./antigravity";
import { readCopilot } from "./copilot";
import { readGoose } from "./goose";
import { readMuse } from "./muse";
import type { ReadResult, Reader, UsageRecord } from "./types";

// Fixtures are built per test in a temp folder. Every table holds only the columns a
// reader may touch, copied from the agent's own schema (see the comment above each reader).

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

const records = (result: ReadResult): readonly UsageRecord[] => {
  assert.strictEqual(result._tag, "Read");
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

// ---------------------------------------------------------------------------------------
// Copilot CLI
// ---------------------------------------------------------------------------------------

const copilotParts = [".copilot", "session-store.db"];

const copilotSchema = `
  CREATE TABLE assistant_usage_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    model TEXT NOT NULL,
    input_tokens INTEGER,
    output_tokens INTEGER,
    cache_read_tokens INTEGER,
    cache_write_tokens INTEGER,
    reasoning_tokens INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
  );
`;

// Copilot counts cache inside `input_tokens`: input = uncached + cache read + cache write.
const copilotEvents = [
  ["c1", "model-a", 1000, 50, 300, 200, "2026-03-01T10:00:00.000Z"],
  ["c1", "model-a", 2000, 60, 1500, 0, "2026-03-01T10:01:00.000Z"],
  ["c2", "model-b", 400, 10, 0, 0, "2026-03-01T11:00:00.000Z"],
] as const;

const fillCopilot = (db: DatabaseSync) => {
  db.exec(copilotSchema);
  const insert = db.prepare(
    "INSERT INTO assistant_usage_events (session_id, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens, created_at) VALUES (?, ?, ?, ?, ?, ?, 5, ?)",
  );
  for (const [session, model, input, output, cacheRead, cacheWrite, at] of copilotEvents) {
    insert.run(session, model, input, output, cacheRead, cacheWrite, at);
  }
};

describe(readCopilot, () => {
  it.effect("yields the known totals of a fixture database", () =>
    provide(
      Effect.gen(function* scenario() {
        const home = yield* makeHome;
        yield* makeDatabase(home, copilotParts, fillCopilot);
        const result = yield* readCopilot(home);
        assert.deepStrictEqual(totals(records(result)), {
          cacheRead: 1800,
          cacheWrite: 200,
          input: 1400,
          output: 120,
        });
      }),
    ),
  );

  it.effect("gives one record per usage event, with cache taken out of input", () =>
    provide(
      Effect.gen(function* scenario() {
        const home = yield* makeHome;
        yield* makeDatabase(home, copilotParts, fillCopilot);
        assert.deepStrictEqual(records(yield* readCopilot(home)), [
          {
            at: Date.parse("2026-03-01T10:00:00.000Z"),
            cacheRead: 300,
            cacheWrite: 200,
            input: 500,
            model: "model-a",
            output: 50,
            session: "copilot:c1",
          },
          {
            at: Date.parse("2026-03-01T10:01:00.000Z"),
            cacheRead: 1500,
            cacheWrite: 0,
            input: 500,
            model: "model-a",
            output: 60,
            session: "copilot:c1",
          },
          {
            at: Date.parse("2026-03-01T11:00:00.000Z"),
            cacheRead: 0,
            cacheWrite: 0,
            input: 400,
            model: "model-b",
            output: 10,
            session: "copilot:c2",
          },
        ]);
      }),
    ),
  );

  it.effect("skips with no-data when the store has no usage table (older Copilot CLI)", () =>
    provide(
      Effect.gen(function* scenario() {
        const home = yield* makeHome;
        yield* makeDatabase(home, copilotParts, (db) => {
          db.exec("CREATE TABLE sessions (id TEXT PRIMARY KEY)");
        });
        assertSkipped(yield* readCopilot(home), "Copilot CLI", "no-data");
      }),
    ),
  );

  databaseFailures("Copilot CLI", readCopilot, copilotParts, fillCopilot);
});

// ---------------------------------------------------------------------------------------
// Goose
// ---------------------------------------------------------------------------------------

const gooseParts = [".local", "share", "goose", "sessions", "sessions.db"];
const gooseMacParts = [
  "Library",
  "Application Support",
  "Block",
  "goose",
  "sessions",
  "sessions.db",
];

const gooseSchema = `
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    accumulated_input_tokens INTEGER,
    accumulated_output_tokens INTEGER,
    accumulated_cache_read_tokens INTEGER,
    accumulated_cache_write_tokens INTEGER,
    model_config_json TEXT
  );
  CREATE TABLE usage_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    created_timestamp INTEGER NOT NULL,
    model TEXT,
    input_tokens INTEGER,
    output_tokens INTEGER,
    cache_read_tokens INTEGER,
    cache_write_tokens INTEGER
  );
`;

const fillGoose = (db: DatabaseSync) => {
  db.exec(gooseSchema);
  // g1 has ledger rows and session totals that repeat them: counted once, from the ledger.
  db.exec(`
    INSERT INTO sessions VALUES ('g1', '2026-03-01 10:00:00', 900, 90, 300, 100, '{"model_name":"model-a"}');
    INSERT INTO usage_ledger (session_id, created_timestamp, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens)
      VALUES ('g1', 1772359200, 'model-a', 500, 40, 300, 100),
             ('g1', 1772359260, NULL, 400, 50, 0, 0);
  `);
  // g2 predates the ledger: only its session totals exist, with the model from model_config_json.
  db.exec(`
    INSERT INTO sessions VALUES ('g2', '2026-03-01 12:00:00', 70, 7, 20, 0, '{"model_name":"model-b"}');
  `);
};

describe(readGoose, () => {
  it.effect("counts ledger rows, plus session totals only for sessions without a ledger", () =>
    provide(
      Effect.gen(function* scenario() {
        const home = yield* makeHome;
        yield* makeDatabase(home, gooseParts, fillGoose);
        const rows = records(yield* readGoose(home));
        assert.deepStrictEqual(rows, [
          {
            at: 1_772_359_200_000,
            cacheRead: 300,
            cacheWrite: 100,
            input: 100,
            model: "model-a",
            output: 40,
            session: "goose:g1",
          },
          {
            at: 1_772_359_260_000,
            cacheRead: 0,
            cacheWrite: 0,
            input: 400,
            model: "model-a",
            output: 50,
            session: "goose:g1",
          },
          {
            at: Date.parse("2026-03-01T12:00:00Z"),
            cacheRead: 20,
            cacheWrite: 0,
            input: 50,
            model: "model-b",
            output: 7,
            session: "goose:g2",
          },
        ]);
        assert.deepStrictEqual(totals(rows), {
          cacheRead: 320,
          cacheWrite: 100,
          input: 550,
          output: 97,
        });
      }),
    ),
  );

  it.effect("reads a database with no ledger table from the session totals", () =>
    provide(
      Effect.gen(function* scenario() {
        const home = yield* makeHome;
        yield* makeDatabase(home, gooseParts, (db) => {
          db.exec(`
            CREATE TABLE sessions (
              id TEXT PRIMARY KEY,
              created_at TIMESTAMP,
              accumulated_input_tokens INTEGER,
              accumulated_output_tokens INTEGER,
              model_config_json TEXT
            );
            INSERT INTO sessions VALUES ('old', '2026-03-01 10:00:00', 30, 3, 'not json');
          `);
        });
        const rows = records(yield* readGoose(home));
        assert.deepStrictEqual(totals(rows), { cacheRead: 0, cacheWrite: 0, input: 30, output: 3 });
        assert.strictEqual(rows[0]?.model, "unknown");
      }),
    ),
  );

  it.effect("finds the database in the macOS application folder too", () =>
    provide(
      Effect.gen(function* scenario() {
        const home = yield* makeHome;
        yield* makeDatabase(home, gooseMacParts, fillGoose);
        assert.strictEqual(records(yield* readGoose(home)).length, 3);
      }),
    ),
  );

  databaseFailures("Goose", readGoose, gooseParts, fillGoose);
});

// ---------------------------------------------------------------------------------------
// Antigravity
// ---------------------------------------------------------------------------------------

const varint = (value: bigint): number[] => {
  const out: number[] = [];
  let rest = value;
  do {
    const low = Number(rest % 128n);
    rest /= 128n;
    out.push(rest > 0n ? low + 128 : low);
  } while (rest > 0n);
  return out;
};

const varintField = (field: number, value: number | bigint): number[] => [
  ...varint(BigInt(field * 8)),
  ...varint(BigInt(value)),
];

const bytesField = (field: number, body: readonly number[]): number[] => [
  ...varint(BigInt(field * 8 + 2)),
  ...varint(BigInt(body.length)),
  ...body,
];

const textField = (field: number, text: string): number[] =>
  bytesField(field, [...new TextEncoder().encode(text)]);

interface Call {
  readonly input?: number;
  readonly output?: number;
  readonly cacheWrite?: number;
  readonly cacheRead?: number;
  readonly thinking?: number;
  readonly response?: number;
}

/** `gen_metadata.data`: chat_model(1) holds usage(4) and the model name(19); step_indices is field 2. */
const generation = (call: Call, model: string, stepIndices: readonly number[]): Uint8Array => {
  const usage = [
    ...varintField(1, 7),
    ...(call.input === undefined ? [] : varintField(2, call.input)),
    ...(call.output === undefined ? [] : varintField(3, call.output)),
    ...(call.cacheWrite === undefined ? [] : varintField(4, call.cacheWrite)),
    ...(call.cacheRead === undefined ? [] : varintField(5, call.cacheRead)),
    ...(call.thinking === undefined ? [] : varintField(9, call.thinking)),
    ...(call.response === undefined ? [] : varintField(10, call.response)),
  ];
  const chat = [
    ...bytesField(4, usage),
    // A 10-byte varint (2^64 - 1) in a field the reader ignores must not drop the row.
    ...varintField(9, 2n ** 64n - 1n),
    ...textField(19, model),
  ];
  const packed = stepIndices.flatMap((index) => varint(BigInt(index)));
  return Uint8Array.from([...bytesField(1, chat), ...bytesField(2, packed)]);
};

/** `steps.metadata`: created_at(1) is a timestamp with seconds(1) and nanos(2). */
const stepMetadata = (seconds: number, nanos: number): Uint8Array =>
  Uint8Array.from(bytesField(1, [...varintField(1, seconds), ...varintField(2, nanos)]));

const antigravityRoot = [".gemini", "antigravity", "conversations"];
const antigravityParts = [...antigravityRoot, "conv-1.db"];

const fillAntigravity = (db: DatabaseSync) => {
  db.exec(`
    CREATE TABLE gen_metadata (idx integer, data blob, size integer NOT NULL DEFAULT 0, PRIMARY KEY (idx));
    CREATE TABLE steps (idx integer, step_type integer, status integer, metadata blob, PRIMARY KEY (idx));
  `);
  const gen = db.prepare("INSERT INTO gen_metadata (idx, data) VALUES (?, ?)");
  gen.run(
    0,
    generation(
      { cacheRead: 20, cacheWrite: 10, input: 100, output: 40, response: 25, thinking: 15 },
      "gemini-test-1",
      [0],
    ),
  );
  gen.run(1, generation({ cacheRead: 7, input: 5, output: 6 }, "gemini-test-1", [1, 2]));
  // No output total: the reader adds thinking (9) and visible output (10).
  gen.run(2, generation({ input: 1, response: 3, thinking: 2 }, "gemini-test-2", [99]));
  // A truncated blob and an empty one carry no usage and must not fail the file.
  gen.run(3, Uint8Array.from([0x0a, 0x7f, 0x01]));
  gen.run(4, null);
  const step = db.prepare("INSERT INTO steps (idx, metadata) VALUES (?, ?)");
  step.run(0, stepMetadata(1_780_000_000, 500_000_000));
  step.run(1, stepMetadata(1_780_000_060, 0));
};

describe(readAntigravity, () => {
  it.effect("decodes only the usage fields of each generation, counting thinking once", () =>
    provide(
      Effect.gen(function* scenario() {
        const home = yield* makeHome;
        const { file } = yield* makeDatabase(home, antigravityParts, fillAntigravity);
        const fs = yield* FileSystem.FileSystem;
        const info = yield* fs.stat(file);
        const modified = info.mtime._tag === "Some" ? info.mtime.value.getTime() : -1;
        assert.deepStrictEqual(records(yield* readAntigravity(home)), [
          {
            at: 1_780_000_000_500,
            cacheRead: 20,
            cacheWrite: 10,
            input: 100,
            model: "gemini-test-1",
            output: 40,
            session: "antigravity:conv-1",
          },
          {
            at: 1_780_000_060_000,
            cacheRead: 7,
            cacheWrite: 0,
            input: 5,
            model: "gemini-test-1",
            output: 6,
            session: "antigravity:conv-1",
          },
          {
            // No step carries step 99, so the call takes the time its file last changed.
            at: modified,
            cacheRead: 0,
            cacheWrite: 0,
            input: 1,
            model: "gemini-test-2",
            output: 5,
            session: "antigravity:conv-1",
          },
        ]);
      }),
    ),
  );

  it.effect("reads the CLI and IDE folders and the implicit subfolder, one session per file", () =>
    provide(
      Effect.gen(function* scenario() {
        const home = yield* makeHome;
        yield* makeDatabase(home, antigravityParts, fillAntigravity);
        yield* makeDatabase(
          home,
          [".gemini", "antigravity-cli", "conversations", "c2.db"],
          fillAntigravity,
        );
        yield* makeDatabase(
          home,
          [".gemini", "antigravity-ide", "conversations", "implicit", "c3.db"],
          fillAntigravity,
        );
        const sessions = new Set(records(yield* readAntigravity(home)).map((row) => row.session));
        assert.deepStrictEqual([...sessions].toSorted(), [
          "antigravity:c2",
          "antigravity:c3",
          "antigravity:conv-1",
        ]);
      }),
    ),
  );

  it.effect("counts the readable files when another file is corrupt", () =>
    provide(
      Effect.gen(function* scenario() {
        const home = yield* makeHome;
        yield* makeDatabase(home, antigravityParts, fillAntigravity);
        yield* writeText(home, [...antigravityRoot, "broken.db"], garbage);
        assert.strictEqual(records(yield* readAntigravity(home)).length, 3);
      }),
    ),
  );

  it.effect("skips with no-data when the folder holds no conversation database", () =>
    provide(
      Effect.gen(function* scenario() {
        const home = yield* makeHome;
        yield* writeText(home, [".gemini", "antigravity", "skills", "a.md"], "skill");
        yield* writeText(home, [...antigravityRoot, "old.pb"], "legacy");
        assertSkipped(yield* readAntigravity(home), "Antigravity", "no-data");
      }),
    ),
  );

  // A non-database file and a live write-ahead log run through the shared cases below, with
  // the conversation folder holding exactly one database file.
  databaseFailures("Antigravity", readAntigravity, antigravityParts, fillAntigravity);
});

// ---------------------------------------------------------------------------------------
// Muse
// ---------------------------------------------------------------------------------------

const museEntry = (
  id: string,
  session: string,
  model: string,
  input: number,
  output: number,
  cacheRead: number,
  cacheWrite: number,
  source?: string,
): string =>
  // `JSON.stringify` leaves out `source_run_record_id` when `source` is undefined.
  JSON.stringify({
    id,
    payload: {
      event: {
        kind: "model_completed",
        model,
        usage: {
          cache_read_tokens: cacheRead,
          cache_write_tokens: cacheWrite,
          input_tokens: input,
          output_tokens: output,
          reasoning_tokens: 8,
        },
      },
      source_run_record_id: source,
    },
    payload_schema_version: 1,
    payload_type: "runtime.session",
    record_type: "event",
    recorded_at: 1_785_578_400_123_456,
    schema_version: 1,
    stream: { id: session, kind: "session" },
  });

const museSessionFile = (folder: string, day: string, session: string) => [
  folder,
  "sessions",
  "2026",
  "08",
  day,
  session,
  "session.jsonl",
];

const defaultMuse = [".local", "share", "muse"];

const museLines = (...lines: readonly string[]) => `${lines.join("\n")}\n`;

describe(readMuse, () => {
  it.effect("is skipped with no-data when no default folder and no MUSE_HOME exist", () =>
    provide(
      Effect.gen(function* scenario() {
        const home = yield* makeHome;
        const result = yield* readMuse(home);
        assertSkipped(result, "Muse", "no-data");
      }),
    ),
  );

  it.effect("stays no-data when MUSE_HOME points at a folder that does not exist", () =>
    provide(
      Effect.gen(function* scenario() {
        const home = yield* makeHome;
        assertSkipped(yield* readMuse(home), "Muse", "no-data");
      }),
      { MUSE_HOME: "/nonexistent/muse-home" },
    ),
  );

  it.effect("reads the default folder, taking cache and reasoning out of the counts", () =>
    provide(
      Effect.gen(function* scenario() {
        const home = yield* makeHome;
        yield* writeText(
          home,
          museSessionFile(defaultMuse.join("/"), "01", "s1"),
          museLines(
            JSON.stringify({ payload_type: "session_start", record_type: "event" }),
            // Muse counts cache inside input_tokens: 100 = 30 uncached + 60 read + 10 write.
            museEntry("e1", "s1", "muse-model-1", 100, 20, 60, 10),
            museEntry("e2", "s1", "muse-model-1", 50, 5, 0, 0),
          ),
        );
        assert.deepStrictEqual(records(yield* readMuse(home)), [
          {
            at: 1_785_578_400_123,
            cacheRead: 60,
            cacheWrite: 10,
            input: 30,
            model: "muse-model-1",
            output: 20,
            session: "muse:s1",
          },
          {
            at: 1_785_578_400_123,
            cacheRead: 0,
            cacheWrite: 0,
            input: 50,
            model: "muse-model-1",
            output: 5,
            session: "muse:s1",
          },
        ]);
      }),
    ),
  );

  it.effect("reads the folder named by MUSE_HOME instead of the default", () =>
    provide(
      Effect.gen(function* scenario() {
        const home = yield* makeHome;
        const custom = yield* makeHome;
        yield* writeText(
          home,
          museSessionFile(defaultMuse.join("/"), "01", "default"),
          museLines(museEntry("d1", "default", "muse-model-1", 999, 999, 0, 0)),
        );
        yield* writeText(
          custom,
          museSessionFile(".", "02", "custom"),
          museLines(museEntry("c1", "custom", "muse-model-1", 10, 2, 0, 0)),
        );
        const rows = records(yield* provide(readMuse(home), { MUSE_HOME: custom }));
        assert.deepStrictEqual(
          rows.map((row) => row.session),
          ["muse:custom"],
        );
      }),
    ),
  );

  it.effect("follows XDG_DATA_HOME when MUSE_HOME is not set", () =>
    provide(
      Effect.gen(function* scenario() {
        const home = yield* makeHome;
        const data = yield* makeHome;
        yield* writeText(
          data,
          museSessionFile("muse", "03", "xdg"),
          museLines(museEntry("x1", "xdg", "muse-model-1", 10, 2, 0, 0)),
        );
        const rows = records(yield* provide(readMuse(home), { XDG_DATA_HOME: data }));
        assert.strictEqual(rows[0]?.session, "muse:xdg");
      }),
    ),
  );

  it.effect("counts a source record copied into another session once", () =>
    provide(
      Effect.gen(function* scenario() {
        const home = yield* makeHome;
        const folder = defaultMuse.join("/");
        yield* writeText(
          home,
          museSessionFile(folder, "01", "parent"),
          museLines(museEntry("p1", "parent", "muse-model-1", 100, 10, 0, 0, "run-1")),
        );
        yield* writeText(
          home,
          museSessionFile(folder, "02", "fork"),
          museLines(
            museEntry("f1", "fork", "muse-model-1", 100, 10, 0, 0, "run-1"),
            museEntry("f2", "fork", "muse-model-1", 7, 1, 0, 0, "run-2"),
          ),
        );
        const sum = totals(records(yield* readMuse(home)));
        assert.deepStrictEqual(sum, { cacheRead: 0, cacheWrite: 0, input: 107, output: 11 });
      }),
    ),
  );

  it.effect("ignores a half-written last line", () =>
    provide(
      Effect.gen(function* scenario() {
        const home = yield* makeHome;
        yield* writeText(
          home,
          museSessionFile(defaultMuse.join("/"), "01", "s1"),
          `${museEntry("e1", "s1", "muse-model-1", 10, 2, 0, 0)}\n{"record_type":"ev`,
        );
        assert.strictEqual(records(yield* readMuse(home)).length, 1);
      }),
    ),
  );

  it.effect("skips with no-data when sessions hold no usage events", () =>
    provide(
      Effect.gen(function* scenario() {
        const home = yield* makeHome;
        yield* writeText(
          home,
          museSessionFile(defaultMuse.join("/"), "01", "s1"),
          museLines(JSON.stringify({ payload_type: "session_start", record_type: "event" })),
        );
        assertSkipped(yield* readMuse(home), "Muse", "no-data");
      }),
    ),
  );

  it.effect("skips with unreadable when the session log is not JSON", () =>
    provide(
      Effect.gen(function* scenario() {
        const home = yield* makeHome;
        yield* writeText(
          home,
          museSessionFile(defaultMuse.join("/"), "01", "s1"),
          "this is not a session log\n",
        );
        assertSkipped(yield* readMuse(home), "Muse", "unreadable");
      }),
    ),
  );
});
