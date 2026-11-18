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

const decodeLogLine = Schema.decodeUnknownOption(Schema.fromJsonString(LogLine));

/** A usage record from the logs; `key` is set when the line has a message id to de-duplicate on. */
interface LoggedMessage {
  readonly key: string | undefined;
  readonly record: UsageRecord;
}

const hasTokens = ({ input, output, cacheRead, cacheWrite }: UsageRecord): boolean =>
  input + output + cacheRead + cacheWrite > 0;

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
          // Newer Claude Code versions write no requestId, so the message id alone is the key.
          const key = message.id === undefined ? undefined : `${message.id}:${requestId ?? ""}`;
          return [{ key, record }];
        },
      }),
    );

/**
 * Keep one line per message. Claude Code writes a line for each content block of a message, and
 * the counts grow while it streams, so the last line of a `message.id` (+ `requestId`) is the
 * final one. Lines with no message id always count.
 */
const uniqueRecords = (messages: readonly LoggedMessage[]): UsageRecord[] => {
  const byKey = new Map<string, UsageRecord>();
  const records: UsageRecord[] = [];
  for (const { key, record } of messages) {
    if (key === undefined) {
      records.push(record);
    } else {
      byKey.set(key, record);
    }
  }
  return [...records, ...byKey.values()];
};

const message = (error: PlatformError): string => error.message;

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
 * Claude Code usage: the usage lines of the jsonl files under `~/.claude/projects`.
 * Claude Code keeps 30 days of logs by default, the same window the Usage Summary covers.
 *
 * A bad file is skipped, not fatal. The source is `Skipped` only when no usage is
 * left: `unreadable` if something failed to read, else `no-data`.
 */
export const readClaude: Reader = (home) =>
  Effect.gen(function* readClaudeUsage() {
    const path = yield* Path.Path;
    const claudeDir = path.join(home, ".claude");

    const logsResult = yield* Effect.result(readLogs(path.join(claudeDir, "projects")));
    const logs = Result.isSuccess(logsResult) ? logsResult.success : { failures: [], messages: [] };

    const records = uniqueRecords(logs.messages);
    const failures = [
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
