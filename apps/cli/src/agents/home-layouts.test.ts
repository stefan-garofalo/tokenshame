import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterEach, assert, describe, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as EffectPath from "effect/Path";

import { registry } from "./registry";
import type { ReadResult, UsageRecord } from "./types";

// AC-009: every reader finds its Usage Source from the home folder through `Path`, and the
// same fixture is found under macOS, Linux and Windows home-folder conventions. Only Goose has
// a different place per OS; every other agent keeps a dot-folder (or `~/.local/share`) below
// home on all three.

interface OsStyle {
  readonly name: string;
  /** The home folder, as a path below a temp folder. */
  readonly home: readonly string[];
  /** Where Goose keeps its database on this OS. */
  readonly goose: readonly string[];
  /** The per-user app data folder of this OS, below home: where Electron apps such as VS Code keep data. */
  readonly appData: readonly string[];
  /** Where Zed keeps its data folder on this OS. */
  readonly zed: readonly string[];
}

const osStyles: readonly OsStyle[] = [
  {
    appData: ["Library", "Application Support"],
    goose: ["Library", "Application Support", "Block", "goose", "sessions", "sessions.db"],
    home: ["Users", "stefan"],
    name: "macOS",
    zed: ["Library", "Application Support", "Zed"],
  },
  {
    appData: [".config"],
    goose: [".local", "share", "goose", "sessions", "sessions.db"],
    home: ["home", "stefan"],
    name: "Linux",
    zed: [".local", "share", "zed"],
  },
  {
    appData: ["AppData", "Roaming"],
    goose: ["AppData", "Roaming", "Block", "goose", "data", "sessions", "sessions.db"],
    home: ["Users", "Stefan"],
    name: "Windows",
    zed: ["AppData", "Local", "Zed"],
  },
];

const fixture = (name: string): string =>
  fileURLToPath(new URL(`fixtures/${name}`, import.meta.url));

/** Copies an existing fixture folder into the home folder, keeping file times. */
const copyFixture =
  (name: string) =>
  (home: string): void => {
    cpSync(fixture(name), home, { preserveTimestamps: true, recursive: true });
  };

const database = (home: string, parts: readonly string[], sql: string): void => {
  const file = path.join(home, ...parts);
  mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  try {
    db.exec(sql);
  } finally {
    db.close();
  }
};

/** One MiMo Code assistant turn, as `message.data` stores it. */
const mimoTurn = (id: string, input: number): string =>
  `{"id":"${id}","role":"assistant","modelID":"mimo-v2","tokens":{"input":${input},"output":5},"time":{"created":1772359200000}}`;

/** A MiMo Code store with one CLI session and one Xiaomi MiMo AI desktop session. */
const mimoDatabase = (home: string): void => {
  database(
    home,
    [".local", "share", "mimocode", "mimocode.db"],
    `CREATE TABLE session (id TEXT PRIMARY KEY, version TEXT, time_created INTEGER);
     CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, data TEXT NOT NULL);
     INSERT INTO session VALUES ('s1', '1.0.0', 1772359200000), ('s2', 'desktop-1.0.0', 1772359200000);
     INSERT INTO message VALUES ('m1', 's1', '${mimoTurn("m1", 10)}'), ('m2', 's2', '${mimoTurn("m2", 20)}');`,
  );
};

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
const varintField = (field: number, value: number): number[] => [
  ...varint(field * 8),
  ...varint(value),
];
const bytesField = (field: number, body: readonly number[]): number[] => [
  ...varint(field * 8 + 2),
  ...varint(body.length),
  ...body,
];

