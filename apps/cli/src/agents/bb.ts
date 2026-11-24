import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { hasColumns } from "./copilot";
import { columnsOf, readDatabases, rowsOf } from "./databases";
import { listFolder } from "./folders";
import { environmentFolder } from "./env";
import { toCount, unknownModel } from "./pi";
import type { Reader, UsageRecord } from "./types";

const Count = Schema.optionalKey(Schema.NullOr(Schema.Finite));

const Breakdown = Schema.Struct({
  cacheReadInputTokens: Count,
  cacheWriteInputTokens: Count,
  cachedInputTokens: Count,
  inputTokens: Count,
  outputTokens: Count,
  reasoningOutputTokens: Count,
  totalTokens: Count,
});

const TokenUsage = Schema.Struct({
  last: Schema.optionalKey(Schema.NullOr(Breakdown)),
  total: Schema.optionalKey(Schema.NullOr(Breakdown)),
});

const EventRow = Schema.Struct({
  at: Schema.NullOr(Schema.Finite),
  fallbackModel: Schema.NullOr(Schema.String),
  provider: Schema.NullOr(Schema.String),
  sequence: Schema.Finite,
  thread: Schema.String,
  threadModel: Schema.NullOr(Schema.String),
  tokenUsage: Schema.NullOr(Schema.String),
  turn: Schema.NullOr(Schema.String),
});

const decodeEventRow = Schema.decodeUnknownOption(EventRow);
const decodeTokenUsage = Schema.decodeUnknownOption(Schema.fromJsonString(TokenUsage));

type Counts = Pick<UsageRecord, "cacheRead" | "cacheWrite" | "input" | "output">;

const zero: Counts = { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 };

/**
 * BB passes on each provider's counts. Claude-style counts keep cache out of `inputTokens`
 * and reasoning out of `outputTokens`; Codex-style counts include them, which shows when
 * `totalTokens` equals input plus output.
 */
const countsOf = (usage: typeof Breakdown.Type): Counts => {
  const cacheRead = toCount(usage.cacheReadInputTokens ?? usage.cachedInputTokens ?? undefined);
  const cacheWrite = toCount(usage.cacheWriteInputTokens ?? undefined);
  const input = toCount(usage.inputTokens ?? undefined);
  const output = toCount(usage.outputTokens ?? undefined);
  const reasoning = toCount(usage.reasoningOutputTokens ?? undefined);
  const total = usage.totalTokens ?? undefined;
  const uncached =
    input >= cacheRead + cacheWrite && total === input + output
      ? input - cacheRead - cacheWrite
      : input;
  const reasoningInside =
    output >= reasoning && total === uncached + cacheRead + cacheWrite + output;
  return {
    cacheRead,
    cacheWrite,
    input: uncached,
    output: reasoningInside ? output : output + reasoning,
  };
};

const minus = (a: Counts, b: Counts): Counts => ({
  cacheRead: Math.max(a.cacheRead - b.cacheRead, 0),
  cacheWrite: Math.max(a.cacheWrite - b.cacheWrite, 0),
  input: Math.max(a.input - b.input, 0),
  output: Math.max(a.output - b.output, 0),
});

const sum = (counts: Counts): number =>
  counts.input + counts.output + counts.cacheRead + counts.cacheWrite;

// `claude-code` and `codex` threads run Claude Code and Codex, which log the same calls in
// their own folders; those readers count them.
const mirroredProviders = new Set(["claude-code", "codex"]);

const eventsQuery = (columns: ReadonlySet<string>): string => {
  const hasDefaults = hasColumns(columns, "project_execution_defaults", [
    "model",
    "project_id",
    "provider_id",
  ]);
  return `
  SELECT
    e.thread_id AS thread,
    e.turn_id AS turn,
    e.sequence AS sequence,
    e.created_at AS at,
    CASE WHEN json_valid(e.data) THEN json_extract(e.data, '$.tokenUsage') END AS tokenUsage,
    CASE WHEN json_valid(e.data) AND e.type = 'provider/modelFallback'
      THEN json_extract(e.data, '$.fallbackModel') END AS fallbackModel,
    t.provider_id AS provider,
    COALESCE(NULLIF(t.model_override, ''), ${hasDefaults ? "NULLIF(d.model, '')" : "NULL"}) AS threadModel
  FROM events e
  LEFT JOIN threads t ON t.id = e.thread_id
  ${
    hasDefaults
      ? "LEFT JOIN project_execution_defaults d ON d.project_id = t.project_id AND d.provider_id = t.provider_id"
      : ""
  }
  WHERE e.type IN ('thread/tokenUsage/updated', 'provider/modelFallback')
  ORDER BY e.thread_id, e.sequence`;
};

