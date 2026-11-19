import type { Summary, Tokens } from "@tokenshame/share-link/summary";

import { factors } from "./factors";

export type ImpactId =
  | "water"
  | "ice"
  | "glacier"
  | "ocean"
  | "land"
  | "coal"
  | "meals"
  | "flights"
  | "trees"
  | "homes"
  | "tons"
  | "power";

/** The impacts that are KPIs of the bento. */
export type KpiId = Extract<ImpactId, "water" | "ice" | "glacier" | "ocean" | "land">;

/**
 * One Impact Estimate. `amount` is in the id's base unit:
 * water: litres, ice: cm² of Arctic sea ice, glacier: kg of glacier ice, ocean: kg of CO2 in
 * the ocean, land: m² of data center land, coal: plant-hours, meals: school meals,
 * flights: one-way flights, trees: tree-years, homes: home-years of heating,
 * tons: tons of CO2, power: person-years of electricity in Chad.
 */
export interface Impact {
  id: ImpactId;
  amount: number;
}

/** What the impacts are computed from. */
export interface ImpactBase {
  /** Tokens that cost compute, see {@link weightedTokens}. */
  weighted: number;
  /** What the tokens would cost at API list prices. */
  costUsd: number;
}

const hoursPerYear = 8760;
/** A Usage Summary covers the last 30 days. */
const hoursPerMonth = 720;

/** Tokens that cost compute: a cache read counts at the single weight from factors. */
const weigh = ({ input, output, cacheRead, cacheWrite }: Tokens): number =>
  input + output + cacheWrite + cacheRead * factors.cacheReadWeight.value;

const allTokens = (summary: Summary): readonly Tokens[] => [...summary.models, summary.other];

export const weightedTokens = (summary: Summary): number =>
  allTokens(summary).reduce((total, tokens) => total + weigh(tokens), 0);

/**
 * Impact Estimates for one summary. Energy, CO2, water and land come from the weighted tokens;
 * the school meals from the cost. An impact of zero is left out: there is nothing to roast.
 * The first five are the KPIs of the bento, in its order.
 */
export const impactsOf = ({ weighted, costUsd }: ImpactBase): readonly Impact[] => {
  const kwh = weighted * factors.energyPerToken.value;
  const tons = (kwh * factors.gridCo2.value) / 1_000_000;
  const litres = kwh * factors.waterPerKwh.value;

  const all: readonly Impact[] = [
    { id: "water", amount: litres },
    { id: "ice", amount: tons * factors.seaIcePerTon.value * 10_000 },
    { id: "glacier", amount: tons * 1000 * factors.glacierPerKgCo2.value },
    { id: "ocean", amount: tons * 1000 * factors.oceanShare.value },
    { id: "land", amount: (kwh / hoursPerMonth / 1000) * factors.landPerMw.value },
    { id: "coal", amount: (tons / factors.coalPlantCo2.value) * hoursPerYear },
    { id: "meals", amount: costUsd / factors.schoolMealUsd.value },
    { id: "flights", amount: tons / factors.flightCo2.value },
    { id: "trees", amount: tons / factors.treeCo2.value },
    { id: "homes", amount: kwh / factors.homeHeating.value },
    { id: "tons", amount: tons },
    { id: "power", amount: kwh / factors.chadElectricityKwh.value },
  ];
  return all.filter(({ amount }) => amount > 0);
};
