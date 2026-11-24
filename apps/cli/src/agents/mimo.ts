import * as Effect from "effect/Effect";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { hasColumns } from "./copilot";
import { columnsOf, readDatabases, rowsOf, sqlEpochMs } from "./databases";
import { listFolder } from "./folders";
import { xdgDataFolder } from "./env";
import { opencodeTurns } from "./kilo";
import type { OpencodeTurn } from "./kilo";
import type { Reader, UsageRecord } from "./types";

const SessionRow = Schema.Struct({
  created: Schema.NullOr(Schema.Int),
  desktop: Schema.Int,
  id: Schema.String,
});
const decodeSessionRow = Schema.decodeUnknownOption(SessionRow);

// The desktop app stamps its sessions' `version` with a `desktop-` install version.
const sessionsQuery = (columns: ReadonlySet<string>): string => `
  SELECT
    id,
    ${columns.has("session.version") ? "LOWER(TRIM(COALESCE(version, ''))) LIKE 'desktop-%'" : "0"} AS desktop,
    ${columns.has("session.time_created") ? sqlEpochMs("time_created", 0) : "NULL"} AS created
  FROM session`;

/** The data folder of MiMo Code when the orca app drives it through its hook sandbox. */
const orcaHooksData = [
  "Library",
  "Application Support",
  "orca",
  "mimocode-hooks",
  "shared",
  "data",
];

const channelDatabase = /^mimocode-[\w.-]+\.db$/u;

/**
 * Rank of a turn: 0 when it was made in its own session, 1 when unknown, 2 when it is older
 * than its session, so a copy a fork made of an earlier session's history.
 */
const rank = (turn: OpencodeTurn, created: number | null | undefined): number => {
  if (created === null || created === undefined || created <= 0) {
    return 1;
  }
  return turn.at >= created ? 0 : 2;
};

// A fork copies earlier turns into the new session under new ids, but keeps their times and
// counts; a turn with the same id, or the same model, times and counts, is the same call.
const fingerprint = (turn: OpencodeTurn): string =>
  JSON.stringify([
    turn.model,
    turn.at,
    turn.completed,
    turn.input,
    turn.output,
    turn.cacheRead,
    turn.cacheWrite,
  ]);

/**
 * Reads MiMo's databases and keeps the turns of one surface. Each call is counted once,
 * in the session that made it, across every database of the folder.
 */
const readMimo =
  (agent: string, desktop: boolean): Reader =>
  (home) =>
    Effect.gen(function* readFromHome() {
      const path = yield* Path.Path;
      const folders = [yield* xdgDataFolder(home, "mimocode"), path.join(home, ...orcaHooksData)];
      const files: string[] = [];
      for (const folder of folders) {
        const names = yield* listFolder(folder);
        files.push(
          ...["mimocode.db", ...names.filter((name) => channelDatabase.test(name)).toSorted()].map(
            (name) => path.join(folder, name),
          ),
        );
      }
      const seen = new Set<string>();
      return yield* readDatabases(agent, files, (db, source) =>
        Effect.gen(function* readSurface() {
          const columns = yield* columnsOf(db);
          const sessions = hasColumns(columns, "session", ["id"])
            ? rowsOf(yield* db.all(sessionsQuery(columns)), decodeSessionRow)
            : [];
          const byId = new Map(sessions.map((session) => [session.id, session]));
          const turns = (yield* opencodeTurns(db, source)).toSorted(
            (a, b) => rank(a, byId.get(a.session)?.created) - rank(b, byId.get(b.session)?.created),
          );
          const records: UsageRecord[] = [];
          for (const turn of turns) {
            const keys = [fingerprint(turn), ...(turn.id === null ? [] : [`id:${turn.id}`])];
            if (keys.some((key) => seen.has(key))) {
              continue;
            }
            for (const key of keys) {
              seen.add(key);
            }
            if ((byId.get(turn.session)?.desktop === 1) === desktop) {
              records.push({
                at: turn.at,
                cacheRead: turn.cacheRead,
                cacheWrite: turn.cacheWrite,
                input: turn.input,
                model: turn.model,
                output: turn.output,
                session: `mimo:${turn.session}`,
              });
            }
          }
          return records;
        }),
      );
    });

/**
 * MiMo Code (Xiaomi's opencode fork) keeps usage in its XDG data folder,
 * `$XDG_DATA_HOME/mimocode` else `~/.local/share/mimocode`: `mimocode.db`, and
 * `mimocode-<channel>.db` for other release channels. When the orca app drives MiMo Code, it
 * writes the same files to `~/Library/Application Support/orca/mimocode-hooks/shared/data`,
 * which can hold sessions the XDG copy lacks; both folders are read. The Xiaomi MiMo AI desktop app shares
 * that store; its sessions have a `session.version` that starts with `desktop-`, and are
 * read by `readMimoDesktop` instead.
 *
 * Mapping as in `opencodeTurns` (Kilo CLI), with `session` = `mimo:` + session id.
 * A forked session copies earlier turns under new ids with their times and counts; a turn
 * with an id, or a model, times and counts, already seen is dropped, keeping the copy in
 * the session that made the call. The same holds across every database of both folders.
 */
export const readMimoCode: Reader = readMimo("MiMo Code", false);

/** Xiaomi MiMo AI desktop: the sessions of the MiMo Code store made by the desktop app. */
export const readMimoDesktop: Reader = readMimo("Xiaomi MiMo AI", true);
