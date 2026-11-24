import { fileURLToPath } from "node:url";
import * as zlib from "node:zlib";

import { assert, describe, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import type { PlatformError } from "effect/PlatformError";
import * as Path from "effect/Path";
import * as Predicate from "effect/Predicate";

import { readAside } from "./aside";
import { readAugment } from "./augment";
import { readCodebuff } from "./codebuff";
import { readDsh } from "./dsh";
import { readFx } from "./fx";
import { readJunie } from "./junie";
import { readKimiCode } from "./kimi";
import { readMux } from "./mux";
import { readProma } from "./proma";
import type { ReadResult, Reader, UsageRecord } from "./types";
import { readVibe } from "./vibe";

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
  /** Folder below `fixtures/json-tools`, used as the home folder. */
  readonly fixture: string;
  /** Every session key starts with `<slug>:`. */
  readonly slug: string;
  /** Where a corrupt file would live, under the home folder. */
  readonly corruptFile: readonly string[];
  readonly expected: readonly ModelTotals[];
  readonly sessions: number;
  /** Earliest `at` the fixture's own times give; absent when the source only has file times. */
  readonly firstAt: number | undefined;
  /** The folder variable the agent honours, and the fixture folder it is set to. */
  readonly override?: { readonly name: string; readonly folder: readonly string[] };
}

const cases: readonly Case[] = [
  {
    agent: "Aside",
    corruptFile: [".aside", "u", "bad", "sessions", "s", "messages.jsonl"],
    // A repeated response id counts once; `artifacts/` is not read.
    expected: [
      ["claude-sonnet-4", 100, 40, 30, 5],
      ["gpt-5", 10, 1, 0, 0],
    ],
    firstAt: Date.parse("2026-01-01T00:00:02.000Z"),
    fixture: "aside",
    reader: readAside,
    sessions: 1,
    slug: "aside",
  },
  {
    agent: "Augment Code",
    corruptFile: [".augment", "sessions", "bad.json"],
    // Last usage node per turn; a repeated request id and an unfinished turn are skipped.
    expected: [
      ["claude-sonnet-4-5", 400, 100, 800, 25],
      ["grok-4-5", 1000, 50, 200, 0],
    ],
    firstAt: Date.parse("2026-01-01T00:01:00.000Z"),
    fixture: "augment",
    reader: readAugment,
    sessions: 1,
    slug: "augment",
  },
  {
    agent: "Codebuff",
    corruptFile: [".config", "manicode", "projects", "bad", "chats", "c", "chat-messages.json"],
    // A repeated message id counts once; OpenAI-style cached tokens leave the prompt count.
    expected: [
      ["claude-sonnet-4-5", 100, 20, 300, 10],
      ["gpt-5", 310, 55, 200, 0],
    ],
    firstAt: Date.parse("2026-01-01T00:00:00.000Z"),
    fixture: "codebuff",
    override: { folder: [".config", "manicode"], name: "CODEBUFF_DATA_DIR" },
    reader: readCodebuff,
    sessions: 2,
    slug: "codebuff",
  },
  {
    agent: "DeepSeek Harness",
    corruptFile: [".dsh", "sessions", "-bad", "bad", "session.jsonl"],
    // Slot samples replace, a retry adds, a fork's seed and an older generation are skipped.
    expected: [
      ["deepseek-v4", 171, 79, 400, 0],
      ["deepseek-v4-flash-0601", 500, 40, 0, 0],
    ],
    firstAt: 1_767_225_603_000,
    fixture: "dsh",
    override: { folder: [".dsh"], name: "DSH_HOME" },
    reader: readDsh,
    sessions: 3,
    slug: "dsh",
  },
  {
    agent: "fx",
    corruptFile: [".fx", "sessions", "bad", "usage-v2.json"],
    expected: [
      ["anthropic/claude-sonnet-4-5", 20, 2, 0, 1],
      ["unknown", 7, 3, 0, 0],
      ["zai/glm-5.2", 100, 10, 50, 0],
    ],
    firstAt: undefined,
    fixture: "fx",
    reader: readFx,
    sessions: 2,
    slug: "fx",
  },
  {
    agent: "Junie",
    corruptFile: [".junie", "sessions", "bad", "events.jsonl"],
    // A replayed event counts once.
    expected: [
      ["claude-sonnet-4-5", 200, 20, 100, 10],
      ["gpt-5", 20, 2, 0, 0],
    ],
    firstAt: 1_767_225_602_000,
    fixture: "junie",
    reader: readJunie,
    sessions: 1,
    slug: "junie",
  },
  {
    agent: "Kimi Code",
    corruptFile: [".kimi-code", "sessions", "wd_bad", "bad", "agents", "main", "wire.jsonl"],
    // Turn records only, each agent from its own wire, plus the desktop app's runtime.
    expected: [
      ["kimi-k2-turbo", 10, 2, 0, 0],
      ["kimi-k2.6", 100, 20, 300, 5],
      ["unknown", 1, 1, 0, 0],
    ],
    firstAt: 1_767_225_602_000,
    fixture: "kimi-code",
    override: { folder: [".kimi-code"], name: "KIMI_CODE_HOME" },
    reader: readKimiCode,
    sessions: 2,
    slug: "kimi-code",
  },
  {
    agent: "Mux",
    corruptFile: [".mux", "sessions", "bad", "chat.jsonl"],
    // Cache leaves `inputTokens`; `session-usage.json` totals are not counted again.
    expected: [
      ["anthropic:claude-opus-4-6", 300, 100, 600, 100],
      ["openai:gpt-5", 150, 20, 50, 0],
    ],
    firstAt: 1_767_225_601_000,
    fixture: "mux",
    override: { folder: [".mux"], name: "MUX_ROOT" },
    reader: readMux,
    sessions: 2,
    slug: "mux",
  },
  {
    agent: "Proma",
    corruptFile: [".proma", "sdk-config", "projects", "-bad", "bad.jsonl"],
    // Last snapshot per response id, a fork's copy once, display copies of native calls skipped.
    expected: [
      ["claude-sonnet-4-5", 18, 56, 100, 20],
      ["deepseek-v4", 103, 23, 30, 4],
    ],
    firstAt: Date.parse("2026-01-01T00:00:02.000Z"),
    fixture: "proma",
    reader: readProma,
    sessions: 5,
    slug: "proma",
  },
  {
    agent: "Mistral Vibe",
    corruptFile: [".vibe", "logs", "session", "bad", "meta.json"],
    // Cached tokens leave the prompt count; a unified session replaces its older totals.
    expected: [
      ["devstral-medium", 600, 100, 400, 0],
      ["mistral-medium-3.5", 150, 30, 150, 0],
      ["unknown", 250, 25, 0, 0],
    ],
    firstAt: Date.parse("2025-12-31T00:00:00.000Z"),
    fixture: "vibe",
    override: { folder: [".vibe"], name: "VIBE_HOME" },
    reader: readVibe,
    sessions: 4,
    slug: "vibe",
  },
];

