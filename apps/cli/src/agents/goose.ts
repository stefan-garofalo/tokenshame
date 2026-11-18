import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import { hasColumns, readUsageDatabase, uncachedInput } from "./copilot";
import type { BuildQuery } from "./copilot";
import { unknownModel } from "./pi";
import type { Reader } from "./types";

const ledgerColumns = [
  "cache_read_tokens",
  "cache_write_tokens",
  "created_timestamp",
  "input_tokens",
  "model",
  "output_tokens",
  "session_id",
];

// Older Goose versions have no ledger and no cache or model columns on `sessions`.
const sessionColumns = [
  "accumulated_input_tokens",
  "accumulated_output_tokens",
  "created_at",
  "id",
];

const sessionModel = (columns: ReadonlySet<string>): string =>
  columns.has("sessions.model_config_json")
    ? "CASE WHEN json_valid(s.model_config_json) THEN json_extract(s.model_config_json, '$.model_name') END"
    : "NULL";

const sessionCount = (columns: ReadonlySet<string>, name: string): string =>
  columns.has(`sessions.${name}`) ? `s.${name}` : "0";

const ledgerRows = (columns: ReadonlySet<string>): string => `
  SELECT
    'goose:' || l.session_id AS session,
    COALESCE(l.model, ${sessionModel(columns)}, '${unknownModel}') AS model,
    l.created_timestamp * 1000 AS at,
    ${uncachedInput("l.input_tokens", "l.cache_read_tokens", "l.cache_write_tokens")} AS input,
    COALESCE(l.output_tokens, 0) AS output,
    COALESCE(l.cache_read_tokens, 0) AS cacheRead,
    COALESCE(l.cache_write_tokens, 0) AS cacheWrite
  FROM usage_ledger l
  LEFT JOIN sessions s ON s.id = l.session_id`;

const sessionRows = (columns: ReadonlySet<string>, hasLedger: boolean): string => {
  const read = sessionCount(columns, "accumulated_cache_read_tokens");
  const write = sessionCount(columns, "accumulated_cache_write_tokens");
  return `
  SELECT
    'goose:' || s.id AS session,
    COALESCE(${sessionModel(columns)}, '${unknownModel}') AS model,
    CAST(unixepoch(s.created_at, 'subsec') * 1000 AS INTEGER) AS at,
    ${uncachedInput("s.accumulated_input_tokens", read, write)} AS input,
    COALESCE(s.accumulated_output_tokens, 0) AS output,
    COALESCE(${read}, 0) AS cacheRead,
    COALESCE(${write}, 0) AS cacheWrite
  FROM sessions s
  ${hasLedger ? "WHERE NOT EXISTS (SELECT 1 FROM usage_ledger l WHERE l.session_id = s.id)" : ""}`;
};

// Goose writes the same tokens twice: one `usage_ledger` row per model call, and running
// totals on the `sessions` row. Ledger rows give per-model and per-hour detail. A session
// with no ledger rows (written before the ledger existed) falls back to its totals.
// Never both for one session: that would count twice.
const buildQuery: BuildQuery = (columns) => {
  const hasLedger =
    hasColumns(columns, "usage_ledger", ledgerColumns) && hasColumns(columns, "sessions", ["id"]);
  const hasTotals = hasColumns(columns, "sessions", sessionColumns);
  const parts = [
    ...(hasLedger ? [ledgerRows(columns)] : []),
    ...(hasTotals ? [sessionRows(columns, hasLedger)] : []),
  ];
  return parts.length > 0
    ? Option.some(`SELECT * FROM (${parts.join(" UNION ALL ")}) ORDER BY at, session`)
    : Option.none();
};

/**
 * Goose keeps sessions in a SQLite database (since Goose 1.10; schema from
 * `crates/goose/src/session/session_manager.rs` in block/goose). The folder is Goose's data
 * folder, then `sessions/sessions.db`:
 * - `~/.local/share/goose` (XDG data folder, macOS and Linux);
 * - `~/Library/Application Support/Block/goose` (older macOS installs);
 * - `~/AppData/Roaming/Block/goose/data` (Windows).
 * `GOOSE_PATH_ROOT` (an absolute folder that replaces them) is not read.
 *
 * Mapping, from `usage_ledger` (one row per model call): `session` = `goose:` +
 * `session_id`, `model` = `model` (else `sessions.model_config_json.model_name`, else
 * unknown), `at` = `created_timestamp` (epoch seconds). Goose counts cache inside
 * `input_tokens`, so `input` = `input_tokens` - cache reads - cache writes.
 * For a session with no ledger row, the same from `sessions.accumulated_*` and `created_at`.
 */
export const readGoose: Reader = (home) =>
  Effect.gen(function* readFromHome() {
    const path = yield* Path.Path;
    return yield* readUsageDatabase(
      "Goose",
      [
        path.join(home, ".local", "share", "goose", "sessions", "sessions.db"),
        path.join(
          home,
          "Library",
          "Application Support",
          "Block",
          "goose",
          "sessions",
          "sessions.db",
        ),
        path.join(home, "AppData", "Roaming", "Block", "goose", "data", "sessions", "sessions.db"),
      ],
      buildQuery,
    );
  });
