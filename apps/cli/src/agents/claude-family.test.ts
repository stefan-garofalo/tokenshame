import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import type { PlatformError } from "effect/PlatformError";

import { readCherryStudio } from "./cherrystudio";
import { readClaude } from "./claude";
import { readCodeBuddy } from "./codebuddy";
import { readCommandCode } from "./commandcode";
import { readOpenClaude } from "./openclaude";
import { readOpenCodeReview } from "./opencodereview";
import { readQoder } from "./qoder";
import type { ReadResult, Reader, UsageRecord } from "./types";
import { readWorkBuddy } from "./workbuddy";
import { readZcode } from "./zcode";

type ModelTotals = readonly [
  model: string,
  input: number,
  output: number,
  cacheRead: number,
  cacheWrite: number,
];

const fixtureHome = (name: string): string =>
  fileURLToPath(new URL(`fixtures/claude-family/${name}`, import.meta.url));

/** Real files, and the given environment instead of the real one. */
const provide = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  env: Readonly<Record<string, string>> = {},
) =>
  effect.pipe(
    Effect.provide(
      Layer.mergeAll(NodeServices.layer, ConfigProvider.layer(ConfigProvider.fromEnv({ env }))),
    ),
  );

const totalsByModel = (records: readonly UsageRecord[]): readonly ModelTotals[] => {
  const byModel = new Map<string, [number, number, number, number]>();
  for (const record of records) {
    const sum = byModel.get(record.model) ?? [0, 0, 0, 0];
    sum[0] += record.input;
    sum[1] += record.output;
    sum[2] += record.cacheRead;
    sum[3] += record.cacheWrite;
    byModel.set(record.model, sum);
  }
  return [...byModel]
    .map(([model, sum]): ModelTotals => [model, ...sum])
    .toSorted((a, b) => a[0].localeCompare(b[0]));
};

const recordsOf = (result: ReadResult): readonly UsageRecord[] =>
  result._tag === "Read"
    ? result.records
    : assert.fail(`expected Read, got Skipped (${result.reason}: ${result.detail})`);

const sessionsOf = (records: readonly UsageRecord[]): string[] =>
  [...new Set(records.map(({ session }) => session))].toSorted();

const assertSkipped = (result: ReadResult, agent: string, reason: "no-data" | "unreadable") => {
  assert.strictEqual(result._tag, "Skipped");
  if (result._tag === "Skipped") {
    assert.strictEqual(result.agent, agent);
    assert.strictEqual(result.reason, reason);
    assert.strictEqual(result.detail.length > 0, reason === "unreadable");
  }
};

/** Runs `read` on a fresh temp home that `prepare` fills. */
const readTempHome = (
  read: Reader,
  prepare: (home: string) => Effect.Effect<void, PlatformError, FileSystem.FileSystem | Path.Path>,
) =>
  provide(
    Effect.scoped(
      Effect.gen(function* tempHome() {
        const fs = yield* FileSystem.FileSystem;
        const home = yield* fs.makeTempDirectoryScoped({ prefix: "tokenshame-claude-family-" });
        yield* prepare(home);
        return yield* read(home);
      }),
    ),
  );

const writeFile = (home: string, parts: readonly string[], text: string) =>
  Effect.gen(function* write() {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const file = path.join(home, ...parts);
    yield* fs.makeDirectory(path.dirname(file), { recursive: true });
    yield* fs.writeFileString(file, text);
  });

const copyFixture = (home: string, name: string) =>
  Effect.gen(function* copy() {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.copy(fixtureHome(name), home, { overwrite: true });
  });

/** A SQLite database below the home, made by `sql`. */
const writeDatabase = (home: string, parts: readonly string[], sql: string) =>
  Effect.gen(function* write() {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const file = path.join(home, ...parts);
    yield* fs.makeDirectory(path.dirname(file), { recursive: true });
    const db = new DatabaseSync(file);
    try {
      db.exec(sql);
    } finally {
      db.close();
    }
  });

// --- Shared cases of every jsonl reader -------------------------------------------------

interface Case {
  readonly agent: string;
  readonly read: Reader;
  readonly fixture: string;
  readonly corruptFile: readonly string[];
  readonly expected: readonly ModelTotals[];
  readonly sessions: readonly string[];
}

