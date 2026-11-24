import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { clineDataFolder } from "./cline";
import { environmentFolder } from "./env";
import { exclusive, readFiles, stemOf, toCount, unknownModel } from "./pi";
import type { ParseFile } from "./pi";
import type { Reader, UsageRecord } from "./types";

const Count = Schema.optionalKey(Schema.Finite);
const Text = Schema.optionalKey(Schema.String);

const MessagesFile = Schema.Struct({
  messages: Schema.Array(
    Schema.Struct({
      id: Text,
      metrics: Schema.optionalKey(
        Schema.Struct({
          cacheReadTokens: Count,
          cacheWriteTokens: Count,
          inputTokens: Count,
          outputTokens: Count,
        }),
      ),
      modelInfo: Schema.optionalKey(Schema.Struct({ id: Text })),
      role: Text,
      ts: Count,
    }),
  ),
  sessionId: Text,
});

const decodeMessagesFile = Schema.decodeUnknownOption(Schema.fromJsonString(MessagesFile));

/** Epoch ms below this are taken as seconds. */
const millisecondsFrom = 1_000_000_000_000;

/**
 * A parser for one run of the reader. A session folder copied under a new name keeps its
 * `sessionId`, so each message is counted once by session id and message id (else position).
 */
const makeParse = (): ParseFile => {
  const seen = new Set<string>();
  return (file) =>
    Option.map(decodeMessagesFile(file.text), (data) => {
      const sessionId = data.sessionId ?? stemOf(file.segments, ".messages.json");
      let model = unknownModel;
      const records: UsageRecord[] = [];
      for (const [index, message] of data.messages.entries()) {
        if (message.role !== "assistant") {
          continue;
        }
        // The model carries over: a message without `modelInfo` ran on the last one named.
        const named = message.modelInfo?.id?.trim() ?? "";
        model = named === "" ? model : named;
        const key = `${sessionId}:${message.id ?? index}`;
        if (message.metrics === undefined || seen.has(key)) {
          continue;
        }
        seen.add(key);
        const { metrics } = message;
        const cacheRead = toCount(metrics.cacheReadTokens);
        const cacheWrite = toCount(metrics.cacheWriteTokens);
        const ts = message.ts ?? 0;
        records.push({
          at: ts <= 0 ? file.mtimeMs : Math.trunc(ts < millisecondsFrom ? ts * 1000 : ts),
          cacheRead,
          cacheWrite,
          input: exclusive(toCount(metrics.inputTokens), cacheRead + cacheWrite),
          model,
          output: toCount(metrics.outputTokens),
          session: `cline-cli:${sessionId}`,
        });
      }
      return records;
    });
};

/**
 * Cline CLI (npm `cline` 3.x) keeps one folder per session:
 * `<sessions>/<id>/<id>.messages.json`. The sessions folder is, in order:
 * `CLINE_SESSION_DATA_DIR`; else `CLINE_DATA_DIR/sessions`; else `CLINE_DIR/data/sessions`;
 * else `~/.cline/data/sessions` (the CLI's own resolution).
 *
 * Mapping, from each `role: "assistant"` message with `metrics`: `session` = `cline-cli:` +
 * `sessionId` (else the file name), `model` = `modelInfo.id` (carried to later messages
 * without one; else unknown), `at` = `ts` (epoch ms), else file time. The CLI counts cache
 * inside `inputTokens` (its own pricing bills input minus cache read and write), so
 * `input` = `inputTokens` - `cacheReadTokens` - `cacheWriteTokens`.
 * The `<id>.json` session summary is not read: its usage totals sum the same messages.
 */
export const readClineCli: Reader = (home) =>
  Effect.gen(function* readFromHome() {
    const path = yield* Path.Path;
    const sessionDir = yield* environmentFolder("CLINE_SESSION_DATA_DIR");
    const folder = Option.isSome(sessionDir)
      ? sessionDir.value
      : path.join(yield* clineDataFolder(home), "sessions");
    return yield* readFiles(
      "Cline CLI",
      folder,
      [],
      (segments) => segments.length === 2 && segments[1] === `${segments[0]}.messages.json`,
      makeParse(),
    );
  });
