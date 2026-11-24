import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import type { PlatformError } from "effect/PlatformError";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { environmentFolder } from "./env";
import type { Reader, SkippedSource, UsageRecord } from "./types";
import { zstdDecompress, zstdMissing } from "./zstd";

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

const rolloutFile = /^rollout-.*\.jsonl(?:\.zst)?$/u;

/** A compressed rollout that could not be decompressed, or a Node without zstd. */
class ZstdError extends Data.TaggedError("ZstdError")<{ readonly message: string }> {}

const decompress = (data: Uint8Array) => {
  const decode = zstdDecompress;
  return decode === undefined
    ? Effect.fail(new ZstdError({ message: zstdMissing }))
    : Effect.try({
        catch: (error) => new ZstdError({ message: String(error) }),
        try: () => new TextDecoder().decode(decode(data)),
      });
};

const recordTotal = (record: UsageRecord): number =>
  record.input + record.output + record.cacheRead + record.cacheWrite;

/**
 * Codex CLI. Reads `rollout-*.jsonl` session files below `sessions/` (`YYYY/MM/DD/`) and
 * `archived_sessions/` (where Codex moves archived sessions) of the Codex home: `CODEX_HOME`
 * when set, else `~/.codex`. Codex may compress a rollout to `rollout-*.jsonl.zst`; those are
 * read when Node has zstd (22.15+), else they count as unreadable files.
 *
 * Each file keeps cumulative `token_count` totals, so only its last non-null total counts.
 * Lines that fail to parse are skipped. The session id is the file name without `rollout-`
 * and its suffix; a rollout that exists more than once (in both folders, or plain and
 * compressed) counts once, with its largest total, since Codex totals only grow.
 */
export const readCodex: Reader = Effect.fn("readCodex")(function* readSessions(home: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const codexHome = Option.getOrElse(yield* environmentFolder("CODEX_HOME"), () =>
    path.join(home, ".codex"),
  );
  const roots = [path.join(codexHome, "sessions"), path.join(codexHome, "archived_sessions")];
  const skipped = (reason: SkippedSource["reason"], detail: string): SkippedSource => ({
    _tag: "Skipped",
    agent: "Codex",
    detail,
    path: roots[0] ?? codexHome,
    reason,
  });

  const listRoot = (root: string) =>
    fs.readDirectory(root, { recursive: true }).pipe(
      Effect.map((entries) =>
        entries
          .filter((entry) => rolloutFile.test(path.basename(entry)))
          .toSorted()
          .map((entry) => path.join(root, entry)),
      ),
      // A missing folder holds no sessions; any other listing failure is kept.
      Effect.catchIf(
        (error) => error.reason._tag === "NotFound",
        () => Effect.succeed<string[]>([]),
      ),
      Effect.result,
    );

  const readLines = (file: string): Stream.Stream<string, PlatformError | ZstdError> =>
    file.endsWith(".zst")
      ? Stream.fromEffect(Effect.flatMap(fs.readFile(file), decompress)).pipe(Stream.splitLines)
      : fs.stream(file).pipe(Stream.decodeText(), Stream.splitLines);

  const readSession = (file: string) => {
    const name = path.basename(file).replace(/\.zst$/u, "");
    const session = `codex:${path.basename(name, ".jsonl").replace(/^rollout-/u, "")}`;
    return readLines(file).pipe(
      Stream.runFold(() => emptyScan, scanLine),
      Effect.map((scan) => toRecord(session, scan)),
      Effect.result,
    );
  };

  // The unicorn rules mistake `Effect.forEach` for `Array#forEach`.
  // oxlint-disable-next-line unicorn/no-array-for-each, unicorn/no-array-method-this-argument
  const listed = yield* Effect.forEach(roots, listRoot);
  const files = listed.flatMap((result) => (Result.isSuccess(result) ? result.success : []));
  // oxlint-disable-next-line unicorn/no-array-for-each, unicorn/no-array-method-this-argument
  const results = yield* Effect.forEach(files, readSession);

  const bySession = new Map<string, UsageRecord>();
  for (const result of results) {
    const record = Result.getOrUndefined(result);
    const kept = record === undefined ? undefined : bySession.get(record.session);
    if (record !== undefined && (kept === undefined || recordTotal(record) > recordTotal(kept))) {
      bySession.set(record.session, record);
    }
  }
  if (bySession.size > 0) {
    return { _tag: "Read", records: [...bySession.values()] };
  }
  const [failure] = [...listed.filter(Result.isFailure), ...results.filter(Result.isFailure)];
  return failure === undefined
    ? skipped("no-data", "")
    : skipped("unreadable", failure.failure.message);
});