const cherryApp = ["Library", "Application Support", "CherryStudio"];

const cases: readonly Case[] = [
  {
    agent: "Qoder",
    corruptFile: [".qoder", "projects", "bad", "bad.jsonl"],
    // `auto` lines take the user's `businessModelKey`; m1 keeps its last line; zero usage
    // and `*.checkpoints.jsonl` count nothing; `.qoder-cn` is read too.
    expected: [
      ["glm-4.6", 50, 5, 0, 0],
      ["qmodel-x", 100, 25, 300, 10],
    ],
    fixture: "qoder",
    read: readQoder,
    sessions: ["qoder:s1", "qoder:s2"],
  },
  {
    agent: "OpenClaude",
    corruptFile: [".openclaude", "projects", "bad", "bad.jsonl"],
    // The sidechain call counts; the `.replay.json` sibling does not.
    expected: [["deepseek-chat", 1010, 101, 200, 0]],
    fixture: "openclaude",
    read: readOpenClaude,
    sessions: ["openclaude:u1"],
  },
  {
    agent: "Cherry Studio",
    corruptFile: [...cherryApp, "Data", "Agents", ".claude", "projects", "bad", "bad.jsonl"],
    // One call written 3 times in V2 and again in V1 counts once; the V1-only call counts.
    expected: [["deepseek-chat", 11, 7, 100, 0]],
    fixture: "cherrystudio",
    read: readCherryStudio,
    sessions: ["cherry:c0", "cherry:c1"],
  },
  {
    agent: "CodeBuddy",
    corruptFile: [".codebuddy", "projects", "bad", "bad.jsonl"],
    // msg-1: the larger snapshot, input without its cache reads (total = input + output).
    // msg-2: DeepSeek `prompt_tokens` hold the cache hits. In-progress lines do not count.
    expected: [
      ["glm-5.2", 9766, 3, 14_720, 0],
      ["minimax-m3", 7, 2, 3, 0],
    ],
    fixture: "codebuddy",
    read: readCodeBuddy,
    sessions: ["codebuddy:session-1"],
  },
  {
    agent: "WorkBuddy",
    corruptFile: [".workbuddy-ai", "projects", "bad", "bad.jsonl"],
    // w1 is in both the new and the legacy folder: once.
    expected: [["hunyuan-t1", 600, 60, 0, 0]],
    fixture: "workbuddy",
    read: readWorkBuddy,
    sessions: ["workbuddy:w0", "workbuddy:w1"],
  },
  {
    agent: "Command Code",
    corruptFile: [".commandcode", "projects", "bad", "bad.jsonl"],
    // The forked copy of uuid-1 counts once; sidecar files are not read; a line with no
    // model takes the `model_change` model.
    expected: [
      ["anthropic/claude-sonnet-4-5", 100, 10, 0, 50],
      ["deepseek/deepseek-v4-flash", 28_544, 206, 7424, 0],
    ],
    fixture: "commandcode",
    read: readCommandCode,
    sessions: ["commandcode:cc-1", "commandcode:cc-2"],
  },
  {
    agent: "OpenCodeReview",
    corruptFile: [".opencodereview", "sessions", "bad", "bad.jsonl"],
    // The replayed line (same time, model and counts) counts once.
    expected: [
      ["claude-sonnet-4", 1000, 200, 500, 100],
      ["gpt-4o", 300, 30, 0, 0],
    ],
    fixture: "opencodereview",
    read: readOpenCodeReview,
    sessions: ["opencodereview:rev-1"],
  },
  {
    agent: "ZCode",
    corruptFile: [".zcode", "projects", "bad", "bad.jsonl"],
    // z1: total = input + output, so its cache reads come out of input.
    // z2: no total, so reasoning is added to output.
    expected: [["glm-5.2", 650, 107, 400, 0]],
    fixture: "zcode",
    read: readZcode,
    sessions: ["zcode:z1", "zcode:z2"],
  },
];

