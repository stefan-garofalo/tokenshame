import type { Summary, Tokens } from "@tokenshame/share-link/summary";

import { factors } from "./factors";

export type ImpactId = "villages" | "coal" | "packs" | "flights" | "trees" | "homes" | "tons";

/**
 * One Impact Estimate. `amount` is in the id's base unit:
 * villages: village-days supplied, coal: plant-hours, packs: packs of cigarettes,
 * flights: one-way flights, trees: tree-years, homes: home-years of heating,
 * tons: tons of CO2.
 */
export interface Impact {
  id: ImpactId;
  amount: number;
}

const hoursPerYear = 8760;

/** Tokens that cost compute: a cache read counts at the single weight from factors. */
const weigh = ({ input, output, cacheRead, cacheWrite }: Tokens): number =>
  input + output + cacheWrite + cacheRead * factors.cacheReadWeight.value;

export const weightedTokens = (summary: Summary): number =>
  [...summary.models, summary.other].reduce((total, tokens) => total + weigh(tokens), 0);

/**
 * Impact Estimates for one summary, from its weighted tokens and its API cost.
 * An impact of zero is left out: there is nothing to roast.
 */
export const impactsOf = (weighted: number, costUsd: number): readonly Impact[] => {
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
  ];
  return all.filter(({ amount }) => amount > 0);
};
