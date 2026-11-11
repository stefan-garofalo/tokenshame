import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import type * as Path from "effect/Path";

import { readAmp } from "./amp";
import { readAntigravity } from "./antigravity";
import { readClaude } from "./claude";
import { readCodex } from "./codex";
import { readCopilot } from "./copilot";
import { readDroid } from "./droid";
import { readGemini } from "./gemini";
import { readGoose } from "./goose";
import { readGrok } from "./grok";
import { readKimi } from "./kimi";
import { readMuse } from "./muse";
import { readOpencode } from "./opencode";
import { readPi } from "./pi";
import { readQwen } from "./qwen";
import type { ReadResult, Reader } from "./types";

/** The single list of Usage Sources the CLI reads: one reader per supported agent. */
const registry: readonly (readonly [agent: string, read: Reader])[] = [
  ["Claude Code", readClaude],
  ["Codex", readCodex],
  ["opencode", readOpencode],
  ["Pi", readPi],
  ["Gemini CLI", readGemini],
  ["Grok", readGrok],
  ["Qwen", readQwen],
  ["Amp", readAmp],
  ["Droid", readDroid],
  ["Kimi", readKimi],
  ["Copilot CLI", readCopilot],
  ["Goose", readGoose],
  ["Antigravity", readAntigravity],
  ["Muse", readMuse],
];

/** How many sources are read at once: enough to overlap disk waits, few enough for open file limits. */
const readConcurrency = 4;

/**
 * Reads every Usage Source under the home folder. A reader never fails by contract; if one
 * still does, that source is skipped as unreadable and the others carry on (AC-015).
 */
export const readAll = (
  home: string,
): Effect.Effect<readonly ReadResult[], never, FileSystem.FileSystem | Path.Path> => {
  const reads = registry.map(([agent, read]) =>
    read(home).pipe(
      Effect.catchCause(() =>
        Effect.succeed<ReadResult>({
          _tag: "Skipped",
          agent,
          detail: "the reader crashed",
          path: home,
          reason: "unreadable",
        }),
      ),
    ),
  );
  return Effect.all(reads, { concurrency: readConcurrency });
};
