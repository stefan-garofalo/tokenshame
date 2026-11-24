import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { readLogFiles } from "./claude";
import { usageResult } from "./folders";
import type { ParseLog } from "./claude";
import { decodeLines, exclusive, stemOf, toCount, unknownModel } from "./pi";
import type { SourceFile } from "./pi";
import type { ReadResult, Reader, UsageRecord } from "./types";

// Shared by the Tencent buddy readers (CodeBuddy, WorkBuddy): one transcript format.

const Count = Schema.optionalKey(Schema.Finite);
const Text = Schema.optionalKey(Schema.String);

/** Usage as the buddy tools log it: Anthropic, OpenAI and DeepSeek field names all occur. */
const BuddyUsage = Schema.Struct({
  cacheCreationInputTokens: Count,
  cacheMissTokens: Count,
  cacheReadInputTokens: Count,
  cacheTokens: Count,
  cache_creation_input_tokens: Count,
  cache_read_input_tokens: Count,
  cachedMissTokens: Count,
  cachedWriteTokens: Count,
  cached_tokens: Count,
  completion_tokens: Count,
  inputTokens: Count,
  input_tokens: Count,
  outputTokens: Count,
  output_tokens: Count,
  prompt_cache_hit_tokens: Count,
  prompt_cache_write_tokens: Count,
  prompt_tokens: Count,
  totalTokens: Count,
  total_tokens: Count,
});

const BuddyLine = Schema.Struct({
  id: Text,
  message: Schema.optionalKey(
    Schema.Struct({ model: Text, usage: Schema.optionalKey(BuddyUsage) }),
  ),
  providerData: Schema.optionalKey(
    Schema.Struct({
      messageId: Text,
      model: Text,
      rawUsage: Schema.optionalKey(BuddyUsage),
      requestModelId: Text,
      traceId: Text,
      usage: Schema.optionalKey(BuddyUsage),
    }),
  ),
  role: Text,
  sessionId: Text,
  status: Text,
  timestamp: Count,
  type: Text,
});

const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));
const decodeBuddyLine = Schema.decodeUnknownOption(BuddyLine);

const firstOf = (values: readonly (number | undefined)[]): number | undefined =>
  values.find((value) => value !== undefined);

/** The first count above zero, else the first present one: some fields are logged as 0. */
const firstPositive = (values: readonly (number | undefined)[]): number | undefined =>
  values.find((value) => value !== undefined && value > 0) ?? firstOf(values);

type Counts = Pick<UsageRecord, "cacheRead" | "cacheWrite" | "input" | "output">;

/**
 * - `cachedMissTokens` (extension style) is input without cache already.
 * - OpenAI and DeepSeek `prompt_tokens` count cache reads inside them.
 * - `input_tokens` counts them inside only when the logged total proves it
 *   (total = input + output); otherwise it is taken as Anthropic style, without cache.
 * Reasoning counts are not added: no source shows they sit outside `output`.
 */
const countsOf = (usage: typeof BuddyUsage.Type): Counts => {
  const cacheRead = toCount(
    firstPositive([
      usage.cache_read_input_tokens,
      usage.cacheReadInputTokens,
      usage.cacheTokens,
      usage.prompt_cache_hit_tokens,
      usage.cached_tokens,
    ]),
  );
  const cacheWrite = toCount(
    firstPositive([
      usage.cache_creation_input_tokens,
      usage.cacheCreationInputTokens,
      usage.cachedWriteTokens,
      usage.prompt_cache_write_tokens,
    ]),
  );
  const output = toCount(
    firstOf([usage.output_tokens, usage.outputTokens, usage.completion_tokens]),
  );
  const missed = firstOf([usage.cachedMissTokens, usage.cacheMissTokens]);
  const named = firstOf([usage.input_tokens, usage.inputTokens]);
  const logged = toCount(named ?? usage.prompt_tokens);
  const total = firstOf([usage.total_tokens, usage.totalTokens]);
  const cacheInside =
    (named === undefined && usage.prompt_tokens !== undefined) ||
    (total !== undefined && toCount(total) === logged + output);
  if (missed !== undefined) {
    return { cacheRead, cacheWrite, input: toCount(missed), output };
  }
  const input = cacheInside ? exclusive(logged, cacheRead + cacheWrite) : logged;
  return { cacheRead, cacheWrite, input, output };
};

