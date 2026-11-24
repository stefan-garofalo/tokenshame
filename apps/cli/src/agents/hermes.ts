import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import { hasColumns } from "./copilot";
import { columnsOf, readDatabases, sqlCount, sqlEpochMs, usageRows } from "./databases";
import { listFolder } from "./folders";
import { environmentFolder } from "./env";
import { unknownModel } from "./pi";
import type { Reader } from "./types";

const usageColumns = [
  "cache_read_tokens",
  "cache_write_tokens",
  "input_tokens",
  "model",
  "output_tokens",
];

const modelOf = (column: string): string =>
  `COALESCE(NULLIF(TRIM(${column}), ''), '${unknownModel}')`;

// One row per session and model, summed over billing providers and tasks (main loop,
// compression, titles, and so on).
const perModel = (fallbackMs: number): string => `
  SELECT
    'hermes:' || u.session_id AS session,
    ${modelOf("u.model")} AS model,
    ${sqlEpochMs("MIN(s.started_at)", fallbackMs)} AS at,
    SUM(${sqlCount("u.input_tokens")}) AS input,
    SUM(${sqlCount("u.output_tokens")}) AS output,
    SUM(${sqlCount("u.cache_read_tokens")}) AS cacheRead,
    SUM(${sqlCount("u.cache_write_tokens")}) AS cacheWrite
  FROM session_model_usage u
  LEFT JOIN sessions s ON s.id = u.session_id
  GROUP BY u.session_id, ${modelOf("u.model")}`;

const sessionTotals = (fallbackMs: number, hasPerModel: boolean): string => `
  SELECT
    'hermes:' || s.id AS session,
    ${modelOf("s.model")} AS model,
    ${sqlEpochMs("s.started_at", fallbackMs)} AS at,
    ${sqlCount("s.input_tokens")} AS input,
    ${sqlCount("s.output_tokens")} AS output,
    ${sqlCount("s.cache_read_tokens")} AS cacheRead,
    ${sqlCount("s.cache_write_tokens")} AS cacheWrite
  FROM sessions s
  ${
    hasPerModel
      ? `WHERE NOT EXISTS (SELECT 1 FROM session_model_usage u WHERE u.session_id = s.id
          AND ${usageColumns
            .filter((name) => name !== "model")
            .map((name) => sqlCount(`u.${name}`))
            .join(" + ")} > 0)`
      : ""
  }`;

/** The Hermes homes to read: `HERMES_HOME` alone when set, else the default folders. */
const hermesHomes = (home: string) =>
  Effect.gen(function* resolveHomes() {
    const path = yield* Path.Path;
    const configured = yield* environmentFolder("HERMES_HOME");
    return Option.match(configured, {
      onNone: () => [path.join(home, ".hermes"), path.join(home, "AppData", "Local", "hermes")],
      onSome: (folder) => [folder],
    });
  });

/** `state.db` of a Hermes home and of each named profile in it, unless the home is a profile. */
const stateDatabases = (hermesHome: string) =>
  Effect.gen(function* listDatabases() {
    const path = yield* Path.Path;
    const own = path.join(hermesHome, "state.db");
    if (path.basename(path.dirname(hermesHome)) === "profiles") {
      return [own];
    }
    const profiles = path.join(hermesHome, "profiles");
    const names = yield* listFolder(profiles);
    return [own, ...names.toSorted().map((name) => path.join(profiles, name, "state.db"))];
  });

/**
 * Hermes Agent (NousResearch/hermes-agent) keeps usage in SQLite `state.db` in its home:
 * `HERMES_HOME` when set, else `~/.hermes` and `~/AppData/Local/hermes` (Windows). Each named
 * profile has its own `profiles/<name>/state.db`, read too unless `HERMES_HOME` is itself a
 * profile folder.
 *
 * Hermes stores totals per session, not per call. Mapping:
 * - `session_model_usage` (one row per session, model, provider and task): summed per
 *   session and model;
 * - `sessions` totals (`input_tokens`, `output_tokens`, `cache_read_tokens`,
 *   `cache_write_tokens`, `model`), only for sessions with no `session_model_usage` row that
 *   holds tokens, so no session counts twice.
 * `session` = `hermes:` + session id, `at` = `sessions.started_at` (epoch seconds).
 * `input_tokens` already excludes cache; `reasoning_tokens` is part of `output_tokens`.
 */
export const readHermes: Reader = (home) =>
  Effect.gen(function* readFromHome() {
    const homes = yield* hermesHomes(home);
    // The unicorn rules mistake `Effect.forEach` for `Array#forEach`.
    // oxlint-disable-next-line unicorn/no-array-for-each, unicorn/no-array-method-this-argument
    const files = yield* Effect.forEach(homes, stateDatabases);
    return yield* readDatabases("Hermes Agent", files.flat(), (db, source) =>
      Effect.gen(function* readState() {
        const columns = yield* columnsOf(db);
        const hasPerModel =
          hasColumns(columns, "session_model_usage", ["session_id", ...usageColumns]) &&
          hasColumns(columns, "sessions", ["id", "started_at"]);
        const hasTotals = hasColumns(columns, "sessions", ["id", "started_at", ...usageColumns]);
        const parts = [
          ...(hasPerModel ? [perModel(source.mtimeMs)] : []),
          ...(hasTotals ? [sessionTotals(source.mtimeMs, hasPerModel)] : []),
        ];
        return parts.length > 0
          ? usageRows(yield* db.all(`${parts.join(" UNION ALL ")} ORDER BY at, session`))
          : [];
      }),
    );
  });
