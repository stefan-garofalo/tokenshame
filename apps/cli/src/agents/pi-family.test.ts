import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { zstdCompressSync } from "node:zlib";

import { assert, describe, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import type { PlatformError } from "effect/PlatformError";
import * as Path from "effect/Path";

import { readGjc } from "./gjc";
import { readJcode } from "./jcode";
import { readKimchi } from "./kimchi";
import { readLingTai } from "./lingtai";
import { readOmp } from "./omp";
import { readOpenClaw } from "./openclaw";
import { readPrimeAgent } from "./prime-agent";
import { readReasonix } from "./reasonix";
import { readSenpi } from "./senpi";
import { readZerostack } from "./zerostack";
import type { ReadResult, Reader, UsageRecord } from "./types";

// Fixtures are synthetic files under `fixtures/pi-family/<fixture>`, each laid out as a home
// folder. OpenClaw's SQLite store is built per test in a temp home.

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
  /** Start of every session key. */
  readonly slug: string;
  /** Where a corrupt file would be read, under the home folder. */
  readonly corruptFile: readonly string[];
  readonly expected: readonly ModelTotals[];
  readonly sessions: number;
  readonly firstAt: number;
  /** A variable that moves the folder at `folder` (below home) elsewhere. */
  readonly override?: { readonly variable: string; readonly folder: readonly string[] };
}

