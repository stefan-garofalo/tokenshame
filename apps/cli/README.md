# tokenshame

Your coding agents have been busy. Run one command to see how many tokens they burned in the last 30 days, and what that cost the planet: bottles of water (a fifth of them from drought zones), Arctic sea ice counted in battery-hen cages, glacier ice, CO2 dumped in the ocean, data center land, a coal plant's CO2, school meals, flights to New York and a year of electricity in Chad.

```bash
npx tokenshame
```

It reads the usage logs that 59 coding agents already keep on your machine, keeps the last 30 days, prints a short summary, and on Enter opens a page with the roast, wrapped like a year-in-review. The page has its own link and its own preview image, so you can post it on X.

## It's a meme

tokenshame is a roast, not a tool. It takes your real token count and turns it into the most guilt-trippy comparisons we could source, written to be screenshotted and posted. It is rage bait on purpose: the page flexes the damage instead of apologising for it ("Cry about it"), so the people who are angry about AI's water use have something to quote-post. It makes fun of you, of AI hype, and of the climate-guilt genre all at once.

The numbers are real enough to be funny and rough enough that you should not cite them anywhere. Every factor has a public source and a date (see [How we calculate](#how-we-calculate)), but put together they are back-of-the-envelope estimates, off by a factor of ten either way. It is not a carbon calculator, an audit or advice. Your tokens did not literally take water from anyone; the page converts them into what the same water, power or money would mean somewhere else.

## What it reads

The CLI reads the local usage data of 59 coding agents:

| Kind                          | Agents                                                                                                                                                                                                                                                                                                                             |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Terminal agents               | Claude Code, Codex, opencode, GitHub Copilot CLI, Gemini CLI, Grok, Qwen, Amp, Droid, Kimi, Kimi Code, Goose, Muse, Cline CLI, Kilo CLI, Devin, Forge, Junie, Augment Code (Auggie), Codebuff, Mistral Vibe, DeepSeek Harness, Mux, fx, Hermes Agent, Command Code, OpenCodeReview, ZCode, Qoder, CodeBuddy, WorkBuddy, OpenClaude |
| Pi and its forks              | Pi, Oh My Pi, Senpi, Kimchi, gajae-code, Prime Agent                                                                                                                                                                                                                                                                               |
| Editors and editor extensions | Cursor, Zed Agent, Kiro, Copilot (VS Code), Cline, Roo Code, Kilo Code, IBM Bob, Antigravity                                                                                                                                                                                                                                       |
| Desktop apps and other agents | Cherry Studio, Xiaomi MiMo AI, MiMo Code, Quick Desktop, Proma, Aside, BB, OpenClaw, Jcode, Reasonix, LingTai TUI, zerostack                                                                                                                                                                                                       |

Each agent is read from the folder it uses by default on macOS, Linux and Windows. Where the agent lets you move that folder with an environment variable, the CLI reads the variable too: for example `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `XDG_DATA_HOME`, `GEMINI_CLI_HOME`, `GROK_HOME`, `PI_CODING_AGENT_DIR`, `KIMI_CODE_HOME`, `MUSE_HOME` or `HERMES_HOME`. Claude Code is also read from the sessions that the Claude desktop app runs. The CLI never starts an agent.

Only usage from the last 30 days counts. Claude Code deletes its own logs after 30 days by default, so a longer window would come up short anyway. Codex logs a session as one total, so a Codex session counts on the day it started.

Only real token counts are read. The CLI never estimates tokens from text length, context size or cost. An agent that does not write real counts gives nothing, even when it is installed. This is often true for Cursor, which leaves its counts at zero on current builds, and for Kiro's Auto agent. Agents that keep usage only on their own servers (Trae, Warp, Windsurf) cannot be read, and neither can tools that only run other agents, because those agents already log the same calls.

A call that an agent copies into a forked, resumed or archived session counts once. A source that fails to open is named in the output and skipped, and the others still count. If no source has data, the CLI lists the folders it checked and prints no link.

## What leaves your machine

Only the Usage Summary, and only if you press Enter. It holds:

- token counts per model: input, output, cache read and cache write, for the eight busiest models, with the rest added into one "other" count
- the number of sessions
- your busiest hour of the day
- the first day with usage in those 30 days

It holds no prompts, no file paths, no project names, no API key and no login. The CLI asks for none of those.

The CLI makes no network call itself. It prints the exact Usage Summary and the Share Link that encodes it, then waits. When you press Enter it hands the link to your system's opener (`open`, `xdg-open` or `start`), and your browser contacts the site. Run `npx tokenshame --dry-run` to print the summary and the link without opening anything.

The server stores nothing. The link is the only copy of your numbers, and there is no database and no leaderboard.

## What the Share Page and Share Card show

The Share Page is rendered from the link alone. It is a Wrapped: full-screen slides that snap as you scroll, each with a Next link, so it works without script. The first slide is the headline, Tokens Processed: the raw total of every count in your Usage Summary. Then one slide per KPI (water, Arctic sea ice, glacier, ocean, data center land), each on its own colour, then the rest of the Roast Lines, then a slider that turns the API list-price cost into hours of pay at an hourly rate the visitor picks. The last slide is the bento with a Post on X button and a Copy image button. The page also has a "how we calculated" note that links to the section below and a box with `npx tokenshame`. Search engines are told not to index it.

The Share Card is a 1200×630 image of the same bento: the full token count, the five KPI tiles, the command and the domain. X shows it as the link preview. Copy image puts it on your clipboard so you can paste it into a post.

The same link always gives the same lines. The root of the site redirects here, to this README.

## How we calculate

The headline is not an estimate. Tokens Processed is the sum of the input, output, cache read and cache write counts in the link.

Everything after the headline is a joke with a footnote. Nobody publishes the energy a coding agent uses per token, so the factors below are public figures from different years and different models, glued together to make a point. The point is the punchline, not the precision: expect every figure to be off by a factor of ten either way. The tables list every number the engine multiplies by, where it came from, and the day we last checked it. The code is in [`apps/web/src/server/roast`](apps/web/src/server/roast), and a test fails when this section and the code disagree.

The steps:

1. Weighted tokens = input + output + cache write + cache read × `cacheReadWeight`. We count a cache read as a tenth of a token, the ratio Anthropic bills it at. The real compute per cache read is not published.
2. Energy in kWh = weighted tokens × `energyPerToken`.
3. CO2 in tons = energy × `gridCo2` ÷ 1,000,000.
4. Water in litres = energy × `waterPerKwh`.
5. Average power over the month = energy ÷ 720 hours.
6. Cost = each model's counts × its list price from the second table, with cache reads at their own price. A model id that is not in the table is priced as Claude Sonnet 4.6 and shown as "Other models".
7. The KPIs, in the bento's order:
   - Water in whole 500 mL bottles = water × 2; below one bottle, millilitres. Bottles from a drought zone = bottles × `droughtShare`, rounded down.
   - Arctic sea ice in battery-hen cages = CO2 × `seaIcePerTon` × 10,000 ÷ `henCageCm2`; below one cage, square centimetres.
   - Glacier ice in kilograms = CO2 × 1,000 × `glacierPerKgCo2`.
   - CO2 in the ocean in kilograms = CO2 × 1,000 × `oceanShare`.
   - Data center land in square metres = average power in MW × `landPerMw`; below one square metre, square centimetres.
8. The rest of the Roast Lines, each a cost someone else pays:
   - Coal: hours of the Vindhyachal coal plant = CO2 ÷ `coalPlantCo2` × 8,760 hours.
   - School meals = cost ÷ `schoolMealUsd`.
   - Flights, London to New York = CO2 ÷ `flightCo2`. For a small share of a flight the line shows kilometres, using `flightKm`.
   - Electricity in Chad: person-years = energy ÷ `chadElectricityKwh`. From two the line counts people; below that, how long one person there lives on it.
   - Trees for a year = CO2 ÷ `treeCo2`.
   - Homes heated for a year = energy ÷ `homeHeating`.
   - Tons of CO2 = the CO2 figure from step 3.
9. Hours of your salary: the page divides the cost by an hourly rate. The rate starts at `devHourlyWage` and the visitor can drag it.

A comparison that comes out as zero is left out. The KPIs keep their fixed order. The rest are ranked by how bad they sound, and a figure of 1 or more outranks a fraction. Ties break by a hash of the link, so the order is fixed for a link.

### Factors

| Factor               | Value      | Unit                                                                                     | Source                                                                                                                 | Date       | Note                                                                                                                                                                                                                                                                                                                         |
| -------------------- | ---------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cacheReadWeight`    | 0.1        | weighted tokens per cache-read token                                                     | [platform.claude.com](https://platform.claude.com/docs/en/about-claude/pricing)                                        | 2026-11-11 | Editorial choice (grill Q24). Anthropic bills a cache hit at 0.1 times the base input price, and we use the same ratio as a proxy for compute. Real compute per cache read is not published.                                                                                                                                 |
| `energyPerToken`     | 0.00000024 | kWh per weighted token                                                                   | [epoch.ai](https://epoch.ai/gradient-updates/how-much-energy-does-chatgpt-use)                                         | 2026-11-11 | Rough estimate. Epoch AI puts a GPT-4o query with about 10,000 input and 500 output tokens near 2.5 Wh (Feb 2025), which is 0.24 mWh per token. Google measured 0.24 Wh for a median Gemini text prompt (arXiv 2508.15734, Aug 2025). Real values change with model and hardware, by a factor of ten either way.             |
| `gridCo2`            | 473        | g CO2 per kWh                                                                            | [ember-energy.org](https://ember-energy.org/latest-insights/global-electricity-review-2025/global-electricity-trends/) | 2026-11-11 | World average carbon intensity of electricity in 2024, from Ember. Data centers differ by region.                                                                                                                                                                                                                            |
| `waterPerKwh`        | 1.08       | litres of water per kWh                                                                  | [arxiv.org](https://arxiv.org/abs/2508.15734)                                                                          | 2026-11-11 | Derived from Google's median Gemini prompt: 0.26 mL of water for 0.24 Wh (2025). It counts the whole data center, cooling included. Rough estimate for other providers.                                                                                                                                                      |
| `flightCo2`          | 0.38       | tons CO2 per one-way economy passenger, London to New York                               | [greencalculus.com](https://greencalculus.com/convert/co2e-to-flights-london-new-york/)                                | 2026-11-11 | About 5,540 km at the UK DEFRA 2026 long-haul economy factor, without the radiative-forcing uplift. We count CO2 only, so the figure is the low end. With the uplift it is about 0.65 t. The page is a secondary source for the DEFRA numbers.                                                                               |
| `flightKm`           | 5,540      | km, London to New York great-circle distance                                             | [greencalculus.com](https://greencalculus.com/convert/co2e-to-flights-london-new-york/)                                | 2026-11-11 | Used to show a small share of a flight as kilometers flown.                                                                                                                                                                                                                                                                  |
| `coalPlantCo2`       | 33,877,953 | tons CO2 per year, Vindhyachal Super Thermal Power Station (NTPC, Madhya Pradesh, India) | [doi.org](https://doi.org/10.1088/1748-9326/ac13f1)                                                                    | 2026-11-11 | 2018 emissions of the plant ranked second worst on Earth in Grant, Zelinka and Mitova, Environmental Research Letters 16(9), 2021. It is India's top CO2 emitter among power plants. Climate TRACE lists a similar 33.4 Mt for a later year. We spread the year evenly over 8,760 hours.                                     |
| `treeCo2`            | 0.06       | tons CO2 absorbed per urban tree per year                                                | [epa.gov](https://www.epa.gov/energy/greenhouse-gas-equivalencies-calculator-calculations-and-references)              | 2026-11-11 | US EPA: 36.4 lb of carbon per year for a medium urban tree over its first ten years (0.060 t CO2). A forest tree can differ.                                                                                                                                                                                                 |
| `homeHeating`        | 8,600      | kWh of space heating per dwelling per year                                               | [odyssee-mure.eu](https://www.odyssee-mure.eu/publications/efficiency-by-sector/households/household-eu.pdf)           | 2026-11-11 | EU average, 0.74 toe per dwelling (ODYSSEE-MURE, from Eurostat), at 11,630 kWh per toe. The range across member states is about 700 to 16,500 kWh. All GPU electricity ends up as heat.                                                                                                                                      |
| `seaIcePerTon`       | 3          | m² of September Arctic sea ice lost per ton of CO2                                       | [doi.org](https://doi.org/10.1126/science.aag2345)                                                                     | 2026-11-19 | Notz and Stroeve, Science 354(6313), 2016: a sustained loss of 3 ± 0.3 m² of September sea-ice area per ton of CO2, from observations 1953 to 2015.                                                                                                                                                                          |
| `henCageCm2`         | 432        | cm² of cage floor per battery hen                                                        | [uepcertified.com](https://uepcertified.com/wp-content/uploads/2020/02/Caged-UEP-Guidelines_17.pdf)                    | 2026-11-19 | United Egg Producers guidelines: at least 67 square inches (432 cm²) of usable space per caged white hen. Less than a letter-size sheet of paper. The page uses it as the unit of melted sea ice.                                                                                                                            |
| `glacierPerKgCo2`    | 15         | kg of glacier ice eventually melted per kg of CO2                                        | [fona.de](https://www.fona.de/en/glacier-mass-loss-past-the-point-of-no-return)                                        | 2026-11-19 | Marzeion, Kaser, Maussion and Champollion, Nature Climate Change, 2018, as summarised by the German research ministry: every kg of CO2 emitted today causes about 15 kg of glacier melt in the long term. Glaciers outside Greenland and Antarctica only. Carbon Brief reports about 16 kg.                                  |
| `oceanShare`         | 0.29       | share of emitted CO2 taken up by the ocean                                               | [essd.copernicus.org](https://essd.copernicus.org/articles/18/3211/2026/)                                              | 2026-11-19 | Global Carbon Budget 2025: the ocean took up 29% of total CO2 emissions over the last decade. Dissolved CO2 makes seawater more acidic.                                                                                                                                                                                      |
| `droughtShare`       | 0.2        | share of data center water from water-stressed watersheds                                | [iopscience.iop.org](https://iopscience.iop.org/article/10.1088/1748-9326/abfba1)                                      | 2026-11-19 | Siddik, Shehabi and Marston, Environmental Research Letters 16(6), 2021: one-fifth of the direct water footprint of US data center servers comes from moderately to highly water-stressed watersheds. US data, applied to all usage.                                                                                         |
| `landPerMw`          | 9,105      | m² of data center land per MW of capacity                                                | [andymasley.com](https://andymasley.com/writing/data-center-land-use-issues-are-fake/)                                 | 2026-11-19 | Midpoint of 1,500 to 3,000 acres per GW of new hyperscale build-out (2,250 acres per GW). Industry guides say 0.5 to 1.5 acres per MW. The line spreads the month's energy evenly over 30 days and counts the land that much power needs.                                                                                    |
| `schoolMealUsd`      | 0.12       | US dollars per school meal in a low-income country                                       | [info-cooperazione.it](https://www.info-cooperazione.it/wp-content/uploads/2025/10/WFP-0000168637.pdf)                 | 2026-11-18 | WFP, State of School Feeding Worldwide 2024, Annex II, Table A2.5: $22.09 per child per year in low-income countries, over 180 school days. The country data comes mostly from 2019 to 2024 surveys. Other estimates run from $0.25 to $0.55 a meal. The source is a copy of the WFP report; wfp.org blocks automated reads. |
| `chadElectricityKwh` | 18.2       | kWh of electricity generated per person per year in Chad                                 | [ourworldindata.org](https://ourworldindata.org/grapher/per-capita-electricity-generation)                             | 2026-11-18 | Our World in Data, from Ember and the Energy Institute, 2024. It counts electricity generated, not used: Chad's grid loses some on the way, so a person there uses less.                                                                                                                                                     |
| `devHourlyWage`      | 64.44      | US dollars per hour, median pay of US software developers, QA analysts and testers       | [bls.gov](https://www.bls.gov/ooh/computer-and-information-technology/software-developers.htm)                         | 2026-11-18 | US Bureau of Labor Statistics, May 2025. It is the only hourly median BLS gives for the group. The page's slider starts here and the reader can move it.                                                                                                                                                                     |

### Prices

List prices in USD per 1M tokens, standard tier, short-context rows. Anthropic bills a cache write at 1.25 times the input price. OpenAI and Google do not bill a cache write, so it costs the input price. Models that vendors list under several ids share one row.

| Model                 | Ids                                        | Input | Output | Cache read | Cache write | Source                                                                               | Date       |
| --------------------- | ------------------------------------------ | ----- | ------ | ---------- | ----------- | ------------------------------------------------------------------------------------ | ---------- |
| Claude Fable 5.2      | `claude-fable-5-2`                         | 8     | 40     | 0.2        | 10          | [platform.claude.com](https://platform.claude.com/docs/en/about-claude/pricing)      | 2026-11-11 |
| Claude Fable 5.1      | `claude-fable-5-1`                         | 10    | 50     | 0.25       | 12.5        | [platform.claude.com](https://platform.claude.com/docs/en/about-claude/pricing)      | 2026-11-11 |
| Claude Fable 5        | `claude-fable-5`                           | 10    | 50     | 1          | 12.5        | [platform.claude.com](https://platform.claude.com/docs/en/about-claude/pricing)      | 2026-11-11 |
| Claude Mythos 5.2     | `claude-mythos-5-2`                        | 8     | 40     | 0.2        | 10          | [platform.claude.com](https://platform.claude.com/docs/en/about-claude/pricing)      | 2026-11-11 |
| Claude Mythos 5.1     | `claude-mythos-5-1`                        | 10    | 50     | 0.25       | 12.5        | [platform.claude.com](https://platform.claude.com/docs/en/about-claude/pricing)      | 2026-11-11 |
| Claude Mythos 5       | `claude-mythos-5`                          | 10    | 50     | 1          | 12.5        | [platform.claude.com](https://platform.claude.com/docs/en/about-claude/pricing)      | 2026-11-11 |
| Claude Opus 5.5       | `claude-opus-5-5`                          | 4     | 20     | 0.2        | 5           | [platform.claude.com](https://platform.claude.com/docs/en/about-claude/pricing)      | 2026-11-11 |
| Claude Opus 5         | `claude-opus-5`                            | 5     | 25     | 0.5        | 6.25        | [platform.claude.com](https://platform.claude.com/docs/en/about-claude/pricing)      | 2026-11-11 |
| Claude Opus 4.8       | `claude-opus-4-8`                          | 5     | 25     | 0.5        | 6.25        | [platform.claude.com](https://platform.claude.com/docs/en/about-claude/pricing)      | 2026-11-11 |
| Claude Opus 4.7       | `claude-opus-4-7`                          | 5     | 25     | 0.5        | 6.25        | [platform.claude.com](https://platform.claude.com/docs/en/about-claude/pricing)      | 2026-11-11 |
| Claude Opus 4.6       | `claude-opus-4-6`                          | 5     | 25     | 0.5        | 6.25        | [platform.claude.com](https://platform.claude.com/docs/en/about-claude/pricing)      | 2026-11-11 |
| Claude Opus 4.5       | `claude-opus-4-5`                          | 5     | 25     | 0.5        | 6.25        | [platform.claude.com](https://platform.claude.com/docs/en/about-claude/pricing)      | 2026-11-11 |
| Claude Opus 4.1       | `claude-opus-4-1`                          | 15    | 75     | 1.5        | 18.75       | [platform.claude.com](https://platform.claude.com/docs/en/about-claude/pricing)      | 2026-11-11 |
| Claude Opus 4         | `claude-opus-4`                            | 15    | 75     | 1.5        | 18.75       | [platform.claude.com](https://platform.claude.com/docs/en/about-claude/pricing)      | 2026-11-11 |
| Claude Sonnet 5.5     | `claude-sonnet-5-5`                        | 2     | 10     | 0.1        | 2.5         | [platform.claude.com](https://platform.claude.com/docs/en/about-claude/pricing)      | 2026-11-11 |
| Claude Sonnet 5       | `claude-sonnet-5`                          | 2     | 10     | 0.2        | 2.5         | [platform.claude.com](https://platform.claude.com/docs/en/about-claude/pricing)      | 2026-11-11 |
| Claude Sonnet 4.6     | `claude-sonnet-4-6`                        | 3     | 15     | 0.3        | 3.75        | [platform.claude.com](https://platform.claude.com/docs/en/about-claude/pricing)      | 2026-11-11 |
| Claude Sonnet 4.5     | `claude-sonnet-4-5`                        | 3     | 15     | 0.3        | 3.75        | [platform.claude.com](https://platform.claude.com/docs/en/about-claude/pricing)      | 2026-11-11 |
| Claude Sonnet 4       | `claude-sonnet-4`                          | 3     | 15     | 0.3        | 3.75        | [platform.claude.com](https://platform.claude.com/docs/en/about-claude/pricing)      | 2026-11-11 |
| Claude Haiku 5.5      | `claude-haiku-5-5`                         | 0.1   | 0.5    | 0.01       | 0.125       | [platform.claude.com](https://platform.claude.com/docs/en/about-claude/pricing)      | 2026-11-11 |
| Claude Haiku 4.5      | `claude-haiku-4-5`                         | 1     | 5      | 0.1        | 1.25        | [platform.claude.com](https://platform.claude.com/docs/en/about-claude/pricing)      | 2026-11-11 |
| GPT-6 Astra           | `gpt-6-astra`                              | 10    | 50     | 1          | 10          | [developers.openai.com](https://developers.openai.com/api/docs/pricing)              | 2026-11-11 |
| GPT-6.1 Sol           | `gpt-6.1-sol`                              | 2     | 10     | 0.1        | 2           | [developers.openai.com](https://developers.openai.com/api/docs/pricing)              | 2026-11-11 |
| GPT-6.1 Terra         | `gpt-6.1-terra`                            | 1     | 5      | 0.05       | 1           | [developers.openai.com](https://developers.openai.com/api/docs/pricing)              | 2026-11-11 |
| GPT-6 Sol             | `gpt-6-sol`                                | 2     | 10     | 0.2        | 2           | [developers.openai.com](https://developers.openai.com/api/docs/pricing)              | 2026-11-11 |
| GPT-6 Luna            | `gpt-6-luna`                               | 0.1   | 0.5    | 0.01       | 0.1         | [developers.openai.com](https://developers.openai.com/api/docs/pricing)              | 2026-11-11 |
| GPT-5.6 Sol           | `gpt-5.6-sol`                              | 4     | 20     | 0.4        | 4           | [developers.openai.com](https://developers.openai.com/api/docs/pricing)              | 2026-11-11 |
| GPT-5.6 Terra         | `gpt-5.6-terra`                            | 2     | 12     | 0.2        | 2           | [developers.openai.com](https://developers.openai.com/api/docs/pricing)              | 2026-11-11 |
| GPT-5.6 Luna          | `gpt-5.6-luna`                             | 0.2   | 1.2    | 0.02       | 0.2         | [developers.openai.com](https://developers.openai.com/api/docs/pricing)              | 2026-11-11 |
| GPT-5.5               | `gpt-5.5`                                  | 5     | 30     | 0.5        | 5           | [developers.openai.com](https://developers.openai.com/api/docs/pricing)              | 2026-11-11 |
| GPT-5.4               | `gpt-5.4`                                  | 2.5   | 15     | 0.25       | 2.5         | [developers.openai.com](https://developers.openai.com/api/docs/pricing)              | 2026-11-11 |
| GPT-5.4 mini          | `gpt-5.4-mini`                             | 0.75  | 4.5    | 0.075      | 0.75        | [developers.openai.com](https://developers.openai.com/api/docs/pricing)              | 2026-11-11 |
| GPT-5.4 nano          | `gpt-5.4-nano`                             | 0.2   | 1.25   | 0.02       | 0.2         | [developers.openai.com](https://developers.openai.com/api/docs/pricing)              | 2026-11-11 |
| GPT-5.3 Codex         | `gpt-5.3-codex`                            | 1.75  | 14     | 0.175      | 1.75        | [developers.openai.com](https://developers.openai.com/api/docs/pricing)              | 2026-11-11 |
| GPT-5.2               | `gpt-5.2`                                  | 1.75  | 14     | 0.175      | 1.75        | [developers.openai.com](https://developers.openai.com/api/docs/pricing)              | 2026-11-11 |
| GPT-5.1               | `gpt-5.1`                                  | 1.25  | 10     | 0.125      | 1.25        | [developers.openai.com](https://developers.openai.com/api/docs/pricing)              | 2026-11-11 |
| GPT-5.1 Codex         | `gpt-5.1-codex`                            | 1.25  | 10     | 0.125      | 1.25        | [developers.openai.com](https://developers.openai.com/api/docs/models/gpt-5.1-codex) | 2026-11-11 |
| GPT-5                 | `gpt-5`                                    | 1.25  | 10     | 0.125      | 1.25        | [developers.openai.com](https://developers.openai.com/api/docs/pricing)              | 2026-11-11 |
| GPT-5 Codex           | `gpt-5-codex`                              | 1.25  | 10     | 0.125      | 1.25        | [developers.openai.com](https://developers.openai.com/api/docs/models/gpt-5-codex)   | 2026-11-11 |
| GPT-5 mini            | `gpt-5-mini`                               | 0.25  | 2      | 0.025      | 0.25        | [developers.openai.com](https://developers.openai.com/api/docs/pricing)              | 2026-11-11 |
| GPT-5 nano            | `gpt-5-nano`                               | 0.05  | 0.4    | 0.005      | 0.05        | [developers.openai.com](https://developers.openai.com/api/docs/pricing)              | 2026-11-11 |
| GPT-4.1               | `gpt-4.1`                                  | 2     | 8      | 0.5        | 2           | [developers.openai.com](https://developers.openai.com/api/docs/pricing)              | 2026-11-11 |
| GPT-4.1 mini          | `gpt-4.1-mini`                             | 0.4   | 1.6    | 0.1        | 0.4         | [developers.openai.com](https://developers.openai.com/api/docs/pricing)              | 2026-11-11 |
| GPT-4o                | `gpt-4o`                                   | 2.5   | 10     | 1.25       | 2.5         | [developers.openai.com](https://developers.openai.com/api/docs/pricing)              | 2026-11-11 |
| GPT-4o mini           | `gpt-4o-mini`                              | 0.15  | 0.6    | 0.075      | 0.15        | [developers.openai.com](https://developers.openai.com/api/docs/pricing)              | 2026-11-11 |
| o3                    | `o3`                                       | 2     | 8      | 0.5        | 2           | [developers.openai.com](https://developers.openai.com/api/docs/pricing)              | 2026-11-11 |
| Gemini 4 Carbon       | `gemini-4-carbon`                          | 4     | 20     | 0.2        | 4           | [ai.google.dev](https://ai.google.dev/gemini-api/docs/pricing)                       | 2026-11-11 |
| Gemini 4 Argon        | `gemini-4-argon`                           | 4     | 20     | 0.2        | 4           | [ai.google.dev](https://ai.google.dev/gemini-api/docs/pricing)                       | 2026-11-11 |
| Gemini 3.8 Flash      | `gemini-3.8-flash`                         | 1.5   | 7.5    | 0.15       | 1.5         | [ai.google.dev](https://ai.google.dev/gemini-api/docs/pricing)                       | 2026-11-11 |
| Gemini 3.6 Flash      | `gemini-3.6-flash`                         | 1.5   | 7.5    | 0.15       | 1.5         | [ai.google.dev](https://ai.google.dev/gemini-api/docs/pricing)                       | 2026-11-11 |
| Gemini 3.5 Flash-Lite | `gemini-3.5-flash-lite`                    | 0.3   | 2.5    | 0.03       | 0.3         | [ai.google.dev](https://ai.google.dev/gemini-api/docs/pricing)                       | 2026-11-11 |
| Gemini 3.1 Flash-Lite | `gemini-3.1-flash-lite`                    | 0.25  | 1.5    | 0.025      | 0.25        | [ai.google.dev](https://ai.google.dev/gemini-api/docs/pricing)                       | 2026-11-11 |
| Gemini 3.1 Pro        | `gemini-3.1-pro`, `gemini-3.1-pro-preview` | 2     | 12     | 0.2        | 2           | [ai.google.dev](https://ai.google.dev/gemini-api/docs/pricing)                       | 2026-11-11 |
| Gemini 3 Flash        | `gemini-3-flash`, `gemini-3-flash-preview` | 0.5   | 3      | 0.05       | 0.5         | [ai.google.dev](https://ai.google.dev/gemini-api/docs/pricing)                       | 2026-11-11 |
| Gemini 2.5 Pro        | `gemini-2.5-pro`                           | 1.25  | 10     | 0.125      | 1.25        | [ai.google.dev](https://ai.google.dev/gemini-api/docs/pricing)                       | 2026-11-11 |
| Gemini 2.5 Flash      | `gemini-2.5-flash`                         | 0.3   | 2.5    | 0.03       | 0.3         | [ai.google.dev](https://ai.google.dev/gemini-api/docs/pricing)                       | 2026-11-11 |
| Gemini 2.5 Flash-Lite | `gemini-2.5-flash-lite`                    | 0.1   | 0.4    | 0.01       | 0.1         | [ai.google.dev](https://ai.google.dev/gemini-api/docs/pricing)                       | 2026-11-11 |

## Development

You need [bun](https://bun.sh). The CLI needs Node 22.13 or later, and the web app needs Node 24.

```bash
bun install
bun run dev            # every app, through turbo
bun run dev:cli -- --dry-run   # build the CLI and run it without opening a browser
bunx turbo run test    # every test suite
bun run check-types    # TypeScript across all workspaces
bun run check          # oxlint and oxfmt
```

`bun run dev:cli` reads the real home folder, so it reports your own usage. To try it on made-up data, point `HOME` at a fixture home, for example `HOME=<folder holding a .codex/sessions tree> bun run dev:cli -- --dry-run`. The Codex fixture in `apps/cli/src/agents/fixtures/codex/last-total` works as that folder.

The web app runs at <http://localhost:3001>.

The repository is a Bun and Turborepo monorepo:

```
tokenshame/
├── apps/
│   ├── cli/          # the npm package `tokenshame`: readers, summary, consent prompt
│   ├── web/          # Share Page, Share Card and the roast engine (TanStack Start, Nitro)
│   └── wiki/         # grill log, spec, architecture and plan
└── packages/
    ├── share-link/   # Usage Summary schema and the Share Link encoding, used by both apps
    ├── ui/           # shared shadcn/ui components and styles
    └── config/       # shared tooling config
```

Each app owns its environment schema in `.env.schema`, and Varlock generates `src/env.ts` from it. Run `bun run env:generate` after you change a schema. Commit schemas, never secrets. The site address comes from `VERCEL_PROJECT_PRODUCTION_URL`, with `http://localhost:3001` in local development.

## Deploy

`apps/web` runs as the Vercel project `tokenshame`, live at <https://tokenshame.vercel.app>. The CLI opens its Share Links on that address, and the root of the site redirects to this repository.

## Specs and plan

The decisions, the spec and the task plan live in the repository:

- [Spec, architecture and plan](apps/wiki/content/docs/project/specs/tokenshame/usage-roast-share)
- [Grill log](apps/wiki/content/docs/project/grilling/tokenshame-grill-log.md)

## Licence

MIT. See [LICENSE](LICENSE).
