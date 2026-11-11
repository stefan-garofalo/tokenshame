import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { readFiles, stemOf, toCount, toEpochMs, unknownModel } from "./pi";
import type { ParseFile } from "./pi";
import type { Reader } from "./types";

const Count = Schema.optionalKey(Schema.Finite);
const Text = Schema.optionalKey(Schema.String);

const AmpThread = Schema.Struct({
  created: Count,
  messages: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        role: Text,
        usage: Schema.optionalKey(
          Schema.Struct({
            cacheCreationInputTokens: Count,
            cacheReadInputTokens: Count,
            inputTokens: Count,
            model: Text,
            outputTokens: Count,
            timestamp: Text,
          }),
        ),
      }),
    ),
  ),
  usageLedger: Schema.optionalKey(
    Schema.Struct({
      events: Schema.optionalKey(
        Schema.Array(
          Schema.Struct({
            model: Text,
            timestamp: Text,
            tokens: Schema.optionalKey(
              Schema.Struct({
                cacheCreationInputTokens: Count,
                cacheReadInputTokens: Count,
                input: Count,
                output: Count,
              }),
            ),
          }),
        ),
      ),
    }),
  ),
});

const decodeThread = Schema.decodeUnknownOption(Schema.fromJsonString(AmpThread));

const parseAmp: ParseFile = (file) => {
  const session = `amp:${stemOf(file.segments, ".json")}`;
  return Option.map(decodeThread(file.text), (thread) => {
    const created = toCount(thread.created);
    const createdMs = created > 0 ? created : file.mtimeMs;
    const fromMessages = (thread.messages ?? []).flatMap((message) => {
      const { usage } = message;
      if (message.role !== "assistant" || usage === undefined) {
        return [];
      }
      return [
        {
          at: toEpochMs(usage.timestamp, createdMs),
          cacheRead: toCount(usage.cacheReadInputTokens),
          cacheWrite: toCount(usage.cacheCreationInputTokens),
          input: toCount(usage.inputTokens),
          model: usage.model ?? unknownModel,
          output: toCount(usage.outputTokens),
          session,
        },
      ];
    });
    // The ledger repeats what the messages carry, so it only stands in when no message has usage.
    if (fromMessages.length > 0) {
      return fromMessages;
    }
    return (thread.usageLedger?.events ?? []).map((event) => ({
      at: toEpochMs(event.timestamp, createdMs),
      cacheRead: toCount(event.tokens?.cacheReadInputTokens),
      cacheWrite: toCount(event.tokens?.cacheCreationInputTokens),
      input: toCount(event.tokens?.input),
      model: event.model ?? unknownModel,
      output: toCount(event.tokens?.output),
      session,
    }));
  });
};

/**
 * Amp. Reads thread files `~/.local/share/amp/threads/T-*.json`, one session per thread.
 * Each assistant message with `usage` gives `model`, `inputTokens`, `outputTokens`,
 * `cacheReadInputTokens`, `cacheCreationInputTokens` (Amp keeps cache out of `inputTokens`);
 * `at` is `usage.timestamp`, else the thread `created` time (epoch ms), else the file time.
 * A thread with no message usage falls back to `usageLedger.events` (`tokens.input`, `output`,
 * `cacheReadInputTokens`, `cacheCreationInputTokens`). Amp keeps threads on the server;
 * only threads a local Amp client wrote or cached exist here, so a missing folder is normal.
 */
export const readAmp: Reader = (home) =>
  readFiles(
    "Amp",
    home,
    [".local", "share", "amp", "threads"],
    (segments) => segments.length === 1 && segments[0]?.endsWith(".json") === true,
    parseAmp,
  );
