import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { environmentFolder } from "./env";
import { readFolders } from "./folders";
import { NullableCount, NullableText, countOf, timeOf } from "./json-tools";
import { exclusive, unknownModel } from "./pi";
import type { ParseFile } from "./pi";
import type { Reader, UsageRecord } from "./types";

const Usage = Schema.Struct({
  cacheCreationInputTokens: NullableCount,
  cacheCreationTokens: NullableCount,
  cacheReadInputTokens: NullableCount,
  cache_creation_input_tokens: NullableCount,
  cache_creation_tokens: NullableCount,
  cache_read_input_tokens: NullableCount,
  completionTokens: NullableCount,
  completion_tokens: NullableCount,
  inputTokens: NullableCount,
  input_tokens: NullableCount,
  model: NullableText,
  outputTokens: NullableCount,
  output_tokens: NullableCount,
  promptTokens: NullableCount,
  promptTokensDetails: Schema.optionalKey(
    Schema.NullOr(Schema.Struct({ cachedTokens: NullableCount })),
  ),
  prompt_tokens: NullableCount,
  prompt_tokens_details: Schema.optionalKey(
    Schema.NullOr(Schema.Struct({ cached_tokens: NullableCount })),
  ),
});

const OptionalUsage = Schema.optionalKey(Schema.NullOr(Usage));
const Time = Schema.optionalKey(Schema.NullOr(Schema.Union([Schema.String, Schema.Finite])));

const HistoryEntry = Schema.Struct({
  providerOptions: Schema.optionalKey(
    Schema.NullOr(
      Schema.Struct({
        codebuff: Schema.optionalKey(
          Schema.NullOr(Schema.Struct({ model: NullableText, usage: OptionalUsage })),
        ),
        usage: OptionalUsage,
      }),
    ),
  ),
  role: NullableText,
});

const ChatMessage = Schema.Struct({
  createdAt: Time,
  id: NullableText,
  metadata: Schema.optionalKey(
    Schema.NullOr(
      Schema.Struct({
        codebuff: Schema.optionalKey(
          Schema.NullOr(Schema.Struct({ model: NullableText, usage: OptionalUsage })),
        ),
        model: NullableText,
        modelId: NullableText,
        runState: Schema.optionalKey(
          Schema.NullOr(
            Schema.Struct({
              sessionState: Schema.optionalKey(
                Schema.NullOr(
                  Schema.Struct({
                    mainAgentState: Schema.optionalKey(
                      Schema.NullOr(
                        Schema.Struct({
                          messageHistory: Schema.optionalKey(
                            Schema.NullOr(Schema.Array(Schema.Unknown)),
                          ),
                        }),
                      ),
                    ),
                  }),
                ),
              ),
            }),
          ),
        ),
        timestamp: Time,
        usage: OptionalUsage,
      }),
    ),
  ),
  role: NullableText,
  timestamp: Time,
  variant: NullableText,
});

const decodeChat = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Array(Schema.Unknown)));
const decodeMessage = Schema.decodeUnknownOption(ChatMessage);
const decodeHistoryEntry = Schema.decodeUnknownOption(HistoryEntry);

interface Counts {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
}

/** The first positive count, as Codebuff's different upstreams name the same count differently. */
const firstCount = (...values: readonly (number | null | undefined)[]): number =>
  values.map(countOf).find((value) => value > 0) ?? 0;

const noCounts: Counts = { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 };

const countsOf = (usage: typeof Usage.Type | null | undefined): Counts => {
  if (usage === null || usage === undefined) {
    return noCounts;
  }
  const input = firstCount(
    usage.inputTokens,
    usage.input_tokens,
    usage.promptTokens,
    usage.prompt_tokens,
  );
  const cacheRead = firstCount(usage.cacheReadInputTokens, usage.cache_read_input_tokens);
  // OpenAI-style usage counts cached tokens inside the prompt count, as a detail of it.
  const cachedDetail = firstCount(
    usage.promptTokensDetails?.cachedTokens,
    usage.prompt_tokens_details?.cached_tokens,
  );
  return {
    cacheRead: cacheRead > 0 ? cacheRead : cachedDetail,
    cacheWrite: firstCount(
      usage.cacheCreationInputTokens,
      usage.cache_creation_input_tokens,
      usage.cacheCreationTokens,
      usage.cache_creation_tokens,
    ),
    input: cacheRead > 0 ? input : exclusive(input, cachedDetail),
    output: firstCount(
      usage.outputTokens,
      usage.output_tokens,
      usage.completionTokens,
      usage.completion_tokens,
    ),
  };
};

const hasCounts = (counts: Counts): boolean =>
  counts.input + counts.output + counts.cacheRead + counts.cacheWrite > 0;

/** Usage of one model call, with the model when the log names it. */
interface CallUsage {
  readonly counts: Counts;
  readonly model: string | undefined;
}

