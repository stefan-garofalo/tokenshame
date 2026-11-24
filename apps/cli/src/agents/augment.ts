import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { NullableCount, NullableText, countOf, timeOf } from "./json-tools";
import { readFiles, stemOf, unknownModel } from "./pi";
import type { ParseFile } from "./pi";
import type { Reader, UsageRecord } from "./types";

const AugmentSession = Schema.Struct({
  agentState: Schema.optionalKey(Schema.NullOr(Schema.Struct({ modelId: NullableText }))),
  chatHistory: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.Unknown))),
  sessionId: NullableText,
});

const Turn = Schema.Struct({
  completed: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
  exchange: Schema.optionalKey(
    Schema.NullOr(
      Schema.Struct({
        model_id: NullableText,
        request_id: NullableText,
        response_nodes: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.Unknown))),
      }),
    ),
  ),
  finishedAt: NullableText,
  sequenceId: Schema.optionalKey(Schema.NullOr(Schema.Union([Schema.String, Schema.Finite]))),
});

const ResponseNode = Schema.Struct({
  token_usage: Schema.optionalKey(
    Schema.NullOr(
      Schema.Struct({
        cache_creation_input_tokens: NullableCount,
        cache_read_input_tokens: NullableCount,
        input_tokens: NullableCount,
        output_tokens: NullableCount,
      }),
    ),
  ),
});

const decodeSession = Schema.decodeUnknownOption(Schema.fromJsonString(AugmentSession));
const decodeTurn = Schema.decodeUnknownOption(Turn);
const decodeNode = Schema.decodeUnknownOption(ResponseNode);

type Counts = Pick<UsageRecord, "cacheRead" | "cacheWrite" | "input" | "output">;

/** The last response node with usage: a later node holds the final totals, never an addition. */
const lastUsage = (nodes: readonly unknown[]): Counts | undefined =>
  nodes
    .flatMap((raw) => {
      const usage = Option.getOrUndefined(decodeNode(raw))?.token_usage;
      if (usage === null || usage === undefined) {
        return [];
      }
      const counts: Counts = {
        cacheRead: countOf(usage.cache_read_input_tokens),
        cacheWrite: countOf(usage.cache_creation_input_tokens),
        input: countOf(usage.input_tokens),
        output: countOf(usage.output_tokens),
      };
      return counts.input + counts.output + counts.cacheRead + counts.cacheWrite > 0
        ? [counts]
        : [];
    })
    .at(-1);

const parseAugment: ParseFile = (file) =>
  Option.map(decodeSession(file.text), (augment) => {
    const session = `augment:${augment.sessionId ?? stemOf(file.segments, ".json")}`;
    const sessionModel = augment.agentState?.modelId ?? undefined;
    // A snapshot can keep a turn twice; its request id (else sequence id) names it once.
    const byTurn = new Map<string, UsageRecord>();
    for (const [index, raw] of (augment.chatHistory ?? []).entries()) {
      const turn = Option.getOrUndefined(decodeTurn(raw));
      const exchange = turn?.exchange;
      const counts = lastUsage(exchange?.response_nodes ?? []);
      if (
        turn?.completed === true &&
        exchange !== null &&
        exchange !== undefined &&
        counts !== undefined
      ) {
        byTurn.set(exchange.request_id ?? String(turn.sequenceId ?? `#${index}`), {
          at: timeOf(turn.finishedAt, file.mtimeMs),
          ...counts,
          model: exchange.model_id ?? sessionModel ?? unknownModel,
          session,
        });
      }
    }
    return [...byTurn.values()];
  });

/**
 * Augment Code (Auggie CLI). Reads the session snapshots `~/.augment/sessions/<session>.json`
 * (the same on every platform), one session per file. Each `chatHistory[]` turn with
 * `completed: true` gives one record from the last `exchange.response_nodes[].token_usage`
 * with counts (a later node is the final total, never an addition): `input_tokens`,
 * `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens` map to `input`,
 * `output`, `cacheRead`, `cacheWrite` (Anthropic style: cache is kept out of `input_tokens`).
 * Unfinished turns are skipped. `model` = `exchange.model_id`, else `agentState.modelId`.
 * `session` = `augment:` + `sessionId` (else the file name). `at` = the turn's `finishedAt`,
 * else the file time. Credits are ignored. A turn kept twice (same `request_id`, else
 * `sequenceId`) counts once.
 */
export const readAugment: Reader = (home) =>
  readFiles(
    "Augment Code",
    home,
    [".augment", "sessions"],
    (segments) => segments.length === 1 && segments[0]?.endsWith(".json") === true,
    parseAugment,
  );
