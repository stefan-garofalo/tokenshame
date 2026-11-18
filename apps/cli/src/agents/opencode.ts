import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { openReadOnly } from "./sqlite";
import type { Row, SqliteError } from "./sqlite";
import type { Reader, ReadResult, SkippedSource, UsageRecord } from "./types";

const agent = "opencode";

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

/** One usage row, as both queries below name their columns. */
const UsageRow = Schema.Struct({
  at: Schema.Int,
  cacheRead: Count,
  cacheWrite: Count,
  input: Count,
  model: Schema.String,
  output: Count,
  session: Schema.String,
});

// Token counts are read with `json_extract` so prompt text never reaches this process.
// `CASE WHEN json_valid` keeps one malformed row from failing the whole query.
const messageUsage = `
  SELECT
    session_id AS session,
    json_extract(data, '$.modelID') AS model,
    COALESCE(json_extract(data, '$.time.created'), time_created) AS at,
    COALESCE(json_extract(data, '$.tokens.input'), 0) AS input,
    COALESCE(json_extract(data, '$.tokens.output'), 0) AS output,
    COALESCE(json_extract(data, '$.tokens.cache.read'), 0) AS cacheRead,
    COALESCE(json_extract(data, '$.tokens.cache.write'), 0) AS cacheWrite
  FROM message
  WHERE CASE WHEN json_valid(data)
    THEN json_extract(data, '$.role') = 'assistant' AND json_type(data, '$.tokens') = 'object'
    ELSE 0 END
  ORDER BY time_created, id`;

const sessionUsage = `
  SELECT
    id AS session,
    CASE WHEN json_valid(model) THEN json_extract(model, '$.id') END AS model,
    time_created AS at,
    tokens_input AS input,
    tokens_output AS output,
    tokens_cache_read AS cacheRead,
    tokens_cache_write AS cacheWrite
  FROM session
  ORDER BY time_created, id`;

const decodeUsageRow = Schema.decodeUnknownOption(UsageRow);

/** Rows that do not decode or hold no tokens are dropped: they carry no usage. */
const toRecords = (rows: readonly Row[]): UsageRecord[] =>
  rows.flatMap((row) =>
    Option.match(decodeUsageRow(row), {
      onNone: () => [],
      onSome: (usage) =>
        usage.input + usage.output + usage.cacheRead + usage.cacheWrite > 0
          ? [{ ...usage, session: `${agent}:${usage.session}` }]
          : [],
    }),
  );

const skipped = (path: string, reason: SkippedSource["reason"], detail: string): SkippedSource => ({
  _tag: "Skipped",
  agent,
  detail,
  path,
  reason,
});

const readUsage = (file: string): Effect.Effect<ReadResult, SqliteError> =>
  Effect.scoped(
    Effect.gen(function* scopedRead() {
      const db = yield* openReadOnly(file);
      // opencode keeps the same tokens on `message` rows (per model turn) and on `session`
      // rows (summed). Use messages for per-model and per-hour detail, and fall back to
      // session totals only when no message holds usage. Never both: that would count twice.
      const fromMessages = toRecords(yield* db.all(messageUsage));
      const records =
        fromMessages.length > 0 ? fromMessages : toRecords(yield* db.all(sessionUsage));
      return records.length > 0
        ? ({ _tag: "Read", records } satisfies ReadResult)
        : skipped(file, "no-data", "");
    }),
  );

/**
 * opencode keeps its usage in `~/.local/share/opencode/opencode.db`, on every platform.
 * Opened read-only through the shared SQLite helper.
 */
export const readOpencode: Reader = (home) =>
  Effect.gen(function* readFromHome() {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const file = path.join(home, ".local", "share", "opencode", "opencode.db");
    return yield* Effect.gen(function* checkedRead() {
      if (!(yield* fs.exists(file))) {
        return skipped(file, "no-data", "");
      }
      return yield* readUsage(file);
    }).pipe(Effect.catch((error) => Effect.succeed(skipped(file, "unreadable", error.message))));
  });