/** The real file system and the given environment, so no real folder override leaks in. */
const layerWith = (env: Readonly<Record<string, string>>) =>
  Layer.merge(NodeServices.layer, ConfigProvider.layer(ConfigProvider.fromEnv({ env })));

const layer = layerWith({});

const fixtureHome = (...parts: readonly string[]): string =>
  fileURLToPath(new URL(["fixtures/json-tools", ...parts].join("/"), import.meta.url));

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
      const home = yield* fs.makeTempDirectoryScoped({ prefix: "tokenshame-json-tools-" });
      yield* prepare(home, fs, path);
      return yield* reader(home);
    }),
  ).pipe(Effect.provide(layerWith(env)));

const writeFile = (
  home: string,
  segments: readonly string[],
  content: string | Uint8Array,
  fs: FileSystem.FileSystem,
  path: Path.Path,
) =>
  Effect.gen(function* fileWrite() {
    const file = path.join(home, ...segments);
    yield* fs.makeDirectory(path.dirname(file), { recursive: true });
    yield* Predicate.isString(content)
      ? fs.writeFileString(file, content)
      : fs.writeFile(file, content);
  });

describe.each(cases)("$agent reader", (c) => {
  it.effect("returns the known per-model totals of its fixture", () =>
    Effect.gen(function* fixtureTotals() {
      const result = yield* c.reader(fixtureHome(c.fixture)).pipe(Effect.provide(layer));
      const records = usageOf(result);
      assert.deepStrictEqual(totalsByModel(records), c.expected);
      assert.strictEqual(new Set(records.map((record) => record.session)).size, c.sessions);
      for (const record of records) {
        assert.isTrue(record.session.startsWith(`${c.slug}:`));
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
      assertSkipped(result, c.agent, "no-data");
    }),
  );

  it.effect("skips a corrupt file without throwing and keeps the rest", () =>
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

  it.effect("reports a folder with only corrupt files as unreadable", () =>
    Effect.gen(function* onlyCorrupt() {
      const result = yield* readTempHome(c.reader, (home, fs, path) =>
        writeFile(home, c.corruptFile, "{not json\n", fs, path),
      );
      assertSkipped(result, c.agent, "unreadable");
    }),
  );

  const { override } = c;
  if (override !== undefined) {
    it.effect(`reads the folder ${override.name} names instead of the default`, () =>
      Effect.gen(function* overriddenFolder() {
        const env = { [override.name]: fixtureHome(c.fixture, ...override.folder) };
        const result = yield* readTempHome(c.reader, () => Effect.void, env);
        assert.isAbove(usageOf(result).length, 0);
      }),
    );
  }
});

describe("DeepSeek Harness zstd transcripts", () => {
  const lines = [
    '{"seq":0,"type":"session","id":"z1"}\n',
    '{"seq":1,"type":"assistant/message","time":1767225602000,"data":{"message":{"source":{"model":"deepseek-v4"}},"usage":{"inputTokens":5,"outputTokens":6}}}\n',
  ];
  const transcript = [".dsh", "sessions", "-z", "z1", "session.jsonl.zstd"];

  it.effect("reads a transcript of concatenated zstd frames, or reports it unreadable", () =>
    Effect.gen(function* zstdTranscript() {
      const { zstdCompressSync } = zlib;
      if (!Predicate.isFunction(zstdCompressSync)) {
        const result = yield* readTempHome(readDsh, (home, fs, path) =>
          writeFile(home, transcript, new Uint8Array([0x28, 0xb5, 0x2f, 0xfd, 0]), fs, path),
        );
        assertSkipped(result, "DeepSeek Harness", "unreadable");
        return;
      }
      const frames = Buffer.concat(lines.map((line) => zstdCompressSync(line)));
      const result = yield* readTempHome(readDsh, (home, fs, path) =>
        writeFile(home, transcript, frames, fs, path),
      );
      assert.deepStrictEqual(totalsByModel(usageOf(result)), [["deepseek-v4", 5, 6, 0, 0]]);
    }),
  );

  it.effect("reports a broken zstd transcript as unreadable", () =>
    Effect.gen(function* brokenZstd() {
      const bytes = new Uint8Array([0x28, 0xb5, 0x2f, 0xfd, 0xff, 0xff, 0xff, 0xff]);
      const result = yield* readTempHome(readDsh, (home, fs, path) =>
        writeFile(home, transcript, bytes, fs, path),
      );
      assertSkipped(result, "DeepSeek Harness", "unreadable");
    }),
  );
});
