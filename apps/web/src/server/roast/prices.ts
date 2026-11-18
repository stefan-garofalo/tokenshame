import type { Tokens } from "@tokenshame/share-link/summary";

/** List price of one model, in US dollars per million tokens of each kind. */
export interface Price {
  name: string;
  /** Raw model ids this price applies to, as agents log them without a date suffix. */
  ids: readonly string[];
  unit: "USD per 1M tokens";
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  source: string;
  date: string;
}

const checkedOn = "2026-11-11";

const anthropic = "https://platform.claude.com/docs/en/about-claude/pricing";
const openai = "https://developers.openai.com/api/docs/pricing";
const google = "https://ai.google.dev/gemini-api/docs/pricing";

const price = (
  source: string,
  name: string,
  ids: readonly string[],
  input: number,
  output: number,
  cacheRead: number,
  cacheWrite: number,
): Price => ({
  name,
  ids,
  unit: "USD per 1M tokens",
  input,
  output,
  cacheRead,
  cacheWrite,
  source,
  date: checkedOn,
});

/** Anthropic bills a cache write at 1.25 times the input price (5 minute cache). */
const claude = (
  name: string,
  ids: readonly string[],
  input: number,
  output: number,
  cacheRead: number,
): Price => price(anthropic, name, ids, input, output, cacheRead, input * 1.25);

/** OpenAI and Google do not bill a cache write, so it costs the plain input price. */
const gpt = (
  name: string,
  ids: readonly string[],
  input: number,
  output: number,
  cacheRead: number,
  source: string = openai,
): Price => price(source, name, ids, input, output, cacheRead, input);

const gemini = (
  name: string,
  ids: readonly string[],
  input: number,
  output: number,
  cacheRead: number,
): Price => price(google, name, ids, input, output, cacheRead, input);

/**
 * Standard-tier list prices from the vendors' pricing pages, short-context rows.
 * Introductory prices that end soon are not used: the price after the end date is.
 * Haiku 5.5 uses its up to 100,000 token row, because the link holds no prompt sizes.
 */
