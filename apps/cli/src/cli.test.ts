import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterEach, assert, beforeEach, describe, it, vi } from "@effect/vitest";
import { decode, encode, shareUrl } from "@tokenshame/share-link/link";
import type { Summary } from "@tokenshame/share-link/summary";
import type * as Cause from "effect/Cause";
import * as Console from "effect/Console";
import * as Array from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Terminal from "effect/Terminal";

import { filterWarnings, run } from "./index";
import type { Open } from "./prompt";
import { OpenError } from "./prompt";
import { summarize } from "./summary";
import type { UsageRecord } from "./agents/types";

const fixtures = (name: string): string =>
  fileURLToPath(new URL(`agents/fixtures/${name}`, import.meta.url));

const origin = "https://tokenshame.vercel.app";

// --- fake network: every way the CLI could reach out throws ---------------------

const refuse = (): never => {
  throw new Error("the CLI must make no network request");
};

let networkSpies: readonly { readonly mock: { readonly calls: readonly unknown[] } }[] = [];

// --- fake home folders ----------------------------------------------------------

const homes: string[] = [];

const makeHome = (): string => {
  const home = mkdtempSync(path.join(tmpdir(), "tokenshame-home-"));
  homes.push(home);
  return home;
};

const claudeLine = (
  at: Date,
  session: string,
  id: string,
  model: string,
  input: number,
  output: number,
  cacheRead: number,
  cacheWrite: number,
): string =>
  JSON.stringify({
    message: {
      id,
      model,
      role: "assistant",
      usage: {
        cache_creation_input_tokens: cacheWrite,
        cache_read_input_tokens: cacheRead,
        input_tokens: input,
        output_tokens: output,
      },
    },
    requestId: `req-${id}`,
    sessionId: session,
    timestamp: at.toISOString(),
    type: "assistant",
  });

/** A home folder whose Claude Code logs hold these lines, written in local time. */
const claudeHome = (lines: readonly string[]): string => {
  const home = makeHome();
  const dir = path.join(home, ".claude", "projects", "app");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "log.jsonl"), `${lines.join("\n")}\n`);
  return home;
};

/** Local-time dates keep these tests true in every time zone. */
const local = (day: number, hour: number): Date => new Date(2026, 0, day, hour, 0);

/**
 * Model A: 300 input, 30 output, 3,000 cache read, 110 cache write in session s1 (14:00).
 * Model B: 5 of each in session s2 (09:00, a day earlier).
 */
const twoSessionHome = (): string =>
  claudeHome([
    claudeLine(local(5, 14), "s1", "m1", "model-a", 100, 10, 1000, 50),
    claudeLine(local(5, 14), "s1", "m2", "model-a", 200, 20, 2000, 60),
    claudeLine(local(4, 9), "s2", "m3", "model-b", 5, 5, 5, 5),
  ]);

const expectedSummary: Summary = {
  busiestHour: 14,
  firstDay: "2026-01-04",
  models: [
    { cacheRead: 3000, cacheWrite: 110, input: 300, model: "model-a", output: 30 },
    { cacheRead: 5, cacheWrite: 5, input: 5, model: "model-b", output: 5 },
  ],
  other: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
  sessions: 2,
  version: 1,
};

// --- the command entry under a fake terminal, opener, and console ---------------

const keypress = (name: string, ctrl = false): Terminal.UserInput => ({
  input: Option.none(),
  key: { ctrl, meta: false, name, shift: false },
});

const enter = keypress("return");
const ctrlC = keypress("c", true);

interface Outcome {
  readonly code: number;
  readonly errors: string;
  readonly logs: string;
  readonly opened: readonly string[];
  readonly prompts: number;
}