/** A usage record and the call id it is de-duplicated on, when the line has one. */
interface BuddyCall {
  readonly key: string | undefined;
  readonly record: UsageRecord;
}

type Line = typeof BuddyLine.Type;

const isCall = (line: Line): boolean =>
  ((line.type === "message" && line.role === "assistant") || line.type === "function_call") &&
  (line.status === undefined || line.status === "completed");

const usageOf = ({ message, providerData }: Line) =>
  message?.usage ?? providerData?.usage ?? providerData?.rawUsage;

const modelOf = ({ message, providerData }: Line): string =>
  providerData?.model ?? providerData?.requestModelId ?? message?.model ?? unknownModel;

/** The call one line logs, if it is a call with usage. */
const callOf = (line: Line, file: SourceFile, sessionPrefix: string): BuddyCall[] => {
  const usage = usageOf(line);
  if (!isCall(line) || usage === undefined) {
    return [];
  }
  const session = `${sessionPrefix}:${line.sessionId ?? stemOf(file.segments, ".jsonl")}`;
  const id = line.providerData?.messageId ?? line.providerData?.traceId ?? line.id;
  const at = line.timestamp !== undefined && line.timestamp > 0 ? line.timestamp : file.mtimeMs;
  return [
    {
      key: id === undefined ? undefined : `${session}:${id}`,
      record: {
        ...countsOf(usage),
        at: Math.trunc(at),
        model: modelOf(line),
        session,
      },
    },
  ];
};

const parseBuddyLog =
  (sessionPrefix: string): ParseLog<BuddyCall> =>
  (file) =>
    Option.map(
      decodeLines(file.text, (text) => Option.map(decodeJson(text), decodeBuddyLine)),
      (lines) => lines.flatMap(Option.toArray).flatMap((line) => callOf(line, file, sessionPrefix)),
    );

const totalOf = ({ input, output, cacheRead, cacheWrite }: UsageRecord): number =>
  input + output + cacheRead + cacheWrite;

/** A call logged more than once (streaming snapshots, copies) keeps its largest snapshot. */
const uniqueCalls = (calls: readonly BuddyCall[]): UsageRecord[] => {
  const byKey = new Map<string, UsageRecord>();
  const records: UsageRecord[] = [];
  for (const { key, record } of calls) {
    if (key === undefined) {
      records.push(record);
    } else {
      const kept = byKey.get(key);
      if (kept === undefined || totalOf(record) >= totalOf(kept)) {
        byKey.set(key, record);
      }
    }
  }
  return [...records, ...byKey.values()];
};

/**
 * Reads the buddy transcripts (`*.jsonl` at any depth) below each of `roots`. Format from
 * tokscale's `tencent_buddy.rs`. A call is a line of `type` `message` with `role` `assistant`,
 * or of `type` `function_call`, whose `status` is absent or `completed`. Mapping:
 * - usage = `message.usage`, else `providerData.usage`, else `providerData.rawUsage`;
 *   counts as in `countsOf`;
 * - `model` = `providerData.model`, else `providerData.requestModelId`, else `message.model`;
 * - `session` = prefix + `sessionId`, else the file name; `at` = `timestamp` (epoch ms), else
 *   the file time.
 * A call is keyed on `providerData.messageId`, else `traceId`, else the line `id`, within its
 * session; repeated lines keep the largest.
 */
export const readBuddyLogs = (
  agent: string,
  sessionPrefix: string,
  roots: readonly string[],
  path: string,
): Effect.Effect<ReadResult, never, FileSystem.FileSystem | Path.Path> =>
  Effect.map(
    readLogFiles(roots, (name) => name.endsWith(".jsonl"), parseBuddyLog(sessionPrefix)),
    ({ failures, items }) => usageResult(agent, path, uniqueCalls(items), failures),
  );

/**
 * CodeBuddy (Tencent) CLI and web UI: `~/.codebuddy/projects/<project>/*.jsonl`, read as in
 * `readBuddyLogs`, with `session` = `codebuddy:` + `sessionId`.
 * The IDE and VS Code extension logs (`[AgentReporter] ... usage: {...}` lines in the editor's
 * log folders) are not read: they mirror one execution into several log files.
 */
export const readCodeBuddy: Reader = (home) =>
  Effect.gen(function* readFromHome() {
    const path = yield* Path.Path;
    const folder = path.join(home, ".codebuddy");
    return yield* readBuddyLogs("CodeBuddy", "codebuddy", [path.join(folder, "projects")], folder);
  });
