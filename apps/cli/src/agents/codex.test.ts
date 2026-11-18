import { fileURLToPath } from "node:url";

import * as NodePath from "@effect/platform-node/NodePath";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as PlatformError from "effect/PlatformError";

import { readCodex } from "./codex";
import type { ReadResult } from "./types";

// Each fixture folder is a fake home with a `.codex/sessions` tree of synthetic sessions.
const fixtureHome = (name: string): string =>
  fileURLToPath(new URL(`fixtures/codex/${name}`, import.meta.url));

const read = (name: string) =>
  readCodex(fixtureHome(name)).pipe(Effect.provide(NodeServices.layer));

const sessionOne = "codex:2026-01-02T03-04-05-00000000-0000-4000-8000-000000000001";
const sessionTwo = "codex:2026-01-03T10-00-00-00000000-0000-4000-8000-000000000002";
const jan2 = Date.parse("2026-01-02T03:04:05.000Z");
const jan3 = Date.parse("2026-01-03T10:00:00.000Z");

const records = (result: ReadResult) => {
  assert.strictEqual(result._tag, "Read");
  return result._tag === "Read" ? result.records : [];
};

describe(readCodex, () => {
  it.effect("counts only the last non-null cumulative total of a session file", () =>
    Effect.map(read("last-total"), (result) => {
      assert.deepStrictEqual(records(result), [
        {
          at: jan2,
          cacheRead: 200,
          cacheWrite: 0,
          // 600 input minus 200 cached; the earlier totals (100, 300) are not added.
          input: 400,
          model: "gpt-synthetic-1",
          output: 50,
          session: sessionOne,
        },
      ]);
    }),
  );

  it.effect("sums two session files", () =>
    Effect.map(read("two-files"), (result) => {
      assert.deepStrictEqual(records(result), [
        {
          at: jan2,
          cacheRead: 80,
          cacheWrite: 0,
          input: 120,
          model: "gpt-synthetic-1",
          output: 20,
          session: sessionOne,
        },
        {
          at: jan3,
          cacheRead: 500,
          cacheWrite: 0,
          input: 500,
          model: "gpt-synthetic-2",
          output: 70,
          session: sessionTwo,
        },
      ]);
    }),
  );

  it.effect("skips corrupt and malformed lines without failing", () =>
    Effect.map(read("corrupt-line"), (result) => {
      assert.deepStrictEqual(records(result), [
        {
          at: jan2,
          cacheRead: 40,
          cacheWrite: 0,
          input: 60,
          model: "gpt-synthetic-1",
          output: 10,
          session: sessionOne,
        },
      ]);
    }),
  );

  it.effect("splits cache write out of the input count", () =>
    Effect.map(read("cache-write"), (result) => {
      assert.deepStrictEqual(records(result), [
        {
          at: jan2,
          cacheRead: 200,
          cacheWrite: 100,
          input: 300,
          model: "gpt-synthetic-1",
          output: 50,
          session: sessionOne,
        },
      ]);
    }),
  );

  it.effect("records a session under the model Codex logged last", () =>
    Effect.map(read("model-switch"), (result) => {
      assert.deepStrictEqual(
        records(result).map(({ model }) => model),
        ["gpt-synthetic-2"],
      );
    }),
  );

  it.effect("records a session with no logged model under the unknown id", () =>
    Effect.map(read("no-model"), (result) => {
      assert.deepStrictEqual(
        records(result).map(({ model }) => model),
        ["unknown"],
      );
    }),
  );

  it.effect("skips as no-data when the sessions folder is missing", () =>
    Effect.map(read("missing"), (result) => {
      assert.deepStrictEqual(result, {
        _tag: "Skipped",
        agent: "Codex",
        detail: "",
        path: `${fixtureHome("missing")}/.codex/sessions`,
        reason: "no-data",
      });
    }),
  );

  it.effect("skips as no-data when no session has a token total", () =>
    Effect.map(read("no-usage"), (result) => {
      assert.strictEqual(result._tag, "Skipped");
      assert.strictEqual(result._tag === "Skipped" ? result.reason : "", "no-data");
    }),
  );

  it.effect("skips as unreadable when the sessions folder cannot be listed", () => {
    const denied = FileSystem.layerNoop({
      readDirectory: () =>
        Effect.fail(
          PlatformError.systemError({
            _tag: "PermissionDenied",
            description: "denied",
            method: "readDirectory",
            module: "FileSystem",
          }),
        ),
    });
    return Effect.map(
      readCodex("/home/synthetic").pipe(Effect.provide(Layer.merge(denied, NodePath.layer))),
      (result) => {
        assert.strictEqual(result._tag, "Skipped");
        assert.strictEqual(result._tag === "Skipped" ? result.reason : "", "unreadable");
      },
    );
  });
});
