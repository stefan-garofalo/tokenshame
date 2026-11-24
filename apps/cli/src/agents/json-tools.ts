import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";

import { toCount } from "./pi";

// Shared by the readers of agents that keep usage in JSON files below one or more folders
// (Codebuff, Mux, Junie, Augment Code, fx, Aside, Mistral Vibe, Proma, Kimi Code).

/** A count that the log may omit or write as `null`. */
export const NullableCount = Schema.optionalKey(Schema.NullOr(Schema.Finite));

/** A text that the log may omit or write as `null`. */
export const NullableText = Schema.optionalKey(Schema.NullOr(Schema.String));

/** `toCount` for a count that may be `null`. */
export const countOf = (value: number | null | undefined): number => toCount(value ?? undefined);

const millisecondsFrom = 1_000_000_000_000;

/**
 * Epoch milliseconds of a log time: an ISO text, or a number in epoch milliseconds or seconds
 * (a number below 10^12 is taken as seconds). The fallback when the time is missing or invalid.
 */
export const timeOf = (value: number | string | null | undefined, fallbackMs: number): number => {
  if (Predicate.isString(value)) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : fallbackMs;
  }
  if (!Predicate.isNumber(value) || !Number.isFinite(value) || value <= 0) {
    return fallbackMs;
  }
  return Math.trunc(value >= millisecondsFrom ? value : value * 1000);
};
