import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { environmentFolder } from "./env";
import { NullableCount, NullableText, countOf, timeOf } from "./json-tools";
import { decodeLines, exclusive, readFiles, unknownModel } from "./pi";
import type { ParseFile } from "./pi";
import type { Reader, UsageRecord } from "./types";

const ChatLine = Schema.Struct({
  createdAt: NullableText,
  id: NullableText,
  metadata: Schema.optionalKey(
    Schema.NullOr(
      Schema.Struct({
        model: NullableText,
        providerMetadata: Schema.optionalKey(
          Schema.NullOr(
            Schema.Struct({
              anthropic: Schema.optionalKey(
                Schema.NullOr(Schema.Struct({ cacheCreationInputTokens: NullableCount })),
              ),
            }),
          ),
        ),
        timestamp: NullableCount,
        usage: Schema.optionalKey(
          Schema.NullOr(
            Schema.Struct({
              cachedInputTokens: NullableCount,
              inputTokens: NullableCount,
              outputTokens: NullableCount,
            }),
          ),
        ),
      }),
    ),
  ),
  role: NullableText,
});

const decodeChatLine = Schema.decodeUnknownOption(Schema.fromJsonString(ChatLine));

// Segments below `sessions`: `<workspace>/chat.jsonl`, or a sub-agent's
// `<workspace>/subagent-transcripts/<task>/chat.jsonl`. The folder holding the file names the session.
const parseMux: ParseFile = (file) => {
  const session = `mux:${file.segments.at(-2) ?? ""}`;
  return Option.map(decodeLines(file.text, decodeChatLine), (lines) => {
    // A message id is one model call; if a line repeats it, the last copy wins.
    const byId = new Map<string, UsageRecord>();
    for (const [index, line] of lines.entries()) {
      const meta = line.metadata;
      const usage = meta?.usage;
      if (
        line.role === "assistant" &&
        meta !== null &&
        meta !== undefined &&
        usage !== null &&
        usage !== undefined
      ) {
        // Mux (AI SDK) counts cache reads and writes inside `inputTokens`.
        const cacheRead = countOf(usage.cachedInputTokens);
        const cacheWrite = countOf(meta.providerMetadata?.anthropic?.cacheCreationInputTokens);
        byId.set(line.id ?? `#${index}`, {
          at: timeOf(meta.timestamp ?? line.createdAt, file.mtimeMs),
          cacheRead,
          cacheWrite,
          input: exclusive(exclusive(countOf(usage.inputTokens), cacheRead), cacheWrite),
          model: meta.model ?? unknownModel,
          output: countOf(usage.outputTokens),
          session,
        });
      }
    }
    return [...byId.values()];
  });
};

const isChat = (segments: readonly string[]): boolean =>
  segments.at(-1) === "chat.jsonl" &&
  (segments.length === 2 || (segments.length === 4 && segments[1] === "subagent-transcripts"));

/**
 * Mux (coder/mux). Reads `<root>/sessions/<workspace>/chat.jsonl` and each sub-agent's
 * `<root>/sessions/<workspace>/subagent-transcripts/<task>/chat.jsonl`; a sub-agent's usage is
 * only in its own transcript, so nothing counts twice. The root is `MUX_ROOT` when set, else
 * `~/.mux` (the same on every platform). `session-usage.json` and `analytics/` repeat the same
 * usage as per-model totals and are not read.
 *
 * Mapping, from assistant lines with `metadata.usage`: `model` = `metadata.model` as logged
 * (`provider:model`), `session` = `mux:` + the folder of the transcript, `at` =
 * `metadata.timestamp` (epoch ms), else `createdAt`, else the file time. Mux counts cache
 * inside `usage.inputTokens`, so `input` = `inputTokens` - `cachedInputTokens` (`cacheRead`) -
 * `providerMetadata.anthropic.cacheCreationInputTokens` (`cacheWrite`). `output` =
 * `outputTokens`, which already holds `reasoningTokens`. A message id is counted once.
 */
export const readMux: Reader = (home) =>
  Effect.gen(function* readFromHome() {
    const path = yield* Path.Path;
    const muxRoot = yield* environmentFolder("MUX_ROOT");
    const root = Option.getOrElse(muxRoot, () => path.join(home, ".mux"));
    return yield* readFiles("Mux", root, ["sessions"], isChat, parseMux);
  });