const cases: readonly Case[] = [
  {
    agent: "Oh My Pi",
    corruptFile: [".omp", "agent", "sessions", "-bad-", "bad.jsonl"],
    // a2 and a3 are copied into the fork omp-2 and count once.
    expected: [
      ["claude-opus-5", 107, 43, 300, 20],
      ["gpt-5", 75, 17, 1, 0],
    ],
    firstAt: Date.parse("2026-03-01T10:00:02.000Z"),
    fixture: "omp",
    reader: readOmp,
    sessions: 3,
    slug: "omp",
  },
  {
    agent: "Senpi",
    corruptFile: [".senpi", "agent", "sessions", "-bad-", "bad.jsonl"],
    expected: [
      ["claude-opus-5", 2, 49, 40_625, 332],
      ["kimi-k2", 10, 5, 0, 0],
    ],
    firstAt: Date.parse("2026-03-03T09:00:01.000Z"),
    fixture: "senpi",
    override: { folder: [".senpi", "agent"], variable: "SENPI_CODING_AGENT_DIR" },
    reader: readSenpi,
    sessions: 2,
    slug: "senpi",
  },
  {
    agent: "Kimchi",
    corruptFile: [".config", "kimchi", "harness", "sessions", "-bad-", "bad.jsonl"],
    expected: [["kimi-k2.6", 9541, 151, 50, 0]],
    firstAt: Date.parse("2026-03-04T00:00:01.000Z"),
    fixture: "kimchi",
    override: { folder: [".config", "kimchi", "harness"], variable: "KIMCHI_CODING_AGENT_DIR" },
    reader: readKimchi,
    sessions: 1,
    slug: "kimchi",
  },
  {
    agent: "gajae-code",
    corruptFile: [".gjc", "agent", "sessions", "-bad-", "bad.jsonl"],
    // The review pass replays m1, which counts once.
    expected: [
      ["claude-sonnet-4-5", 40, 8, 0, 0],
      ["gpt-4o", 500, 50, 100, 0],
    ],
    firstAt: Date.parse("2026-03-05T08:00:01.000Z"),
    fixture: "gjc",
    override: { folder: [".gjc", "agent"], variable: "GJC_CODING_AGENT_DIR" },
    reader: readGjc,
    sessions: 2,
    slug: "gjc",
  },
  {
    agent: "Prime Agent",
    corruptFile: [".prime", "agent", "sessions", "bad.jsonl"],
    // p1 holds its child's 50/20; the child's own file counts it, so p1 keeps 100/50.
    expected: [
      ["claude-opus-5", 110, 55, 20, 10],
      ["gpt-5.4", 50, 20, 0, 0],
    ],
    firstAt: Date.parse("2026-03-06T00:00:01.000Z"),
    fixture: "prime",
    override: { folder: [".prime", "agent"], variable: "PRIME_AGENT_CODING_AGENT_DIR" },
    reader: readPrimeAgent,
    sessions: 2,
    slug: "prime",
  },
  {
    agent: "Jcode",
    corruptFile: [".jcode", "sessions", "session_bad.json"],
    // The journal corrects m2 to 100/20 and adds m3 (OpenAI style: 500 input holds 200 cached).
    expected: [
      ["claude-sonnet-4", 1300, 320, 800, 50],
      ["gpt-5", 300, 40, 200, 0],
    ],
    firstAt: Date.parse("2026-03-07T12:00:01.000Z"),
    fixture: "jcode",
    override: { folder: [".jcode"], variable: "JCODE_HOME" },
    reader: readJcode,
    sessions: 1,
    slug: "jcode",
  },
  {
    agent: "Reasonix",
    corruptFile: [".reasonix", "stats", "2026-01-01.jsonl"],
    expected: [
      ["deepseek/deepseek-chat", 80, 22, 30, 0],
      ["deepseek/deepseek-reasoner", 30, 8, 10, 0],
    ],
    firstAt: Date.parse("2026-03-08T09:10:11.000Z"),
    fixture: "reasonix",
    override: { folder: [".reasonix"], variable: "REASONIX_HOME" },
    reader: readReasonix,
    sessions: 2,
    slug: "reasonix",
  },
  {
    agent: "LingTai TUI",
    corruptFile: [".lingtai", "bad-agent", "logs", "token_ledger.jsonl"],
    expected: [
      ["deepseek-v4", 600, 150, 400, 0],
      ["gpt-5-mini", 200, 20, 0, 0],
    ],
    firstAt: Date.parse("2026-03-10T10:00:00.000Z"),
    fixture: "lingtai",
    override: { folder: [".lingtai"], variable: "LINGTAI_HOME" },
    reader: readLingTai,
    sessions: 2,
    slug: "lingtai",
  },
  {
    agent: "zerostack",
    corruptFile: [".local", "share", "zerostack", "sessions", "bad.json"],
    expected: [
      ["deepseek/deepseek-v4-pro", 4000, 500, 0, 0],
      ["gpt-5", 100, 10, 0, 0],
    ],
    firstAt: Date.parse("2026-03-11T09:00:00.000Z"),
    fixture: "zerostack",
    reader: readZerostack,
    sessions: 2,
    slug: "zerostack",
  },
  {
    agent: "OpenClaw",
    corruptFile: [".openclaw", "agents", "main", "sessions", "bad.jsonl"],
    // The reset archive repeats sess-1, which counts once; ev2 takes the model_change model.
    expected: [
      ["claude-opus-5", 120, 55, 200, 10],
      ["claude-sonnet-4-5", 30, 3, 0, 0],
    ],
    firstAt: 1_773_396_001_000,
    fixture: "openclaw",
    reader: readOpenClaw,
    sessions: 2,
    slug: "openclaw",
  },
];

const fixtureHome = (fixture: string): string =>
  fileURLToPath(new URL(`fixtures/pi-family/${fixture}`, import.meta.url));

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
  assert.strictEqual(result._tag, "Read", result._tag === "Skipped" ? result.detail : "");
  return result._tag === "Read" ? result.records : [];
};

const sessionCount = (records: readonly UsageRecord[]): number =>
  new Set(records.map((record) => record.session)).size;

const platform = (env: Readonly<Record<string, string>>) =>
  Layer.mergeAll(NodeServices.layer, ConfigProvider.layer(ConfigProvider.fromEnv({ env })));

