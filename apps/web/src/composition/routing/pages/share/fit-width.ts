// Advance widths of Epilogue 900 in em, measured in Chrome at no tracking. Digits use tabular numerals, so they are equal.
const advances = new Map<string, number>(
  Object.entries({
    " ": 0.25,
    "!": 0.311,
    $: 0.592,
    "'": 0.193,
    ",": 0.326,
    "-": 0.453,
    ".": 0.315,
    "?": 0.58,
    "’": 0.282,
    A: 0.703,
    B: 0.664,
    C: 0.735,
    D: 0.702,
    E: 0.589,
    F: 0.588,
    G: 0.741,
    H: 0.74,
    I: 0.304,
    J: 0.611,
    K: 0.71,
    L: 0.552,
    M: 0.986,
    N: 0.779,
    O: 0.782,
    P: 0.647,
    Q: 0.782,
    R: 0.666,
    S: 0.648,
    T: 0.607,
    U: 0.694,
    V: 0.683,
    W: 0.999,
    X: 0.709,
    Y: 0.677,
    Z: 0.606,
    a: 0.641,
    b: 0.682,
    c: 0.636,
    d: 0.681,
    e: 0.654,
    f: 0.465,
    g: 0.645,
    h: 0.666,
    i: 0.272,
    j: 0.28,
    k: 0.611,
    l: 0.309,
    m: 0.964,
    n: 0.666,
    o: 0.651,
    p: 0.682,
    q: 0.681,
    r: 0.498,
    s: 0.567,
    t: 0.507,
    u: 0.656,
    v: 0.582,
    w: 0.855,
    x: 0.622,
    y: 0.589,
    z: 0.535,
  }),
);
const digit = 0.625;
const unknown = 0.65;
const tracking = -0.04;

const advance = (character: string): number => {
  if (/\d/u.test(character)) {
    return digit;
  }
  return advances.get(character) ?? unknown;
};

/**
 * Width of the ink of one line of Epilogue 900 at the display tracking, in em. The tracking after the
 * last character does not count: it moves no ink.
 */
const fitWidth = (text: string): number =>
  [...text].reduce(
    (width, character, index) => width + advance(character) + (index > 0 ? tracking : 0),
    0,
  );

/**
 * The `font-size` that makes `text` span `span` percent of the nearest container's width. The container
 * needs `container-type: inline-size`.
 */
export const fitFontSize = (text: string, span: number | string = 100): string =>
  `calc(${span} * 1cqw / ${fitWidth(text)})`;
