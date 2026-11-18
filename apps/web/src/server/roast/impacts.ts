import type { Summary, Tokens } from "@tokenshame/share-link/summary";

import { factors } from "./factors";

export type ImpactId = "wikipedia" | "reading" | "floppies" | "laptops" | "flights" | "baths";

/**
 * One Impact Estimate. `amount` is in the id's base unit:
 * wikipedia: copies of English Wikipedia, reading: working days of reading,
 * floppies: floppy disks, laptops: full laptop charges, flights: one-way flights,
 * baths: baths of water.
 */
export interface Impact {
  id: ImpactId;
  amount: number;
}

/** What the impacts are computed from. */
export interface ImpactBase {
  /** Tokens Processed: every count, unweighted. */
  tokens: number;
  /** Output tokens: the text the agents wrote. */
  output: number;
  /** Tokens that cost compute, see {@link weightedTokens}. */
  weighted: number;
}

/** A working day of reading, in minutes: eight hours. */
export const workdayMinutes = 8 * 60;

/** Tokens that cost compute: a cache read counts at the single weight from factors. */
const weigh = ({ input, output, cacheRead, cacheWrite }: Tokens): number =>
  input + output + cacheWrite + cacheRead * factors.cacheReadWeight.value;

const allTokens = (summary: Summary): readonly Tokens[] => [...summary.models, summary.other];

export const weightedTokens = (summary: Summary): number =>
  allTokens(summary).reduce((total, tokens) => total + weigh(tokens), 0);

export const outputTokens = (summary: Summary): number =>
  allTokens(summary).reduce((total, { output }) => total + output, 0);

/**
 * Impact Estimates for one summary. Text volume comes from the raw token counts; energy,
 * CO2 and water come from the weighted tokens. An impact of zero is left out: there is
 * nothing to roast.
 */
export const impactsOf = ({ tokens, output, weighted }: ImpactBase): readonly Impact[] => {
  const kwh = weighted * factors.energyPerToken.value;
  const tons = (kwh * factors.gridCo2.value) / 1_000_000;
  const litres = kwh * factors.waterPerKwh.value;
  const writtenWords = output * factors.wordsPerToken.value;

  const all: readonly Impact[] = [
    {
      id: "wikipedia",
      amount: (tokens * factors.wordsPerToken.value) / factors.wikipediaWords.value,
    },
    { id: "reading", amount: writtenWords / factors.readingWpm.value / workdayMinutes },
    {
      id: "floppies",
      amount: (tokens * factors.charsPerToken.value) / factors.floppyBytes.value,
    },
    { id: "laptops", amount: kwh / factors.laptopBatteryKwh.value },
    { id: "flights", amount: tons / factors.flightCo2.value },
    { id: "baths", amount: litres / factors.bathLitres.value },
  ];
  return all.filter(({ amount }) => amount > 0);
};
