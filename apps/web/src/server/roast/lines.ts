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
 * impact's base unit. `text` gets the figure and the unit already joined. A rung is
 * used from `min` up (1 unless set). A `whole` rung counts whole units: people, not 3.4 of them.
 */
interface Rung {
  perBase: number;
  one: string;
  many: string;
  text: (quantity: string) => string;
  min?: number;
  whole?: boolean;
}

interface Template {
  severity: number;
  /** Largest unit first. The first rung that reaches its `min` wins. */
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

const parched = (quantity: string): string =>
  `${quantity} went without their daily water minimum so you could ship that refactor.`;

const thirsty = (quantity: string): string =>
  `One person went ${quantity} without their daily water minimum so you could ship that refactor.`;

const coal = (quantity: string): string =>
  `That's ${quantity} of Vindhyachal, India's dirtiest coal plant, running just for you.`;

const meals = (quantity: string): string =>
  `Your API bill could have bought ${quantity} for kids in low-income countries. You bought a refactor.`;

const flown = (quantity: string): string =>
  `Same CO2 as ${quantity} from London to New York, minus the free snacks.`;

const absorbed = (quantity: string): string => `That's ${quantity} to clean up after you.`;

const heated = (quantity: string): string =>
  `The GPUs behind your tokens could have heated a home for ${quantity}. Cozy.`;

const emitted = (quantity: string): string => `You put ${quantity} of CO2 into the air. For vibes.`;

const chadPeople = (quantity: string): string =>
  `${quantity} in Chad live on that much electricity for a whole year.`;

const chadPerson = (quantity: string): string =>
  `One person in Chad lives on that much electricity for ${quantity}.`;

const unread = (quantity: string): string =>
  `That's as much text as ${quantity}, and nobody is ever going to read it.`;

/**
 * Public copy. A meme, not a report: every line turns the tokens into a cost someone else pays,
 * keeps one real number from a cited source, and ends deadpan. The damage is ranked by how bad
 * it sounds. Lines never use the word "cache" and never mention ozone.
 */
const templates = {
  water: {
    severity: 9,
    // Person-days of the WHO minimum. From three, count people; below, how long one person went without.
    rungs: [
      { ...unitRung(1, "person", "people", parched), min: 3, whole: true },
      unitRung(1, "day", "days", thirsty),
      unitRung(24, "hour", "hours", thirsty),
      unitRung(1440, "minute", "minutes", thirsty),
      unitRung(86_400, "second", "seconds", thirsty),
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
  meals: {
    severity: 8,
    rungs: [unitRung(1, "school meal", "school meals", meals)],
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
  power: {
    severity: 7,
    // Person-years of Chad's electricity. From two, count people; below, how long one person lives on it.
    rungs: [
      { ...unitRung(1, "person", "people", chadPeople), min: 2, whole: true },
      unitRung(days, "day", "days", chadPerson),
      unitRung(hours, "hour", "hours", chadPerson),
    ],
  },
  wikipedia: {
    severity: 6,
    rungs: [
      unitRung(1, "English Wikipedia", "English Wikipedias", unread),
      unitRung(100, "percent of English Wikipedia", "percent of English Wikipedia", unread),
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
  // The largest unit that reaches its minimum, or the smallest unit when none does.
  let [chosen] = rungs;
  for (const rung of rungs) {
    chosen = rung;
    if (amount * rung.perBase >= (rung.min ?? 1)) {
      break;
    }
  }
  const raw = amount * chosen.perBase;
  const value = chosen.whole === true ? Math.floor(raw) : raw;
  const figure = formatFigure(value);
  const unit = figure === "1" ? chosen.one : chosen.many;
  return { id, text: chosen.text(`${figure} ${unit}`), figure, unit, value, severity };
};
