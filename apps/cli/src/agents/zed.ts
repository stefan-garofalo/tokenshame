import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { hasColumns } from "./copilot";
import { columnsOf, readDatabases, rowsOf } from "./databases";
import type { ReadFailure } from "./databases";
import { xdgDataFolder } from "./env";
import { toCount, toEpochMs, unknownModel } from "./pi";
import type { Reader, UsageRecord } from "./types";
import { zstdDecompress } from "./zstd";
import type { Decompress } from "./zstd";

const Count = Schema.optionalKey(Schema.NullOr(Schema.Finite));

/** Zed's `language_model::TokenUsage`: Anthropic-shaped, so `input_tokens` excludes cache. */
const TokenUsage = Schema.Struct({
  cache_creation_input_tokens: Count,
  cache_read_input_tokens: Count,
  input_tokens: Count,
  output_tokens: Count,
});

/** The part of a thread's JSON that holds its usage. */
const Thread = Schema.Struct({
  cumulative_token_usage: Schema.optionalKey(Schema.NullOr(TokenUsage)),
  imported: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
  model: Schema.optionalKey(Schema.NullOr(Schema.Struct({ model: Schema.String }))),
  request_token_usage: Schema.optionalKey(
    Schema.NullOr(
      Schema.Union([Schema.Record(Schema.String, TokenUsage), Schema.Array(TokenUsage)]),
    ),
  ),
});

const ThreadRow = Schema.Struct({
  data: Schema.Uint8Array,
  data_type: Schema.String,
  id: Schema.String,
  updated_at: Schema.String,
});

// An older Zed bound JSON threads to `data` as text; the cast reads both as bytes.
const threadsQuery = "SELECT id, updated_at, data_type, CAST(data AS BLOB) AS data FROM threads";

const decodeThread = Schema.decodeUnknownOption(Schema.fromJsonString(Thread));
const decodeThreadRow = Schema.decodeUnknownOption(ThreadRow);

type Counts = Pick<UsageRecord, "cacheRead" | "cacheWrite" | "input" | "output">;

const countsOf = (usage: typeof TokenUsage.Type): Counts => ({
  cacheRead: toCount(usage.cache_read_input_tokens ?? undefined),
  cacheWrite: toCount(usage.cache_creation_input_tokens ?? undefined),
  input: toCount(usage.input_tokens ?? undefined),
  output: toCount(usage.output_tokens ?? undefined),
});

/**
 * A thread's usage: per count, the larger of the running total and the sum of the
 * per-request map. The map can miss requests of an agent loop, and the running total
 * counts every request, so the larger one never counts a request twice.
 */
const threadCounts = (thread: typeof Thread.Type): Counts => {
  const requests = Object.values(thread.request_token_usage ?? {}).map(countsOf);
  const total = countsOf(thread.cumulative_token_usage ?? {});
  const sum = (key: keyof Counts) =>
    Math.max(
      total[key],
      requests.reduce((acc, counts) => acc + counts[key], 0),
    );
  return {
    cacheRead: sum("cacheRead"),
    cacheWrite: sum("cacheWrite"),
    input: sum("input"),
    output: sum("output"),
  };
};

const missingZstd: ReadFailure = {
  message: "the thread store is zstd-compressed and this Node.js has no zstd (Node 22.15+ needed)",
};

const threadJson = (
  row: typeof ThreadRow.Type,
  decompress: Decompress | undefined,
): Effect.Effect<Option.Option<string>, ReadFailure> => {
  const decoder = new TextDecoder();
  switch (row.data_type.trim().toLowerCase()) {
    case "json": {
      return Effect.succeedSome(decoder.decode(row.data));
    }
    case "zstd": {
      if (decompress === undefined) {
        return Effect.fail(missingZstd);
      }
      return Effect.succeed(
        Option.map(Option.liftThrowable(decompress)(row.data), (bytes) => decoder.decode(bytes)),
      );
    }
    default: {
      return Effect.succeedNone;
    }
  }
};

/** Builds the Zed reader with the given zstd decompressor, or none when Node.js lacks zstd. */
export const makeReadZed =
  (decompress?: Decompress): Reader =>
  (home) =>
    Effect.gen(function* readFromHome() {
      const path = yield* Path.Path;
      const linux = yield* xdgDataFolder(home, "zed");
      const folders = [
        path.join(home, "Library", "Application Support", "Zed"),
        linux,
        path.join(home, "AppData", "Local", "Zed"),
      ];
      return yield* readDatabases(
        "Zed Agent",
        folders.map((folder) => path.join(folder, "threads", "threads.db")),
        (db, source) =>
          Effect.gen(function* readThreads() {
            const columns = yield* columnsOf(db);
            if (!hasColumns(columns, "threads", ["data", "data_type", "id", "updated_at"])) {
              return [];
            }
            const rows = rowsOf(yield* db.all(threadsQuery), decodeThreadRow);
            const records: UsageRecord[] = [];
            for (const row of rows) {
              const thread = (yield* threadJson(row, decompress)).pipe(
                Option.flatMap(decodeThread),
              );
              if (Option.isNone(thread) || thread.value.imported === true) {
                continue;
              }
              records.push({
                ...threadCounts(thread.value),
                at: toEpochMs(row.updated_at, source.mtimeMs),
                model: thread.value.model?.model ?? unknownModel,
                session: `zed:${row.id}`,
              });
            }
            return records;
          }),
      );
    });

/**
 * Zed's built-in agent keeps one row per thread in `threads/threads.db` below Zed's data
 * folder: `~/Library/Application Support/Zed` (macOS), `$XDG_DATA_HOME/zed` else
 * `~/.local/share/zed` (Linux), `~/AppData/Local/Zed` (Windows). Every one that exists is read.
 *
 * Table `threads` (`id`, `updated_at`, `data_type`, `data`): `data` is the thread as JSON,
 * zstd-compressed when `data_type` is `zstd` (read with `node:zlib`, Node 22.15+; an older
 * Node.js skips the source as unreadable). Mapping, one record per thread:
 * `session` = `zed:` + `id`, `at` = `updated_at`, `model` = `model.model`;
 * counts from `cumulative_token_usage` and `request_token_usage` (`input_tokens`,
 * `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`), each the
 * larger of the running total and the per-request sum. Threads imported from external
 * agents (`imported`) are skipped: those agents log their own usage.
 */
export const readZed: Reader = makeReadZed(zstdDecompress);
