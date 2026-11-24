import * as Effect from "effect/Effect";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { columnsOf, readDatabases, rowsOf, sqlCount, sqlEpochMs, UsageRow } from "./databases";
import type { DatabaseFile } from "./databases";
import { xdgDataFolder } from "./env";
import { unknownModel } from "./pi";
import type { ReadOnlyDatabase } from "./sqlite";
import type { Reader } from "./types";

/** One assistant turn of an opencode-style `message` table: its usage and its identity. */
const TurnRow = Schema.Struct({
  ...UsageRow.fields,
  /** `time.completed`, as stored. Together with `at` it tells a forked copy from a new turn. */
  completed: Schema.NullOr(Schema.Finite),
  /** The id inside the payload, when it has one. */
  id: Schema.NullOr(Schema.String),
});

export type OpencodeTurn = typeof TurnRow.Type;

const decodeTurn = Schema.decodeUnknownOption(TurnRow);

const field = (path: string): string => `json_extract(m.data, '$.${path}')`;

// Token counts are read with `json_extract`, so message text never reaches this process.
// `CASE WHEN json_valid` keeps one malformed row from failing the whole query.
const turnsQuery = (fallbackMs: number): string => `
  SELECT
    COALESCE(NULLIF(${field("session_id")}, ''), m.session_id) AS session,
    COALESCE(NULLIF(${field("modelID")}, ''), NULLIF(${field("model.id")}, ''), '${unknownModel}') AS model,
    ${sqlEpochMs(field("time.created"), fallbackMs)} AS at,
    ${field("time.completed")} AS completed,
    CAST(${field("id")} AS TEXT) AS id,
    ${sqlCount(field("tokens.input"))} AS input,
    ${sqlCount(field("tokens.output"))} + ${sqlCount(field("tokens.reasoning"))} AS output,
    ${sqlCount(field("tokens.cache.read"))} AS cacheRead,
    ${sqlCount(field("tokens.cache.write"))} AS cacheWrite
  FROM message m
  WHERE CASE WHEN json_valid(m.data)
    THEN ${field("role")} = 'assistant' AND json_type(m.data, '$.tokens') = 'object'
    ELSE 0 END
  ORDER BY m.rowid`;

/**
 * The assistant turns of a database in opencode's message schema, shared by the opencode
 * forks Kilo CLI and MiMo Code: table `message` (`session_id`, `data` JSON). Mapping:
 * `model` = `data.modelID` (else `data.model.id`, else unknown), session = `data.session_id`
 * else the row's `session_id`, `at` = `data.time.created` (milliseconds, or seconds in some
 * MiMo builds; missing: the file's last change). `tokens.input` already excludes cache,
 * `tokens.output` excludes `tokens.reasoning`, so `output` = output + reasoning.
 * A database without that table has no turns.
 */
export const opencodeTurns = (db: ReadOnlyDatabase, source: DatabaseFile) =>
  Effect.gen(function* readTurns() {
    const columns = yield* columnsOf(db);
    if (!columns.has("message.data") || !columns.has("message.session_id")) {
      return [];
    }
    return rowsOf(yield* db.all(turnsQuery(source.mtimeMs)), decodeTurn);
  });

/**
 * Kilo CLI (Kilo-Org/kilocode, an opencode fork) keeps usage in `kilo.db` in its XDG data
 * folder: `$XDG_DATA_HOME/kilo`, else `~/.local/share/kilo`, on every platform. Mapping as
 * in `opencodeTurns`, with `session` = `kilo:` + the session id. Sessions Kilo CLI imported
 * from the Kilo Code extension (model `legacy`) carry zero tokens, so they add nothing.
 */
export const readKilo: Reader = (home) =>
  Effect.gen(function* readFromHome() {
    const path = yield* Path.Path;
    const folder = yield* xdgDataFolder(home, "kilo");
    return yield* readDatabases("Kilo CLI", [path.join(folder, "kilo.db")], (db, source) =>
      Effect.map(opencodeTurns(db, source), (turns) =>
        turns.map((turn) => ({
          at: turn.at,
          cacheRead: turn.cacheRead,
          cacheWrite: turn.cacheWrite,
          input: turn.input,
          model: turn.model,
          output: turn.output,
          session: `kilo:${turn.session}`,
        })),
      ),
    );
  });