describe.each(cases)("$agent reader", (c) => {
  it.effect("returns the known per-model totals and sessions of its fixture", () =>
    Effect.gen(function* fixtureTotals() {
      const records = recordsOf(yield* provide(c.read(fixtureHome(c.fixture))));
      assert.deepStrictEqual(totalsByModel(records), c.expected);
      assert.deepStrictEqual(sessionsOf(records), c.sessions);
      for (const { at } of records) {
        assert.isTrue(Number.isSafeInteger(at) && at > 0);
      }
    }),
  );

  it.effect("skips a missing folder as no-data", () =>
    Effect.map(
      readTempHome(c.read, () => Effect.void),
      (result) => {
        assertSkipped(result, c.agent, "no-data");
      },
    ),
  );

  it.effect("keeps the usage of the other files when one file is corrupt", () =>
    Effect.map(
      readTempHome(c.read, (home) =>
        Effect.andThen(copyFixture(home, c.fixture), writeFile(home, c.corruptFile, "{not json\n")),
      ),
      (result) => {
        assert.deepStrictEqual(totalsByModel(recordsOf(result)), c.expected);
      },
    ),
  );

  it.effect("reports a folder with only a corrupt file as unreadable", () =>
    Effect.map(
      readTempHome(c.read, (home) => writeFile(home, c.corruptFile, "{not json\n")),
      (result) => {
        assertSkipped(result, c.agent, "unreadable");
      },
    ),
  );
});

// --- Claude Code folders -----------------------------------------------------------------

describe("Claude Code folders", () => {
  it.effect(
    "reads every CLAUDE_CONFIG_DIR folder, counts a copied message once, skips ~/.claude",
    () =>
      Effect.map(
        provide(readClaude(fixtureHome("claude/config-dirs")), { CLAUDE_CONFIG_DIR: "~/a, ~/b" }),
        (result) => {
          const records = recordsOf(result);
          assert.deepStrictEqual(totalsByModel(records), [
            ["claude-opus-4-1", 20, 2, 0, 0],
            ["claude-sonnet-4-5", 10, 1, 100, 5],
          ]);
          assert.deepStrictEqual(sessionsOf(records), ["claude:s1", "claude:s2"]);
        },
      ),
  );

  it.effect("reads `transcripts/` and `~/.config/claude` by default", () =>
    Effect.map(provide(readClaude(fixtureHome("claude/default-dirs"))), (result) => {
      const records = recordsOf(result);
      assert.deepStrictEqual(totalsByModel(records), [["claude-sonnet-4-5", 130, 48, 67, 8]]);
      // A transcript line without `sessionId` takes the file name.
      assert.deepStrictEqual(sessionsOf(records), ["claude:s3", "claude:ses_1"]);
    }),
  );

  it.effect("reads Claude Desktop sessions, not their audit log, and counts a copy once", () =>
    Effect.map(provide(readClaude(fixtureHome("claude/desktop"))), (result) => {
      assert.deepStrictEqual(totalsByModel(recordsOf(result)), [
        ["claude-haiku-4-5", 4, 1, 0, 0],
        ["claude-sonnet-4-5", 30, 3, 300, 0],
      ]);
    }),
  );

  it.effect("names the first CLAUDE_CONFIG_DIR folder when nothing is there", () =>
    Effect.map(
      provide(readClaude(fixtureHome("claude/config-dirs")), { CLAUDE_CONFIG_DIR: "/nowhere/x" }),
      (result) => {
        assertSkipped(result, "Claude Code", "no-data");
        assert.strictEqual(result._tag === "Skipped" ? result.path : "", "/nowhere/x");
      },
    ),
  );
});

describe("Qoder folders", () => {
  it.effect("follows QODER_CONFIG_DIR and QODERCN_CONFIG_DIR", () =>
    Effect.map(
      provide(readQoder("/nowhere"), {
        QODERCN_CONFIG_DIR: fixtureHome("qoder/.qoder-cn"),
        QODER_CONFIG_DIR: fixtureHome("qoder/.qoder"),
      }),
      (result) => {
        assert.deepStrictEqual(sessionsOf(recordsOf(result)), ["qoder:s1", "qoder:s2"]);
      },
    ),
  );
});

// --- Databases ----------------------------------------------------------------------------

const cherryDatabase = [...cherryApp, "Data", "cherrystudio.sqlite"];

