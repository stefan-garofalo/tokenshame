/**
 * Server Contract of the roast engine: a Usage Summary in, the numbers and the
 * Roast Lines for the Share Page and the Share Card out. Pure: no I/O, no clock,
 * no randomness, so one summary always gives the same result.
 *
 * Public strings never say "cache" and never mention ozone. `factors` and
 * `prices` are data for the README. Do not print their notes on a page.
 */
import type { Summary } from "@tokenshame/share-link/summary";
import { tokensProcessed } from "@tokenshame/share-link/summary";

import { impactsOf, weightedTokens } from "./impacts";
import type { ImpactId } from "./impacts";
import { formatCount, formatUsd, render } from "./lines";
import { cardSize, dreadOf, keyOf, rank } from "./pick";
import { costOf, fallbackPrice, priceOf } from "./prices";

export { factors } from "./factors";
export type { Factor } from "./factors";
export { prices } from "./prices";
export type { Price } from "./prices";
export type { ImpactId } from "./impacts";

/** One Roast Line. `text` is the sentence, `figure` and `unit` are the number inside it. */
export interface RoastLine {
  id: ImpactId;
  text: string;
  figure: string;
  unit: string;
  /** The number behind `figure`, in `unit`. */
  value: number;
  dread: number;
}

export interface Roast {
  headline: { tokens: number; figure: string; label: "tokens processed" };
  /** Tokens that cost compute: what the impacts are computed from. */
  weightedTokens: number;
  /** What the same tokens would cost at API list prices. */
  cost: { usd: number; figure: string };
  /** Cost per model in link order, with the model's name when we know it. */
  models: readonly { name: string; known: boolean; usd: number }[];
  /** Every line for the Share Page, most dreadful first. */
  lines: readonly RoastLine[];
  /** The first three of `lines`, for the Share Card. */
  cardLines: readonly RoastLine[];
}

export const roast = (summary: Summary): Roast => {
  const models = summary.models.map((tokens) => {
    const price = priceOf(tokens.model);
    return {
      name: (price ?? fallbackPrice).name,
      known: price !== undefined,
      usd: costOf(tokens, price ?? fallbackPrice),
    };
  });
  const usd =
    models.reduce((total, { usd: modelUsd }) => total + modelUsd, 0) +
    costOf(summary.other, fallbackPrice);
  const weighted = weightedTokens(summary);

  const lines = rank(
    impactsOf(weighted, usd).map(({ id, amount }) => {
      const { severity, ...line } = render(id, amount);
      return { ...line, dread: dreadOf(severity, line.value) };
    }),
    keyOf(summary),
  );

  const tokens = tokensProcessed(summary);
  return {
    headline: { tokens, figure: formatCount(tokens), label: "tokens processed" },
    weightedTokens: weighted,
    cost: { usd, figure: formatUsd(usd) },
    models,
    lines,
    cardLines: lines.slice(0, cardSize),
  };
};