/** Usage and model of the last assistant entry with usage in the stashed run state. */
const historyUsage = (history: readonly unknown[]): CallUsage => {
  for (const raw of history.toReversed()) {
    const entry = Option.getOrUndefined(decodeHistoryEntry(raw));
    const options = entry?.providerOptions;
    if (entry?.role === "assistant" && options !== null && options !== undefined) {
      const counts = countsOf(options.usage ?? options.codebuff?.usage);
      if (hasCounts(counts)) {
        return { counts, model: options.codebuff?.model ?? undefined };
      }
    }
  }
  return { counts: noCounts, model: undefined };
};

/** The chat id is the chat's start time with `:` written as `-`: `2025-12-14T10-00-00.000Z`. */
const chatTime = (chatId: string, fallbackMs: number): number =>
  timeOf(
    chatId.replace(
      /^(?<hour>\d{4}-\d{2}-\d{2}T\d{2})-(?<minute>\d{2})-(?<second>\d{2})/u,
      "$<hour>:$<minute>:$<second>",
    ),
    fallbackMs,
  );

const assistantVariants = new Set(["ai", "agent", "assistant"]);

type Metadata = NonNullable<(typeof ChatMessage.Type)["metadata"]>;

/** The message's own usage, else the usage stashed in its run state. */
const callUsage = (meta: Metadata): CallUsage => {
  const direct = countsOf(meta.usage ?? meta.codebuff?.usage);
  const stashed = historyUsage(meta.runState?.sessionState?.mainAgentState?.messageHistory ?? []);
  const model = meta.model ?? meta.modelId ?? meta.codebuff?.model ?? meta.usage?.model;
  return {
    counts: hasCounts(direct) ? direct : stashed.counts,
    model: model ?? stashed.model,
  };
};

const toRecord = (
  message: typeof ChatMessage.Type,
  session: string,
  fallbackMs: number,
): UsageRecord | undefined => {
  const variant = message.variant ?? message.role ?? "";
  const meta = message.metadata;
  if (!assistantVariants.has(variant) || meta === null || meta === undefined) {
    return undefined;
  }
  const call = callUsage(meta);
  if (!hasCounts(call.counts)) {
    return undefined;
  }
  return {
    at: timeOf(message.timestamp ?? message.createdAt ?? meta.timestamp, fallbackMs),
    ...call.counts,
    model: call.model ?? unknownModel,
    session,
  };
};

// File segments below `projects`: `<project>/chats/<chatId>/chat-messages.json`.
const parseCodebuff: ParseFile = (file) => {
  const [project = "", , chatId = ""] = file.segments;
  const session = `codebuff:${project}/${chatId}`;
  const fallbackMs = chatTime(chatId, file.mtimeMs);
  return Option.map(decodeChat(file.text), (messages) => {
    const seen = new Set<string>();
    return messages.flatMap((raw) => {
      const message = Option.getOrUndefined(decodeMessage(raw));
      const record = message === undefined ? undefined : toRecord(message, session, fallbackMs);
      const id = message?.id ?? undefined;
      if (record === undefined || (id !== undefined && seen.has(id))) {
        return [];
      }
      if (id !== undefined) {
        seen.add(id);
      }
      return [record];
    });
  });
};

/**
 * Codebuff (formerly Manicode). Reads `<root>/projects/<project>/chats/<chatId>/chat-messages.json`,
 * one session per chat. The roots are `~/.config/manicode`, `~/.config/manicode-dev` and
 * `~/.config/manicode-staging` (the release channels, the same on every platform), or only
 * `CODEBUFF_DATA_DIR` when it is set. Freebuff writes the same files but logs no token counts,
 * so its chats give no records.
 *
 * Mapping, per assistant message (`variant` or `role` of `ai`, `agent`, `assistant`): usage is
 * `metadata.usage`, else `metadata.codebuff.usage`, else the last assistant entry with usage
 * in `metadata.runState.sessionState.mainAgentState.messageHistory[].providerOptions`
 * (`usage` or `codebuff.usage`). Each usage field has camelCase and snake_case names:
 * `inputTokens`/`promptTokens` = `input`, `outputTokens`/`completionTokens` = `output`,
 * `cacheReadInputTokens` = `cacheRead`, `cacheCreationInputTokens` = `cacheWrite`. When the
 * cache read is only given as `promptTokensDetails.cachedTokens` (OpenAI style), it is part
 * of the prompt count, so `input` = prompt - cached. `credits` are ignored. `model` =
 * `metadata.model`, `modelId`, `codebuff.model`, then the usage or history model. `at` = the
 * message `timestamp`, `createdAt` or `metadata.timestamp`, else the chat id time, else the
 * file time. A message id repeated in one chat counts once.
 */
export const readCodebuff: Reader = (home) =>
  Effect.gen(function* readFromHome() {
    const path = yield* Path.Path;
    const dataDir = yield* environmentFolder("CODEBUFF_DATA_DIR");
    const channel = (name: string) => path.join(home, ".config", name, "projects");
    return yield* readFolders(
      "Codebuff",
      Option.match(dataDir, {
        onNone: () => [channel("manicode"), channel("manicode-dev"), channel("manicode-staging")],
        onSome: (dir) => [path.join(dir, "projects")],
      }),
      (segments) =>
        segments.length === 4 && segments[1] === "chats" && segments[3] === "chat-messages.json",
      parseCodebuff,
    );
  });
