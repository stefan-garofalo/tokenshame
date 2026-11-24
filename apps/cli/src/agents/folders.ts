import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import type * as Path from "effect/Path";

import { hasTokens, readFiles } from "./pi";
import type { ParseFile } from "./pi";
import type { ReadResult, UsageRecord } from "./types";

// Shared by readers whose agent keeps usage in several folders or files.

/** Keeps every `.jsonl` file, at any depth below the folder. */
export const jsonlFiles = (segments: readonly string[]): boolean =>
  segments.at(-1)?.endsWith(".jsonl") === true;

/**
 * One result from the results of several folders of one agent: all their records when any
 * folder has usage, else the first `unreadable`, else the first result.
 */
export const mergeResults = (results: readonly [ReadResult, ...ReadResult[]]): ReadResult => {
  const records = results.flatMap((result) => (result._tag === "Read" ? result.records : []));
  if (records.length > 0) {
    return { _tag: "Read", records };
  }
  return (
    results.find((result) => result._tag === "Skipped" && result.reason === "unreadable") ??
    results[0]
  );
};

/**
 * `readFiles` for an agent that keeps its files in several folders (an environment override,
 * a legacy folder, a per-OS folder). Each folder is read once, in order, with the same `parse`,
 * so a parser that counts a call once does so across all folders.
 */
export const readFolders = (
  agent: string,
  folders: readonly [string, ...string[]],
  wanted: (segments: readonly string[]) => boolean,
  parse: ParseFile,
): Effect.Effect<ReadResult, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* readEachFolder() {
    const [first, ...rest] = folders;
    const results: [ReadResult, ...ReadResult[]] = [
      yield* readFiles(agent, first, [], wanted, parse),
    ];
    for (const folder of new Set(rest)) {
      if (folder !== first) {
        results.push(yield* readFiles(agent, folder, [], wanted, parse));
      }
    }
    return mergeResults(results);
  });

/** The entries of a folder, or none when it is missing or cannot be listed. */
export const listFolder = (folder: string) =>
  Effect.gen(function* list() {
    const fs = yield* FileSystem.FileSystem;
    return yield* fs.readDirectory(folder).pipe(Effect.orElseSucceed((): string[] => []));
  });

/**
 * The result of one source from its records and the causes of what failed to read. Records
 * without tokens are dropped. The source is `Skipped` only when no usage is left:
 * `unreadable` if something failed, else `no-data`. `path` is the first place it checked.
 */
export const usageResult = (
  agent: string,
  path: string,
  records: readonly UsageRecord[],
  failures: readonly string[],
): ReadResult => {
  const usage = records.filter(hasTokens);
  if (usage.length > 0) {
    return { _tag: "Read", records: usage };
  }
  const [failure] = failures;
  return failure === undefined
    ? { _tag: "Skipped", agent, detail: "", path, reason: "no-data" }
    : { _tag: "Skipped", agent, detail: failure, path, reason: "unreadable" };
};
