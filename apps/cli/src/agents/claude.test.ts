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

  it.effect("counts a message once when its lines have no requestId, and keeps the last line", () =>
    Effect.map(readRecords("no-request-id"), (records) => {
      // Claude Code writes one line per content block of a message, with no requestId.
      // The output count grows while the message streams, so the last line is the final one.
      assert.deepStrictEqual(totalsByModel(records), [
        ["claude-sonnet-4-5-20250929", 5, 403, 3000, 110],
      ]);
    }),
  );

  it.effect("counts every session of the logs", () =>
    Effect.map(readRecords("duplicates"), (records) => {
      assert.strictEqual(records.length, 3);
      assert.deepStrictEqual(sessionsOf(records).toSorted(), ["claude:s-a", "claude:s-b"]);
    }),
  );

  it.effect("skips corrupt lines and files but keeps the valid usage", () =>
    Effect.map(readRecords("corrupt"), (records) => {
      assert.deepStrictEqual(totalsByModel(records), [["claude-sonnet-4-5-20250929", 7, 8, 9, 10]]);
    }),
  );

  it.effect("returns Skipped unreadable when every log file fails to read", () =>
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
    Effect.map(readRecords("models"), (records) => {
      assert.deepStrictEqual([...new Set(records.map(({ model }) => model))].toSorted(), [
        "claude-haiku-4-5-20251001",
        "claude-sonnet-4-5-20250929",
      ]);
    }),
  );
});
