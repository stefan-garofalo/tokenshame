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

/** The fields of one Command Code (v3 transcript) line this reader needs. */
const CommandLine = Schema.Struct({
  id: Text,
  message: Schema.optionalKey(
    Schema.Struct({
      meta: Schema.optionalKey(Schema.Struct({ messageId: Text })),
      role: Text,
    }),
  ),
  model: Text,
  timestamp: Text,
  type: Text,
  usage: Schema.optionalKey(
    Schema.Struct({
      cacheReadTokens: Count,
      cacheWriteTokens: Count,
      inputTokens: Count,
      outputTokens: Count,
    }),
  ),
});

const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));
const decodeCommandLine = Schema.decodeUnknownOption(CommandLine);

interface CommandCall {
  readonly key: string | undefined;
  readonly record: UsageRecord;
}

const parseCommandLog: ParseLog<CommandCall> = (file) =>
  Option.map(
    decodeLines(file.text, (text) => Option.map(decodeJson(text), decodeCommandLine)),
    (lines) => {
      let session = stemOf(file.segments, ".jsonl");
      let model: string | undefined;
      const calls: CommandCall[] = [];
      for (const line of lines.flatMap(Option.toArray)) {
        if (line.type === "session" && line.id !== undefined) {
          session = line.id;
        }
        // A message names the model of its call; a `model_change` line, the model from then on.
        model = line.model ?? model;
        const { usage } = line;
        if (line.type !== "message" || line.message?.role !== "assistant" || usage === undefined) {
          continue;
        }
        // `id` is unique only within one file; `meta.messageId` survives `/fork` copies.
        const messageId = line.message.meta?.messageId;
        const lineKey = line.id === undefined ? undefined : `${line.id}:${line.timestamp ?? ""}`;
        calls.push({
          key: messageId ?? lineKey,
          record: {
            at: toEpochMs(line.timestamp, file.mtimeMs),
            cacheRead: toCount(usage.cacheReadTokens),
            cacheWrite: toCount(usage.cacheWriteTokens),
            input: toCount(usage.inputTokens),
            model: model ?? unknownModel,
            output: toCount(usage.outputTokens),
            session: `commandcode:${session}`,
          },
        });
      }
      return calls;
    },
  );

/** A call copied into a forked session counts once, in the first file read. */
const uniqueCalls = (calls: readonly CommandCall[]): UsageRecord[] => {
  const seen = new Set<string>();
  return calls.flatMap(({ key, record }) => {
    if (key !== undefined) {
      if (seen.has(key)) {
        return [];
      }
      seen.add(key);
    }
    return [record];
  });
};

/**
 * Command Code keeps one transcript per session, `~/.commandcode/projects/<project>/<id>.jsonl`
 * (format from tokscale's `commandcode.rs` and codeburn's `command-code.ts`). The sidecars
 * `<id>.checkpoints.jsonl` and `<id>.prompts.jsonl` are not read.
 *
 * Mapping, from `type: "message"` lines with `message.role` `assistant` and a `usage` block:
 * `input` = `usage.inputTokens`, `output` = `outputTokens`, `cacheRead` = `cacheReadTokens`,
 * `cacheWrite` = `cacheWriteTokens`. The buckets do not overlap: tokscale checked that the
 * logged `costUsd` comes out exact only with the full `inputTokens` at the input rate plus
 * the cache buckets (codeburn subtracts cache reads from input instead). `model` = the line's
 * `model`, else the last `model_change`; `session` = `commandcode:` + the `session` header id,
 * else the file name; `at` = `timestamp`. Entries a `/rewind` left off the active branch still
 * count: they were real calls. A call is keyed on `message.meta.messageId`, else `id` +
 * `timestamp`.
 */
export const readCommandCode: Reader = (home) =>
  Effect.gen(function* readFromHome() {
    const path = yield* Path.Path;
    const folder = path.join(home, ".commandcode");
    const { failures, items } = yield* readLogFiles(
      [path.join(folder, "projects")],
      (name) => /^[^.]+\.jsonl$/u.test(name),
      parseCommandLog,
    );
    return usageResult("Command Code", folder, uniqueCalls(items), failures);
  });
