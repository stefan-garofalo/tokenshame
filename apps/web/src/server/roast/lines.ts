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
  /** Set for a KPI of the bento. */
  tile?: Tile;
}

/** A KPI as a bento tile: the figure and unit, then what they are of, then a deadpan quip. */
export interface Tile {
  label: string;
  quip: string;
}

/**
 * One way to say an impact. `perBase` is how many of this rung's unit fit in the
 * impact's base unit. `text` gets the figure and the unit already joined, and the value. A rung
 * is used from `min` up (1 unless set). A `whole` rung counts whole units: people, not 3.4 of them.
 */
interface Rung {
  perBase: number;
  one: string;
  many: string;
  text: (quantity: string, value: number) => string;
  min?: number;
  whole?: boolean;
}

interface Template {
  severity: number;
  /** Largest unit first. The first rung that reaches its `min` wins. */
  rungs: readonly Rung[];
  /** A KPI of the bento has a tile. `quip` gets the value in the chosen rung's unit. */
  tile?: { label: string; quip: (value: number, rung: Rung) => string };
}

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

const days = 365;
const hours = 8760;

const unitRung = (
  perBase: number,
  one: string,
  many: string,
  text: (quantity: string, value: number) => string,
): Rung => ({ perBase, one, many, text });

/** Whole bottles from a water-stressed watershed, when there is at least one. */
const droughtBottles = (bottles: number): number =>
  Math.floor(bottles * factors.droughtShare.value);

const drank = (quantity: string, bottles: number): string => {
  const dry = droughtBottles(bottles);
  const drought =
    dry >= 1
      ? `${formatFigure(dry)} came from a drought zone.`
      : "A fifth of it came from a drought zone.";
  return `You drank ${quantity} of water. ${drought} Cry about it.`;
};

const sipped = (quantity: string): string =>
  `You drank ${quantity} of water. A fifth of it came from a drought zone. Cry about it.`;

const melted = (quantity: string): string =>
  `You melted ${quantity} of Arctic sea ice. Polar bears can swim.`;

const glacier = (quantity: string): string =>
  `Your CO2 will melt ${quantity} of glacier ice. Ice is temporary, shipping is forever.`;

const swallowed = (quantity: string): string =>
  `The ocean swallowed ${quantity} of your CO2. Coral will cope.`;

const paved = (quantity: string): string =>
  `You kept ${quantity} of data center land busy all month. It was a forest once. Everything was.`;

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

const massRungs = (text: (quantity: string) => string): readonly Rung[] => [
  unitRung(0.001, "ton", "tons", text),
  unitRung(1, "kilogram", "kilograms", text),
  unitRung(1000, "gram", "grams", text),
];

/**
 * Public copy. A meme, not a report: every line turns the tokens into a cost the planet or
 * someone else pays, keeps one real number from a cited source, and shrugs it off. The five KPIs
 * of the bento come first and have a tile; the rest is ranked by how bad it sounds. Lines never
 * use the word "cache" or "agent", and never mention ozone.
 */
const templates = {
  water: {
    severity: 9,
    // Litres. Whole 500 mL bottles from one bottle; below, milliliters.
    rungs: [
      { ...unitRung(2, "bottle", "bottles", drank), whole: true },
      unitRung(1000, "milliliter", "milliliters", sipped),
    ],
    tile: {
      label: "of water",
      quip: (value, rung) => {
        const dry = rung.whole === true ? droughtBottles(value) : 0;
        return dry >= 1
          ? `${formatFigure(dry)} from a drought zone`
          : "a fifth from a drought zone";
      },
    },
  },
  ice: {
    severity: 9,
    // cm² of sea ice, counted in battery-hen cages from one cage.
    rungs: [
      unitRung(1 / factors.henCageCm2.value, "battery-hen cage", "battery-hen cages", melted),
      unitRung(1, "square centimeter", "square centimeters", melted),
    ],
    tile: { label: "of Arctic sea ice", quip: () => "polar bears can swim" },
  },
  glacier: {
    severity: 8,
    rungs: massRungs(glacier),
    tile: { label: "of glacier, melted", quip: () => "ice is temporary" },
  },
  ocean: {
    severity: 7,
    rungs: massRungs(swallowed),
    tile: { label: "of CO2 in the ocean", quip: () => "coral will cope" },
  },
  land: {
    severity: 7,
    rungs: [
      unitRung(0.0001, "hectare", "hectares", paved),
      unitRung(1, "square meter", "square meters", paved),
      unitRung(10_000, "square centimeter", "square centimeters", paved),
    ],
    tile: { label: "of data center land", quip: () => "it was a forest once" },
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
} satisfies Record<ImpactId, Template>;

export const render = (id: ImpactId, amount: number): RenderedLine => {
  const template: Template = templates[id];
  const { severity, rungs, tile } = template;
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
  const text = chosen.text(`${figure} ${unit}`, value);
  const line = { id, text, figure, unit, value, severity };
  return tile ? { ...line, tile: { label: tile.label, quip: tile.quip(value, chosen) } } : line;
};
