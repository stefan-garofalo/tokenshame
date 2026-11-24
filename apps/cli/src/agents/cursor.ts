import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import { hasColumns, readUsageDatabase } from "./copilot";
import { unknownModel } from "./pi";
import type { Reader } from "./types";
import { appDataFolders } from "./vscode";

const count = (field: string): string =>
  `MAX(CAST(COALESCE(json_extract(v, '$.tokenCount.${field}'), 0) AS INTEGER), 0)`;

// `bubbleId:<composer id>:<bubble id>` rows. A value that is not JSON reads as NULL, so one
// bad row cannot fail `json_extract` for the whole query.
const bubbleRows = `
  SELECT
    'cursor:' || substr(rest, 1, instr(rest, ':') - 1) AS session,
    COALESCE(NULLIF(TRIM(json_extract(v, '$.modelInfo.modelName')), ''), '${unknownModel}') AS model,
    CASE WHEN typeof(json_extract(v, '$.createdAt')) IN ('integer', 'real')
      THEN CAST(json_extract(v, '$.createdAt') AS INTEGER)
      ELSE CAST(unixepoch(json_extract(v, '$.createdAt'), 'subsec') * 1000 AS INTEGER) END AS at,
    ${count("inputTokens")} AS input,
    ${count("outputTokens")} AS output,
    0 AS cacheRead,
    0 AS cacheWrite
  FROM (
    SELECT substr(key, length('bubbleId:') + 1) AS rest,
      CASE WHEN json_valid(CAST(value AS TEXT)) THEN CAST(value AS TEXT) END AS v
    FROM cursorDiskKV
    WHERE key LIKE 'bubbleId:%')
  WHERE json_extract(v, '$.tokenCount.inputTokens') > 0
    OR json_extract(v, '$.tokenCount.outputTokens') > 0
  ORDER BY at, session`;

/**
 * Cursor keeps chats in its global `state.vscdb`, `<app data>/Cursor/User/globalStorage/`
 * (macOS, Linux and Windows app data folders; on Linux also `XDG_CONFIG_HOME`). Table
 * `cursorDiskKV`, one `bubbleId:<composer id>:<bubble id>` row per chat message, its value
 * JSON. Only the real per-message counts are read: `tokenCount.inputTokens` (`input`) and
 * `tokenCount.outputTokens` (`output`). Current Cursor builds leave both at 0; such rows are
 * skipped, never estimated from text or the context meter, so a recent install is `no-data`.
 * Cursor logs no cache split. `session` = `cursor:` + composer id, `model` =
 * `modelInfo.modelName` (else unknown), `at` = `createdAt`; a row without it is dropped.
 *
 * The cursor-agent CLI (`~/.cursor`) is not read: it stores transcripts, no token counts.
 */
export const readCursor: Reader = (home) =>
  Effect.gen(function* readFromHome() {
    const path = yield* Path.Path;
    const bases = yield* appDataFolders(home);
    return yield* readUsageDatabase(
      "Cursor",
      bases.map((base) => path.join(base, "Cursor", "User", "globalStorage", "state.vscdb")),
      (columns) =>
        hasColumns(columns, "cursorDiskKV", ["key", "value"])
          ? Option.some(bubbleRows)
          : Option.none(),
    );
  });