describe("Cherry Studio chat database", () => {
  it.effect("reads chat rows only, without cache in input, by conversation", () =>
    Effect.map(
      readTempHome(readCherryStudio, (home) =>
        writeDatabase(
          home,
          cherryDatabase,
          `CREATE TABLE ai_usage_record (
             id TEXT PRIMARY KEY, message_id TEXT, model_id TEXT, input_tokens INTEGER,
             output_tokens INTEGER, cache_read_tokens INTEGER, cache_write_tokens INTEGER,
             reasoning_tokens INTEGER, created_at INTEGER, message_kind TEXT, record_kind TEXT);
           CREATE TABLE message (id TEXT PRIMARY KEY, topic_id TEXT);
           INSERT INTO message VALUES ('msg-1', 'topic-1');
           INSERT INTO ai_usage_record VALUES
             ('r1', 'msg-1', 'deepseek-chat', 1000, 50, 300, 100, 10, 1768132800000, 'chat', 'invocation'),
             ('r2', NULL, 'deepseek-chat', 200, 20, 0, 0, 0, 1768132900, NULL, 'invocation'),
             ('r3', NULL, 'deepseek-chat', 9000, 900, 0, 0, 0, 1768132800000, 'agent-session', 'invocation'),
             ('r4', NULL, 'deepseek-chat', 9000, 900, 0, 0, 0, 1768132800000, 'chat', 'legacy-aggregate');`,
        ),
      ),
      (result) => {
        const records = recordsOf(result);
        assert.deepStrictEqual(totalsByModel(records), [["deepseek-chat", 800, 70, 300, 100]]);
        assert.deepStrictEqual(sessionsOf(records), ["cherry:chat", "cherry:topic-1"]);
        // `created_at` in seconds or milliseconds lands on the same scale.
        assert.isTrue(records.every(({ at }) => at > 1_700_000_000_000));
      },
    ),
  );

  it.effect("reports a file that is not a database as unreadable", () =>
    Effect.map(
      readTempHome(readCherryStudio, (home) =>
        writeFile(home, cherryDatabase, "not a database ".repeat(100)),
      ),
      (result) => {
        assertSkipped(result, "Cherry Studio", "unreadable");
      },
    ),
  );
});

const zcodeDatabase = [".zcode", "cli", "db", "db.sqlite"];

describe("ZCode database", () => {
  it.effect("reads model_usage and drops transcript sessions the database has", () =>
    Effect.map(
      readTempHome(readZcode, (home) =>
        Effect.andThen(
          copyFixture(home, "zcode"),
          writeDatabase(
            home,
            zcodeDatabase,
            `CREATE TABLE model_usage (
               id TEXT PRIMARY KEY, session_id TEXT, model_id TEXT, started_at INTEGER,
               completed_at INTEGER, input_tokens INTEGER, output_tokens INTEGER,
               reasoning_tokens INTEGER, cache_read_input_tokens INTEGER,
               cache_creation_input_tokens INTEGER, computed_total_tokens INTEGER);
             INSERT INTO model_usage VALUES
               ('u1', 'z1', 'glm-5.2', 1768132800000, 1768132801000, 1000, 100, 20, 600, 100, 1100),
               ('u2', 'z9', 'glm-5.2', 1768132900000, 1768132901000, 500, 50, 10, 0, 0, 560);`,
          ),
        ),
      ),
      (result) => {
        const records = recordsOf(result);
        // u1: total = input + output, so reasoning sits inside output. u2: reasoning outside.
        // Transcript z1 is in the database and drops; transcript z2 is not and stays.
        assert.deepStrictEqual(totalsByModel(records), [["glm-5.2", 850, 167, 600, 100]]);
        assert.deepStrictEqual(sessionsOf(records), ["zcode:z1", "zcode:z2", "zcode:z9"]);
      },
    ),
  );

  it.effect("reports a file that is not a database as unreadable", () =>
    Effect.map(
      readTempHome(readZcode, (home) =>
        writeFile(home, zcodeDatabase, "not a database ".repeat(100)),
      ),
      (result) => {
        assertSkipped(result, "ZCode", "unreadable");
      },
    ),
  );
});
