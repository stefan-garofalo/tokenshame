import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import { readTranscripts } from "./claude";
import { hasColumns, readUsageDatabase, uncachedInput } from "./copilot";
import type { BuildQuery } from "./copilot";
import { mergeResults } from "./folders";
import { unknownModel } from "./pi";
import type { Reader } from "./types";
import { appDataFolders } from "./vscode";

const agent = "Cherry Studio";
const record = "ai_usage_record";

const column = (columns: ReadonlySet<string>, name: string, fallback: string): string =>
  columns.has(`${record}.${name}`) ? `r.${name}` : fallback;

// Cherry Studio has shipped several spellings of `ai_usage_record`, so the query names only
// the columns this database has (tokscale's `cherrystudio.rs` lists them).
const buildQuery: BuildQuery = (columns) => {
  if (!hasColumns(columns, record, ["id", "created_at", "input_tokens", "output_tokens"])) {
    return Option.none();
  }
  const cacheRead = column(columns, "cache_read_tokens", "0");
  const cacheWrite = column(
    columns,
    "cache_write_tokens",
    column(columns, "cache_creation_tokens", "0"),
  );
  const subtracted = uncachedInput("r.input_tokens", cacheRead, cacheWrite);
  const input = columns.has(`${record}.no_cache_tokens`)
    ? `COALESCE(r.no_cache_tokens, ${subtracted})`
    : subtracted;
  const topic =
    hasColumns(columns, record, ["message_id"]) &&
    hasColumns(columns, "message", ["id", "topic_id"]);
  const filters = [
    ...(columns.has(`${record}.message_kind`)
      ? ["(r.message_kind IS NULL OR r.message_kind = 'chat')"]
      : []),
    ...(columns.has(`${record}.record_kind`) ? ["r.record_kind = 'invocation'"] : []),
  ];
  return Option.some(`
    SELECT
      'cherry:' || ${topic ? "COALESCE(m.topic_id, 'chat')" : "'chat'"} AS session,
      COALESCE(NULLIF(${column(columns, "model_id", "NULL")}, ''), '${unknownModel}') AS model,
      CASE WHEN r.created_at < 100000000000 THEN r.created_at * 1000 ELSE r.created_at END AS at,
      ${input} AS input,
      COALESCE(r.output_tokens, 0) AS output,
      COALESCE(${cacheRead}, 0) AS cacheRead,
      COALESCE(${cacheWrite}, 0) AS cacheWrite
    FROM ${record} r
    ${topic ? "LEFT JOIN message m ON m.id = r.message_id" : ""}
    ${filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : ""}
    ORDER BY r.created_at, r.id`);
};

/**
 * Cherry Studio (Electron desktop app) keeps two separate usage stores in its app data folder
 * (`Library/Application Support/CherryStudio`, `.config/CherryStudio` or
 * `AppData/Roaming/CherryStudio`, and `$XDG_CONFIG_HOME/CherryStudio` when set; format from
 * tokscale's `cherrystudio.rs`):
 *
 * - Agent / Claude Code sessions write Claude Code transcripts to `Data/Agents/.claude/projects`
 *   (V2) and `.claude/projects` (V1, older history). Cherry Studio appends one call 3-4 times
 *   with the same `requestId` and `message.id`; `readTranscripts` keeps it once, also when a
 *   V1 copy repeats a V2 session. `session` = `cherry:` + `sessionId`.
 * - Built-in chat writes one row per model call to `Data/cherrystudio.sqlite`, table
 *   `ai_usage_record`. Only `chat` rows (or rows older than `message_kind`) are read:
 *   `agent-session` rows are the transcript calls again, and `legacy-aggregate` rows are
 *   pre-summed history. `input_tokens` counts cache inside it, so `input` = `no_cache_tokens`
 *   when present, else `input_tokens` - cache reads - cache writes. `output` = `output_tokens`
 *   (`reasoning_tokens` is part of it). `session` = `cherry:` + the conversation (`topic_id`
 *   of the row's message), else one `cherry:chat` session. `at` = `created_at`.
 */
export const readCherryStudio: Reader = (home) =>
  Effect.gen(function* readFromHome() {
    const path = yield* Path.Path;
    const apps = (yield* appDataFolders(home)).map((folder) => path.join(folder, "CherryStudio"));
    const transcripts = yield* readTranscripts({
      agent,
      path: apps[0] ?? home,
      roots: apps.flatMap((app) => [
        path.join(app, "Data", "Agents", ".claude", "projects"),
        path.join(app, ".claude", "projects"),
      ]),
      sessionPrefix: "cherry",
    });
    const chats = yield* readUsageDatabase(
      agent,
      apps.map((app) => path.join(app, "Data", "cherrystudio.sqlite")),
      buildQuery,
    );
    return mergeResults([transcripts, chats]);
  });
