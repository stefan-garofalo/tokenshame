import { fileURLToPath } from "node:url";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { readClaude } from "./claude";
import type { ReadResult, SkippedSource, UsageRecord } from "./types";

const read = (name: string): Effect.Effect<ReadResult> =>
  readClaude(fileURLToPath(new URL(`fixtures/claude/${name}`, import.meta.url))).pipe(
    Effect.provide(NodeServices.layer),
  );

/** The records of a `Read` result; fails the test on `Skipped`. */
const readRecords = (name: string): Effect.Effect<readonly UsageRecord[]> =>
  Effect.map(read(name), (result) =>
    result._tag === "Read"
      ? result.records
      : assert.fail(`expected Read, got Skipped (${result.reason}: ${result.detail})`),
  );

const readSkipped = (name: string): Effect.Effect<SkippedSource> =>
  Effect.map(read(name), (result) =>
    result._tag === "Skipped" ? result : assert.fail("expected Skipped, got Read"),
  );

/** Summed counts per model, sorted by model id: `[model, input, output, cacheRead, cacheWrite]`. */
const totalsByModel = (records: readonly UsageRecord[]): (string | number)[][] => {
  const totals = new Map<string, number[]>();
  for (const { model, input, output, cacheRead, cacheWrite } of records) {
    const [i = 0, o = 0, r = 0, w = 0] = totals.get(model) ?? [];
    totals.set(model, [i + input, o + output, r + cacheRead, w + cacheWrite]);
  }
  return [...totals.entries()]
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([model, counts]) => [model, ...counts]);
};

const sessionsOf = (records: readonly UsageRecord[]): string[] => [
  ...new Set(records.map(({ session }) => session)),
];

// The cache cutoff is a local day, and the fixture log lines sit at 12:00Z, so
// these tests hold in time zones from UTC-11 to UTC+11.
describe(readClaude, () => {
  it.effect("counts a message once when its id and requestId repeat", () =>
    Effect.map(readRecords("duplicates"), (records) => {
      // m-1/req-1 repeats three times in one file and once in another.
      // m-2 under req-2 and req-3 are two different requests.
      assert.deepStrictEqual(totalsByModel(records), [
        ["claude-sonnet-4-5-20250929", 600, 60, 6000, 180],
      ]);
    }),
  );

  it.effect("reads the logs alone when stats-cache.json is missing", () =>
    Effect.map(readRecords("duplicates"), (records) => {
      assert.strictEqual(records.length, 3);
      assert.deepStrictEqual(sessionsOf(records).toSorted(), ["claude:s-a", "claude:s-b"]);
    }),
  );

  it.effect("adds only the log usage after lastComputedDate to the cache totals", () =>
    Effect.map(readRecords("merged"), (records) => {
      // Cache totals plus the two lines of 2026-01-11. The 2026-01-09 and
      // 2026-01-10 lines (the boundary day) are already inside the cache.
      assert.deepStrictEqual(totalsByModel(records), [
        ["claude-haiku-4-5-20251001", 1, 2, 3, 4],
        ["claude-opus-4-1-20250805", 100, 200, 300, 400],
        ["claude-sonnet-4-5-20250929", 1010, 2020, 30_030, 4040],
      ]);
    }),
  );

  it.effect("keeps sessions, first day, and busiest hour sensible for the cache", () =>
    Effect.map(readRecords("merged"), (records) => {
      // 4 cached sessions (dailyActivity) plus the one session after the cache.
      assert.strictEqual(sessionsOf(records).length, 5);
      assert.isTrue(records.every(({ session }) => session.startsWith("claude:")));

      const first = Math.min(...records.map(({ at }) => at));
      assert.strictEqual(new Date(first).toLocaleDateString("en-CA"), "2026-01-05");

      const tokensByHour = new Map<number, number>();
      for (const { at, input, output, cacheRead, cacheWrite } of records) {
        const hour = new Date(at).getHours();
        tokensByHour.set(
          hour,
          (tokensByHour.get(hour) ?? 0) + input + output + cacheRead + cacheWrite,
        );
      }
      const [busiest] = [...tokensByHour.entries()].toSorted(([, a], [, b]) => b - a)[0] ?? [];
      assert.strictEqual(busiest, 9);
    }),
  );

  it.effect("skips corrupt lines, files, and the cache but keeps the valid usage", () =>
    Effect.map(readRecords("corrupt"), (records) => {
      assert.deepStrictEqual(totalsByModel(records), [["claude-sonnet-4-5-20250929", 7, 8, 9, 10]]);
    }),
  );

  it.effect("returns Skipped unreadable when only a corrupt cache exists", () =>
    Effect.map(readSkipped("unreadable"), (skipped) => {
      assert.strictEqual(skipped.agent, "Claude Code");
      assert.strictEqual(skipped.reason, "unreadable");
      assert.isTrue(skipped.detail.length > 0);
    }),
  );

  it.effect("returns Skipped no-data when nothing exists", () =>
    Effect.map(readSkipped("absent"), (skipped) => {
      assert.strictEqual(skipped.reason, "no-data");
      assert.strictEqual(skipped.detail, "");
      assert.isTrue(skipped.path.endsWith(".claude"));
    }),
  );

  it.effect("returns Skipped no-data when the logs hold no usage lines", () =>
    Effect.map(readSkipped("no-usage"), (skipped) => {
      assert.strictEqual(skipped.reason, "no-data");
    }),
  );

  it.effect("passes model ids through unchanged", () =>
    Effect.map(readRecords("merged"), (records) => {
      assert.deepStrictEqual([...new Set(records.map(({ model }) => model))].toSorted(), [
        "claude-haiku-4-5-20251001",
        "claude-opus-4-1-20250805",
        "claude-sonnet-4-5-20250929",
      ]);
    }),
  );
});
