import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { environmentFolder } from "./env";
import { readFiles, stemOf, toCount, toEpochMs, unknownModel } from "./pi";
import type { ParseFile } from "./pi";
import type { ReadResult, Reader } from "./types";

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
 * Amp. Reads thread files `<data folder>/threads/T-*.json`, one session per thread. The data
 * folder is each folder of `AMP_DATA_DIR` (comma-separated) when set, else
 * `$XDG_DATA_HOME/amp`, else `~/.local/share/amp`.
 * Each assistant message with `usage` gives `model`, `inputTokens`, `outputTokens`,
 * `cacheReadInputTokens`, `cacheCreationInputTokens` (Amp keeps cache out of `inputTokens`);
 * `at` is `usage.timestamp`, else the thread `created` time (epoch ms), else the file time.
 * A thread with no message usage falls back to `usageLedger.events` (`tokens.input`, `output`,
 * `cacheReadInputTokens`, `cacheCreationInputTokens`). Amp keeps threads on the server;
 * only threads a local Amp client wrote or cached exist here, so a missing folder is normal.
 */
export const readAmp: Reader = (home) =>
  Effect.gen(function* readFromHome() {
    const path = yield* Path.Path;
    const listed = yield* environmentFolder("AMP_DATA_DIR");
    const dataHome = yield* environmentFolder("XDG_DATA_HOME");
    const folders = Option.match(listed, {
      onNone: () => [
        Option.match(dataHome, {
          onNone: () => path.join(home, ".local", "share", "amp"),
          onSome: (data) => path.join(data, "amp"),
        }),
      ],
      onSome: (list) =>
        list
          .split(",")
          .map((folder) => folder.trim())
          .filter((folder) => folder !== ""),
    });
    // oxlint-disable-next-line unicorn/no-array-for-each, unicorn/no-array-method-this-argument
    const results = yield* Effect.forEach(new Set(folders), (folder) =>
      readFiles(
        "Amp",
        folder,
        ["threads"],
        (segments) => segments.length === 1 && segments[0]?.endsWith(".json") === true,
        parseAmp,
      ),
    );
    const records = results.flatMap((result) => (result._tag === "Read" ? result.records : []));
    if (records.length > 0) {
      return { _tag: "Read", records } satisfies ReadResult;
    }
    return (
      results.find((result) => result._tag === "Skipped" && result.reason === "unreadable") ??
      results[0] ?? { _tag: "Skipped", agent: "Amp", detail: "", path: home, reason: "no-data" }
    );
  });
