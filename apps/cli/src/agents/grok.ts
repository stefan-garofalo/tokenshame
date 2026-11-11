import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { decodeLines, exclusive, readFiles, toCount, unknownModel } from "./pi";
import type { ParseFile } from "./pi";
import type { Reader, UsageRecord } from "./types";

const Count = Schema.optionalKey(Schema.Finite);

const GrokUsageSchema = Schema.Struct({
  cachedReadTokens: Count,
  inputTokens: Count,
  outputTokens: Count,
});
type GrokUsage = typeof GrokUsageSchema.Type;

const GrokLine = Schema.Struct({
  params: Schema.optionalKey(
    Schema.Struct({
      _meta: Schema.optionalKey(Schema.Struct({ agentTimestampMs: Count })),
      update: Schema.optionalKey(
        Schema.Struct({
          _meta: Schema.optionalKey(Schema.Struct({ modelId: Schema.optionalKey(Schema.String) })),
          sessionUpdate: Schema.optionalKey(Schema.String),
          usage: Schema.optionalKey(
            Schema.Struct({
              ...GrokUsageSchema.fields,
              modelUsage: Schema.optionalKey(Schema.Record(Schema.String, GrokUsageSchema)),
            }),
          ),
        }),
      ),
    }),
  ),
});

const decodeGrokLine = Schema.decodeUnknownOption(Schema.fromJsonString(GrokLine));

const parseGrok: ParseFile = (file) => {
  const session = `grok:${file.segments.at(-2) ?? ""}`;
  return Option.map(decodeLines(file.text, decodeGrokLine), (lines) => {
    const records: UsageRecord[] = [];
    // The turn's model is the last one the log named before the turn finished.
    let model = unknownModel;
    for (const line of lines) {
      const update = line.params?.update;
      model = update?._meta?.modelId ?? model;
      const usage = update?.usage;
      if (update?.sessionUpdate === "turn_completed" && usage !== undefined) {
        const timestamp = toCount(line.params?._meta?.agentTimestampMs);
        const at = timestamp > 0 ? timestamp : file.mtimeMs;
        const perModel = Object.entries(usage.modelUsage ?? {});
        const turns: readonly (readonly [string, GrokUsage])[] =
          perModel.length > 0 ? perModel : [[model, usage]];
        for (const [turnModel, turn] of turns) {
          const cached = toCount(turn.cachedReadTokens);
          // Grok's `inputTokens` includes the cached reads; `outputTokens` includes reasoning.
          records.push({
            at,
            cacheRead: cached,
            cacheWrite: 0,
            input: exclusive(toCount(turn.inputTokens), cached),
            model: turnModel,
            output: toCount(turn.outputTokens),
            session,
          });
        }
      }
    }
    return records;
  });
};

/**
 * Grok Build (xAI). Reads `~/.grok/sessions/<workspace>/<session>/updates.jsonl`, one
 * session per folder. Each `turn_completed` update carries `usage`: `inputTokens` (with
 * `cachedReadTokens` inside it) gives `input` = `inputTokens` - `cachedReadTokens` and
 * `cacheRead`; `outputTokens` (reasoning included) gives `output`. When `usage.modelUsage`
 * lists models, each gives one record under its id; otherwise the turn uses the last
 * `_meta.modelId` the log named. `at` is `params._meta.agentTimestampMs`. Older logs keep only a
 * running `totalTokens` with no split, so those turns count nothing. The global
 * `~/.grok/logs/unified.jsonl` repeats the same inferences and is not read, to avoid counting
 * twice. Grok logs no cache writes.
 */
export const readGrok: Reader = (home) =>
  readFiles(
    "Grok",
    home,
    [".grok", "sessions"],
    (segments) => segments.length === 3 && segments[2] === "updates.jsonl",
    parseGrok,
  );
