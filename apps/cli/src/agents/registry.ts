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
import { readKimi, readKimiCode } from "./kimi";
import { readMuse } from "./muse";
import { readOpencode } from "./opencode";
import { readPi } from "./pi";
import { readQwen } from "./qwen";
import { readCline } from "./cline";
import { readClineCli } from "./cline-cli";
import { readCopilotVscode } from "./copilot-vscode";
import { readCursor } from "./cursor";
import { readIbmBob } from "./ibm-bob";
import { readKiloCode } from "./kilo-code";
import { readKiro } from "./kiro";
import { readRooCode } from "./roo-code";
import { readQoder } from "./qoder";
import { readOpenClaude } from "./openclaude";
import { readCherryStudio } from "./cherrystudio";
import { readCodeBuddy } from "./codebuddy";
import { readWorkBuddy } from "./workbuddy";
import { readCommandCode } from "./commandcode";
import { readOpenCodeReview } from "./opencodereview";
import { readZcode } from "./zcode";
import { readOmp } from "./omp";
import { readSenpi } from "./senpi";
import { readKimchi } from "./kimchi";
import { readGjc } from "./gjc";
import { readPrimeAgent } from "./prime-agent";
import { readOpenClaw } from "./openclaw";
import { readJcode } from "./jcode";
import { readReasonix } from "./reasonix";
import { readLingTai } from "./lingtai";
import { readZerostack } from "./zerostack";
import { readAside } from "./aside";
import { readAugment } from "./augment";
import { readCodebuff } from "./codebuff";
import { readDsh } from "./dsh";
import { readFx } from "./fx";
import { readJunie } from "./junie";
import { readMux } from "./mux";
import { readProma } from "./proma";
import { readVibe } from "./vibe";
import { readBb } from "./bb";
import { readDevin } from "./devin";
import { readForge } from "./forge";
import { readHermes } from "./hermes";
import { readKilo } from "./kilo";
import { readMimoCode, readMimoDesktop } from "./mimo";
import { readQuickDesk } from "./quickdesk";
import { readZed } from "./zed";
import type { ReadResult, Reader } from "./types";

/** The single list of Usage Sources the CLI reads: one reader per supported agent. Exported for tests that walk every reader. */
export const registry: readonly (readonly [agent: string, read: Reader])[] = [
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
  ["Cline", readCline],
  ["Cline CLI", readClineCli],
  ["Roo Code", readRooCode],
  ["Kilo Code", readKiloCode],
  ["IBM Bob", readIbmBob],
  ["Kiro", readKiro],
  ["Copilot (VS Code)", readCopilotVscode],
  ["Cursor", readCursor],
  ["Qoder", readQoder],
  ["OpenClaude", readOpenClaude],
  ["Cherry Studio", readCherryStudio],
  ["CodeBuddy", readCodeBuddy],
  ["WorkBuddy", readWorkBuddy],
  ["Command Code", readCommandCode],
  ["OpenCodeReview", readOpenCodeReview],
  ["ZCode", readZcode],
  ["Oh My Pi", readOmp],
  ["Senpi", readSenpi],
  ["Kimchi", readKimchi],
  ["gajae-code", readGjc],
  ["Prime Agent", readPrimeAgent],
  ["OpenClaw", readOpenClaw],
  ["Jcode", readJcode],
  ["Reasonix", readReasonix],
  ["LingTai TUI", readLingTai],
  ["zerostack", readZerostack],
  ["Aside", readAside],
  ["Augment Code", readAugment],
  ["Codebuff", readCodebuff],
  ["DeepSeek Harness", readDsh],
  ["fx", readFx],
  ["Junie", readJunie],
  ["Kimi Code", readKimiCode],
  ["Mux", readMux],
  ["Proma", readProma],
  ["Mistral Vibe", readVibe],
  ["Kilo CLI", readKilo],
  ["Zed Agent", readZed],
  ["Hermes Agent", readHermes],
  ["MiMo Code", readMimoCode],
  ["Xiaomi MiMo AI", readMimoDesktop],
  ["Devin", readDevin],
  ["BB", readBb],
  ["Forge", readForge],
  ["Quick Desktop", readQuickDesk],
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