const execute = (
  dryRun: boolean,
  home: string,
  inputs: readonly Terminal.UserInput[],
  open?: Open,
): Effect.Effect<Outcome> =>
  Effect.gen(function* execution() {
    const logs: string[] = [];
    const errors: string[] = [];
    const opened: string[] = [];
    let prompts = 0;
    const console_: Console.Console = {
      ...console,
      error: (...args: readonly unknown[]): void => {
        errors.push(args.join(" "));
      },
      log: (...args: readonly unknown[]): void => {
        logs.push(args.join(" "));
      },
    };
    const terminal = Terminal.make({
      columns: Effect.succeed(80),
      display: () => Effect.void,
      readInput: Effect.gen(function* readInput() {
        prompts += 1;
        const queue = yield* Queue.make<Terminal.UserInput, Cause.Done>();
        yield* Queue.offerAll(queue, inputs);
        yield* Queue.end(queue);
        return queue;
      }),
      readLine: Effect.never,
      rows: Effect.succeed(24),
      size: Effect.never,
    });
    const stub: Open = (url) =>
      Effect.sync(() => {
        opened.push(url);
      });
    const code = yield* run(dryRun, home, open ?? stub).pipe(
      Effect.provideService(Terminal.Terminal, terminal),
      Effect.provideService(Console.Console, console_),
      Effect.provide(NodeServices.layer),
    );
    return { code, errors: errors.join("\n"), logs: logs.join("\n"), opened, prompts };
  });

const failingOpen: Open = () => Effect.fail(new OpenError({ reason: "xdg-open not found" }));

const linkOf = (summary: Summary): string => shareUrl(origin, encode(summary));

// --- AC-011, AC-013: the exact Usage Summary and link, no opener on a dry run -----

