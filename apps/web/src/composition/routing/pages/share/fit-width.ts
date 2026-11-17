// JetBrains Mono is monospace: every glyph advances 0.6em (600 of 1000 units), whatever the weight.
const advance = 0.6;
const tracking = -0.04;

/**
 * Width of the ink of one line at the display tracking, in em. The tracking after the last
 * character does not count: it moves no ink.
 */
const fitWidth = (text: string): number => {
  const count = [...text].length;
  return count * advance + Math.max(count - 1, 0) * tracking;
};

// A short line ("0") would grow past its pane; the cap keeps it inside.
const maxFontSize = "20rem";

/**
 * The `font-size` that makes `text` span `span` percent of the nearest container's width, up to a cap.
 * The container needs `container-type: inline-size`.
 */
export const fitFontSize = (text: string, span: number | string = 100): string =>
  `min(calc(${span} * 1cqw / ${fitWidth(text)}), ${maxFontSize})`;
