import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import type { Reader, SkippedSource, UsageRecord } from "./types";

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

/** The cumulative counts Codex keeps per session. `input_tokens` already holds the cached part. */
const TotalUsage = Schema.Struct({
  cache_write_input_tokens: Schema.optionalKey(Count),
  cached_input_tokens: Schema.optionalKey(Count),
  input_tokens: Count,
  output_tokens: Count,
});

/** The few fields of one rollout line the reader needs. Prompt and tool text are never decoded. */
const Line = Schema.Struct({
  payload: Schema.optionalKey(
    Schema.Struct({
      // `null` until Codex has a first total; such events are skipped.
      info: Schema.optionalKey(Schema.NullOr(Schema.Struct({ total_token_usage: TotalUsage }))),
      model: Schema.optionalKey(Schema.String),
      timestamp: Schema.optionalKey(Schema.String),
      type: Schema.optionalKey(Schema.String),
    }),
  ),
  timestamp: Schema.optionalKey(Schema.String),
  type: Schema.String,
});

const decodeLine = Schema.decodeUnknownOption(Schema.fromJsonString(Line));

/** What one session file holds so far. `usage` is the latest total: Codex totals only grow. */
interface Scan {
  readonly at: number | undefined;
  readonly model: string | undefined;
  readonly usage: typeof TotalUsage.Type | undefined;
}

const emptyScan: Scan = { at: undefined, model: undefined, usage: undefined };

/** Model id for a session whose file never logged one. The server maps it to "other". */
const unknownModel = "unknown";

const parseTime = (iso: string | undefined): number | undefined => {
  const ms = Date.parse(iso ?? "");
  return Number.isNaN(ms) ? undefined : ms;
};

const scanLine = (scan: Scan, text: string): Scan => {
  const line = decodeLine(text);
  if (Option.isNone(line)) {
    return scan;
  }
  const { payload, timestamp, type } = line.value;
  const hasModel = type === "turn_context" || type === "session_meta";
  return {
    at:
      scan.at ?? parseTime(type === "session_meta" ? (payload?.timestamp ?? timestamp) : timestamp),
    model: hasModel ? (payload?.model ?? scan.model) : scan.model,
    usage:
      payload?.type === "token_count"
        ? (payload.info?.total_token_usage ?? scan.usage)
        : scan.usage,
  };
};

/**
 * Codex counts `input_tokens` including the cached part, so the uncached input
 * is `input_tokens - cached_input_tokens` and `cacheRead` is the cached part.
 * `cache_write_input_tokens` is treated the same way (a part of `input_tokens`),
 * so `input + cacheRead + cacheWrite` equals `input_tokens` and the total of the
 * four counts stays Codex's own `total_tokens`.
 *
 * A session is one record: its last total, under the last model it logged, at
 * the time the session started.
 */
const toRecord = (session: string, { at, model, usage }: Scan): UsageRecord | undefined => {
  if (usage === undefined || at === undefined) {
    return undefined;
  }
  const cacheRead = usage.cached_input_tokens ?? 0;
  const cacheWrite = usage.cache_write_input_tokens ?? 0;
  return {
    at,
    cacheRead,
    cacheWrite,
    input: Math.max(0, usage.input_tokens - cacheRead - cacheWrite),
    model: model ?? unknownModel,
    output: usage.output_tokens,
    session,
  };
};

const rolloutFile = /^rollout-.*\.jsonl$/u;

/**
 * Reads `~/.codex/sessions/**\/rollout-*.jsonl`. Each file keeps cumulative
 * `token_count` totals, so only its last non-null total counts. Lines that
 * fail to parse are skipped.
 */
export const readCodex: Reader = Effect.fn("readCodex")(function* readSessions(home: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = path.join(home, ".codex", "sessions");
  const skipped = (reason: SkippedSource["reason"], detail: string): SkippedSource => ({
    _tag: "Skipped",
    agent: "Codex",
    detail,
    path: root,
    reason,
  });

  const listed = yield* Effect.result(fs.readDirectory(root, { recursive: true }));
  if (Result.isFailure(listed)) {
    return listed.failure.reason._tag === "NotFound"
      ? skipped("no-data", "")
      : skipped("unreadable", listed.failure.message);
  }

  const files = listed.success.filter((file) => rolloutFile.test(path.basename(file))).toSorted();
  const readSession = (file: string) => {
    const session = `codex:${path.basename(file, ".jsonl").replace(/^rollout-/u, "")}`;
    return fs.stream(path.join(root, file)).pipe(
      Stream.decodeText(),
      Stream.splitLines,
      Stream.runFold(() => emptyScan, scanLine),
      Effect.map((scan) => toRecord(session, scan)),
      Effect.result,
    );
  };
  // The unicorn rules mistake `Effect.forEach` for `Array#forEach`.
  // oxlint-disable-next-line unicorn/no-array-for-each, unicorn/no-array-method-this-argument
  const results = yield* Effect.forEach(files, readSession);

  const records = results.flatMap((result) => {
    const record = Result.getOrUndefined(result);
    return record === undefined ? [] : [record];
  });
  if (records.length > 0) {
    return { _tag: "Read", records };
  }
  const failed = results.find(Result.isFailure);
  return failed === undefined
    ? skipped("no-data", "")
    : skipped("unreadable", failed.failure.message);
});
