import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { NullableCount, NullableText, countOf } from "./json-tools";
import { hasTokens, readFiles, unknownModel } from "./pi";
import type { ParseFile } from "./pi";
import type { Reader, UsageRecord } from "./types";

const Totals = Schema.Struct({
  cache_read_tokens: NullableCount,
  cache_write_tokens: NullableCount,
  input_tokens: NullableCount,
  model: NullableText,
  output_tokens: NullableCount,
});

const UsageFile = Schema.Struct({
  session_id: NullableText,
  snapshot: Schema.optionalKey(
    Schema.NullOr(
      Schema.Struct({
        ...Totals.fields,
        models: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.Unknown))),
      }),
    ),
  ),
});

const decodeUsageFile = Schema.decodeUnknownOption(Schema.fromJsonString(UsageFile));
const decodeTotals = Schema.decodeUnknownOption(Totals);

const toRecord = (totals: typeof Totals.Type, session: string, at: number): UsageRecord => ({
  at,
  cacheRead: countOf(totals.cache_read_tokens),
  cacheWrite: countOf(totals.cache_write_tokens),
  input: countOf(totals.input_tokens),
  model: totals.model ?? unknownModel,
  output: countOf(totals.output_tokens),
  session,
});

// Segments below `sessions`: `<session>/usage-v2.json`.
const parseFx: ParseFile = (file) =>
  Option.map(decodeUsageFile(file.text), (usage) => {
    const { snapshot } = usage;
    if (snapshot === null || snapshot === undefined) {
      return [];
    }
    const session = `fx:${usage.session_id ?? file.segments[0] ?? ""}`;
    const perModel = (snapshot.models ?? [])
      .flatMap((raw) => Option.toArray(decodeTotals(raw)))
      .map((totals) => toRecord(totals, session, file.mtimeMs))
      .filter(hasTokens);
    // The session totals are the sum of the per-model rows: they stand in only when there are none.
    return perModel.length > 0
      ? perModel
      : [toRecord({ ...snapshot, model: undefined }, session, file.mtimeMs)];
  });

/**
 * fx (vercel-labs/fx). Reads `~/.fx/sessions/<session>/usage-v2.json` (the same on every
 * platform), one session per folder. fx keeps one running total per session: each
 * `snapshot.models[]` entry gives one record for its `model` (as logged, `provider/model`):
 * `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens` map to `input`,
 * `output`, `cacheRead`, `cacheWrite`; `reasoning_tokens` is not added. A snapshot with no
 * per-model entry gives its top-level totals once, with an unknown model. `session` = `fx:` +
 * `session_id`, else the folder name. Totals carry no per-call time, so `at` is the file's last
 * change. The global `~/.fx/usage.jsonl` names no session and is not read.
 */
export const readFx: Reader = (home) =>
  readFiles(
    "fx",
    home,
    [".fx", "sessions"],
    (segments) => segments.length === 2 && segments[1] === "usage-v2.json",
    parseFx,
  );
