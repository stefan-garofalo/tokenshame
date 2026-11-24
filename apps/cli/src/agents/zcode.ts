import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { readLogFiles } from "./claude";
import type { ParseLog } from "./claude";
import { hasColumns, readUsageDatabase, uncachedInput } from "./copilot";
import type { BuildQuery } from "./copilot";
import { environmentFolder } from "./env";
import { mergeResults, usageResult } from "./folders";
import { decodeLines, exclusive, stemOf, toCount, toEpochMs, unknownModel } from "./pi";
import type { Reader, UsageRecord } from "./types";

const agent = "ZCode";

// --- v2 SQLite ledger --------------------------------------------------------------------

const optional = (columns: ReadonlySet<string>, name: string): string =>
  columns.has(`model_usage.${name}`) ? `COALESCE(${name}, 0)` : "0";

// ZCode counts cache inside `input_tokens` (codeburn, ccusage and tokscale agree). Whether
// `reasoning_tokens` sits inside `output_tokens` differs between rows, so reasoning is added
// only for the part of `computed_total_tokens` that input and output do not explain.
const buildQuery: BuildQuery = (columns) => {
  if (
    !hasColumns(columns, "model_usage", [
      "id",
      "session_id",
      "model_id",
      "started_at",
      "input_tokens",
      "output_tokens",
    ])
  ) {
    return Option.none();
  }
  const cacheRead = optional(columns, "cache_read_input_tokens");
  const cacheWrite = optional(columns, "cache_creation_input_tokens");
  const reasoning = columns.has("model_usage.computed_total_tokens")
    ? `MIN(${optional(columns, "reasoning_tokens")}, MAX(0, COALESCE(computed_total_tokens, 0) - COALESCE(input_tokens, 0) - COALESCE(output_tokens, 0)))`
    : "0";
  const completed = columns.has("model_usage.completed_at") ? "completed_at" : "NULL";
  return Option.some(`
    SELECT
      'zcode:' || session_id AS session,
      COALESCE(NULLIF(model_id, ''), '${unknownModel}') AS model,
      COALESCE(NULLIF(started_at, 0), ${completed}) AS at,
      ${uncachedInput("input_tokens", cacheRead, cacheWrite)} AS input,
      COALESCE(output_tokens, 0) + ${reasoning} AS output,
      ${cacheRead} AS cacheRead,
      ${cacheWrite} AS cacheWrite
    FROM model_usage
    ORDER BY at, id`);
};

// --- legacy jsonl transcripts ------------------------------------------------------------

const Count = Schema.optionalKey(Schema.Finite);
const Text = Schema.optionalKey(Schema.String);

const ZcodeUsage = Schema.Struct({
  cacheCreationTokens: Count,
  cacheReadTokens: Count,
  cache_read: Count,
  cache_read_tokens: Count,
  cache_write: Count,
  cache_write_tokens: Count,
  completion_tokens: Count,
  input: Count,
  inputTokens: Count,
  input_cache_creation: Count,
  input_cache_read: Count,
  input_tokens: Count,
  output: Count,
  outputTokens: Count,
  output_tokens: Count,
  prompt_tokens: Count,
  reasoning: Count,
  reasoningTokens: Count,
  total: Count,
  totalTokens: Count,
});

const ZcodeLine = Schema.Struct({
  model: Text,
  role: Text,
  sessionId: Text,
  timestamp: Text,
  token_usage: Schema.optionalKey(ZcodeUsage),
  usage: Schema.optionalKey(ZcodeUsage),
});

const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));
const decodeZcodeLine = Schema.decodeUnknownOption(ZcodeLine);

const first = (values: readonly (number | undefined)[]): number =>
  toCount(values.find((value) => value !== undefined));

type Counts = Pick<UsageRecord, "cacheRead" | "cacheWrite" | "input" | "output">;

/**
 * When the logged total equals input + output, input and output already hold the cache and
 * the reasoning, so they are taken out of input; otherwise every bucket is separate.
 */