/** Runs the reader on a fresh temp home, after `prepare` has filled it and named the env. */
const readTempHome = (
  reader: Reader,
  prepare: (
    home: string,
    fs: FileSystem.FileSystem,
    path: Path.Path,
  ) => Effect.Effect<Readonly<Record<string, string>>, PlatformError>,
) =>
  Effect.scoped(
    Effect.gen(function* tempHomeRun() {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* fs.makeTempDirectoryScoped({ prefix: "tokenshame-pi-family-" });
      const env = yield* prepare(home, fs, path);
      return yield* reader(home).pipe(Effect.provide(platform(env)));
    }),
  ).pipe(Effect.provide(NodeServices.layer));

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
    return {};
  });

describe.each(cases)("$agent reader", (c) => {
  it.effect("returns the known per-model totals of its fixture", () =>
    Effect.gen(function* fixtureTotals() {
      const records = usageOf(yield* c.reader(fixtureHome(c.fixture)));
      assert.deepStrictEqual(totalsByModel(records), c.expected);
      assert.strictEqual(sessionCount(records), c.sessions);
      for (const record of records) {
        assert.isTrue(record.session.startsWith(`${c.slug}:`), record.session);
        assert.isTrue(Number.isSafeInteger(record.at) && record.at > 0);
      }
      assert.strictEqual(Math.min(...records.map((record) => record.at)), c.firstAt);
    }).pipe(Effect.provide(platform({}))),
  );

  it.effect("skips a missing folder as no-data", () =>
    Effect.gen(function* missingFolder() {
      const result = yield* readTempHome(c.reader, () => Effect.succeed({}));
      assert.strictEqual(result._tag, "Skipped");
      assert.strictEqual(result._tag === "Skipped" ? result.agent : "", c.agent);
      assert.strictEqual(result._tag === "Skipped" ? result.reason : "", "no-data");
    }),
  );

  it.effect("skips a corrupt file without throwing and keeps the rest", () =>
    Effect.gen(function* corruptSibling() {
      const result = yield* readTempHome(c.reader, (home, fs, path) =>
        Effect.gen(function* copyThenCorrupt() {
          yield* fs.copy(fixtureHome(c.fixture), home, { overwrite: true });
          return yield* writeFile(home, c.corruptFile, "{not json\n", fs, path);
        }),
      );
      assert.deepStrictEqual(totalsByModel(usageOf(result)), c.expected);
    }),
  );

  it.effect("reports a folder with only corrupt files as unreadable", () =>
    Effect.gen(function* onlyCorrupt() {
      const result = yield* readTempHome(c.reader, (home, fs, path) =>
        writeFile(home, c.corruptFile, "{not json\n", fs, path),
      );
      assert.strictEqual(result._tag, "Skipped");
      assert.strictEqual(result._tag === "Skipped" ? result.reason : "", "unreadable");
    }),
  );

  const { override } = c;
  if (override !== undefined) {
    it.effect(`reads the folder ${override.variable} names`, () =>
      Effect.gen(function* movedFolder() {
        const result = yield* readTempHome(c.reader, (home, fs, path) =>
          Effect.gen(function* copyThenMove() {
            yield* fs.copy(fixtureHome(c.fixture), home, { overwrite: true });
            const moved = path.join(home, "moved");
            yield* fs.rename(path.join(home, ...override.folder), moved);
            return { [override.variable]: moved };
          }),
        );
        assert.deepStrictEqual(totalsByModel(usageOf(result)), c.expected);
      }),
    );
  }
});

// --- OpenClaw's per-agent SQLite store ----------------------------------------------------

/** An assistant event; `model` is a JSON fragment such as `"model":"x",`, or empty. */
const assistantEvent = (id: string, model: string, usage: string, at: number): string =>
  `{"type":"message","id":"${id}","timestamp":"${new Date(at).toISOString()}","message":{"role":"assistant",${model}"usage":${usage},"timestamp":${at}}}`;

