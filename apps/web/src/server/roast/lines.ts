import { factors } from "./factors";
import { workdayMinutes } from "./impacts";
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

const unitRung = (
  perBase: number,
  one: string,
  many: string,
  text: (quantity: string) => string,
): Rung => ({ perBase, one, many, text });

const asMuchText = (quantity: string): string => `Your tokens hold as much text as ${quantity}.`;

const reading = (quantity: string): string =>
  `Reading all of the output would take you ${quantity}.`;

const floppies = (quantity: string): string =>
  `Saved as plain text, your tokens would fill ${quantity}.`;

const laptops = (quantity: string): string =>
  `The electricity behind your tokens adds up to ${quantity}.`;

const flown = (quantity: string): string =>
  `Your tokens put out as much CO2 as ${quantity} from London to New York.`;

const baths = (quantity: string): string =>
  `The data centers that ran your tokens used ${quantity}.`;

/**
 * Public copy. Each line states one comparison in plain words and stops: no punchline.
 * Lines never use the word "cache" and never mention ozone.
 */
const templates = {
  wikipedia: {
    severity: 9,
    rungs: [
      unitRung(1, "copy of English Wikipedia", "copies of English Wikipedia", asMuchText),
      unitRung(100, "percent of English Wikipedia", "percent of English Wikipedia", asMuchText),
    ],
  },
  reading: {
    severity: 8,
    rungs: [
      unitRung(1, "working day", "working days", reading),
      unitRung(8, "hour", "hours", reading),
      unitRung(workdayMinutes, "minute", "minutes", reading),
    ],
  },
  flights: {
    severity: 7,
    rungs: [
      unitRung(1, "flight", "flights", flown),
      unitRung(factors.flightKm.value, "kilometer of a flight", "kilometers of a flight", flown),
    ],
  },
  baths: {
    severity: 6,
    rungs: [
      unitRung(1, "bath of water", "baths of water", baths),
      unitRung(factors.bathLitres.value, "liter of water", "liters of water", baths),
    ],
  },
  laptops: {
    severity: 6,
    rungs: [unitRung(1, "full MacBook Pro charge", "full MacBook Pro charges", laptops)],
  },
  floppies: {
    severity: 5,
    rungs: [unitRung(1, "floppy disk", "floppy disks", floppies)],
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
