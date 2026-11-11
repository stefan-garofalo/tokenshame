import type { Summary } from "@tokenshame/share-link/summary";

/** The card shows this many of the page's lines. */
export const cardSize = 3;

/**
 * Dread, as one number. A figure of at least 1 outranks a fraction, so a line
 * like "0.04 flights" goes last. Next comes the editorial severity of the
 * comparison, times ten. The digits in the figure come last and only separate
 * two comparisons of equal severity. Equal dread is left to the hash.
 */
export const dreadOf = (severity: number, value: number): number =>
  (value >= 1 ? 100 : 0) + severity * 10 + Math.min(9, Math.floor(Math.log10(1 + value)));

const modulus = 4_294_967_291;

/** A polynomial rolling hash below 2^32. Stable across runs and platforms. */
const hash = (text: string): number => {
  let state = 7;
  for (const char of text) {
    state = (state * 131 + (char.codePointAt(0) ?? 0)) % modulus;
  }
  return state;
};

/**
 * The summary as one string, in a fixed field order. The Share Link is an encoding
 * of the summary, so this string changes exactly when the link does.
 */
export const keyOf = (summary: Summary): string =>
  [
    summary.version,
    summary.firstDay,
    summary.sessions,
    summary.busiestHour,
    ...[...summary.models, { model: "other", ...summary.other }].map(
      ({ model, input, output, cacheRead, cacheWrite }) =>
        `${model}:${input}:${output}:${cacheRead}:${cacheWrite}`,
    ),
  ].join("|");

/** Below zero when `left` comes first: higher dread, then the lower hash of the summary key and id. */
const compare = <Line extends { id: string; dread: number }>(
  left: Line,
  right: Line,
  key: string,
): number =>
  right.dread - left.dread ||
  hash(`${key}|${left.id}`) - hash(`${key}|${right.id}`) ||
  left.id.localeCompare(right.id);

/**
 * Highest dread first, equal dread by hash. An insertion sort: the lines are few, and
 * the web package's TypeScript library has no `toSorted`, which the lint rules ask for
 * in place of `sort`.
 */
export const rank = <Line extends { id: string; dread: number }>(
  lines: readonly Line[],
  key: string,
): Line[] => {
  const ranked: Line[] = [];
  for (const line of lines) {
    const before = ranked.findIndex((other) => compare(line, other, key) < 0);
    ranked.splice(before === -1 ? ranked.length : before, 0, line);
  }
  return ranked;
};
