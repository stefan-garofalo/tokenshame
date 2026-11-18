// The Share Card draws no stylesheet, so it copies the tokens of `src/index.css` (the `--ts-*` custom
// properties). `share-card.test.tsx` fails when a value drifts from the Share Page's.

export const colors = {
  accent: "#ffb454",
  accentInk: "#000000",
  bar: "#262626",
  bg: "#000000",
  ink: "#ededed",
  muted: "#9a9a9a",
  raised: "#171717",
  surface: "#0d0d0d",
} as const;

export const family = "JetBrains Mono";

/** Display type: weight 800, tightened, set tight. Text is weight 500. */
export const display = { leading: 0.95, weight: 800 } as const;
export const tracking = "-0.04em";
export const textWeight = 500;

/** The Share Card is 1200 by 630 pixels, the size X shows for `summary_large_image`. */
export const card = { gap: 8, height: 630, margin: 12, pad: 28, width: 1200 } as const;