/** One Antigravity generation: usage(4) with input(2) and output(3), and the model name(19). */
const antigravityGeneration = (): string => {
  const usage = [...varintField(1, 7), ...varintField(2, 100), ...varintField(3, 40)];
  const model = [...new TextEncoder().encode("gemini-test-1")];
  const chat = [...bytesField(4, usage), ...bytesField(19, model)];
  const bytes = [...bytesField(1, chat), ...bytesField(2, [0])];
  return bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

/** `steps.metadata`: created_at(1) holds seconds(1), so the record has its own time. */
const antigravityStepTime = (): string =>
  bytesField(1, varintField(1, 1_780_000_000))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

const museLine = JSON.stringify({
  id: "e1",
  payload: {
    event: {
      kind: "model_completed",
      model: "muse-model-1",
      usage: {
        cache_read_tokens: 60,
        cache_write_tokens: 10,
        input_tokens: 100,
        output_tokens: 20,
      },
    },
  },
  payload_schema_version: 1,
  payload_type: "runtime.session",
  record_type: "event",
  recorded_at: 1_785_578_400_123_456,
  schema_version: 1,
  stream: { id: "s1", kind: "session" },
});

/** How to put usage for one agent under a home folder on the given OS. */
type Plant = (home: string, os: OsStyle) => void;

const plants = {
  Amp: copyFixture("json-agents/amp"),
  Antigravity: (home) => {
    database(
      home,
      [".gemini", "antigravity", "conversations", "conv-1.db"],
      `CREATE TABLE gen_metadata (idx integer, data blob, size integer NOT NULL DEFAULT 0, PRIMARY KEY (idx));
       CREATE TABLE steps (idx integer, step_type integer, status integer, metadata blob, PRIMARY KEY (idx));
       INSERT INTO gen_metadata (idx, data) VALUES (0, x'${antigravityGeneration()}');
       INSERT INTO steps (idx, metadata) VALUES (0, x'${antigravityStepTime()}');`,
    );
  },
  Aside: copyFixture("json-tools/aside"),
  "Augment Code": copyFixture("json-tools/augment"),
  BB: (home) => {
    database(
      home,
      [".bb", "bb.db"],
      `CREATE TABLE threads (id TEXT PRIMARY KEY, project_id TEXT, provider_id TEXT NOT NULL, model_override TEXT, created_at INTEGER NOT NULL);
       CREATE TABLE events (id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, turn_id TEXT, sequence INTEGER NOT NULL, type TEXT NOT NULL, data TEXT NOT NULL, created_at INTEGER NOT NULL);
       INSERT INTO threads VALUES ('b1', 'p1', 'pi', 'claude-x', 1772359200000);
       INSERT INTO events VALUES ('e1', 'b1', 'u1', 1, 'thread/tokenUsage/updated', '{"tokenUsage":{"last":{"inputTokens":10,"outputTokens":5}}}', 1772359200000);`,
    );
  },
  "Cherry Studio": (home, os) => {
    cpSync(
      fixture("claude-family/cherrystudio/Library/Application Support/CherryStudio"),
      path.join(home, ...os.appData, "CherryStudio"),
      { preserveTimestamps: true, recursive: true },
    );
  },
  "Claude Code": copyFixture("claude/duplicates"),
  Cline: copyFixture("ide/cline"),
  "Cline CLI": copyFixture("ide/cline-cli"),
  CodeBuddy: copyFixture("claude-family/codebuddy"),
  Codebuff: copyFixture("json-tools/codebuff"),
  Codex: copyFixture("codex/last-total"),
  "Command Code": copyFixture("claude-family/commandcode"),
  "Copilot (VS Code)": copyFixture("ide/copilot-vscode"),
  "Copilot CLI": (home) => {
    database(
      home,
      [".copilot", "session-store.db"],
      `CREATE TABLE assistant_usage_events (
         id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, model TEXT NOT NULL,
         input_tokens INTEGER, output_tokens INTEGER, cache_read_tokens INTEGER,
         cache_write_tokens INTEGER, reasoning_tokens INTEGER, created_at TEXT);
       INSERT INTO assistant_usage_events (session_id, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens, created_at)
         VALUES ('c1', 'model-a', 1000, 50, 300, 200, 5, '2026-03-01T10:00:00.000Z');`,
    );
  },
  Cursor: (home, os) => {
    database(
      home,
      [...os.appData, "Cursor", "User", "globalStorage", "state.vscdb"],
      `CREATE TABLE cursorDiskKV (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB);
       INSERT INTO cursorDiskKV VALUES ('bubbleId:comp-1:b1', '{"createdAt":"2026-03-01T10:00:00.000Z","modelInfo":{"modelName":"model-a"},"tokenCount":{"inputTokens":100,"outputTokens":20}}');`,
    );
  },
  "DeepSeek Harness": copyFixture("json-tools/dsh"),
  Devin: (home) => {
    database(
      home,
      [".local", "share", "devin", "cli", "sessions.db"],
      `CREATE TABLE sessions (id TEXT PRIMARY KEY, model TEXT, title TEXT);
       CREATE TABLE message_nodes (row_id INTEGER PRIMARY KEY, session_id TEXT NOT NULL, chat_message TEXT NOT NULL, created_at INTEGER NOT NULL);
       INSERT INTO sessions VALUES ('d1', 'claude-x', NULL);
       INSERT INTO message_nodes (session_id, chat_message, created_at) VALUES ('d1', '{"role":"assistant","metadata":{"metrics":{"input_tokens":10,"output_tokens":5}}}', 1772359200);`,
    );
  },
  Droid: copyFixture("json-agents/droid"),
  Forge: (home) => {
    database(
      home,
      [".forge", ".forge.db"],
      `CREATE TABLE conversations (conversation_id TEXT PRIMARY KEY NOT NULL, title TEXT, workspace_id BIGINT NOT NULL, context TEXT, created_at TIMESTAMP NOT NULL, updated_at TIMESTAMP);
       INSERT INTO conversations VALUES ('c1', NULL, 1, '{"messages":[{"message":{"text":{"role":"Assistant","model":"model-f","content":""}},"usage":{"prompt_tokens":{"actual":10},"completion_tokens":{"actual":5},"cached_tokens":{"actual":2}}}]}', '2026-03-01 09:00:00', '2026-03-01 10:00:00');`,
    );
  },
  "Gemini CLI": copyFixture("json-agents/gemini"),
  Goose: (home, os) => {
    database(
      home,
      os.goose,
      `CREATE TABLE sessions (
         id TEXT PRIMARY KEY, created_at TIMESTAMP, accumulated_input_tokens INTEGER,
         accumulated_output_tokens INTEGER, accumulated_cache_read_tokens INTEGER,
         accumulated_cache_write_tokens INTEGER, model_config_json TEXT);
       CREATE TABLE usage_ledger (
         id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL,
         created_timestamp INTEGER NOT NULL, model TEXT, input_tokens INTEGER,
         output_tokens INTEGER, cache_read_tokens INTEGER, cache_write_tokens INTEGER);
       INSERT INTO sessions VALUES ('g1', '2026-03-01 10:00:00', 900, 90, 300, 100, '{"model_name":"model-a"}');
       INSERT INTO usage_ledger (session_id, created_timestamp, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens)
         VALUES ('g1', 1772359200, 'model-a', 500, 40, 300, 100);`,
    );
  },
  Grok: copyFixture("json-agents/grok"),
  "Hermes Agent": (home) => {
    database(
      home,
      [".hermes", "state.db"],
      `CREATE TABLE sessions (id TEXT PRIMARY KEY, model TEXT, started_at REAL NOT NULL, input_tokens INTEGER, output_tokens INTEGER, cache_read_tokens INTEGER, cache_write_tokens INTEGER, reasoning_tokens INTEGER);
       INSERT INTO sessions VALUES ('h1', 'model-a', 1772359200, 10, 5, 0, 0, 0);`,
    );
  },
  "IBM Bob": (home, os) => {
    cpSync(fixture("ide/ibm-bob/Library/Application Support"), path.join(home, ...os.appData), {
      preserveTimestamps: true,
      recursive: true,
    });
  },
  Jcode: copyFixture("pi-family/jcode"),
  Junie: copyFixture("json-tools/junie"),
  "Kilo CLI": (home) => {
    database(
      home,
      [".local", "share", "kilo", "kilo.db"],
      `CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, data TEXT NOT NULL);
       INSERT INTO message VALUES ('m1', 's1', '{"role":"assistant","modelID":"claude-x","tokens":{"input":10,"output":5,"reasoning":1,"cache":{"read":2,"write":0}},"time":{"created":1772359200000}}');`,
    );
  },
  "Kilo Code": copyFixture("ide/kilo-code"),
  Kimchi: copyFixture("pi-family/kimchi"),
  Kimi: copyFixture("json-agents/kimi"),
  "Kimi Code": copyFixture("json-tools/kimi-code"),
  Kiro: copyFixture("ide/kiro"),
  "LingTai TUI": copyFixture("pi-family/lingtai"),
  "MiMo Code": (home) => {
    mimoDatabase(home);
  },
  "Mistral Vibe": copyFixture("json-tools/vibe"),
  Muse: (home) => {
    const file = path.join(
      home,
      ".local",
      "share",
      "muse",
      "sessions",
      "2026",
      "08",
      "01",
      "s1",
      "session.jsonl",
    );
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${museLine}\n`);
  },
  Mux: copyFixture("json-tools/mux"),
  "Oh My Pi": copyFixture("pi-family/omp"),
  OpenClaude: copyFixture("claude-family/openclaude"),
  OpenClaw: copyFixture("pi-family/openclaw"),
  OpenCodeReview: copyFixture("claude-family/opencodereview"),
  Pi: copyFixture("json-agents/pi"),
  "Prime Agent": copyFixture("pi-family/prime"),
  Proma: copyFixture("json-tools/proma"),
  Qoder: copyFixture("claude-family/qoder"),
  "Quick Desktop": (home) => {
    const file = path.join(home, ".quickwork", "metrics", "metrics-2026-03-01.jsonl");
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(
      file,
      `${JSON.stringify({ InputTokens: 10, Model: "claude-x", OutputTokens: 5, session_id: "q1" })}\n`,
    );
  },
  Qwen: copyFixture("json-agents/qwen"),
  Reasonix: copyFixture("pi-family/reasonix"),
  "Roo Code": copyFixture("ide/roo-code"),
  Senpi: copyFixture("pi-family/senpi"),
  WorkBuddy: copyFixture("claude-family/workbuddy"),
  "Xiaomi MiMo AI": (home) => {
    mimoDatabase(home);
  },
  ZCode: copyFixture("claude-family/zcode"),
  "Zed Agent": (home, os) => {
    database(
      home,
      [...os.zed, "threads", "threads.db"],
      `CREATE TABLE threads (id TEXT PRIMARY KEY, summary TEXT, updated_at TEXT NOT NULL, data_type TEXT NOT NULL, data BLOB NOT NULL);
       INSERT INTO threads VALUES ('t1', '', '2026-03-01T10:00:00Z', 'json', CAST('{"model":{"provider":"zed.dev","model":"claude-x"},"cumulative_token_usage":{"input_tokens":10,"output_tokens":5}}' AS BLOB));`,
    );
  },
  fx: copyFixture("json-tools/fx"),
  "gajae-code": copyFixture("pi-family/gjc"),
  opencode: (home) => {
    database(
      home,
      [".local", "share", "opencode", "opencode.db"],
      `CREATE TABLE session (
         id TEXT PRIMARY KEY, time_created INTEGER NOT NULL, model TEXT,
         tokens_input INTEGER NOT NULL DEFAULT 0, tokens_output INTEGER NOT NULL DEFAULT 0,
         tokens_cache_read INTEGER NOT NULL DEFAULT 0, tokens_cache_write INTEGER NOT NULL DEFAULT 0);
       CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, time_created INTEGER NOT NULL, data TEXT NOT NULL);
       INSERT INTO session VALUES ('s1', 1700000000000, '{"id":"model-a"}', 10, 20, 30, 40);`,
    );
  },
  zerostack: copyFixture("pi-family/zerostack"),
} satisfies Record<string, Plant>;

const plantFor = (agent: string): Plant =>
  new Map<string, Plant>(Object.entries(plants)).get(agent) ??
  assert.fail(`no fixture for ${agent}`);

const roots: string[] = [];

/** A fake home below a fresh temp folder, in the folder style of one OS. */
const makeHome = (os: OsStyle): string => {
  const root = mkdtempSync(path.join(tmpdir(), "tokenshame-layout-"));
  roots.push(root);
  const home = path.join(root, ...os.home);
  mkdirSync(home, { recursive: true });
  return home;
};

/** An empty environment, so no variable of the real machine (`MUSE_HOME`) moves a source. */
const platform = Layer.mergeAll(
  NodeServices.layer,
  ConfigProvider.layer(ConfigProvider.fromEnv({ env: {} })),
);

const readAgent = (agent: string, home: string): Effect.Effect<ReadResult> => {
  const read = registry.find(([name]) => name === agent)?.[1];
  return (read ?? assert.fail(`no reader for ${agent}`))(home).pipe(Effect.provide(platform));
};

/** Records without the fields that could differ by home path. */
const comparable = (result: ReadResult): readonly UsageRecord[] =>
  result._tag === "Read"
    ? result.records
    : assert.fail(`expected Read, got Skipped (${result.reason}: ${result.detail})`);

describe("home-folder layouts", () => {
  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("has a fixture for every reader in the registry", () => {
    assert.deepStrictEqual(
      Object.keys(plants).toSorted(),
      registry.map(([agent]) => agent).toSorted(),
    );
  });

  for (const [agent] of registry) {
    it.effect(`${agent} finds the same fixture under macOS, Linux and Windows homes`, () =>
      Effect.gen(function* check() {
        const found: (readonly UsageRecord[])[] = [];
        for (const os of osStyles) {
          const home = makeHome(os);
          plantFor(agent)(home, os);
          const records = comparable(yield* readAgent(agent, home));
          assert.isAbove(records.length, 0, `${agent} on ${os.name}`);
          found.push(records);
        }
        for (const records of found) {
          assert.deepStrictEqual(records, found[0]);
        }
      }),
    );
  }

  it.effect("Goose ignores the database of another OS in the same home", () =>
    Effect.gen(function* check() {
      // A macOS-style database in a Linux-style home is not where Goose keeps it there.
      const [macOs, linux] = osStyles;
      const home = makeHome(linux ?? assert.fail("no Linux style"));
      plantFor("Goose")(home, linux ?? assert.fail("no style"));
      const alone = comparable(yield* readAgent("Goose", home));
      plantFor("Goose")(home, macOs ?? assert.fail("no style"));
      assert.deepStrictEqual(comparable(yield* readAgent("Goose", home)), alone);
    }),
  );
});

// --- Path.join, never string concatenation --------------------------------------------

/** A POSIX `Path` whose `join` and separator are Windows style: `a\b`. */
const windowsPath = Layer.effect(EffectPath.Path)(
  Effect.gen(function* build() {
    const posix = yield* EffectPath.Path;
    return EffectPath.make({
      ...posix,
      join: (...parts: readonly string[]) => parts.join("\\"),
      sep: "\\",
    });
  }).pipe(Effect.provide(EffectPath.layer)),
);

describe("readers build paths with Path.join", () => {
  const home = String.raw`C:\Users\Stefan`;

  for (const [agent, read] of registry) {
    it.effect(`${agent} reports a source path joined by the Path service`, () =>
      Effect.gen(function* check() {
        // Nothing exists at a Windows path on this machine, so every reader skips with the
        // path it checked. A "/" in it would mean the reader joined the string itself.
        const result = yield* read(home).pipe(
          Effect.provide(Layer.mergeAll(platform, windowsPath)),
        );
        assert.strictEqual(result._tag, "Skipped");
        if (result._tag === "Skipped") {
          assert.isTrue(result.path.startsWith(`${home}\\`), result.path);
          assert.notInclude(result.path, "/");
        }
      }),
    );
  }
});
