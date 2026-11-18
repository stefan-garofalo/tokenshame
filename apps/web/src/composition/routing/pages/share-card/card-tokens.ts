// The Share Card draws no stylesheet, so it copies the dark (Omarchy Matte Black) tokens of
// `src/index.css` (the `--ts-*` custom properties). `share-card.test.tsx` fails when a value drifts from the Share Page's.

export const colors = {
  accent: "#e68e0d",
  accentInk: "#090909",
  bar: "#2a2a2a",
  bg: "#090909",
  ink: "#eaeaea",
  muted: "#8a8a8d",
  raised: "#1e1e1e",
  surface: "#121212",
} as const;

export const family = "JetBrains Mono";

/** Display type: weight 800, tightened, set tight. Text is weight 500. */
export const display = { leading: 0.95, weight: 800 } as const;
export const tracking = "-0.04em";
export const textWeight = 500;

/** The Share Card is 1200 by 630 pixels, the size X shows for `summary_large_image`. */
export const card = { gap: 8, height: 630, margin: 12, pad: 28, width: 1200 } as const;
