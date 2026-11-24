import * as Effect from "effect/Effect";
import * as Path from "effect/Path";

import { hasColumns } from "./copilot";
import { columnsOf, readDatabases, sqlCount, usageRows } from "./databases";
import { unknownModel } from "./pi";
import type { Reader } from "./types";

const usage = (name: string): string => `json_extract(m.value, '$.usage.${name}.actual')`;

// Only the usage and model of each message leave SQLite: `json_each` walks the context and
// `json_extract` picks the fields, so message text never reaches this process.
// `CASE WHEN json_valid` keeps one malformed context from failing the whole query.
const messagesQuery = (fallbackMs: number): string => `
  SELECT
    'forge:' || c.conversation_id AS session,
    COALESCE(NULLIF(json_extract(m.value, '$.message.text.model'), ''), '${unknownModel}') AS model,
    COALESCE(
      CAST(unixepoch(COALESCE(c.updated_at, c.created_at), 'subsec') * 1000 AS INTEGER),
      ${fallbackMs}) AS at,
    MAX(${sqlCount(usage("prompt_tokens"))} - ${sqlCount(usage("cached_tokens"))}, 0) AS input,
    ${sqlCount(usage("completion_tokens"))} AS output,
    MIN(${sqlCount(usage("cached_tokens"))}, ${sqlCount(usage("prompt_tokens"))}) AS cacheRead,
    0 AS cacheWrite
  FROM conversations c,
    json_each(CASE WHEN json_valid(c.context) THEN c.context ELSE '{}' END, '$.messages') m
  WHERE LOWER(json_extract(m.value, '$.message.text.role')) = 'assistant'
  ORDER BY c.rowid, m.key`;

/**
 * Forge (antinomyhq/forge) keeps conversations in SQLite `~/.forge/.forge.db`, table
 * `conversations` (`conversation_id`, `context` JSON, `created_at`, `updated_at`). Each
 * assistant message in `context.messages` carries its call's `usage`. Mapping:
 * `session` = `forge:` + `conversation_id`, `model` = `message.text.model`, `at` = the
 * conversation's `updated_at` (else `created_at`; messages have no time of their own);
 * `prompt_tokens` counts cache inside it, so `input` = `prompt_tokens` - `cached_tokens`,
 * `cacheRead` = `cached_tokens`, `output` = `completion_tokens`. Only `actual` counts are
 * read; Forge's `approx` counts are estimates and are skipped.
 */
export const readForge: Reader = (home) =>
  Effect.gen(function* readFromHome() {
    const path = yield* Path.Path;
    return yield* readDatabases("Forge", [path.join(home, ".forge", ".forge.db")], (db, source) =>
      Effect.gen(function* readConversations() {
        const columns = yield* columnsOf(db);
        return hasColumns(columns, "conversations", [
          "context",
          "conversation_id",
          "created_at",
          "updated_at",
        ])
          ? usageRows(yield* db.all(messagesQuery(source.mtimeMs)))
          : [];
      }),
    );
  });
