import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { decodeLines, readFiles, toCount } from "./pi";
import type { ParseFile } from "./pi";
import type { Reader, UsageRecord } from "./types";

/** Kimi CLI wire logs name no model; every Kimi CLI session runs Kimi's coding model. */
const kimiModel = "kimi-for-coding";

const Count = Schema.optionalKey(Schema.Finite);

const WireLine = Schema.Struct({
  message: Schema.optionalKey(
    Schema.Struct({
      payload: Schema.optionalKey(
        Schema.Struct({
          message_id: Schema.optionalKey(Schema.String),
          token_usage: Schema.optionalKey(
            Schema.Struct({
              input_cache_creation: Count,
              input_cache_read: Count,
              input_other: Count,
              output: Count,
            }),
          ),
        }),
      ),
      type: Schema.optionalKey(Schema.String),
    }),
  ),
  timestamp: Count,
});

const decodeWireLine = Schema.decodeUnknownOption(Schema.fromJsonString(WireLine));

const parseKimi: ParseFile = (file) => {
  const session = `kimi:${file.segments.at(-2) ?? ""}`;
  return Option.map(decodeLines(file.text, decodeWireLine), (lines) => {
    // Kimi repeats a StatusUpdate under the same message id as it streams: the last copy wins.
    const byMessage = new Map<string, UsageRecord>();
    for (const [index, line] of lines.entries()) {
      const { payload, type } = line.message ?? {};
      const usage = payload?.token_usage;
      if (type === "StatusUpdate" && usage !== undefined) {
        const seconds = toCount(line.timestamp);
        byMessage.set(payload?.message_id ?? `#${index}`, {
          at: seconds > 0 ? Math.round(seconds * 1000) : file.mtimeMs,
          cacheRead: toCount(usage.input_cache_read),
          cacheWrite: toCount(usage.input_cache_creation),
          input: toCount(usage.input_other),
          model: kimiModel,
          output: toCount(usage.output),
          session,
        });
      }
    }
    return [...byMessage.values()];
  });
};

/**
 * Kimi CLI. Reads `~/.kimi/sessions/<group>/<session>/wire.jsonl`, one session per folder.
 * Each `StatusUpdate` message carries `payload.token_usage`: `input_other`, `output`,
 * `input_cache_read`, `input_cache_creation` map to `input`, `output`, `cacheRead`,
 * `cacheWrite` (Kimi keeps cache out of `input_other`). `at` is the line `timestamp`
 * (epoch seconds). The log names no model, so every record uses `kimi-for-coding`.
 * Kimi Code (`~/.kimi-code`) uses another layout and is not read.
 */
export const readKimi: Reader = (home) =>
  readFiles(
    "Kimi",
    home,
    [".kimi", "sessions"],
    (segments) => segments.length === 3 && segments[2] === "wire.jsonl",
    parseKimi,
  );
