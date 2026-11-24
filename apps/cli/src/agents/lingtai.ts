import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";

import { environmentFolder } from "./env";
import { decodeLines, exclusive, toCount, toEpochMs, unknownModel } from "./pi";
import type { Reader, ReadResult, SkippedSource, UsageRecord } from "./types";

// LingTai writes counts as numbers or as numeric text.
const Count = Schema.optionalKey(Schema.Union([Schema.Finite, Schema.String]));
const Text = Schema.optionalKey(Schema.String);

/** One line of an agent's `token_ledger.jsonl`: the usage of one model call. */
const LedgerLine = Schema.Struct({
  cached: Count,
  input: Count,
  model: Text,
  output: Count,
  run_id: Text,
  source: Text,
  thinking: Count,
  ts: Schema.optionalKey(Schema.Union([Schema.Finite, Schema.String])),
});

/** The part of an agent's `.agent.json` the reader uses. */
const Manifest = Schema.Struct({
  agent_id: Text,
  llm: Schema.optionalKey(Schema.Struct({ model: Text })),
});

const decodeLedgerLine = Schema.decodeUnknownOption(Schema.fromJsonString(LedgerLine));
const decodeManifest = Schema.decodeUnknownOption(Schema.fromJsonString(Manifest));

const count = (value: number | string | undefined): number =>
  toCount(Predicate.isString(value) ? Number(value) : value);

/** Times below this are epoch seconds, not milliseconds. */
const millisecondsFrom = 1e12;

const toRecords = (
  lines: readonly (typeof LedgerLine.Type)[],
  agent: string,
  manifest: Option.Option<typeof Manifest.Type>,
  mtimeMs: number,
): readonly UsageRecord[] => {
  const agentId = Option.getOrUndefined(manifest)?.agent_id ?? agent;
  const fallbackModel = Option.getOrUndefined(manifest)?.llm?.model ?? unknownModel;
  return lines.map((line) => {
    const cached = count(line.cached);
    const run = line.run_id === undefined || line.run_id === "" ? undefined : line.run_id;
    return {
      at: Predicate.isNumber(line.ts)
        ? Math.trunc(line.ts < millisecondsFrom ? line.ts * 1000 : line.ts)
        : toEpochMs(line.ts, mtimeMs),
      cacheRead: cached,
      cacheWrite: 0,
      input: exclusive(count(line.input), cached),
      model: line.model ?? fallbackModel,
      output: count(line.output) + count(line.thinking),
      session: `lingtai:${run ?? `${agentId}:${line.source ?? "main"}`}`,
    };
  });
};

/**
 * LingTai TUI keeps one folder per agent, `<home>/<agent>/`, with a token ledger in
 * `logs/token_ledger.jsonl` (one line per model call) and the agent's `.agent.json`. The
 * home is `LINGTAI_HOME`, else `LINGTAI_TUI_HOME`, else `~/.lingtai` (taken as one folder,
 * not a path list). Project homes (`<project>/.lingtai`, listed in `~/.lingtai-tui`) are not
 * read: only the home folder is known.
 *
 * Mapping: `model` = `model`, else `.agent.json` `llm.model`. `at` = `ts` (ISO text, or epoch
 * seconds or milliseconds). `cached` is part of `input`, so `cacheRead` = `cached` and
 * `input` = `input` - `cached`. `output` = `output` + `thinking` (counted apart).
 * `session` = `lingtai:` + `run_id`, else the agent id (`.agent.json` `agent_id`, else the
 * folder name) and the line's `source`.
 */
export const readLingTai: Reader = (home) =>
  Effect.gen(function* readFromHome() {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const lingtaiHome = yield* environmentFolder("LINGTAI_HOME");
    const tuiHome = yield* environmentFolder("LINGTAI_TUI_HOME");
    const root = Option.getOrElse(
      Option.orElse(lingtaiHome, () => tuiHome),
      () => path.join(home, ".lingtai"),
    );
    const skipped = (reason: SkippedSource["reason"], detail: string): SkippedSource => ({
      _tag: "Skipped",
      agent: "LingTai TUI",
      detail,
      path: root,
      reason,
    });

    /** None when the folder has no ledger; some(none) when its ledger is corrupt. */
    const readAgent = (agent: string) =>
      Effect.gen(function* readAgentFolder() {
        const ledger = path.join(root, agent, "logs", "token_ledger.jsonl");
        const text = yield* fs.readFileString(ledger).pipe(Effect.option);
        if (Option.isNone(text)) {
          return Option.none<Option.Option<readonly UsageRecord[]>>();
        }
        const info = yield* fs.stat(ledger).pipe(Effect.option);
        const mtimeMs = info
          .pipe(
            Option.flatMap(({ mtime }) => mtime),
            Option.getOrElse(() => new Date()),
          )
          .getTime();
        const manifestText = yield* fs
          .readFileString(path.join(root, agent, ".agent.json"))
          .pipe(Effect.option);
        const manifest = manifestText.pipe(Option.flatMap(decodeManifest));
        return Option.some(
          Option.map(decodeLines(text.value, decodeLedgerLine), (lines) =>
            toRecords(lines, agent, manifest, mtimeMs),
          ),
        );
      });

    const present = yield* fs.exists(root).pipe(Effect.orElseSucceed(() => false));
    if (!present) {
      return skipped("no-data", "");
    }
    const listed = yield* fs.readDirectory(root).pipe(Effect.result);
    if (listed._tag === "Failure") {
      return skipped("unreadable", listed.failure.message);
    }
    // The unicorn rules mistake `Effect.forEach` for `Array#forEach`.
    // oxlint-disable-next-line unicorn/no-array-for-each, unicorn/no-array-method-this-argument
    const found = yield* Effect.forEach(listed.success, readAgent, { concurrency: 8 });
    const ledgers = found.flatMap((ledger) => Option.toArray(ledger));
    const records = ledgers
      .flatMap((ledger) => Option.getOrElse(ledger, () => []))
      .filter((record) => record.input + record.output + record.cacheRead + record.cacheWrite > 0);
    if (records.length > 0) {
      return { _tag: "Read", records } satisfies ReadResult;
    }
    const corrupt = ledgers.filter(Option.isNone).length;
    return corrupt > 0
      ? skipped("unreadable", `${corrupt} of ${ledgers.length} ledgers could not be parsed`)
      : skipped("no-data", "");
  });
