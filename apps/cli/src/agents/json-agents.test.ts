import { fileURLToPath } from "node:url";

import { assert, describe, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import type { PlatformError } from "effect/PlatformError";
import * as Path from "effect/Path";

import { readAmp } from "./amp";
import { readDroid } from "./droid";
import { readGemini } from "./gemini";
import { readGrok } from "./grok";
import { readKimi } from "./kimi";
import { readPi } from "./pi";
import { readQwen } from "./qwen";
import type { ReadResult, Reader, UsageRecord } from "./types";

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
  /** Where a corrupt file would live, under the home folder. */
  readonly corruptFile: readonly string[];
  readonly expected: readonly ModelTotals[];
  readonly sessions: number;
  /** Earliest `at` the fixture's own timestamps give; absent when the source only has file times. */
  readonly firstAt: number | undefined;
}

const cases: readonly Case[] = [
  {
    agent: "Pi",
    corruptFile: [".pi", "agent", "sessions", "--bad--", "bad.jsonl"],
    expected: [
      ["claude-sonnet-4-5", 111, 57, 13, 9],
      ["gpt-5", 200, 20, 0, 0],
    ],
    firstAt: Date.parse("2026-01-01T00:00:02.000Z"),
    fixture: "pi",
    reader: readPi,
    sessions: 2,
  },
  {
    agent: "Gemini CLI",
    corruptFile: [".gemini", "tmp", "abc123", "chats", "bad.json"],
    expected: [
      ["gemini-2.5-flash", 500, 30, 0, 0],
      ["gemini-2.5-pro", 635, 160, 405, 0],
    ],
    firstAt: Date.parse("2026-01-01T00:00:02.000Z"),
    fixture: "gemini",
    reader: readGemini,
    sessions: 2,
  },
  {
    agent: "Grok",
    corruptFile: [".grok", "sessions", "-bad", "bad", "updates.jsonl"],
    expected: [
      ["grok-4.5", 600, 100, 400, 0],
      ["grok-4.5-build", 150, 20, 50, 0],
      ["grok-code-fast-1", 100, 10, 0, 0],
    ],
    firstAt: 1_767_225_603_000,
    fixture: "grok",
    reader: readGrok,
    sessions: 1,
  },
  {
    agent: "Qwen",
    corruptFile: [".qwen", "projects", "-bad", "chats", "bad.jsonl"],
    expected: [["qwen3-coder-plus", 900, 190, 300, 0]],
    firstAt: Date.parse("2026-01-01T00:00:02.000Z"),
    fixture: "qwen",
    reader: readQwen,
    sessions: 1,
  },
  {
    agent: "Amp",
    corruptFile: [".local", "share", "amp", "threads", "T-bad.json"],
    expected: [
      ["claude-opus-4-5", 10, 5, 0, 0],
      ["claude-sonnet-4-5", 107, 43, 300, 20],
    ],
    firstAt: 1_767_225_600_000,
    fixture: "amp",
    reader: readAmp,
    sessions: 2,
  },
  {
    agent: "Droid",
    corruptFile: [".factory", "sessions", "-bad", "bad.settings.json"],
    expected: [
      ["claude-sonnet-4-5", 1000, 230, 4000, 50],
      ["gpt-5", 10, 5, 0, 0],
    ],
    firstAt: undefined,
    fixture: "droid",
    reader: readDroid,
    sessions: 2,
  },
  {
    agent: "Kimi",
    corruptFile: [".kimi", "sessions", "grp", "bad", "wire.jsonl"],
    expected: [["kimi-for-coding", 170, 50, 405, 7]],
    firstAt: 1_767_225_603_000,
    fixture: "kimi",
    reader: readKimi,
    sessions: 1,
  },
];

const fixtureHome = (fixture: string): string =>
  fileURLToPath(new URL(`fixtures/json-agents/${fixture}`, import.meta.url));

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

/** Runs the reader on a fresh temp home, after `prepare` has filled it. */
const readTempHome = (
  reader: Reader,
  prepare: (
    home: string,
    fs: FileSystem.FileSystem,
    path: Path.Path,
  ) => Effect.Effect<void, PlatformError>,
) =>
  Effect.scoped(
    Effect.gen(function* tempHomeRun() {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* fs.makeTempDirectoryScoped({ prefix: "tokenshame-json-agents-" });
      yield* prepare(home, fs, path);
      return yield* reader(home);
    }),
  ).pipe(Effect.provide(NodeServices.layer));

const writeCorruptFile = (
  home: string,
  segments: readonly string[],
  fs: FileSystem.FileSystem,
  path: Path.Path,
) =>
  Effect.gen(function* corruptFileWrite() {
    const file = path.join(home, ...segments);
    yield* fs.makeDirectory(path.dirname(file), { recursive: true });
    yield* fs.writeFileString(file, "{not json\n");
  });

describe.each(cases)("$agent reader", (c) => {
  it.effect("returns the known per-model totals of its fixture", () =>
    Effect.gen(function* fixtureTotals() {
      const result = yield* c
        .reader(fixtureHome(c.fixture))
        .pipe(Effect.provide(NodeServices.layer));
      const records = usageOf(result);
      assert.deepStrictEqual(totalsByModel(records), c.expected);
      assert.strictEqual(new Set(records.map((record) => record.session)).size, c.sessions);
      for (const record of records) {
        assert.isTrue(record.session.startsWith(`${c.fixture}:`));
        assert.isTrue(Number.isSafeInteger(record.at) && record.at > 0);
      }
      const first = Math.min(...records.map((record) => record.at));
      if (c.firstAt === undefined) {
        assert.isTrue(first > 0);
      } else {
        assert.strictEqual(first, c.firstAt);
      }
    }),
  );

  it.effect("skips a missing folder as no-data", () =>
    Effect.gen(function* missingFolder() {
      const result = yield* readTempHome(c.reader, () => Effect.void);
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
          yield* writeCorruptFile(home, c.corruptFile, fs, path);
        }),
      );
      assert.deepStrictEqual(totalsByModel(usageOf(result)), c.expected);
    }),
  );

  it.effect("reports a folder with only corrupt files as unreadable", () =>
    Effect.gen(function* onlyCorrupt() {
      const result = yield* readTempHome(c.reader, (home, fs, path) =>
        writeCorruptFile(home, c.corruptFile, fs, path),
      );
      assert.strictEqual(result._tag, "Skipped");
      assert.strictEqual(result._tag === "Skipped" ? result.reason : "", "unreadable");
    }),
  );
});
