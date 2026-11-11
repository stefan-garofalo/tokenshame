import * as Schema from "effect/Schema";

import { Version } from "./version";

/** A token count: a non-negative safe integer. */
const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

/**
 * A raw model id as the agent logs it. The charset and length bound keep the
 * worst-case Share Link under 2,000 characters and keep prose out of it.
 */
export const ModelId = Schema.String.check(Schema.isPattern(/^[\w.:/@+-]{1,64}$/));

/** At most this many models travel by name; the rest are summed into `other`. */
export const maxModels = 8;

/** The four raw token counts the CLI reads from a Usage Source. */
export const Tokens = Schema.Struct({
  input: Count,
  output: Count,
  cacheRead: Count,
  cacheWrite: Count,
});
export interface Tokens extends Schema.Schema.Type<typeof Tokens> {}

export const ModelUsage = Schema.Struct({ model: ModelId, ...Tokens.fields });
export interface ModelUsage extends Schema.Schema.Type<typeof ModelUsage> {}

/** A calendar day as `YYYY-MM-DD`; calendar dates that do not exist are rejected. */
const Day = Schema.String.check(
  Schema.isPattern(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/),
  Schema.makeFilter((day) => new Date(`${day}T00:00:00Z`).toISOString().startsWith(day)),
);

/**
 * The Usage Summary: the only numbers that leave the machine. Raw counts only;
 * no prompt text, project name, or path.
 *
 * - `models`: the top {@link maxModels} models by tokens.
 * - `other`: counts of every model beyond those, summed.
 * - `busiestHour`: hour of day, 0 to 23.
 * - `firstDay`: the day of the earliest usage found.
 */
export const Summary = Schema.Struct({
  version: Version,
  models: Schema.Array(ModelUsage).check(Schema.isMaxLength(maxModels)),
  other: Tokens,
  sessions: Count,
  busiestHour: Count.check(Schema.isLessThanOrEqualTo(23)),
  firstDay: Day,
});
export interface Summary extends Schema.Schema.Type<typeof Summary> {}

/** Tokens Processed: the public headline, the raw total of every count in the summary. */
export const tokensProcessed = (summary: Summary): number =>
  [...summary.models, summary.other].reduce(
    (total, { input, output, cacheRead, cacheWrite }) =>
      total + input + output + cacheRead + cacheWrite,
    0,
  );
