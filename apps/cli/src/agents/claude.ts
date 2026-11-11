import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import type { PlatformError } from "effect/PlatformError";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import type { ReadResult, Reader, SkippedSource, UsageRecord } from "./types";

const agent = "Claude Code";
const fileReadConcurrency = 8;

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

/** A calendar day as `YYYY-MM-DD`; days that do not exist are rejected. */
const Day = Schema.String.check(
  Schema.isPattern(/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/u),
  Schema.makeFilter((day) => new Date(`${day}T00:00:00Z`).toISOString().startsWith(day)),
);

/** Only the fields of `~/.claude/stats-cache.json` this reader needs. */
const StatsCache = Schema.Struct({
  dailyActivity: Schema.Array(Schema.Struct({ date: Day, sessionCount: Count })).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed([])),
  ),
  hourCounts: Schema.Record(
    Schema.String.check(Schema.isPattern(/^(?:\d|1\d|2[0-3])$/u)),
    Count,
  ).pipe(Schema.withDecodingDefaultKey(Effect.succeed({}))),
  lastComputedDate: Day,
  modelUsage: Schema.Record(
    Schema.String,
    Schema.Struct({
      cacheCreationInputTokens: Count,
      cacheReadInputTokens: Count,
      inputTokens: Count,
      outputTokens: Count,
    }),
  ),
});
type Cache = typeof StatsCache.Type;

/**
 * The fields of one jsonl log line this reader needs. Lines of other types
 * (prompts, tool results) fail to decode and are skipped.
 */
const LogLine = Schema.Struct({
  message: Schema.Struct({
    id: Schema.optionalKey(Schema.String),
    model: Schema.String,
    usage: Schema.Struct({
      cache_creation_input_tokens: Schema.optionalKey(Count),
      cache_read_input_tokens: Schema.optionalKey(Count),
      input_tokens: Count,
      output_tokens: Count,
    }),
  }),
  requestId: Schema.optionalKey(Schema.String),
  sessionId: Schema.optionalKey(Schema.String),
  timestamp: Schema.String,
});

const decodeCache = Schema.decodeUnknownOption(Schema.fromJsonString(StatsCache));
const decodeLogLine = Schema.decodeUnknownOption(Schema.fromJsonString(LogLine));

/** A usage record from the logs; `key` is set when the line can be de-duplicated. */
interface LoggedMessage {
  readonly key: string | undefined;
  readonly record: UsageRecord;
}

const hasTokens = ({ input, output, cacheRead, cacheWrite }: UsageRecord): boolean =>
  input + output + cacheRead + cacheWrite > 0;

/** Epoch ms of `HH:30` local time on a `YYYY-MM-DD` day. Cache days are local days. */
const localAt = (day: string, hour: number): number =>
  new Date(`${day}T${String(hour).padStart(2, "0")}:30:00`).getTime();

/** Epoch ms where the local day after `day` starts. */
const startOfNextDay = (day: string): number => {
  const next = new Date(`${day}T00:00:00`);
  next.setDate(next.getDate() + 1);
  return next.getTime();
};

/** Split `total` in proportion to `weights`; the parts always sum to `total`. */
const split = (total: number, weights: readonly number[]): number[] => {
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
  const parts = weights.map((weight) => Math.floor(total * (weight / weightSum)));
  const heaviest = weights.indexOf(Math.max(...weights));
  parts[heaviest] = (parts[heaviest] ?? 0) + total - parts.reduce((sum, part) => sum + part, 0);
  return parts;
};

/**
 * The cache stores totals, not events, so this makes synthetic records that
 * keep the Usage Summary honest:
 * - Tokens of each model are split over the hours of `hourCounts` in
 *   proportion to their counts, so the busiest hour is weighted by tokens.
 *   They sit on `lastComputedDate`, the newest day the cache covers.
 * - Sessions are spread over `dailyActivity` by `sessionCount`: one
 *   zero-token record per session at noon of its day. That keeps the session
 *   count and the first day right. The token records reuse the first of
 *   these session keys, so they add no session.
 */
const cacheRecords = (cache: Cache): UsageRecord[] => {
  const models = Object.entries(cache.modelUsage);
  const firstModel = models[0]?.[0];
  if (firstModel === undefined) {
    return [];
  }

  const busyHours = Object.entries(cache.hourCounts).filter(([, count]) => count > 0);
  const hours = busyHours.length > 0 ? busyHours.map(([hour]) => Number(hour)) : [12];
  const weights = busyHours.length > 0 ? busyHours.map(([, count]) => count) : [1];

  const sessions = cache.dailyActivity.flatMap(({ date, sessionCount }) =>
    Array.from({ length: sessionCount }, (_, index): UsageRecord => ({
      at: localAt(date, 12),
      cacheRead: 0,
      cacheWrite: 0,
      input: 0,
      model: firstModel,
      output: 0,
      session: `claude:cache:${date}:${index}`,
    })),
  );

  // The token records join the first cached session, so they add no session of their own.
  const tokenSession = sessions[0]?.session ?? "claude:cache";

  const tokens = models.flatMap(([model, usage]) => {
    const cacheReads = split(usage.cacheReadInputTokens, weights);
    const cacheWrites = split(usage.cacheCreationInputTokens, weights);
    const inputs = split(usage.inputTokens, weights);
    const outputs = split(usage.outputTokens, weights);
    return hours
      .map((hour, index): UsageRecord => ({
        at: localAt(cache.lastComputedDate, hour),
        cacheRead: cacheReads[index] ?? 0,
        cacheWrite: cacheWrites[index] ?? 0,
        input: inputs[index] ?? 0,
        model,
        output: outputs[index] ?? 0,
        session: tokenSession,
      }))
      .filter(hasTokens);
  });

  return [...tokens, ...sessions];
};

