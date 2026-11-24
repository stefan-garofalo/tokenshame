import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

import { assert, describe, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import type { PlatformError } from "effect/PlatformError";

import { readCline } from "./cline";
import { readClineCli } from "./cline-cli";
import { readCopilotVscode } from "./copilot-vscode";
import { readCursor } from "./cursor";
import { readIbmBob } from "./ibm-bob";
import { readKiloCode } from "./kilo-code";
import { readKiro } from "./kiro";
import { readRooCode } from "./roo-code";
import type { ReadResult, Reader, UsageRecord } from "./types";

// Synthetic fixtures under `fixtures/ide/<name>/`, each laid out as a home folder.

type ModelTotals = readonly [
  model: string,
  input: number,
  output: number,
  cacheRead: number,
  cacheWrite: number,
];

interface Case {
  readonly agent: string;
  readonly reader: Reader;
  readonly fixture: string;
  readonly slug: string;
  /** Where a corrupt file would live, under the home folder. */
  readonly corruptFile: readonly string[];
  readonly expected: readonly ModelTotals[];
  readonly sessions: number;
  readonly firstAt: number;
}

const january = 1_767_225_600_000;
const remote = [".vscode-server", "data", "User"];

const cases: readonly Case[] = [
  {
    agent: "Cline",
    corruptFile: [".cline", "data", "tasks", "bad", "ui_messages.json"],
    // task-b is under two editors and counted once; the row without `modelInfo` takes the
    // history file's model; the row without counts is dropped.
    expected: [
      ["claude-sonnet-4-5", 400, 80, 1050, 200],
      ["gpt-5", 10, 5, 0, 0],
    ],
    firstAt: january,
    fixture: "cline",
    reader: readCline,
    sessions: 2,
    slug: "cline",
  },
  {
    agent: "Roo Code",
    corruptFile: [
      ...remote,
      "globalStorage",
      "rooveterinaryinc.roo-cline",
      "tasks",
      "bad",
      "ui_messages.json",
    ],
    // Old Anthropic row keeps `tokensIn`; old OpenAI row and the new row have cache taken out.
    expected: [
      ["claude-sonnet-4-5", 300, 10, 600, 100],
      ["gpt-4.1", 1300, 20, 1200, 200],
    ],
    firstAt: 1_748_038_758_034,
    fixture: "roo-code",
    reader: readRooCode,
    sessions: 1,
    slug: "roo",
  },
  {
    agent: "Kilo Code",
    corruptFile: [
      ...remote,
      "globalStorage",
      "kilocode.kilo-code",
      "tasks",
      "bad",
      "ui_messages.json",
    ],
    expected: [["anthropic/claude-sonnet-4", 300, 20, 200, 0]],
    firstAt: january,
    fixture: "kilo-code",
    reader: readKiloCode,
    sessions: 1,
    slug: "kilo",
  },
  {
    agent: "IBM Bob",
    corruptFile: [
      "Library",
      "Application Support",
      "IBM Bob",
      "User",
      "globalStorage",
      "ibm.bob-code",
      "tasks",
      "bad",
      "ui_messages.json",
    ],
    expected: [["unknown", 250, 40, 100, 50]],
    firstAt: january,
    fixture: "ibm-bob",
    reader: readIbmBob,
    sessions: 1,
    slug: "bob",
  },
  {
    agent: "Cline CLI",
    corruptFile: [".cline", "data", "sessions", "bad", "bad.messages.json"],
    // The copied session folder is counted once; m2 runs on m1's model.
    expected: [["cline/glm-5", 7557, 141, 850, 100]],
    firstAt: january,
    fixture: "cline-cli",
    reader: readClineCli,
    sessions: 1,
    slug: "cline-cli",
  },
  {
    agent: "Kiro",
    corruptFile: [".kiro", "sessions", "cli", "bad.json"],
    // Turns with zero counts (the Auto agent) are dropped, not estimated.
    expected: [["claude-sonnet-4.5", 321, 654, 111, 22]],
    firstAt: january,
    fixture: "kiro",
    reader: readKiro,
    sessions: 1,
    slug: "kiro",
  },
  {
    agent: "Copilot (VS Code)",
    corruptFile: [...remote, "workspaceStorage", "bad", "chatSessions", "bad.json"],
    // The empty-window original of c1 repeats r1 with stale counts and is not counted.
    expected: [
      ["claude-sonnet-4", 1500, 350, 4500, 0],
      ["gpt-4.1-2025-04-14", 900, 60, 0, 0],
      ["gpt-4o", 200, 20, 0, 0],
    ],
    firstAt: january,
    fixture: "copilot-vscode",
    reader: readCopilotVscode,
    sessions: 2,
    slug: "copilot-vscode",
  },
];

const fixtureHome = (fixture: string): string =>
  fileURLToPath(new URL(`fixtures/ide/${fixture}`, import.meta.url));

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

const usageOf = (result: ReadResult): readonly UsageRecord[] => {
  assert.strictEqual(result._tag, "Read");
  return result._tag === "Read" ? result.records : [];
};

const assertSkipped = (result: ReadResult, agent: string, reason: "no-data" | "unreadable") => {
  assert.strictEqual(result._tag, "Skipped");
  if (result._tag === "Skipped") {
    assert.strictEqual(result.agent, agent);
    assert.strictEqual(result.reason, reason);
  }
};

/** Real file system, with only the given environment variables. */
const platform = (env: Readonly<Record<string, string>> = {}) =>
  Layer.mergeAll(NodeServices.layer, ConfigProvider.layer(ConfigProvider.fromEnv({ env })));

/** Runs the reader on a fresh temp home, after `prepare` has filled it. */
const readTempHome = (
  reader: Reader,
  prepare: (
    home: string,
    fs: FileSystem.FileSystem,
    path: Path.Path,
  ) => Effect.Effect<void, PlatformError>,
  env: Readonly<Record<string, string>> = {},
) =>
  Effect.scoped(
    Effect.gen(function* tempHomeRun() {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* fs.makeTempDirectoryScoped({ prefix: "tokenshame-ide-" });
      yield* prepare(home, fs, path);
      return yield* reader(home);
    }),
  ).pipe(Effect.provide(platform(env)));

const writeFile = (
  home: string,
  segments: readonly string[],
  text: string,
  fs: FileSystem.FileSystem,
  path: Path.Path,
) =>
  Effect.gen(function* fileWrite() {
    const file = path.join(home, ...segments);
    yield* fs.makeDirectory(path.dirname(file), { recursive: true });
    yield* fs.writeFileString(file, text);
  });

describe.each(cases)("$agent reader", (c) => {
  it.effect("returns the known per-model totals of its fixture", () =>
    Effect.gen(function* fixtureTotals() {
      const records = usageOf(
        yield* c.reader(fixtureHome(c.fixture)).pipe(Effect.provide(platform())),
      );
      assert.deepStrictEqual(totalsByModel(records), c.expected);
      assert.strictEqual(new Set(records.map((record) => record.session)).size, c.sessions);
      for (const record of records) {
        assert.isTrue(record.session.startsWith(`${c.slug}:`), record.session);
      }
      assert.strictEqual(Math.min(...records.map((record) => record.at)), c.firstAt);
    }),
  );

  it.effect("skips a missing folder as no-data", () =>
    Effect.gen(function* missingFolder() {
      assertSkipped(yield* readTempHome(c.reader, () => Effect.void), c.agent, "no-data");
    }),
  );

  it.effect("skips a corrupt file and keeps the rest", () =>
    Effect.gen(function* corruptSibling() {
      const result = yield* readTempHome(c.reader, (home, fs, path) =>
        Effect.gen(function* copyThenCorrupt() {
          yield* fs.copy(fixtureHome(c.fixture), home, { overwrite: true });
          yield* writeFile(home, c.corruptFile, "{not json\n", fs, path);
        }),
      );
      assert.deepStrictEqual(totalsByModel(usageOf(result)), c.expected);
    }),
  );

  it.effect("reports a source with only corrupt files as unreadable", () =>
    Effect.gen(function* onlyCorrupt() {
      const result = yield* readTempHome(c.reader, (home, fs, path) =>
        writeFile(home, c.corruptFile, "{not json\n", fs, path),
      );
      assertSkipped(result, c.agent, "unreadable");
    }),
  );
});

/** Copies part of a fixture home to `to` below the home folder. */
const copyInto =
  (fixture: string, from: readonly string[], to: string) =>
  (home: string, fs: FileSystem.FileSystem, path: Path.Path) =>
    fs.copy(path.join(fixtureHome(fixture), ...from), path.join(home, to));

describe("Cline-family environment overrides", () => {
  it.effect("CLINE_DIR moves Cline's data folder, CLINE_SESSION_DATA_DIR the CLI sessions", () =>
    Effect.scoped(
      Effect.gen(function* moved() {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const home = yield* fs.makeTempDirectoryScoped({ prefix: "tokenshame-ide-" });
        yield* copyInto("cline", [".cline"], "elsewhere")(home, fs, path);
        yield* copyInto("cline-cli", [".cline", "data", "sessions"], "cli-sessions")(
          home,
          fs,
          path,
        );
        const env = {
          CLINE_DIR: path.join(home, "elsewhere"),
          CLINE_SESSION_DATA_DIR: path.join(home, "cli-sessions"),
        };
        assertSkipped(yield* readCline(home), "Cline", "no-data");
        const [cline, cli] = yield* Effect.all([readCline(home), readClineCli(home)]).pipe(
          Effect.provide(platform(env)),
        );
        assert.deepStrictEqual(totalsByModel(usageOf(cline)), [
          ["claude-sonnet-4-5", 100, 50, 1000, 200],
          ["gpt-5", 10, 5, 0, 0],
        ]);
        assert.deepStrictEqual(totalsByModel(usageOf(cli)), [["cline/glm-5", 7557, 141, 850, 100]]);
      }),
    ).pipe(Effect.provide(platform())),
  );
});

// --- Cursor: a `state.vscdb` built per test ---------------------------------------------

const cursorDb = [
  "Library",
  "Application Support",
  "Cursor",
  "User",
  "globalStorage",
  "state.vscdb",
];

/** The fields of a Cursor bubble value this test sets. */
interface Bubble {
  readonly createdAt: string | number;
  readonly contextTokensUsed?: number;
  readonly modelInfo?: { readonly modelName: string };
  readonly text?: string;
  readonly tokenCount?: { readonly inputTokens: number; readonly outputTokens: number };
  readonly type?: number;
}

const bubble = (fields: Bubble): string => JSON.stringify(fields);

const cursorHome = (rows: readonly (readonly [key: string, value: string])[]) =>
  readTempHome(readCursor, (home, fs, path) =>
    Effect.gen(function* buildDatabase() {
      const file = path.join(home, ...cursorDb);
      yield* fs.makeDirectory(path.dirname(file), { recursive: true });
      const db = new DatabaseSync(file);
      try {
        // Cursor's own schema for this table.
        db.exec("CREATE TABLE cursorDiskKV (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)");
        const insert = db.prepare("INSERT INTO cursorDiskKV (key, value) VALUES (?, ?)");
        for (const [key, value] of rows) {
          insert.run(key, value);
        }
      } finally {
        db.close();
      }
    }),
  );

describe("Cursor reader", () => {
  it.effect("reads only real non-zero bubble counts", () =>
    Effect.gen(function* realCounts() {
      const result = yield* cursorHome([
        [
          "bubbleId:comp-1:b1",
          bubble({
            createdAt: "2026-01-01T00:00:00.000Z",
            text: "hi",
            tokenCount: { inputTokens: 0, outputTokens: 0 },
            type: 1,
          }),
        ],
        [
          "bubbleId:comp-1:b2",
          bubble({
            createdAt: "2026-01-01T00:00:05.000Z",
            modelInfo: { modelName: "claude-4-sonnet" },
            text: "a long reply that must never be turned into a token estimate",
            tokenCount: { inputTokens: 1200, outputTokens: 300 },
            type: 2,
          }),
        ],
        [
          "bubbleId:comp-2:b3",
          bubble({
            createdAt: january + 100_000,
            tokenCount: { inputTokens: 50, outputTokens: 5 },
            type: 2,
          }),
        ],
        ["bubbleId:comp-2:b4", "not json"],
        ["composerData:comp-1", bubble({ contextTokensUsed: 90_000, createdAt: january })],
      ]);
      const records = usageOf(result);
      assert.deepStrictEqual(totalsByModel(records), [
        ["claude-4-sonnet", 1200, 300, 0, 0],
        ["unknown", 50, 5, 0, 0],
      ]);
      assert.deepStrictEqual(
        records.map((record) => [record.session, record.at]),
        [
          ["cursor:comp-1", january + 5000],
          ["cursor:comp-2", january + 100_000],
        ],
      );
    }),
  );

  it.effect("is no-data when every bubble count is zero, as on current builds", () =>
    Effect.gen(function* zeroCounts() {
      const result = yield* cursorHome([
        [
          "bubbleId:comp-1:b1",
          bubble({
            createdAt: "2026-01-01T00:00:00.000Z",
            text: "hello there",
            tokenCount: { inputTokens: 0, outputTokens: 0 },
          }),
        ],
      ]);
      assertSkipped(result, "Cursor", "no-data");
    }),
  );

  it.effect("skips a missing folder as no-data", () =>
    Effect.gen(function* missing() {
      assertSkipped(yield* readTempHome(readCursor, () => Effect.void), "Cursor", "no-data");
    }),
  );

  it.effect("reports a file that is not a database as unreadable", () =>
    Effect.gen(function* corrupt() {
      const result = yield* readTempHome(readCursor, (home, fs, path) =>
        writeFile(home, cursorDb, "not a database", fs, path),
      );
      assertSkipped(result, "Cursor", "unreadable");
    }),
  );
});
