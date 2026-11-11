import { currentVersion } from "@tokenshame/share-link/version";
import { maxModels, ModelId } from "@tokenshame/share-link/summary";
import type { Summary, Tokens } from "@tokenshame/share-link/summary";
import type { NonEmptyReadonlyArray } from "effect/Array";
import * as Order from "effect/Order";
import * as Schema from "effect/Schema";

import type { UsageRecord } from "./agents/types";

const noTokens: Tokens = { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 };

const add = (left: Tokens, right: Tokens): Tokens => ({
  cacheRead: left.cacheRead + right.cacheRead,
  cacheWrite: left.cacheWrite + right.cacheWrite,
  input: left.input + right.input,
  output: left.output + right.output,
});

const total = ({ cacheRead, cacheWrite, input, output }: Tokens): number =>
  cacheRead + cacheWrite + input + output;

const isModelId = Schema.is(ModelId);

const byTokensThenId = Order.combine(
  Order.flip(
    Order.mapInput(Order.Number, ([, tokens]: readonly [string, Tokens]) => total(tokens)),
  ),
  Order.mapInput(Order.String, ([model]: readonly [string, Tokens]) => model),
);

const pad = (value: number): string => String(value).padStart(2, "0");

/** The local calendar day of an instant, as `YYYY-MM-DD`. */
const localDay = (at: number): string => {
  const date = new Date(at);
  return `${String(date.getFullYear()).padStart(4, "0")}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

/**
 * Builds the Usage Summary of every record found, all time (AC-008).
 *
 * - `models`: the top {@link maxModels} models by tokens, then by id. A model with no
 *   tokens adds nothing, so it is left out.
 * - `other`: the sum of every further model, and of every model id that does not
 *   fit the link format, so `encode` never fails on a strange id.
 * - `sessions`: distinct session keys; a record with no tokens still counts its session.
 * - `busiestHour`: the local hour of day with the most tokens; the earliest hour wins a tie.
 * - `firstDay`: the local day of the earliest record.
 */
export const summarize = (records: NonEmptyReadonlyArray<UsageRecord>): Summary => {
  const perModel = new Map<string, Tokens>();
  const perHour: number[] = Array.from({ length: 24 }, () => 0);
  let other = noTokens;
  let earliest = records[0].at;

  for (const record of records) {
    earliest = Math.min(earliest, record.at);
    const hour = new Date(record.at).getHours();
    perHour[hour] = (perHour[hour] ?? 0) + total(record);
    if (isModelId(record.model)) {
      perModel.set(record.model, add(perModel.get(record.model) ?? noTokens, record));
    } else {
      other = add(other, record);
    }
  }

  const ranked = [...perModel].filter(([, tokens]) => total(tokens) > 0).toSorted(byTokensThenId);
  for (const [, tokens] of ranked.slice(maxModels)) {
    other = add(other, tokens);
  }

  return {
    busiestHour: perHour.indexOf(Math.max(...perHour)),
    firstDay: localDay(earliest),
    models: ranked.slice(0, maxModels).map(([model, { cacheRead, cacheWrite, input, output }]) => ({
      cacheRead,
      cacheWrite,
      input,
      model,
      output,
    })),
    other,
    sessions: new Set(records.map(({ session }) => session)).size,
    version: currentVersion,
  };
};
