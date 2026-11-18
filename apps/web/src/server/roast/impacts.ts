import type { Summary, Tokens } from "@tokenshame/share-link/summary";

import { factors } from "./factors";

export type ImpactId =
  | "water"
  | "coal"
  | "meals"
  | "flights"
  | "trees"
  | "homes"
  | "tons"
  | "power"
  | "wikipedia";

/**
 * One Impact Estimate. `amount` is in the id's base unit:
 * water: person-days of the WHO minimum of water, coal: plant-hours, meals: school meals,
 * flights: one-way flights, trees: tree-years, homes: home-years of heating,
 * tons: tons of CO2, power: person-years of electricity in Chad, wikipedia: copies of
 * English Wikipedia.
 */
export interface Impact {
  id: ImpactId;
  amount: number;
}

/** What the impacts are computed from. */
export interface ImpactBase {
  /** Tokens Processed: every count, unweighted. */
  tokens: number;
  /** Tokens that cost compute, see {@link weightedTokens}. */
  weighted: number;
  /** What the tokens would cost at API list prices. */
  costUsd: number;
}

const hoursPerYear = 8760;

/** Tokens that cost compute: a cache read counts at the single weight from factors. */
const weigh = ({ input, output, cacheRead, cacheWrite }: Tokens): number =>
  input + output + cacheWrite + cacheRead * factors.cacheReadWeight.value;

const allTokens = (summary: Summary): readonly Tokens[] => [...summary.models, summary.other];

export const weightedTokens = (summary: Summary): number =>
  allTokens(summary).reduce((total, tokens) => total + weigh(tokens), 0);

/**
 * Impact Estimates for one summary. Energy, CO2 and water come from the weighted tokens; the
 * school meals from the cost; the text volume from the raw counts. An impact of zero
 * is left out: there is nothing to roast.
 */
export const impactsOf = ({ tokens, weighted, costUsd }: ImpactBase): readonly Impact[] => {
  const kwh = weighted * factors.energyPerToken.value;
  const tons = (kwh * factors.gridCo2.value) / 1_000_000;
  const litres = kwh * factors.waterPerKwh.value;

  const all: readonly Impact[] = [
    { id: "water", amount: litres / factors.waterPerPerson.value },
    { id: "coal", amount: (tons / factors.coalPlantCo2.value) * hoursPerYear },
    { id: "meals", amount: costUsd / factors.schoolMealUsd.value },
    { id: "flights", amount: tons / factors.flightCo2.value },
    { id: "trees", amount: tons / factors.treeCo2.value },
    { id: "homes", amount: kwh / factors.homeHeating.value },
    { id: "tons", amount: tons },
    { id: "power", amount: kwh / factors.chadElectricityKwh.value },
    {
      id: "wikipedia",
      amount: (tokens * factors.wordsPerToken.value) / factors.wikipediaWords.value,
    },
  ];
  return all.filter(({ amount }) => amount > 0);
};