/** The fixture's ev1, as OpenClaw's doctor imports it from the JSONL file. */
const importedEvent = assistantEvent(
  "ev1",
  '"model":"claude-opus-5",',
  '{"input":100,"output":50,"cacheRead":200,"cacheWrite":10}',
  1_773_396_001_000,
);

const buildStore = (file: string) => {
  const db = new DatabaseSync(file);
  try {
    db.exec(`
      CREATE TABLE session_windows (session_id TEXT PRIMARY KEY, session_key TEXT NOT NULL,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, model_provider TEXT, model TEXT);
      CREATE TABLE transcript_events (session_id TEXT NOT NULL, seq INTEGER NOT NULL,
        event_json TEXT, event_zstd BLOB, event_utf8_bytes INTEGER, created_at INTEGER NOT NULL,
        PRIMARY KEY (session_id, seq));
      CREATE TABLE session_transcript_archives (session_id TEXT NOT NULL, generation TEXT NOT NULL,
        encoding TEXT NOT NULL, archive_blob BLOB NOT NULL, archive_sha256 TEXT NOT NULL,
        created_at INTEGER NOT NULL, PRIMARY KEY (session_id, generation));
      INSERT INTO session_windows VALUES ('sess-2', 'agent:main:sess-2', 1, 1, 'openai', 'gpt-5');`);
    const insertEvent = db.prepare(
      "INSERT INTO transcript_events (session_id, seq, event_json, event_zstd, created_at) VALUES (?, ?, ?, ?, ?)",
    );
    insertEvent.run("sess-1", 1, importedEvent, null, 1_773_396_001_000);
    const compressed = assistantEvent("ev3", "", '{"input":11,"output":2}', 1_773_400_000_000);
    insertEvent.run(
      "sess-2",
      1,
      null,
      zstdCompressSync(Buffer.from(compressed)),
      1_773_400_000_000,
    );
    const archived = assistantEvent(
      "ev9",
      '"model":"claude-haiku-4-5",',
      '{"input":9,"output":1}',
      1_773_300_000_000,
    );
    db.prepare(
      "INSERT INTO session_transcript_archives VALUES ('sess-old', 'g1', 'identity', ?, 'x', 1773300000000)",
    ).run(Buffer.from(`${archived}\n`));
  } finally {
    db.close();
  }
};

describe("OpenClaw SQLite store", () => {
  it.effect("reads events and archives, and counts an imported event once", () =>
    Effect.gen(function* storeAndFiles() {
      const result = yield* readTempHome(readOpenClaw, (home, fs, path) =>
        Effect.gen(function* buildHome() {
          yield* fs.copy(fixtureHome("openclaw"), home, { overwrite: true });
          const folder = path.join(home, ".openclaw", "agents", "main", "agent");
          yield* fs.makeDirectory(folder, { recursive: true });
          buildStore(path.join(folder, "openclaw-agent.sqlite"));
          return {};
        }),
      );
      const records = usageOf(result);
      assert.deepStrictEqual(totalsByModel(records), [
        ["claude-haiku-4-5", 9, 1, 0, 0],
        ["claude-opus-5", 120, 55, 200, 10],
        ["claude-sonnet-4-5", 30, 3, 0, 0],
        ["gpt-5", 11, 2, 0, 0],
      ]);
      assert.strictEqual(sessionCount(records), 4);
    }),
  );

  it.effect("reports a store that is not a database as unreadable", () =>
    Effect.gen(function* garbageStore() {
      const result = yield* readTempHome(readOpenClaw, (home, fs, path) =>
        writeFile(
          home,
          [".openclaw", "agents", "main", "agent", "openclaw-agent.sqlite"],
          "this is not a database, it is only text. ".repeat(100),
          fs,
          path,
        ),
      );
      assert.strictEqual(result._tag, "Skipped");
      assert.strictEqual(result._tag === "Skipped" ? result.reason : "", "unreadable");
    }),
  );
});