/** A thread's state while its events are read in order. */
interface ThreadState {
  readonly thread: string;
  fallbackModel: string | null;
  total: Counts;
}

/**
 * The counts of one usage event: `last`, else the growth of `total` since the thread's
 * previous total. Updates the thread's total.
 */
const eventCounts = (event: typeof EventRow.Type, state: ThreadState): Counts => {
  const usage = Option.getOrUndefined(
    Option.flatMap(Option.fromNullishOr(event.tokenUsage), decodeTokenUsage),
  );
  if (usage === undefined) {
    return zero;
  }
  const last = countsOf(usage.last ?? {});
  const total = usage.total ? countsOf(usage.total) : undefined;
  const counts = sum(last) > 0 ? last : minus(total ?? zero, state.total);
  if (total !== undefined) {
    state.total = total;
  }
  return counts;
};

/** The BB databases: `$BB_DATA_DIR/bb.db`, `~/.bb/bb.db`, `~/.bb-dev/<instance>/bb.db`. */
const bbDatabases = (home: string) =>
  Effect.gen(function* listDatabases() {
    const path = yield* Path.Path;
    const dataDir = yield* environmentFolder("BB_DATA_DIR");
    const devRoot = path.join(home, ".bb-dev");
    const instances = yield* listFolder(devRoot);
    return [
      ...Option.toArray(dataDir).map((folder) => path.join(folder, "bb.db")),
      path.join(home, ".bb", "bb.db"),
      ...instances.toSorted().map((name) => path.join(devRoot, name, "bb.db")),
    ];
  });

/**
 * BB (get-bb/bb), an agent orchestrator, keeps its threads in SQLite `bb.db`:
 * `$BB_DATA_DIR/bb.db`, `~/.bb/bb.db`, and development instances `~/.bb-dev/<name>/bb.db`.
 * Every one that exists is read.
 *
 * Table `events` has one `thread/tokenUsage/updated` row per model call, with
 * `data.tokenUsage.last` (this call) and `.total` (thread total so far). Mapping:
 * `session` = `bb:` + `thread_id`, `at` = `created_at` (epoch milliseconds), `model` = the
 * thread's last `provider/modelFallback` model, else `threads.model_override`, else the
 * project default (`project_execution_defaults.model`), else unknown. Counts are `last`;
 * an event with only `total` counts its growth since the thread's previous total.
 * Codex-style counts (cache inside `inputTokens`, reasoning inside `outputTokens`) are
 * split; Claude-style counts get reasoning added to output.
 *
 * Not counted twice:
 * - threads of provider `claude-code` or `codex`: those agents log the same calls, which the
 *   Claude Code and Codex readers count;
 * - a forked thread copies its parent's events with the same `turn_id` and `sequence`: an
 *   event with the same turn, sequence, and counts as one already read is dropped, in every
 *   database.
 */
export const readBb: Reader = (home) =>
  Effect.gen(function* readFromHome() {
    const files = yield* bbDatabases(home);
    const seen = new Set<string>();
    return yield* readDatabases("BB", files, (db, source) =>
      Effect.gen(function* readEvents() {
        const columns = yield* columnsOf(db);
        if (
          !hasColumns(columns, "events", [
            "created_at",
            "data",
            "sequence",
            "thread_id",
            "turn_id",
            "type",
          ]) ||
          !hasColumns(columns, "threads", ["id", "model_override", "project_id", "provider_id"])
        ) {
          return [];
        }
        const records: UsageRecord[] = [];
        let state: ThreadState = { fallbackModel: null, thread: "", total: zero };
        for (const event of rowsOf(yield* db.all(eventsQuery(columns)), decodeEventRow)) {
          if (event.thread !== state.thread) {
            state = { fallbackModel: null, thread: event.thread, total: zero };
          }
          if (event.fallbackModel !== null) {
            state.fallbackModel = event.fallbackModel;
          }
          if (mirroredProviders.has(event.provider ?? "")) {
            continue;
          }
          const counts = eventCounts(event, state);
          const key = JSON.stringify([
            event.turn ?? event.at,
            event.sequence,
            counts.input,
            counts.output,
          ]);
          if (sum(counts) === 0 || seen.has(key)) {
            continue;
          }
          seen.add(key);
          records.push({
            ...counts,
            at: event.at !== null && event.at > 0 ? Math.trunc(event.at) : source.mtimeMs,
            model: state.fallbackModel ?? event.threadModel ?? unknownModel,
            session: `bb:${event.thread}`,
          });
        }
        return records;
      }),
    );
  });
