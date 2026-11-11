#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { homedir } from "node:os";

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { encode, shareUrl } from "@tokenshame/share-link/link";
import * as Array from "effect/Array";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import type * as Path from "effect/Path";
import * as Predicate from "effect/Predicate";
import type * as Terminal from "effect/Terminal";
import type * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import { Command, Flag } from "effect/cli";

import { version } from "../package.json";
import type { Open } from "./prompt";
import { openInBrowser, shareLink } from "./prompt";
import { renderNoLogs, renderSkipped, renderSummary } from "./render";
import { summarize } from "./summary";

/** The site the Share Link opens on. Only the user's browser contacts it. */
const shareOrigin = "https://tokenshame.vercel.app";

// Node also accepts an options object or a constructor as the second argument.
type WarningSecond = string | NodeJS.EmitWarningOptions | (() => void) | undefined;
type WarningArgs = readonly [warning: string | Error, second?: WarningSecond];

/** The `type` of a warning: an Error carries it as its name, a string warning as an argument. */
const warningType = (warning: string | Error, second: WarningSecond): string | undefined => {
  if (warning instanceof Error) {
    return warning.name;
  }
  if (Predicate.isString(second)) {
    return second;
  }
  return Predicate.hasProperty(second, "type") && Predicate.isString(second.type)
    ? second.type
    : undefined;
};

const isSqliteWarning = (warning: string | Error, second: WarningSecond): boolean =>
  warningType(warning, second) === "ExperimentalWarning" &&
  (warning instanceof Error ? warning.message : warning).includes("SQLite");

/**
 * Wraps `process.emitWarning` so the one SQLite `ExperimentalWarning` is dropped and every
 * other warning passes through unchanged (AC-017).
 */
export const filterWarnings =
  <A extends WarningArgs>(emit: (...args: A) => void) =>
  (...args: A): void => {
    if (!isSqliteWarning(args[0], args[1])) {
      emit(...args);
    }
  };

/**
 * One run: read every Usage Source, print the exact Usage Summary and the Share Link, and
 * open the link only after Enter (never on a dry run). Returns the exit code: 0, or 1 when
 * no Usage Source has data. Nothing here touches the network (INV-002).
 */
export const run = (
  dryRun: boolean,
  home: string,
  open: Open,
): Effect.Effect<
  number,
  never,
  FileSystem.FileSystem | Path.Path | Terminal.Terminal | ChildProcessSpawner.ChildProcessSpawner
> =>
  Effect.gen(function* tokenshameRun() {
    // Loaded here, after the warning filter is installed: the readers import `node:sqlite`.
    const { readAll } = yield* Effect.promise(() => import("./agents/registry"));
    const results = yield* readAll(home);

    for (const result of results) {
      if (result._tag === "Skipped" && result.reason === "unreadable") {
        yield* Console.error(renderSkipped(result));
      }
    }

    const records = results.flatMap((result) => (result._tag === "Read" ? result.records : []));
    if (!Array.isReadonlyArrayNonEmpty(records)) {
      const checked = results.flatMap((result) => (result._tag === "Skipped" ? [result.path] : []));
      yield* Console.error(renderNoLogs([...new Set(checked)]));
      return 1;
    }

    const summary = summarize(records);
    const url = shareUrl(shareOrigin, encode(summary));
    yield* Console.log(renderSummary(summary, url));
    yield* dryRun ? Console.log("\nDry run: nothing was opened.") : shareLink(url, open);
    return 0;
  });

const tokenshame = Command.make(
  "tokenshame",
  {
    dryRun: Flag.Boolean("dry-run").pipe(
      Flag.withDefault(false),
      Flag.withDescription("Print the Usage Summary and Share Link without opening a browser"),
    ),
  },
  ({ dryRun }) =>
    run(dryRun, homedir(), openInBrowser).pipe(
      Effect.flatMap((code) =>
        Effect.sync(() => {
          process.exitCode = code;
        }),
      ),
    ),
);

// Run only as the program, not when a test imports `run`. `realpath` resolves the npm bin link.
const [, entry] = process.argv;
if (entry !== undefined && realpathSync(entry) === import.meta.filename) {
  // `defineProperty` because the wrapper's type is one of `emitWarning`'s overloads, not all.
  Object.defineProperty(process, "emitWarning", {
    value: filterWarnings(process.emitWarning.bind(process)),
  });
  NodeRuntime.runMain(
    Command.run(tokenshame, { version }).pipe(Effect.provide(NodeServices.layer)),
  );
}
