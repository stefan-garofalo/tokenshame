import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { decodeLines, exclusive, readFiles, stemOf, toCount, toEpochMs, unknownModel } from "./pi";
import type { ParseFile } from "./pi";
import type { Reader } from "./types";

const Count = Schema.optionalKey(Schema.Finite);
const Text = Schema.optionalKey(Schema.String);

const QwenLine = Schema.Struct({
  model: Text,
  timestamp: Text,
  type: Text,
  usageMetadata: Schema.optionalKey(
    Schema.Struct({
      cachedContentTokenCount: Count,
      candidatesTokenCount: Count,
      promptTokenCount: Count,
      thoughtsTokenCount: Count,
      totalTokenCount: Count,
    }),
  ),
});

const decodeQwenLine = Schema.decodeUnknownOption(Schema.fromJsonString(QwenLine));

const parseQwen: ParseFile = (file) => {
  const session = `qwen:${stemOf(file.segments, ".jsonl")}`;
  return Option.map(decodeLines(file.text, decodeQwenLine), (lines) =>
    lines.flatMap((line) => {
      const usage = line.usageMetadata;
      if (line.type !== "assistant" || usage === undefined) {
        return [];
      }
      const prompt = toCount(usage.promptTokenCount);
      const candidates = toCount(usage.candidatesTokenCount);
      const thoughts = toCount(usage.thoughtsTokenCount);
      const cached = toCount(usage.cachedContentTokenCount);
      // Qwen logs Gemini-shaped usage for every provider. OpenAI-style providers count the
      // thoughts inside the candidates; the Gemini API counts them on top. The logged total
      // tells which: it equals prompt + candidates when thoughts are inside, and some
      // OpenAI-style converters log a total of 0.
      const thoughtsInside =
        thoughts > 0 &&
        (usage.totalTokenCount === 0
          ? candidates > 0
          : usage.totalTokenCount === prompt + candidates);
      return [
        {
          at: toEpochMs(line.timestamp, file.mtimeMs),
          cacheRead: cached,
          cacheWrite: 0,
          input: exclusive(prompt, cached),
          model: line.model ?? unknownModel,
          output: thoughtsInside ? candidates : candidates + thoughts,
          session,
        },
      ];
    }),
  );
};

/**
 * Qwen Code. Reads `~/.qwen/projects/<project>/chats/*.jsonl`, one session per file.
 * Each `assistant` line carries `model` and `usageMetadata`: `promptTokenCount` is the whole
 * prompt with `cachedContentTokenCount` inside it, so `input` = prompt - cached and
 * `cacheRead` = cached; `output` = `candidatesTokenCount`, plus `thoughtsTokenCount` unless
 * the provider already counts thoughts inside the candidates. Qwen logs no cache writes.
 * `at` is the line `timestamp`.
 */
export const readQwen: Reader = (home) =>
  readFiles(
    "Qwen",
    home,
    [".qwen", "projects"],
    (segments) =>
      segments.length >= 3 &&
      segments[1] === "chats" &&
      segments.at(-1)?.endsWith(".jsonl") === true,
    parseQwen,
  );