describe("tokenshame", () => {
  beforeEach(() => {
    networkSpies = [
      vi.spyOn(globalThis, "fetch").mockImplementation(refuse),
      vi.spyOn(http, "request").mockImplementation(refuse),
      vi.spyOn(http, "get").mockImplementation(refuse),
      vi.spyOn(https, "request").mockImplementation(refuse),
      vi.spyOn(https, "get").mockImplementation(refuse),
      vi.spyOn(net, "connect").mockImplementation(refuse),
      vi.spyOn(net, "createConnection").mockImplementation(refuse),
    ];
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const home of homes.splice(0)) {
      rmSync(home, { force: true, recursive: true });
    }
  });

  it.effect("prints the exact Usage Summary and Share Link and starts no opener", () =>
    Effect.gen(function* check() {
      const outcome = yield* execute(true, twoSessionHome(), [enter]);
      assert.strictEqual(outcome.code, 0);
      assert.deepStrictEqual(outcome.opened, []);
      assert.strictEqual(outcome.prompts, 0);
      assert.strictEqual(
        outcome.logs,
        [
          "Usage Summary (exactly what the Share Link carries)",
          "",
          "Tokens processed  3,460",
          "Sessions          2",
          "Busiest hour      14:00",
          "First day         2026-01-04",
          "Version           1",
          "",
          "Model    Input  Output  Cache read  Cache write",
          "model-a    300      30       3,000          110",
          "model-b      5       5           5            5",
          "other        0       0           0            0",
          "",
          `Share Link: ${linkOf(expectedSummary)}`,
          "",
          "Dry run: nothing was opened.",
        ].join("\n"),
      );
    }),
  );

  it.effect("prints a Share Link that decodes back to the printed summary (AC-011)", () =>
    Effect.gen(function* check() {
      const outcome = yield* execute(true, twoSessionHome(), []);
      const printed = /^Share Link: (?<url>\S+)$/mu.exec(outcome.logs)?.groups?.url ?? "";
      const link = printed.slice(`${origin}/r/`.length);
      assert.isTrue(printed.startsWith(`${origin}/r/`));
      assert.deepStrictEqual(yield* decode(link), expectedSummary);
    }),
  );

  // --- AC-012: Enter opens the link exactly once ------------------------------------

  it.effect("opens the Share Link once after Enter and prints it too", () =>
    Effect.gen(function* check() {
      const outcome = yield* execute(false, twoSessionHome(), [enter]);
      assert.strictEqual(outcome.code, 0);
      assert.deepStrictEqual(outcome.opened, [linkOf(expectedSummary)]);
      assert.include(outcome.logs, `Share Link: ${linkOf(expectedSummary)}`);
      assert.include(outcome.logs, "Press Enter to open the Share Link in your browser");
    }),
  );

  it.effect("prints the summary before it waits for input", () =>
    Effect.gen(function* check() {
      const outcome = yield* execute(false, twoSessionHome(), [ctrlC]);
      assert.isTrue(
        outcome.logs.indexOf("Usage Summary") < outcome.logs.indexOf("Press Enter"),
        outcome.logs,
      );
    }),
  );

  it.effect("opens nothing after Ctrl-C, another key, or closed input", () =>
    Effect.gen(function* check() {
      const home = twoSessionHome();
      for (const inputs of [[ctrlC], [keypress("x")], [keypress("escape")], []]) {
        const outcome = yield* execute(false, home, inputs);
        assert.deepStrictEqual(outcome.opened, []);
        assert.strictEqual(outcome.code, 0);
        assert.include(outcome.logs, `Share Link: ${linkOf(expectedSummary)}`);
      }
    }),
  );

  it.effect("prints the link and still ends well when the opener fails", () =>
    Effect.gen(function* check() {
      const outcome = yield* execute(false, twoSessionHome(), [enter], failingOpen);
      assert.strictEqual(outcome.code, 0);
      assert.include(outcome.logs, `Share Link: ${linkOf(expectedSummary)}`);
      assert.include(outcome.errors, "xdg-open not found");
    }),
  );

  // --- AC-014, INV-002: no network -------------------------------------------------

  it.effect("finishes and prints the link with every network call stubbed to fail", () =>
    Effect.gen(function* check() {
      const outcome = yield* execute(false, twoSessionHome(), [enter]);
      assert.strictEqual(outcome.code, 0);
      assert.include(outcome.logs, `Share Link: ${linkOf(expectedSummary)}`);
      assert.deepStrictEqual(
        networkSpies.map((spy) => spy.mock.calls.length),
        networkSpies.map(() => 0),
      );
    }),
  );

  // --- AC-015: a failing source is skipped, the rest are counted ---------------------

  it.effect("names a source that cannot be read and still counts every other source", () =>
    Effect.gen(function* check() {
      const home = makeHome();
      cpSync(fixtures("codex/last-total"), home, { recursive: true });
      cpSync(fixtures("claude/unreadable"), home, { recursive: true });
      const outcome = yield* execute(true, home, []);
      assert.strictEqual(outcome.code, 0);
      assert.match(outcome.errors, /^Skipped Claude Code: .+/mu);
      assert.notInclude(outcome.errors, "Codex");
      assert.include(outcome.logs, "gpt-synthetic-1");
      assert.include(outcome.logs, "Share Link: ");
    }),
  );

  // --- AC-016: no logs, no link ------------------------------------------------------

  it.effect("lists the folders it checked and prints no Share Link when no source has data", () =>
    Effect.gen(function* check() {
      const home = makeHome();
      const outcome = yield* execute(false, home, [enter]);
      assert.strictEqual(outcome.code, 1);
      assert.include(outcome.errors, "No usage logs found");
      assert.include(outcome.errors, path.join(home, ".claude"));
      assert.include(outcome.errors, path.join(home, ".codex"));
      assert.notInclude(outcome.logs, "Share Link");
      assert.notInclude(outcome.errors, "Share Link");
      assert.deepStrictEqual(outcome.opened, []);
      assert.strictEqual(outcome.prompts, 0);
    }),
  );
});

// --- the Usage Summary builder (AC-007, AC-008) --------------------------------------

const record = (
  model: string,
  session: string,
  at: Date,
  input: number,
  output = 0,
  cacheRead = 0,
  cacheWrite = 0,
): UsageRecord => ({
  at: at.getTime(),
  cacheRead,
  cacheWrite,
  input,
  model,
  output,
  session,
});

const summaryOf = (first: UsageRecord, ...rest: readonly UsageRecord[]): Summary =>
  summarize([first, ...rest]);

