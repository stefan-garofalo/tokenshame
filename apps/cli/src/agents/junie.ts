import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { NullableCount, NullableText, countOf, timeOf } from "./json-tools";
import { decodeLines, readFiles } from "./pi";
import type { ParseFile } from "./pi";
import type { Reader, UsageRecord } from "./types";

const ModelUsage = Schema.Struct({
  cacheCreateTokens: NullableCount,
  cacheCreationInputTokens: NullableCount,
  cacheInputTokens: NullableCount,
  cacheRead: NullableCount,
  cacheReadInputTokens: NullableCount,
  cacheWrite: NullableCount,
  input: NullableCount,
  inputTokens: NullableCount,
  model: Schema.NonEmptyString,
  output: NullableCount,
  outputTokens: NullableCount,
});

/** A line of `events.jsonl`. Only `LlmResponseMetadataEvent` lines carry `modelUsage`. */
const EventLine = Schema.Struct({
  event: Schema.optionalKey(
    Schema.NullOr(
      Schema.Struct({
        agentEvent: Schema.optionalKey(
          Schema.NullOr(
            Schema.Struct({
              kind: NullableText,
              modelUsage: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.Unknown))),
            }),
          ),
        ),
      }),
    ),
  ),
  timestampMs: NullableCount,
});

const decodeEventLine = Schema.decodeUnknownOption(Schema.fromJsonString(EventLine));
const decodeModelUsage = Schema.decodeUnknownOption(ModelUsage);

const first = (...values: readonly (number | null | undefined)[]): number =>
  countOf(values.find((value) => value !== null && value !== undefined));

const parseJunie: ParseFile = (file) => {
  const session = `junie:${file.segments.at(-2) ?? ""}`;
  return Option.map(decodeLines(file.text, decodeEventLine), (lines) => {
    // Junie can write the same response event twice; an identical row counts once.
    const byKey = new Map<string, UsageRecord>();
    for (const line of lines) {
      const agentEvent = line.event?.agentEvent;
      if (agentEvent?.kind === "LlmResponseMetadataEvent") {
        const at = timeOf(line.timestampMs, file.mtimeMs);
        for (const [index, raw] of (agentEvent.modelUsage ?? []).entries()) {
          for (const usage of Option.toArray(decodeModelUsage(raw))) {
            const record: UsageRecord = {
              at,
              cacheRead: first(usage.cacheInputTokens, usage.cacheReadInputTokens, usage.cacheRead),
              cacheWrite: first(
                usage.cacheCreateTokens,
                usage.cacheCreationInputTokens,
                usage.cacheWrite,
              ),
              input: first(usage.inputTokens, usage.input),
              model: usage.model,
              output: first(usage.outputTokens, usage.output),
              session,
            };
            const { cacheRead, cacheWrite, input, model, output } = record;
            byKey.set(
              `${at}:${index}:${model}:${input}:${output}:${cacheRead}:${cacheWrite}`,
              record,
            );
          }
        }
      }
    }
    return [...byKey.values()];
  });
};

/**
 * Junie (JetBrains) CLI. Reads `~/.junie/sessions/<session>/events.jsonl`, one session per
 * folder (the same on every platform). Each `LlmResponseMetadataEvent` line
 * (`event.agentEvent`) holds `modelUsage[]`, one row per model call: `model` as logged,
 * `inputTokens` = `input`, `outputTokens` = `output`, `cacheInputTokens` = `cacheRead`,
 * `cacheCreateTokens` = `cacheWrite` (older names: `input`, `output`,
 * `cacheReadInputTokens`/`cacheRead`, `cacheCreationInputTokens`/`cacheWrite`). The cache
 * counts are taken as separate from `inputTokens`, as other Junie readers take them. `at` =
 * the line's `timestampMs`, else the file time. `cost` is ignored. A replayed event (same
 * time, model, row and counts) counts once.
 */
export const readJunie: Reader = (home) =>
  readFiles(
    "Junie",
    home,
    [".junie", "sessions"],
    (segments) => segments.length === 2 && segments[1] === "events.jsonl",
    parseJunie,
  );
