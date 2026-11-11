// The Share Card draws no stylesheet, so it copies the tokens of `src/index.css` (the `--ts-*` custom
// properties). `share-card.test.tsx` fails when a value drifts from the Share Page's.

export const colors = {
  bone: "#e2dccf",
  ink: "#2a1110",
  mustard: "#e0a912",
  red: "#b01220",
  redInk: "#fff",
} as const;

export const family = "Epilogue";

/** Display type: weight 900, tightened, set tight. Text is weight 500. */
export const display = { leading: 0.9, weight: 900 } as const;
export const tracking = "-0.04em";
export const textWeight = 500;

/** The Share Card is 1200 by 630 pixels, the size X shows for `summary_large_image`. */
export const card = { height: 630, margin: 32, width: 1200 } as const;
