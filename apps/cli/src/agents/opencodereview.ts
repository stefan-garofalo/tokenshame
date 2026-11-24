import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { readLogFiles } from "./claude";
import { usageResult } from "./folders";
import type { ParseLog } from "./claude";
import { decodeLines, stemOf, toCount, toEpochMs, unknownModel } from "./pi";
import type { Reader, UsageRecord } from "./types";

const Count = Schema.optionalKey(Schema.Finite);
const Text = Schema.optionalKey(Schema.String);

/** An OpenCodeReview `llm_response` line. Other lines do not match. */
const ResponseLine = Schema.Struct({
  model: Text,
  sessionId: Text,
  timestamp: Text,
  type: Schema.Literal("llm_response"),
  usage: Schema.Struct({
    cache_read_tokens: Count,
    cache_write_tokens: Count,
    completion_tokens: Count,
    prompt_tokens: Count,
  }),
});

const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));
const decodeResponseLine = Schema.decodeUnknownOption(ResponseLine);

const parseReviewLog: ParseLog<UsageRecord> = (file) =>
  Option.map(
    decodeLines(file.text, (text) => Option.map(decodeJson(text), decodeResponseLine)),
    (lines) => {
      // A line with the same time, model and counts is a replayed write of one call.
      const seen = new Set<string>();
      return lines.flatMap(Option.toArray).flatMap(({ model, sessionId, timestamp, usage }) => {
        const record: UsageRecord = {
          at: toEpochMs(timestamp, file.mtimeMs),
          cacheRead: toCount(usage.cache_read_tokens),
          cacheWrite: toCount(usage.cache_write_tokens),
          input: toCount(usage.prompt_tokens),
          model: model ?? unknownModel,
          output: toCount(usage.completion_tokens),
          session: `opencodereview:${sessionId ?? stemOf(file.segments, ".jsonl")}`,
        };
        if (timestamp !== undefined) {
          const key = JSON.stringify(record);
          if (seen.has(key)) {
            return [];
          }
          seen.add(key);
        }
        return [record];
      });
    },
  );

/**
 * OpenCodeReview keeps one log per review session,
 * `~/.opencodereview/sessions/<encoded repo path>/<session>.jsonl` (format from tokscale's
 * `opencodereview.rs`). Each model call is an `llm_response` line with `model`, `timestamp`
 * (when the response was logged) and `usage`: `input` = `prompt_tokens`, `output` =
 * `completion_tokens`, `cacheRead` = `cache_read_tokens`, `cacheWrite` = `cache_write_tokens`
 * (taken as separate buckets, as tokscale does; no source shows otherwise). `session` =
 * `opencodereview:` + `sessionId`, else the file name. Two lines of one file with the same
 * timestamp, model and counts are one call written twice.
 */
export const readOpenCodeReview: Reader = (home) =>
  Effect.gen(function* readFromHome() {
    const path = yield* Path.Path;
    const folder = path.join(home, ".opencodereview");
    const { failures, items } = yield* readLogFiles(
      [path.join(folder, "sessions")],
      (name) => name.endsWith(".jsonl"),
      parseReviewLog,
    );
    return usageResult("OpenCodeReview", folder, items, failures);
  });
