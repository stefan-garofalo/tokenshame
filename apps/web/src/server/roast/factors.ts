/**
 * One number the roast engine multiplies by.
 *
 * `date` is the day the source was read and the value checked. The year the
 * data describes goes in `note`. Rough estimates say so in `note`.
 */
export interface Factor {
  value: number;
  unit: string;
  source: string;
  date: string;
  note: string;
}

const checkedOn = "2026-11-11";

const factor = (
  value: number,
  unit: string,
  source: string,
  note: string,
  date = checkedOn,
): Factor => ({ value, unit, source, date, note });

/** The day the comparisons added on 2026-11-18 were read and checked. */
const added = "2026-11-18";

export const factors = {
  cacheReadWeight: factor(
    0.1,
    "weighted tokens per cache-read token",
    "https://platform.claude.com/docs/en/about-claude/pricing",
    "Editorial choice (grill Q24). Anthropic bills a cache hit at 0.1 times the base input price, and we use the same ratio as a proxy for compute. Real compute per cache read is not published.",
  ),
  energyPerToken: factor(
    0.00000024,
    "kWh per weighted token",
    "https://epoch.ai/gradient-updates/how-much-energy-does-chatgpt-use",
    "Rough estimate. Epoch AI puts a GPT-4o query with about 10,000 input and 500 output tokens near 2.5 Wh (Feb 2025), which is 0.24 mWh per token. Google measured 0.24 Wh for a median Gemini text prompt (arXiv 2508.15734, Aug 2025). Real values change with model and hardware, by a factor of ten either way.",
  ),
  gridCo2: factor(
    473,
    "g CO2 per kWh",
    "https://ember-energy.org/latest-insights/global-electricity-review-2025/global-electricity-trends/",
    "World average carbon intensity of electricity in 2024, from Ember. Data centers differ by region.",
  ),
  waterPerKwh: factor(
    1.08,
    "litres of water per kWh",
    "https://arxiv.org/abs/2508.15734",
    "Derived from Google's median Gemini prompt: 0.26 mL of water for 0.24 Wh (2025). It counts the whole data center, cooling included. Rough estimate for other providers.",
  ),
  flightCo2: factor(
    0.38,
    "tons CO2 per one-way economy passenger, London to New York",
    "https://greencalculus.com/convert/co2e-to-flights-london-new-york/",
    "About 5,540 km at the UK DEFRA 2026 long-haul economy factor, without the radiative-forcing uplift. We count CO2 only, so the figure is the low end. With the uplift it is about 0.65 t. The page is a secondary source for the DEFRA numbers.",
  ),
  flightKm: factor(
    5540,
    "km, London to New York great-circle distance",
    "https://greencalculus.com/convert/co2e-to-flights-london-new-york/",
    "Used to show a small share of a flight as kilometers flown.",
  ),
  wordsPerToken: factor(
    0.75,
    "English words per token",
    "https://developers.openai.com/api/docs/concepts",
    "OpenAI's rule of thumb: a token is about 4 characters or 0.75 words of English text. Anthropic puts it near 3.5 characters, and newer Claude models make about 30% more tokens for the same text. Code differs from prose.",
    added,
  ),
  charsPerToken: factor(
    4,
    "characters of English text per token",
    "https://developers.openai.com/api/docs/concepts",
    "Same rule of thumb as wordsPerToken. We count one byte per character, which holds for plain ASCII text.",
    added,
  ),
  wikipediaWords: factor(
    5_125_583_368,
    "words in the articles of English Wikipedia",
    "https://en.wikipedia.org/wiki/Wikipedia:Size_of_Wikipedia",
    "The last measured count, from 1 March 2026. The same page gives a larger running estimate that is not a measurement.",
    added,
  ),
  readingWpm: factor(
    238,
    "words per minute, silent reading of English non-fiction",
    "https://doi.org/10.1016/j.jml.2019.104047",
    "Brysbaert, Journal of Memory and Language 109, 2019: a meta-analysis of 190 studies with 18,573 readers. Most adults read non-fiction at 175 to 300 words a minute. People read code more slowly than prose.",
    added,
  ),
  floppyBytes: factor(
    1_474_560,
    "bytes on a 3.5-inch HD floppy disk",
    "https://en.wikipedia.org/wiki/Disk_formatting",
    "The formatted capacity sold as 1.44 MB: 80 tracks on each of 2 sides, 18 sectors of 512 bytes per track.",
    added,
  ),
  laptopBatteryKwh: factor(
    0.1,
    "kWh in one full MacBook Pro 16-inch battery",
    "https://www.apple.com/macbook-pro/specs/",
    "Apple lists a 100-watt-hour battery and an actual rating of 99.6 Wh. Charging losses are left out.",
    added,
  ),
  bathLitres: factor(
    80,
    "litres of water in a typical bath",
    "https://waterwise.org.uk/how-to-save-water/",
    "Waterwise, the UK water-efficiency charity. A full tub holds more: an Australian utility gives 140 litres.",
    added,
  ),
  devHourlyWage: factor(
    64.44,
    "US dollars per hour, median pay of US software developers, QA analysts and testers",
    "https://www.bls.gov/ooh/computer-and-information-technology/software-developers.htm",
    "US Bureau of Labor Statistics, May 2025. It is the only hourly median BLS gives for the group. The page's slider starts here and the reader can move it.",
    added,
  ),
} satisfies Record<string, Factor>;
