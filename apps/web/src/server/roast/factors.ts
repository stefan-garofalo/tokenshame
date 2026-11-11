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

const factor = (value: number, unit: string, source: string, note: string): Factor => ({
  value,
  unit,
  source,
  date: checkedOn,
  note,
});

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
  coalPlantCo2: factor(
    33_877_953,
    "tons CO2 per year, Vindhyachal Super Thermal Power Station (NTPC, Madhya Pradesh, India)",
    "https://doi.org/10.1088/1748-9326/ac13f1",
    "2018 emissions of the plant ranked second worst on Earth in Grant, Zelinka and Mitova, Environmental Research Letters 16(9), 2021. It is India's top CO2 emitter among power plants. Climate TRACE lists a similar 33.4 Mt for a later year. We spread the year evenly over 8,760 hours.",
  ),
  treeCo2: factor(
    0.06,
    "tons CO2 absorbed per urban tree per year",
    "https://www.epa.gov/energy/greenhouse-gas-equivalencies-calculator-calculations-and-references",
    "US EPA: 36.4 lb of carbon per year for a medium urban tree over its first ten years (0.060 t CO2). A forest tree can differ.",
  ),
  homeHeating: factor(
    8600,
    "kWh of space heating per dwelling per year",
    "https://www.odyssee-mure.eu/publications/efficiency-by-sector/households/household-eu.pdf",
    "EU average, 0.74 toe per dwelling (ODYSSEE-MURE, from Eurostat), at 11,630 kWh per toe. The range across member states is about 700 to 16,500 kWh. All GPU electricity ends up as heat.",
  ),
  villagePopulation: factor(
    1000,
    "people per village",
    "https://en.wikipedia.org/wiki/2011_Census_of_India",
    "Round number chosen by us. The 2011 Census of India counts 833,087,662 rural people in more than 600,000 villages, about 1,300 per village on average. Many villages are smaller.",
  ),
  waterPerPerson: factor(
    20,
    "litres per person per day",
    "https://iris.who.int/server/api/core/bitstreams/c1461987-2c3f-4e63-8f4c-7e44498e5644/content",
    "WHO basic access to water: at least 20 L per person per day, for drinking and basic hygiene. WHO calls it a guide, not a formal guideline.",
  ),
  cigarettePackPrice: factor(
    9.95,
    "US dollars per pack of 20 cigarettes",
    "https://tobaccoinsider.com/usa-cigarette-prices/",
    "US average retail price of a mainstream brand, weighted by sales volume, with taxes (page posted 2026-08-26). The unweighted state average is $10.34.",
  ),
} satisfies Record<string, Factor>;