export const prices: readonly Price[] = [
  claude("Claude Fable 5.2", ["claude-fable-5-2"], 8, 40, 0.2),
  claude("Claude Fable 5.1", ["claude-fable-5-1"], 10, 50, 0.25),
  claude("Claude Fable 5", ["claude-fable-5"], 10, 50, 1),
  claude("Claude Mythos 5.2", ["claude-mythos-5-2"], 8, 40, 0.2),
  claude("Claude Mythos 5.1", ["claude-mythos-5-1"], 10, 50, 0.25),
  claude("Claude Mythos 5", ["claude-mythos-5"], 10, 50, 1),
  claude("Claude Opus 5.5", ["claude-opus-5-5"], 4, 20, 0.2),
  claude("Claude Opus 5", ["claude-opus-5"], 5, 25, 0.5),
  claude("Claude Opus 4.8", ["claude-opus-4-8"], 5, 25, 0.5),
  claude("Claude Opus 4.7", ["claude-opus-4-7"], 5, 25, 0.5),
  claude("Claude Opus 4.6", ["claude-opus-4-6"], 5, 25, 0.5),
  claude("Claude Opus 4.5", ["claude-opus-4-5"], 5, 25, 0.5),
  claude("Claude Opus 4.1", ["claude-opus-4-1"], 15, 75, 1.5),
  claude("Claude Opus 4", ["claude-opus-4"], 15, 75, 1.5),
  claude("Claude Sonnet 5.5", ["claude-sonnet-5-5"], 2, 10, 0.1),
  claude("Claude Sonnet 5", ["claude-sonnet-5"], 2, 10, 0.2),
  claude("Claude Sonnet 4.6", ["claude-sonnet-4-6"], 3, 15, 0.3),
  claude("Claude Sonnet 4.5", ["claude-sonnet-4-5"], 3, 15, 0.3),
  claude("Claude Sonnet 4", ["claude-sonnet-4"], 3, 15, 0.3),
  claude("Claude Haiku 5.5", ["claude-haiku-5-5"], 0.1, 0.5, 0.01),
  claude("Claude Haiku 4.5", ["claude-haiku-4-5"], 1, 5, 0.1),

  gpt("GPT-6 Astra", ["gpt-6-astra"], 10, 50, 1),
  gpt("GPT-6.1 Sol", ["gpt-6.1-sol"], 2, 10, 0.1),
  gpt("GPT-6.1 Terra", ["gpt-6.1-terra"], 1, 5, 0.05),
  gpt("GPT-6 Sol", ["gpt-6-sol"], 2, 10, 0.2),
  gpt("GPT-6 Luna", ["gpt-6-luna"], 0.1, 0.5, 0.01),
  gpt("GPT-5.6 Sol", ["gpt-5.6-sol"], 4, 20, 0.4),
  gpt("GPT-5.6 Terra", ["gpt-5.6-terra"], 2, 12, 0.2),
  gpt("GPT-5.6 Luna", ["gpt-5.6-luna"], 0.2, 1.2, 0.02),
  gpt("GPT-5.5", ["gpt-5.5"], 5, 30, 0.5),
  gpt("GPT-5.4", ["gpt-5.4"], 2.5, 15, 0.25),
  gpt("GPT-5.4 mini", ["gpt-5.4-mini"], 0.75, 4.5, 0.075),
  gpt("GPT-5.4 nano", ["gpt-5.4-nano"], 0.2, 1.25, 0.02),
  gpt("GPT-5.3 Codex", ["gpt-5.3-codex"], 1.75, 14, 0.175),
  gpt("GPT-5.2", ["gpt-5.2"], 1.75, 14, 0.175),
  gpt("GPT-5.1", ["gpt-5.1"], 1.25, 10, 0.125),
  gpt(
    "GPT-5.1 Codex",
    ["gpt-5.1-codex"],
    1.25,
    10,
    0.125,
    "https://developers.openai.com/api/docs/models/gpt-5.1-codex",
  ),
  gpt("GPT-5", ["gpt-5"], 1.25, 10, 0.125),
  gpt(
    "GPT-5 Codex",
    ["gpt-5-codex"],
    1.25,
    10,
    0.125,
    "https://developers.openai.com/api/docs/models/gpt-5-codex",
  ),
  gpt("GPT-5 mini", ["gpt-5-mini"], 0.25, 2, 0.025),
  gpt("GPT-5 nano", ["gpt-5-nano"], 0.05, 0.4, 0.005),
  gpt("GPT-4.1", ["gpt-4.1"], 2, 8, 0.5),
  gpt("GPT-4.1 mini", ["gpt-4.1-mini"], 0.4, 1.6, 0.1),
  gpt("GPT-4o", ["gpt-4o"], 2.5, 10, 1.25),
  gpt("GPT-4o mini", ["gpt-4o-mini"], 0.15, 0.6, 0.075),
  gpt("o3", ["o3"], 2, 8, 0.5),

  gemini("Gemini 4 Carbon", ["gemini-4-carbon"], 4, 20, 0.2),
  gemini("Gemini 4 Argon", ["gemini-4-argon"], 4, 20, 0.2),
  gemini("Gemini 3.8 Flash", ["gemini-3.8-flash"], 1.5, 7.5, 0.15),
  gemini("Gemini 3.6 Flash", ["gemini-3.6-flash"], 1.5, 7.5, 0.15),
  gemini("Gemini 3.5 Flash-Lite", ["gemini-3.5-flash-lite"], 0.3, 2.5, 0.03),
  gemini("Gemini 3.1 Flash-Lite", ["gemini-3.1-flash-lite"], 0.25, 1.5, 0.025),
  gemini("Gemini 3.1 Pro", ["gemini-3.1-pro", "gemini-3.1-pro-preview"], 2, 12, 0.2),
  gemini("Gemini 3 Flash", ["gemini-3-flash", "gemini-3-flash-preview"], 0.5, 3, 0.05),
  gemini("Gemini 2.5 Pro", ["gemini-2.5-pro"], 1.25, 10, 0.125),
  gemini("Gemini 2.5 Flash", ["gemini-2.5-flash"], 0.3, 2.5, 0.03),
  gemini("Gemini 2.5 Flash-Lite", ["gemini-2.5-flash-lite"], 0.1, 0.4, 0.01),
];

/**
 * Price for a model id we do not know: a mid-tier frontier price, the Claude
 * Sonnet 4.6 row. The spec asks that an unknown id still renders.
 */
export const fallbackPrice: Price = price(anthropic, "Other models", [], 3, 15, 0.3, 3.75);

/**
 * Agents log ids in many forms: `anthropic/claude-opus-4.5`, `claude-opus-4-5-20251101`,
 * `Gemini-2.5-Pro-latest`. Lowercase, drop the vendor prefix and the date or `latest`
 * suffix, and write dots as dashes, so one key matches them all.
 */
const keyOf = (id: string): string =>
  id
    .toLowerCase()
    .slice(id.lastIndexOf("/") + 1)
    .replace(/-(?:\d{8}|\d{4}-\d{2}-\d{2}|latest)$/u, "")
    .replaceAll(".", "-");

const byKey = new Map(
  prices.flatMap((entry) => entry.ids.map((id) => [keyOf(id), entry] as const)),
);

/** The price for a raw model id. `undefined` means the id is unknown. */
export const priceOf = (id: string): Price | undefined => byKey.get(keyOf(id));

/** Cost in US dollars of one model's counts at one price. */
export const costOf = (tokens: Tokens, entry: Price): number =>
  (tokens.input * entry.input +
    tokens.output * entry.output +
    tokens.cacheRead * entry.cacheRead +
    tokens.cacheWrite * entry.cacheWrite) /
  1_000_000;
