import { factors } from "./factors";
import type { ImpactId } from "./impacts";

/** A Roast Line before ranking. `value` is the number in `unit`, `figure` is how it reads. */
export interface RenderedLine {
  id: ImpactId;
  text: string;
  figure: string;
  unit: string;
  value: number;
  /** Editorial dread of the comparison, 1 to 9. See `pick.ts` for how it ranks. */
  severity: number;
}

/**
 * One way to say an impact. `perBase` is how many of this rung's unit fit in the
 * impact's base unit. `text` gets the figure and the unit already joined.
 */
interface Rung {
  perBase: number;
  one: string;
  many: string;
  text: (quantity: string) => string;
}

interface Template {
  severity: number;
  /** Largest unit first. The first rung that gives a figure of at least 1 wins. */
  rungs: readonly Rung[];
}

const days = 365;
const hours = 8760;

const unitRung = (
  perBase: number,
  one: string,
  many: string,
  text: (quantity: string) => string,
): Rung => ({ perBase, one, many, text });

const supplied = (quantity: string): string =>
  `Your tokens drank enough water to supply a village of 1,000 people for ${quantity}. The village got none of it.`;

const heated = (quantity: string): string =>
  `The GPUs behind your tokens gave off enough heat to warm a home for ${quantity}. It warmed a data center instead.`;

const coal = (quantity: string): string =>
  `Your tokens put out as much CO2 as ${quantity} of Vindhyachal, India's most polluting coal plant.`;

const cigarettes = (quantity: string): string =>
  `At API prices your tokens cost as much as ${quantity}. Cigarettes at least print the warning on the box.`;

const flown = (quantity: string): string =>
  `Your tokens emitted the CO2 of ${quantity} from London to New York, one way, economy.`;

const absorbed = (quantity: string): string =>
  `It takes ${quantity} to absorb the CO2 your tokens made.`;

const emitted = (quantity: string): string => `Your tokens put ${quantity} of CO2 into the air.`;

/**
 * Public copy. Lines blame the reader ("you did this") and stay concrete.
 * They never use the word "cache" and never mention ozone.
 */
const templates = {
  villages: {
    severity: 9,
    rungs: [
      unitRung(1 / days, "year", "years", supplied),
      unitRung(1, "day", "days", supplied),
      unitRung(24, "hour", "hours", supplied),
      unitRung(1440, "minute", "minutes", supplied),
      unitRung(86_400, "second", "seconds", supplied),
    ],
  },
  coal: {
    severity: 8,
    rungs: [
      unitRung(1, "hour", "hours", coal),
      unitRung(60, "minute", "minutes", coal),
      unitRung(3600, "second", "seconds", coal),
      unitRung(3_600_000, "millisecond", "milliseconds", coal),
    ],
  },
  packs: {
    severity: 8,
    rungs: [
      unitRung(1, "pack of cigarettes", "packs of cigarettes", cigarettes),
      unitRung(20, "cigarette", "cigarettes", cigarettes),
    ],
  },
  flights: {
    severity: 7,
    rungs: [
      unitRung(1, "flight", "flights", flown),
      unitRung(factors.flightKm.value, "kilometer of a flight", "kilometers of a flight", flown),
    ],
  },
  trees: {
    severity: 6,
    rungs: [
      unitRung(1, "tree working for a full year", "trees working for a full year", absorbed),
      unitRung(days, "day of one tree's work", "days of one tree's work", absorbed),
      unitRung(hours, "hour of one tree's work", "hours of one tree's work", absorbed),
    ],
  },
  homes: {
    severity: 6,
    rungs: [
      unitRung(1, "year", "years", heated),
      unitRung(days, "day", "days", heated),
      unitRung(hours, "hour", "hours", heated),
      unitRung(525_600, "minute", "minutes", heated),
    ],
  },
  tons: {
    severity: 5,
    rungs: [
      unitRung(1, "ton", "tons", emitted),
      unitRung(1000, "kilogram", "kilograms", emitted),
      unitRung(1_000_000, "gram", "grams", emitted),
    ],
  },
} satisfies Record<ImpactId, Template>;

const grouped = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const fractional = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

/** A whole count with thousands separators: `1,094,660,000`. */
export const formatCount = (count: number): string => grouped.format(count);

/** US dollars, to the cent below $100 and whole dollars above. */
export const formatUsd = (usd: number): string =>
  usd < 100 ? `$${usd.toFixed(2)}` : `$${grouped.format(usd)}`;

/** Two significant digits, and "million" or "billion" past a million. */
export const formatFigure = (value: number): string => {
  if (value < 0.01) {
    return "less than 0.01";
  }
  if (value >= 1e9) {
    return `${fractional.format(Number((value / 1e9).toPrecision(2)))} billion`;
  }
  if (value >= 1e6) {
    return `${fractional.format(Number((value / 1e6).toPrecision(2)))} million`;
  }
  if (value >= 1000) {
    return grouped.format(Number(value.toPrecision(3)));
  }
  return fractional.format(Number(value.toPrecision(2)));
};

export const render = (id: ImpactId, amount: number): RenderedLine => {
  const { severity, rungs } = templates[id];
  // The largest unit that gives a figure of at least 1, or the smallest unit when none does.
  let [chosen] = rungs;
  for (const rung of rungs) {
    chosen = rung;
    if (amount * rung.perBase >= 1) {
      break;
    }
  }
  const value = amount * chosen.perBase;
  const figure = formatFigure(value);
  const unit = figure === "1" ? chosen.one : chosen.many;
  return { id, text: chosen.text(`${figure} ${unit}`), figure, unit, value, severity };
};
