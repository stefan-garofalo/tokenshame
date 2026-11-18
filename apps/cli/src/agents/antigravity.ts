import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { decodeMessage, messageOf, textOf, varintOf, varintsOf } from "./protobuf";
import type { Message } from "./protobuf";
import { unknownModel } from "./pi";
import { openReadOnly } from "./sqlite";
import type { Row, SqliteError } from "./sqlite";
import type { Reader, ReadResult, SkippedSource, UsageRecord } from "./types";

const agent = "Antigravity";

const TableRow = Schema.Struct({ name: Schema.String });
const GenerationRow = Schema.Struct({ data: Schema.Uint8Array, idx: Schema.Int });
const StepRow = Schema.Struct({ idx: Schema.Int, metadata: Schema.Uint8Array });

const decodeTableRow = Schema.decodeUnknownOption(TableRow);
const decodeGenerationRow = Schema.decodeUnknownOption(GenerationRow);
const decodeStepRow = Schema.decodeUnknownOption(StepRow);

const rowsOf = <A>(rows: readonly Row[], decode: (row: Row) => Option.Option<A>): A[] =>
  rows.flatMap((row) => Option.toArray(decode(row)));

// Protobuf field numbers, from Antigravity's published `exa.cortex_pb` and
// `exa.codeium_common_pb` schemas, as read by codeburn, Segreant and TokenTracker.
const chatModel = 1;
const stepIndices = 2;
const usageStats = 4;
const inputTokens = 2;
const outputTokens = 3;
const cacheWriteTokens = 4;
const cacheReadTokens = 5;
const thinkingTokens = 9;
const responseTokens = 10;
const responseModel = 19;
const reportedModel = 21;
const createdAt = 1;
const seconds = 1;
const nanos = 2;

const count = (message: Message, field: number): number =>
  Option.getOrElse(varintOf(message, field), () => 0);

/** The model that answered: its response model id, else the name it reports, else unknown. */
const modelOf = (chat: Message): string =>
  textOf(chat, responseModel).pipe(
    Option.filter((name) => name !== ""),
    Option.orElse(() => textOf(chat, reportedModel)),
    Option.filter((name) => name !== ""),
    Option.getOrElse(() => unknownModel),
  );

/** `steps.metadata`: `created_at` is a protobuf timestamp, in epoch milliseconds here. */
const stepTime = (metadata: Uint8Array): Option.Option<number> =>
  decodeMessage(metadata).pipe(
    Option.flatMap((message) => messageOf(message, createdAt)),
    Option.flatMap((stamp) =>
      Option.map(
        varintOf(stamp, seconds),
        (whole) => whole * 1000 + Math.floor(count(stamp, nanos) / 1_000_000),
      ),
    ),
  );

/**
 * One `gen_metadata` row is one model call. Only the token counts, the model id, and the
 * step indices are read; the blob holds nothing else this reader uses.
 */
const toRecord = (
  data: Uint8Array,
  session: string,
  stepTimes: ReadonlyMap<number, number>,
  fallbackMs: number,
): Option.Option<UsageRecord> =>
  decodeMessage(data).pipe(
    Option.flatMap((generation) =>
      Option.flatMap(messageOf(generation, chatModel), (chat) =>
        Option.map(messageOf(chat, usageStats), (usage) => {
          // `output` (3) already holds thinking (9) and visible output (10). Only a call
          // that reports no total gets them added.
          const output = Option.getOrElse(
            varintOf(usage, outputTokens),
            () => count(usage, thinkingTokens) + count(usage, responseTokens),
          );
          const [firstStep] = varintsOf(generation, stepIndices);
          return {
            at: (firstStep === undefined ? undefined : stepTimes.get(firstStep)) ?? fallbackMs,
            cacheRead: count(usage, cacheReadTokens),
            cacheWrite: count(usage, cacheWriteTokens),
            input: count(usage, inputTokens),
            model: modelOf(chat),
            output,
            session,
          };
        }),
      ),
    ),
    Option.filter(
      (record) => record.input + record.output + record.cacheRead + record.cacheWrite > 0,
    ),
  );

