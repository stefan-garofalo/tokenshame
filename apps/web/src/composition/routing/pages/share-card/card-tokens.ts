// The Share Card draws no stylesheet, so it copies the tokens of `src/index.css` (the `--ts-*` custom
// properties). `share-card.test.tsx` fails when a value drifts from the Share Page's.

export const colors = {
  accent: "#c6f19d",
  accentInk: "#0b140b",
  bar: "#1a251a",
  bg: "#050805",
  ink: "#e8f2e5",
  muted: "#8a9a88",
  raised: "#121a12",
  surface: "#0b110b",
} as const;

export const family = "JetBrains Mono";

/** Display type: weight 800, tightened, set tight. Text is weight 500. */
export const display = { leading: 0.95, weight: 800 } as const;
export const tracking = "-0.04em";
export const textWeight = 500;

/** The Share Card is 1200 by 630 pixels, the size X shows for `summary_large_image`. */
export const card = { gap: 8, height: 630, margin: 12, pad: 28, width: 1200 } as const;