const countsOf = (usage: typeof ZcodeUsage.Type): Counts => {
  const input = first([usage.input, usage.input_tokens, usage.prompt_tokens, usage.inputTokens]);
  const output = first([
    usage.output,
    usage.output_tokens,
    usage.completion_tokens,
    usage.outputTokens,
  ]);
  const cacheRead = first([
    usage.cache_read,
    usage.input_cache_read,
    usage.cache_read_tokens,
    usage.cacheReadTokens,
  ]);
  const cacheWrite = first([
    usage.cache_write,
    usage.input_cache_creation,
    usage.cache_write_tokens,
    usage.cacheCreationTokens,
  ]);
  const reasoning = first([usage.reasoning, usage.reasoningTokens]);
  const total = [usage.total, usage.totalTokens].find((value) => value !== undefined);
  return total !== undefined && toCount(total) === input + output
    ? { cacheRead, cacheWrite, input: exclusive(input, cacheRead + cacheWrite), output }
    : { cacheRead, cacheWrite, input, output: output + reasoning };
};

const parseZcodeLog: ParseLog<UsageRecord> = (file) =>
  Option.map(
    decodeLines(file.text, (text) => Option.map(decodeJson(text), decodeZcodeLine)),
    (lines) => {
      let model: string | undefined;
      let session: string | undefined;
      const records: UsageRecord[] = [];
      for (const line of lines.flatMap(Option.toArray)) {
        // The model in effect: the last one the transcript named.
        model = line.model ?? model;
        session ??= line.sessionId;
        const usage = line.usage ?? line.token_usage;
        if (line.role === "assistant" && usage !== undefined) {
          records.push({
            ...countsOf(usage),
            at: toEpochMs(line.timestamp, file.mtimeMs),
            model: model ?? unknownModel,
            session: `zcode:${session ?? stemOf(file.segments, ".jsonl")}`,
          });
        }
      }
      return records;
    },
  );

/**
 * ZCode (Z.ai) keeps its folder at `$ZCODE_HOME` (as ccusage reads it), else `~/.zcode`.
 *
 * - v2 CLI and desktop: `cli/db/db.sqlite`, table `model_usage`, one row per model call
 *   (format from codeburn's `zcode.ts`, ccusage's zcode adapter and tokscale's `zcode.rs`).
 *   `session` = `zcode:` + `session_id`, `model` = `model_id`, `at` = `started_at` (epoch ms),
 *   else `completed_at`. `input_tokens` counts cache inside it, so `input` = `input_tokens` -
 *   `cache_read_input_tokens` - `cache_creation_input_tokens`. `output` = `output_tokens`, plus
 *   `reasoning_tokens` when `computed_total_tokens` shows them outside it.
 * - Legacy transcripts: `projects/<project>/<session>.jsonl`, lines with `role`, `model` and
 *   a `usage` (or `token_usage`) block (field names as in `countsOf`). Lines without one
 *   count nothing (tokscale estimates them from text; codeburn found the counts redacted).
 *   A transcript session the database also holds is skipped: the database has its calls.
 */
export const readZcode: Reader = (home) =>
  Effect.gen(function* readFromHome() {
    const path = yield* Path.Path;
    const folder = Option.getOrElse(yield* environmentFolder("ZCODE_HOME"), () =>
      path.join(home, ".zcode"),
    );
    const database = yield* readUsageDatabase(
      agent,
      [path.join(folder, "cli", "db", "db.sqlite")],
      buildQuery,
    );
    const inDatabase = new Set(
      database._tag === "Read" ? database.records.map(({ session }) => session) : [],
    );
    const { failures, items } = yield* readLogFiles(
      [path.join(folder, "projects")],
      (name) => name.endsWith(".jsonl"),
      parseZcodeLog,
    );
    const transcripts = usageResult(
      agent,
      folder,
      items.filter(({ session }) => !inDatabase.has(session)),
      failures,
    );
    return mergeResults([transcripts, database]);
  });