const readConversation = (
  file: string,
  session: string,
  modifiedMs: number,
): Effect.Effect<readonly UsageRecord[], SqliteError> =>
  Effect.scoped(
    Effect.gen(function* scopedRead() {
      const db = yield* openReadOnly(file);
      const tables = new Set(
        rowsOf(
          yield* db.all(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('gen_metadata', 'steps')",
          ),
          decodeTableRow,
        ).map((table) => table.name),
      );
      if (!tables.has("gen_metadata")) {
        return [];
      }
      const stepRows = tables.has("steps")
        ? rowsOf(yield* db.all("SELECT idx, metadata FROM steps"), decodeStepRow)
        : [];
      const stepTimes = new Map(
        stepRows.flatMap((step) =>
          Option.toArray(Option.map(stepTime(step.metadata), (time) => [step.idx, time] as const)),
        ),
      );
      const generations = rowsOf(
        yield* db.all("SELECT idx, data FROM gen_metadata ORDER BY idx"),
        decodeGenerationRow,
      );
      return generations.flatMap((generation) =>
        Option.toArray(toRecord(generation.data, session, stepTimes, modifiedMs)),
      );
    }),
  );

const skipped = (path: string, reason: SkippedSource["reason"], detail: string): SkippedSource => ({
  _tag: "Skipped",
  agent,
  detail,
  path,
  reason,
});

// The standalone app, the CLI, and the IDE each keep their own folder.
const appFolders: readonly string[] = ["antigravity", "antigravity-cli", "antigravity-ide"];

/**
 * Antigravity keeps one SQLite database per conversation, `<id>.db`, in
 * `~/.gemini/{antigravity,antigravity-cli,antigravity-ide}/conversations` (and its
 * `implicit` subfolder). Older conversations are `.pb` files readable only through
 * Antigravity itself; they are not read.
 *
 * Table `gen_metadata` (`idx`, `data` blob) has one protobuf row per model call. Field
 * numbers below are `a.b` for field `b` inside field `a`:
 * - `1.4` usage: `2` input (uncached), `3` output (includes thinking `9` and visible `10`,
 *   used as the total), `4` cache write, `5` cache read; `1.19` response model id, else `1.21`;
 * - `2` step indices: the first indexes table `steps`, whose `metadata` field `1` is the
 *   call's `created_at` (seconds `1`, nanos `2`). No such step: the file's last change time.
 * `session` = `antigravity:` + the file name without `.db`. The usage repeated inside
 * `steps` and `retry_infos` is never read, so nothing counts twice.
 *
 * These are private, unversioned blobs: a row that does not decode is dropped.
 */
export const readAntigravity: Reader = (home) =>
  Effect.gen(function* readFromHome() {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const roots = appFolders.map((folder) => path.join(home, ".gemini", folder, "conversations"));

    const listFiles = (root: string) =>
      fs.readDirectory(root, { recursive: true }).pipe(
        Effect.map((entries) =>
          entries.filter((entry) => entry.endsWith(".db")).map((entry) => path.join(root, entry)),
        ),
        // A folder that is missing or cannot be listed has no conversations to read.
        Effect.orElseSucceed((): string[] => []),
      );

    const readFile = (file: string) =>
      Effect.gen(function* readOneFile() {
        const info = yield* Effect.option(fs.stat(file));
        const modifiedMs = info.pipe(
          Option.flatMap((stat) => stat.mtime),
          Option.map((time) => time.getTime()),
          Option.getOrElse(() => 0),
        );
        const session = `antigravity:${path.basename(file, ".db")}`;
        return yield* readConversation(file, session, modifiedMs);
      }).pipe(Effect.result);

    // The unicorn rules mistake `Effect.forEach` for `Array#forEach`.
    // oxlint-disable-next-line unicorn/no-array-for-each, unicorn/no-array-method-this-argument
    const listed = yield* Effect.forEach(roots, listFiles);
    // oxlint-disable-next-line unicorn/no-array-for-each, unicorn/no-array-method-this-argument
    const results = yield* Effect.forEach(listed.flat(), readFile, { concurrency: 4 });

    const records = results.flatMap((result) => (Result.isSuccess(result) ? result.success : []));
    if (records.length > 0) {
      return { _tag: "Read", records } satisfies ReadResult;
    }
    const failure = results.find(Result.isFailure);
    return failure === undefined
      ? skipped(roots[0] ?? "", "no-data", "")
      : skipped(roots[0] ?? "", "unreadable", failure.failure.message);
  });
