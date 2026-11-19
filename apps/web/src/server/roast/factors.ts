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

/** The day the Wrapped comparisons (ice, glacier, ocean, land, drought) were read and checked. */
const wrapped = "2026-11-19";

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
  seaIcePerTon: factor(
    3,
    "m² of September Arctic sea ice lost per ton of CO2",
    "https://doi.org/10.1126/science.aag2345",
    "Notz and Stroeve, Science 354(6313), 2016: a sustained loss of 3 ± 0.3 m² of September sea-ice area per ton of CO2, from observations 1953 to 2015.",
    wrapped,
  ),
  henCageCm2: factor(
    432,
    "cm² of cage floor per battery hen",
    "https://uepcertified.com/wp-content/uploads/2020/02/Caged-UEP-Guidelines_17.pdf",
    "United Egg Producers guidelines: at least 67 square inches (432 cm²) of usable space per caged white hen. Less than a letter-size sheet of paper. The page uses it as the unit of melted sea ice.",
    wrapped,
  ),
  glacierPerKgCo2: factor(
    15,
    "kg of glacier ice eventually melted per kg of CO2",
    "https://www.fona.de/en/glacier-mass-loss-past-the-point-of-no-return",
    "Marzeion, Kaser, Maussion and Champollion, Nature Climate Change, 2018, as summarised by the German research ministry: every kg of CO2 emitted today causes about 15 kg of glacier melt in the long term. Glaciers outside Greenland and Antarctica only. Carbon Brief reports about 16 kg.",
    wrapped,
  ),
  oceanShare: factor(
    0.29,
    "share of emitted CO2 taken up by the ocean",
    "https://essd.copernicus.org/articles/18/3211/2026/",
    "Global Carbon Budget 2025: the ocean took up 29% of total CO2 emissions over the last decade. Dissolved CO2 makes seawater more acidic.",
    wrapped,
  ),
  droughtShare: factor(
    0.2,
    "share of data center water from water-stressed watersheds",
    "https://iopscience.iop.org/article/10.1088/1748-9326/abfba1",
    "Siddik, Shehabi and Marston, Environmental Research Letters 16(6), 2021: one-fifth of the direct water footprint of US data center servers comes from moderately to highly water-stressed watersheds. US data, applied to all usage.",
    wrapped,
  ),
  landPerMw: factor(
    9105,
    "m² of data center land per MW of capacity",
    "https://andymasley.com/writing/data-center-land-use-issues-are-fake/",
    "Midpoint of 1,500 to 3,000 acres per GW of new hyperscale build-out (2,250 acres per GW). Industry guides say 0.5 to 1.5 acres per MW. The line spreads the month's energy evenly over 30 days and counts the land that much power needs.",
    wrapped,
  ),
  schoolMealUsd: factor(
    0.12,
    "US dollars per school meal in a low-income country",
    "https://www.info-cooperazione.it/wp-content/uploads/2025/10/WFP-0000168637.pdf",
    "WFP, State of School Feeding Worldwide 2024, Annex II, Table A2.5: $22.09 per child per year in low-income countries, over 180 school days. The country data comes mostly from 2019 to 2024 surveys. Other estimates run from $0.25 to $0.55 a meal. The source is a copy of the WFP report; wfp.org blocks automated reads.",
    added,
  ),
  chadElectricityKwh: factor(
    18.2,
    "kWh of electricity generated per person per year in Chad",
    "https://ourworldindata.org/grapher/per-capita-electricity-generation",
    "Our World in Data, from Ember and the Energy Institute, 2024. It counts electricity generated, not used: Chad's grid loses some on the way, so a person there uses less.",
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