describe(summarize, () => {
  it("sums the counts of one model across records", () => {
    const summary = summaryOf(
      record("m", "s", local(1, 1), 1, 2, 3, 4),
      record("m", "t", local(1, 2), 10, 20, 30, 40),
    );
    assert.deepStrictEqual(summary.models, [
      { cacheRead: 33, cacheWrite: 44, input: 11, model: "m", output: 22 },
    ]);
    assert.strictEqual(summary.version, 1);
    assert.strictEqual(summary.sessions, 2);
  });

  it("keeps the top 8 models by tokens and sums the rest into other", () => {
    const summary = summarize(
      Array.makeBy(10, (index) => record(`model-${index}`, "s", local(1, 1), index + 1, index + 1)),
    );
    assert.deepStrictEqual(
      summary.models.map(({ model }) => model),
      [9, 8, 7, 6, 5, 4, 3, 2].map((index) => `model-${index}`),
    );
    // model-1 (2 + 2) and model-0 (1 + 1) are the two smallest.
    assert.deepStrictEqual(summary.other, { cacheRead: 0, cacheWrite: 0, input: 3, output: 3 });
  });

  it("folds model ids that do not fit the link into other, so encode never throws", () => {
    const summary = summaryOf(
      record("claude-sonnet-4-5", "s", local(1, 1), 100),
      record("not a model id", "s", local(1, 1), 7),
      record("", "s", local(1, 1), 5),
      record("m".repeat(65), "s", local(1, 1), 3),
      record("unicode-é", "s", local(1, 1), 1),
    );
    assert.deepStrictEqual(
      summary.models.map(({ model }) => model),
      ["claude-sonnet-4-5"],
    );
    assert.strictEqual(summary.other.input, 16);
    // `encode` throws on a model id outside the link format.
    assert.isString(encode(summary));
  });

  it("drops models with no tokens but keeps their sessions", () => {
    const summary = summaryOf(
      record("busy", "s1", local(2, 10), 50),
      record("idle", "s2", local(2, 11), 0),
    );
    assert.deepStrictEqual(
      summary.models.map(({ model }) => model),
      ["busy"],
    );
    assert.strictEqual(summary.sessions, 2);
  });

  it("counts distinct session keys", () => {
    const summary = summaryOf(
      record("m", "a", local(1, 1), 1),
      record("m", "a", local(1, 2), 1),
      record("m", "b", local(1, 3), 1),
    );
    assert.strictEqual(summary.sessions, 2);
  });

  it("weights the busiest hour by tokens, not by record count", () => {
    const summary = summarize([
      ...Array.makeBy(5, () => record("m", "s", local(1, 3), 10)),
      record("m", "s", local(1, 20), 1000),
    ]);
    assert.strictEqual(summary.busiestHour, 20);
  });

  it("takes the first day from the earliest record in local time, zero-token records included", () => {
    const summary = summaryOf(
      record("m", "late", local(9, 12), 10),
      record("m", "early", new Date(2026, 0, 3, 0, 5), 0),
    );
    assert.strictEqual(summary.firstDay, "2026-01-03");
  });

  it("builds a summary the link accepts, whatever the input", () => {
    const summary = summaryOf(record("m", "s", local(1, 1), 1));
    assert.deepStrictEqual(Effect.runSync(decode(encode(summary))), summary);
  });
});

// --- AC-017: the warning filter is narrow ---------------------------------------------

const forwarded = (
  warning: string | Error,
  second?: string | { readonly type: string },
): boolean => {
  let seen = false;
  filterWarnings((): void => {
    seen = true;
  })(warning, second);
  return seen;
};

describe(filterWarnings, () => {
  it("hides the SQLite ExperimentalWarning in its string and Error forms", () => {
    const message = "SQLite is an experimental feature and might change at any time";
    assert.isFalse(forwarded(message, "ExperimentalWarning"));
    assert.isFalse(forwarded(message, { type: "ExperimentalWarning" }));
    const error = Object.assign(new Error(message), { name: "ExperimentalWarning" });
    assert.isFalse(forwarded(error));
  });

  it("lets every other warning through", () => {
    assert.isTrue(forwarded("Type stripping is experimental", "ExperimentalWarning"));
    assert.isTrue(forwarded("SQLite is deprecated", "DeprecationWarning"));
    assert.isTrue(forwarded("something else"));
    assert.isTrue(forwarded(new Error("SQLite went wrong")));
  });
});
