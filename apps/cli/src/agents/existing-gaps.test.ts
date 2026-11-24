import { assert, describe, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import type * as Scope from "effect/Scope";
import { DatabaseSync } from "node:sqlite";
import * as zlib from "node:zlib";

import { readAmp } from "./amp";
import { readAntigravity } from "./antigravity";
import { readCodex } from "./codex";
import { readCopilot } from "./copilot";
import { readGemini } from "./gemini";
import { readGoose } from "./goose";
import { readGrok } from "./grok";
import { readOpencode } from "./opencode";
import { readPi } from "./pi";
import type { ReadResult, UsageRecord } from "./types";

// Every fixture is synthetic and built per test in a temp home. Each case sets only the
// environment variables it tests; the rest of the environment is empty.

type Env = Readonly<Record<string, string>>;
type Totals = readonly [model: string, input: number, output: number, read: number, write: number];

const provide = <A, E>(
  effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path | Scope.Scope>,
  env: Env = {},
) =>
  Effect.scoped(effect).pipe(
    Effect.provide(
      Layer.merge(NodeServices.layer, ConfigProvider.layer(ConfigProvider.fromEnv({ env }))),
    ),
  );

const makeHome = Effect.gen(function* buildHome() {
  const fs = yield* FileSystem.FileSystem;
  return yield* fs.makeTempDirectoryScoped({ prefix: "tokenshame-gaps-" });
});

const write = (file: string, content: string | Uint8Array) =>
  Effect.gen(function* writeFile() {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    yield* fs.makeDirectory(path.dirname(file), { recursive: true });
    yield* fs.writeFile(
      file,
      content instanceof Uint8Array ? content : new TextEncoder().encode(content),
    );
  });

/** A closed SQLite database at `file`, made by `fill`. */
const database = (file: string, fill: (db: DatabaseSync) => void) =>
  Effect.gen(function* buildDatabase() {
    yield* write(file, new Uint8Array());
    const db = new DatabaseSync(file);
    fill(db);
    db.close();
  });

const join = (...parts: string[]) =>
  Effect.gen(function* joinPath() {
    const path = yield* Path.Path;
    return path.join(...parts);
  });

const records = (result: ReadResult): readonly UsageRecord[] => {
  assert.strictEqual(result._tag, "Read");
  return result._tag === "Read" ? result.records : [];
};

const totalsByModel = (found: readonly UsageRecord[]): readonly Totals[] => {
  const byModel = new Map<string, [number, number, number, number]>();
  for (const record of found) {
    const sum = byModel.get(record.model) ?? [0, 0, 0, 0];
    sum[0] += record.input;
    sum[1] += record.output;
    sum[2] += record.cacheRead;
    sum[3] += record.cacheWrite;
    byModel.set(record.model, sum);
  }
  return [...byModel]
    .map(([model, sum]): Totals => [model, ...sum])
    .toSorted((a, b) => a[0].localeCompare(b[0]));
};

const sessionsOf = (found: readonly UsageRecord[]) => new Set(found.map((r) => r.session)).size;

const assertSkipped = (result: ReadResult, reason: "no-data" | "unreadable") => {
  assert.strictEqual(result._tag, "Skipped");
  assert.strictEqual(result._tag === "Skipped" ? result.reason : "", reason);
};

// ---------------------------------------------------------------------------------------
// Codex
// ---------------------------------------------------------------------------------------

const rolloutA = "rollout-2026-01-02T03-04-05-00000000-0000-4000-8000-00000000000a.jsonl";
const rolloutB = "rollout-2026-01-03T03-04-05-00000000-0000-4000-8000-00000000000b.jsonl";

/** A rollout whose last cumulative total is `input` (cache inside), `cached`, `output`. */
const rollout = (input: number, cached: number, output: number): string =>
  [
    { payload: { timestamp: "2026-01-02T03:04:05.000Z" }, type: "session_meta" },
    { payload: { model: "gpt-synthetic" }, type: "turn_context" },
    {
      payload: {
        info: {
          total_token_usage: {
            cached_input_tokens: cached,
            input_tokens: input,
            output_tokens: output,
          },
        },
        type: "token_count",
      },
      type: "event_msg",
    },
  ]
    .map((line) => JSON.stringify(line))
    .join("\n");

const hasZstd = "zstdCompressSync" in zlib;

describe("Codex gaps", () => {
  it.effect(
    "reads CODEX_HOME and archived_sessions, a rollout in both once with its larger total",
    () =>
      Effect.gen(function* scenario() {
        const home = yield* makeHome;
        const codexHome = yield* join(home, "custom-codex");
        yield* write(
          yield* join(codexHome, "sessions", "2026", "01", "02", rolloutA),
          rollout(100, 40, 10),
        );
        yield* write(yield* join(codexHome, "archived_sessions", rolloutA), rollout(200, 40, 20));
        yield* write(yield* join(codexHome, "archived_sessions", rolloutB), rollout(50, 0, 5));
        // The default folder is ignored once CODEX_HOME is set.
        yield* write(yield* join(home, ".codex", "sessions", rolloutB), rollout(9000, 0, 9000));
        const found = records(yield* provide(readCodex(home), { CODEX_HOME: codexHome }));
        assert.deepStrictEqual(totalsByModel(found), [["gpt-synthetic", 210, 25, 40, 0]]);
        assert.strictEqual(sessionsOf(found), 2);
      }).pipe(provide),
  );

  it.effect.skipIf(!hasZstd)(
    "reads a .zst rollout and counts a plain and compressed copy once",
    () =>
      Effect.gen(function* scenario() {
        const home = yield* makeHome;
        yield* write(yield* join(home, ".codex", "sessions", rolloutA), rollout(100, 0, 10));
        yield* write(
          yield* join(home, ".codex", "archived_sessions", `${rolloutA}.zst`),
          zlib.zstdCompressSync(rollout(300, 100, 30)),
        );
        yield* write(
          yield* join(home, ".codex", "archived_sessions", `${rolloutB}.zst`),
          zlib.zstdCompressSync(rollout(50, 0, 5)),
        );
        const found = records(yield* readCodex(home));
        assert.deepStrictEqual(totalsByModel(found), [["gpt-synthetic", 250, 35, 100, 0]]);
        assert.strictEqual(sessionsOf(found), 2);
      }).pipe(provide),
  );

  it.effect("reports a corrupt .zst rollout as unreadable when nothing else reads", () =>
    provide(
      Effect.gen(function* scenario() {
        const home = yield* makeHome;
        yield* write(
          yield* join(home, ".codex", "archived_sessions", `${rolloutA}.zst`),
          "not zstd",
        );
        assertSkipped(yield* readCodex(home), "unreadable");
      }),
    ),
  );

  it.effect("skips a missing CODEX_HOME as no-data", () =>
    Effect.gen(function* scenario() {
      const home = yield* makeHome;
      const result = yield* provide(readCodex(home), { CODEX_HOME: yield* join(home, "none") });
      assertSkipped(result, "no-data");
    }).pipe(provide),
  );
});

// ---------------------------------------------------------------------------------------
// opencode
// ---------------------------------------------------------------------------------------

const opencodeSchema = `
  CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, data TEXT);
  CREATE TABLE session_message (
    id TEXT PRIMARY KEY, session_id TEXT, type TEXT, time_created INTEGER, data TEXT
  );`;

interface Turn {
  readonly at: number;
  readonly model: string;
  readonly input: number;
  readonly output: number;
}

/** opencode's assistant payload: reasoning 1, cache read 2, write 3 on every turn. */
const turnData = (turn: Turn, extra: Readonly<Record<string, string>> = {}) =>
  JSON.stringify({
    modelID: turn.model,
    role: "assistant",
    time: { created: turn.at },
    tokens: { cache: { read: 2, write: 3 }, input: turn.input, output: turn.output, reasoning: 1 },
    ...extra,
  });

const turnA: Turn = { at: 1_700_000_000_000, input: 10, model: "model-a", output: 5 };
const turnB: Turn = { at: 1_700_000_100_000, input: 20, model: "model-b", output: 6 };
const turnC: Turn = { at: 1_700_000_200_000, input: 30, model: "model-c", output: 7 };

const opencodeDb = (file: string, messages: readonly (readonly [string, string, Turn])[]) =>
  database(file, (db) => {
    db.exec(opencodeSchema);
    const insert = db.prepare("INSERT INTO message VALUES (?, ?, ?, ?)");
    for (const [id, session, turn] of messages) {
      insert.run(id, session, turn.at, turnData(turn));
    }
  });

describe("opencode gaps", () => {
  it.effect("reads every channel database under XDG_DATA_HOME, a message in two of them once", () =>
    Effect.gen(function* scenario() {
      const home = yield* makeHome;
      const folder = yield* join(home, "xdg", "opencode");
      yield* opencodeDb(yield* join(folder, "opencode.db"), [["m1", "s1", turnA]]);
      yield* opencodeDb(yield* join(folder, "opencode-stable.db"), [
        ["m1", "s1", turnA],
        ["m2", "s2", turnB],
      ]);
      const found = records(
        yield* provide(readOpencode(home), { XDG_DATA_HOME: yield* join(home, "xdg") }),
      );
      assert.deepStrictEqual(totalsByModel(found), [
        ["model-a", 10, 6, 2, 3],
        ["model-b", 20, 7, 2, 3],
      ]);
      assert.strictEqual(sessionsOf(found), 2);
    }).pipe(provide),
  );

  it.effect("reads session_message rows of the database OPENCODE_DB names", () =>
    Effect.gen(function* scenario() {
      const home = yield* makeHome;
      const file = yield* join(home, ".local", "share", "opencode", "custom.db");
      yield* database(file, (db) => {
        db.exec(opencodeSchema);
        const data = JSON.stringify({
          model: { id: "model-v2", providerID: "p" },
          time: { created: turnA.at },
          tokens: { cache: { read: 0, write: 0 }, input: 4, output: 2, reasoning: 1 },
        });
        db.prepare("INSERT INTO session_message VALUES (?, ?, ?, ?, ?)").run(
          "r1",
          "s9",
          "assistant",
          1,
          data,
        );
        db.prepare("INSERT INTO session_message VALUES (?, ?, ?, ?, ?)").run(
          "r2",
          "s9",
          "user",
          2,
          data,
        );
      });
      const found = records(yield* provide(readOpencode(home), { OPENCODE_DB: "custom.db" }));
      assert.deepStrictEqual(totalsByModel(found), [["model-v2", 4, 3, 0, 0]]);
    }).pipe(provide),
  );

  it.effect(
    "reads legacy message files, skipping a message the database has and a forked copy",
    () =>
      provide(
        Effect.gen(function* scenario() {
          const home = yield* makeHome;
          const folder = yield* join(home, ".local", "share", "opencode");
          yield* opencodeDb(yield* join(folder, "opencode.db"), [["m1", "s1", turnA]]);
          const legacy = (session: string, id: string, data: string) =>
            Effect.flatMap(join(folder, "storage", "message", session, `${id}.json`), (file) =>
              write(file, data),
            );
          // The same message id as the database row, with other counts: the database copy wins.
          yield* legacy(
            "s1",
            "m1",
            turnData({ ...turnA, input: 999 }, { id: "m1", sessionID: "s1" }),
          );
          yield* legacy("s3", "m9", turnData(turnC, { id: "m9", sessionID: "s3" }));
          // A forked session copies m9 under a new id and session.
          yield* legacy("s4", "m10", turnData(turnC, { id: "m10", sessionID: "s4" }));
          yield* legacy("s3", "u1", JSON.stringify({ id: "u1", role: "user", sessionID: "s3" }));
          const found = records(yield* readOpencode(home));
          assert.deepStrictEqual(totalsByModel(found), [
            ["model-a", 10, 6, 2, 3],
            ["model-c", 30, 8, 2, 3],
          ]);
          assert.strictEqual(sessionsOf(found), 2);
        }),
      ),
  );

  it.effect("reports a corrupt channel database as unreadable, a missing folder as no-data", () =>
    provide(
      Effect.gen(function* scenario() {
        const home = yield* makeHome;
        assertSkipped(yield* readOpencode(home), "no-data");
        yield* write(
          yield* join(home, ".local", "share", "opencode", "opencode-beta.db"),
          "x".repeat(4096),
        );
        assertSkipped(yield* readOpencode(home), "unreadable");
      }),
    ),
  );
});

// ---------------------------------------------------------------------------------------
// JSON agents: Gemini CLI, Grok, Pi, Amp
// ---------------------------------------------------------------------------------------

const geminiChat = JSON.stringify({
  messages: [
    {
      id: "g1",
      model: "gemini-synthetic",
      timestamp: "2026-01-01T00:00:00.000Z",
      tokens: { cached: 4, input: 10, output: 3, thoughts: 1 },
      type: "gemini",
    },
  ],
});

const grokUpdate = JSON.stringify({
  params: {
    _meta: { agentTimestampMs: 1_700_000_000_000 },
    update: {
      _meta: { modelId: "grok-synthetic" },
      sessionUpdate: "turn_completed",
      usage: { cachedReadTokens: 4, inputTokens: 10, outputTokens: 3 },
    },
  },
});

const piLine = JSON.stringify({
  id: "p1",
  message: {
    model: "pi-synthetic",
    role: "assistant",
    usage: { cacheRead: 3, cacheWrite: 4, input: 1, output: 2 },
  },
  timestamp: "2026-01-01T00:00:00.000Z",
  type: "message",
});

const ampThread = (model: string) =>
  JSON.stringify({
    created: 1_700_000_000_000,
    messages: [
      {
        role: "assistant",
        usage: {
          cacheCreationInputTokens: 4,
          cacheReadInputTokens: 3,
          inputTokens: 1,
          model,
          outputTokens: 2,
        },
      },
    ],
  });

describe("JSON agent folder overrides", () => {
  it.effect("Gemini CLI reads <GEMINI_CLI_HOME>/.gemini/tmp", () =>
    Effect.gen(function* scenario() {
      const home = yield* makeHome;
      const geminiHome = yield* join(home, "gh");
      yield* write(
        yield* join(geminiHome, ".gemini", "tmp", "hash", "chats", "session-1.json"),
        geminiChat,
      );
      const found = records(yield* provide(readGemini(home), { GEMINI_CLI_HOME: geminiHome }));
      assert.deepStrictEqual(totalsByModel(found), [["gemini-synthetic", 6, 4, 4, 0]]);
      assertSkipped(yield* provide(readGemini(home)), "no-data");
    }).pipe(provide),
  );

  it.effect("Grok reads <GROK_HOME>/sessions", () =>
    Effect.gen(function* scenario() {
      const home = yield* makeHome;
      const grokHome = yield* join(home, "gk");
      yield* write(yield* join(grokHome, "sessions", "ws", "s1", "updates.jsonl"), grokUpdate);
      const found = records(yield* provide(readGrok(home), { GROK_HOME: grokHome }));
      assert.deepStrictEqual(totalsByModel(found), [["grok-synthetic", 6, 3, 4, 0]]);
      assertSkipped(yield* provide(readGrok(home)), "no-data");
    }).pipe(provide),
  );

  it.effect("Pi reads <PI_CODING_AGENT_DIR>/sessions", () =>
    Effect.gen(function* scenario() {
      const home = yield* makeHome;
      const agentDir = yield* join(home, "pa");
      yield* write(yield* join(agentDir, "sessions", "--proj--", "s1.jsonl"), piLine);
      const found = records(yield* provide(readPi(home), { PI_CODING_AGENT_DIR: agentDir }));
      assert.deepStrictEqual(totalsByModel(found), [["pi-synthetic", 1, 2, 3, 4]]);
      assertSkipped(yield* provide(readPi(home)), "no-data");
    }).pipe(provide),
  );

  it.effect("Amp reads every AMP_DATA_DIR folder, else $XDG_DATA_HOME/amp", () =>
    Effect.gen(function* scenario() {
      const home = yield* makeHome;
      const [first, second, xdg] = [
        yield* join(home, "a1"),
        yield* join(home, "a2"),
        yield* join(home, "x"),
      ];
      yield* write(yield* join(first, "threads", "T-1.json"), ampThread("amp-one"));
      yield* write(yield* join(second, "threads", "T-2.json"), ampThread("amp-two"));
      yield* write(yield* join(xdg, "amp", "threads", "T-3.json"), ampThread("amp-xdg"));
      const listed = records(
        yield* provide(readAmp(home), { AMP_DATA_DIR: `${first}, ${second}` }),
      );
      assert.deepStrictEqual(totalsByModel(listed), [
        ["amp-one", 1, 2, 3, 4],
        ["amp-two", 1, 2, 3, 4],
      ]);
      const fromXdg = records(yield* provide(readAmp(home), { XDG_DATA_HOME: xdg }));
      assert.deepStrictEqual(totalsByModel(fromXdg), [["amp-xdg", 1, 2, 3, 4]]);
      assertSkipped(
        yield* provide(readAmp(home), { AMP_DATA_DIR: yield* join(home, "none") }),
        "no-data",
      );
    }).pipe(provide),
  );
});

// ---------------------------------------------------------------------------------------
// Antigravity
// ---------------------------------------------------------------------------------------

const varint = (value: number): number[] => {
  const out: number[] = [];
  let rest = value;
  do {
    const low = rest % 128;
    rest = Math.floor(rest / 128);
    out.push(rest > 0 ? low + 128 : low);
  } while (rest > 0);
  return out;
};
const bytesField = (field: number, body: readonly number[]) => [
  ...varint(field * 8 + 2),
  ...varint(body.length),
  ...body,
];

/** `gen_metadata.data`: chat(1) holds usage(4: input 2, output 3) and the model(19). */
const generation = (input: number, output: number, model: string): Uint8Array =>
  Uint8Array.from(
    bytesField(1, [
      ...bytesField(4, [...varint(2 * 8), ...varint(input), ...varint(3 * 8), ...varint(output)]),
      ...bytesField(19, [...new TextEncoder().encode(model)]),
    ]),
  );

describe("Antigravity gaps", () => {
  it.effect("reads conversations below <GEMINI_CLI_HOME>/.gemini", () =>
    Effect.gen(function* scenario() {
      const home = yield* makeHome;
      const geminiHome = yield* join(home, "gh");
      yield* database(
        yield* join(geminiHome, ".gemini", "antigravity-cli", "conversations", "c1.db"),
        (db) => {
          db.exec("CREATE TABLE gen_metadata (idx integer PRIMARY KEY, data blob)");
          db.prepare("INSERT INTO gen_metadata VALUES (?, ?)").run(
            0,
            generation(7, 3, "ag-synthetic"),
          );
        },
      );
      const found = records(yield* provide(readAntigravity(home), { GEMINI_CLI_HOME: geminiHome }));
      assert.deepStrictEqual(totalsByModel(found), [["ag-synthetic", 7, 3, 0, 0]]);
      assertSkipped(yield* provide(readAntigravity(home)), "no-data");
    }).pipe(provide),
  );
});

// ---------------------------------------------------------------------------------------
// Goose
// ---------------------------------------------------------------------------------------

const gooseDb = (file: string, input: number) =>
  database(file, (db) => {
    db.exec(`CREATE TABLE sessions (
      id TEXT PRIMARY KEY, created_at TEXT,
      accumulated_input_tokens INTEGER, accumulated_output_tokens INTEGER)`);
    db.prepare("INSERT INTO sessions VALUES (?, ?, ?, ?)").run(
      "g1",
      "2026-01-01 00:00:00",
      input,
      1,
    );
  });

describe("Goose gaps", () => {
  it.effect("reads only <GOOSE_PATH_ROOT>/data when it is set", () =>
    Effect.gen(function* scenario() {
      const home = yield* makeHome;
      const root = yield* join(home, "goose-root");
      yield* gooseDb(yield* join(root, "data", "sessions", "sessions.db"), 5);
      yield* gooseDb(yield* join(home, ".local", "share", "goose", "sessions", "sessions.db"), 900);
      const found = records(yield* provide(readGoose(home), { GOOSE_PATH_ROOT: root }));
      assert.deepStrictEqual(totalsByModel(found), [["unknown", 5, 1, 0, 0]]);
      assertSkipped(
        yield* provide(readGoose(home), { GOOSE_PATH_ROOT: yield* join(home, "none") }),
        "no-data",
      );
    }).pipe(provide),
  );

  it.effect("reads $XDG_DATA_HOME/goose and the macOS Application Support folder", () =>
    Effect.gen(function* scenario() {
      const home = yield* makeHome;
      yield* gooseDb(
        yield* join(home, "Library", "Application Support", "goose", "sessions", "sessions.db"),
        7,
      );
      assert.deepStrictEqual(totalsByModel(records(yield* provide(readGoose(home)))), [
        ["unknown", 7, 1, 0, 0],
      ]);
      const xdg = yield* join(home, "xdg");
      yield* gooseDb(yield* join(xdg, "goose", "sessions", "sessions.db"), 3);
      const fromXdg = records(yield* provide(readGoose(home), { XDG_DATA_HOME: xdg }));
      assert.deepStrictEqual(totalsByModel(fromXdg), [["unknown", 3, 1, 0, 0]]);
    }).pipe(provide),
  );
});

// ---------------------------------------------------------------------------------------
// Copilot CLI
// ---------------------------------------------------------------------------------------

const storeDb = (file: string) =>
  database(file, (db) => {
    db.exec(`CREATE TABLE assistant_usage_events (
      id INTEGER PRIMARY KEY, session_id TEXT, model TEXT, created_at TEXT, input_tokens INTEGER,
      output_tokens INTEGER, cache_read_tokens INTEGER, cache_write_tokens INTEGER)`);
    db.prepare(
      "INSERT INTO assistant_usage_events VALUES (1, 'c1', 'gpt-store', '2026-01-01T00:00:00Z', 10, 2, 4, 1)",
    ).run();
  });

const desktopDb = (file: string) =>
  database(file, (db) => {
    db.exec(`CREATE TABLE sessions (
      id TEXT PRIMARY KEY, model TEXT, total_input_tokens INTEGER, total_output_tokens INTEGER,
      total_cached_tokens INTEGER, total_reasoning_tokens INTEGER, created_at TEXT)`);
    const insert = db.prepare(
      "INSERT INTO sessions VALUES (?, ?, ?, ?, ?, 0, '2026-01-02T00:00:00Z')",
    );
    // c1 is in the store per call already, so its totals here must not count again.
    insert.run("c1", "gpt-desktop", 500, 50, 100);
    insert.run("d2", "gpt-desktop", 100, 20, 30);
  });

describe("Copilot CLI gaps", () => {
  it.effect("adds data.db session totals the store does not already hold", () =>
    provide(
      Effect.gen(function* scenario() {
        const home = yield* makeHome;
        yield* storeDb(yield* join(home, ".copilot", "session-store.db"));
        yield* desktopDb(yield* join(home, ".copilot", "data.db"));
        const found = records(yield* readCopilot(home));
        assert.deepStrictEqual(totalsByModel(found), [
          ["gpt-desktop", 70, 20, 30, 0],
          ["gpt-store", 5, 2, 4, 1],
        ]);
        assert.strictEqual(sessionsOf(found), 2);
      }),
    ),
  );

  it.effect("reports a corrupt data.db as unreadable, a missing folder as no-data", () =>
    provide(
      Effect.gen(function* scenario() {
        const home = yield* makeHome;
        assertSkipped(yield* readCopilot(home), "no-data");
        yield* write(yield* join(home, ".copilot", "data.db"), "x".repeat(4096));
        assertSkipped(yield* readCopilot(home), "unreadable");
      }),
    ),
  );
});
