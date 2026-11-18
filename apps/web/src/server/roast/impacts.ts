import type { Summary, Tokens } from "@tokenshame/share-link/summary";

import { factors } from "./factors";

export type ImpactId =
  | "villages"
  | "coal"
  | "packs"
  | "flights"
  | "trees"
  | "homes"
  | "tons"
  | "wikipedia"
  | "reading"
  | "laptops"
  | "floppies";

/**
 * One Impact Estimate. `amount` is in the id's base unit:
 * villages: village-days supplied, coal: plant-hours, packs: packs of cigarettes,
 * flights: one-way flights, trees: tree-years, homes: home-years of heating,
 * tons: tons of CO2, wikipedia: copies of English Wikipedia, reading: working days
 * of reading, laptops: full laptop charges, floppies: floppy disks.
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
  /** What the tokens would cost at API list prices. */
  costUsd: number;
}

const hoursPerYear = 8760;

/** A working day of reading, in minutes: eight hours. */
export const workdayMinutes = 8 * 60;

const words = (tokens: number): number => tokens * factors.wordsPerToken.value;

/** Tokens that cost compute: a cache read counts at the single weight from factors. */
const weigh = ({ input, output, cacheRead, cacheWrite }: Tokens): number =>
  input + output + cacheWrite + cacheRead * factors.cacheReadWeight.value;

const allTokens = (summary: Summary): readonly Tokens[] => [...summary.models, summary.other];

export const weightedTokens = (summary: Summary): number =>
  allTokens(summary).reduce((total, tokens) => total + weigh(tokens), 0);

export const outputTokens = (summary: Summary): number =>
  allTokens(summary).reduce((total, { output }) => total + output, 0);

/**
 * Impact Estimates for one summary. Energy, CO2 and water come from the weighted tokens; the
 * cigarettes from the cost; text volume and reading time from the raw counts. An impact of zero
 * is left out: there is nothing to roast.
 */
export const impactsOf = ({ tokens, output, weighted, costUsd }: ImpactBase): readonly Impact[] => {
  const kwh = weighted * factors.energyPerToken.value;
  const tons = (kwh * factors.gridCo2.value) / 1_000_000;
  const litres = kwh * factors.waterPerKwh.value;
  const villageLitresPerDay = factors.villagePopulation.value * factors.waterPerPerson.value;

  const all: readonly Impact[] = [
    { id: "villages", amount: litres / villageLitresPerDay },
    { id: "coal", amount: (tons / factors.coalPlantCo2.value) * hoursPerYear },
    { id: "packs", amount: costUsd / factors.cigarettePackPrice.value },
    { id: "flights", amount: tons / factors.flightCo2.value },
    { id: "trees", amount: tons / factors.treeCo2.value },
    { id: "homes", amount: kwh / factors.homeHeating.value },
    { id: "tons", amount: tons },
    { id: "wikipedia", amount: words(tokens) / factors.wikipediaWords.value },
    { id: "reading", amount: words(output) / factors.readingWpm.value / workdayMinutes },
    { id: "laptops", amount: kwh / factors.laptopBatteryKwh.value },
    {
      id: "floppies",
      amount: (tokens * factors.charsPerToken.value) / factors.floppyBytes.value,
    },
  ];
  return all.filter(({ amount }) => amount > 0);
};