const parseLog = (text: string, fileSession: string): LoggedMessage[] =>
  text
    .split("\n")
    // Cheap filter first: only lines that can hold usage are parsed.
    .filter((line) => line.includes('"usage"'))
    .flatMap((line) =>
      Option.match(decodeLogLine(line), {
        onNone: () => [],
        onSome: ({ message, requestId, sessionId, timestamp }): LoggedMessage[] => {
          const record: UsageRecord = {
            at: Date.parse(timestamp),
            cacheRead: message.usage.cache_read_input_tokens ?? 0,
            cacheWrite: message.usage.cache_creation_input_tokens ?? 0,
            input: message.usage.input_tokens,
            model: message.model,
            output: message.usage.output_tokens,
            session: `claude:${sessionId ?? fileSession}`,
          };
          if (Number.isNaN(record.at) || !hasTokens(record)) {
            return [];
          }
          const key =
            message.id !== undefined && requestId !== undefined
              ? `${message.id}:${requestId}`
              : undefined;
          return [{ key, record }];
        },
      }),
    );

/** Keep the first line of each `message.id` + `requestId`; lines with no such pair always count. */
const uniqueRecords = (messages: readonly LoggedMessage[]): UsageRecord[] => {
  const seen = new Set<string>();
  const records: UsageRecord[] = [];
  for (const { key, record } of messages) {
    if (key !== undefined) {
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
    }
    records.push(record);
  }
  return records;
};

const message = (error: PlatformError): string => error.message;

/** `none` when the file is missing. Fails with a cause when it exists but is not a stats cache. */
const readCache = (cachePath: string) =>
  Effect.gen(function* readCacheFile() {
    const fs = yield* FileSystem.FileSystem;
    if (!(yield* fs.exists(cachePath).pipe(Effect.mapError(message)))) {
      return Option.none<Cache>();
    }
    const text = yield* fs.readFileString(cachePath).pipe(Effect.mapError(message));
    return yield* Option.match(decodeCache(text), {
      onNone: () => Effect.fail("stats-cache.json is not a valid stats cache"),
      onSome: Effect.succeedSome,
    });
  });

/** The logged messages of every jsonl file in file name order, and a cause for each unreadable file. */
const readLogs = (projectsDir: string) =>
  Effect.gen(function* readLogFiles() {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    if (!(yield* fs.exists(projectsDir).pipe(Effect.mapError(message)))) {
      return { failures: [], messages: [] };
    }
    const names = yield* fs
      .readDirectory(projectsDir, { recursive: true })
      .pipe(Effect.mapError(message));
    const [passes, failures] = yield* Effect.partition(
      names.filter((name) => name.endsWith(".jsonl")).toSorted(),
      (name) =>
        fs.readFileString(path.join(projectsDir, name)).pipe(
          Effect.mapError(message),
          Effect.map((text) => parseLog(text, path.basename(name, ".jsonl"))),
        ),
      { concurrency: fileReadConcurrency },
    );
    return { failures, messages: passes.flat() };
  });

const skipped = (path: string, reason: SkippedSource["reason"], detail: string): SkippedSource => ({
  _tag: "Skipped",
  agent,
  detail,
  path,
  reason,
});

/**
 * Claude Code usage: the all-time totals of `~/.claude/stats-cache.json` up to
 * its `lastComputedDate` (that day included), plus the usage in
 * the jsonl files under `~/.claude/projects` on later local days. Claude Code deletes old
 * logs, so the cache holds the older history; the day after the cache is where
 * the logs take over, so no day is counted twice.
 *
 * A bad cache or file is skipped, not fatal. The source is `Skipped` only when
 * no usage is left: `unreadable` if something failed to read, else `no-data`.
 */
export const readClaude: Reader = (home) =>
  Effect.gen(function* readClaudeUsage() {
    const path = yield* Path.Path;
    const claudeDir = path.join(home, ".claude");

    const cacheResult = yield* Effect.result(readCache(path.join(claudeDir, "stats-cache.json")));
    const cache = Result.isSuccess(cacheResult) ? cacheResult.success : Option.none<Cache>();
    const cutoff = Option.match(cache, {
      onNone: () => Number.NEGATIVE_INFINITY,
      onSome: ({ lastComputedDate }) => startOfNextDay(lastComputedDate),
    });

    const logsResult = yield* Effect.result(readLogs(path.join(claudeDir, "projects")));
    const logs = Result.isSuccess(logsResult) ? logsResult.success : { failures: [], messages: [] };

    const records = [
      ...Option.match(cache, { onNone: () => [], onSome: cacheRecords }),
      ...uniqueRecords(logs.messages).filter(({ at }) => at >= cutoff),
    ];
    const failures = [
      ...(Result.isFailure(cacheResult) ? [cacheResult.failure] : []),
      ...(Result.isFailure(logsResult) ? [logsResult.failure] : []),
      ...logs.failures,
    ];

    if (records.length > 0) {
      return { _tag: "Read", records } satisfies ReadResult;
    }
    const [firstFailure] = failures;
    return firstFailure === undefined
      ? skipped(claudeDir, "no-data", "")
      : skipped(claudeDir, "unreadable", firstFailure);
  });
