# tokenshame

Your coding agents have been busy. Run one command to see how many tokens they have processed and what that adds up to in villages' drinking water, flights to New York and packs of cigarettes.

```bash
npx tokenshame
```

That is the intended way to run it. The package is not on npm yet, so the command will not work until it is published.

It reads the usage logs your agents already keep on your machine, prints a short summary, and on Enter opens a page with the roast. The page has its own link and its own preview image, so you can post it on X.

## What it reads

The CLI reads the local usage data of 14 agents:

- Claude Code
- Codex
- opencode
- GitHub Copilot CLI
- Pi
- Gemini CLI
- Grok
- Qwen
- Amp
- Droid
- Kimi
- Goose
- Antigravity
- Muse

Muse is read from its default folder `~/.local/share/muse`, or from the folder in `MUSE_HOME` if you set it. The CLI never starts Muse.

Cursor, Kiro and Devin are not supported. They keep usage data on their own servers, so there is nothing on your machine to read. A source that fails to open is named in the output and skipped, and the others still count. If no source has data, the CLI lists the folders it checked and prints no link.

## What leaves your machine

Only the Usage Summary, and only if you press Enter. It holds:

- token counts per model: input, output, cache read and cache write, for the eight busiest models, with the rest added into one "other" count
- the number of sessions
- your busiest hour of the day
- the first day it found usage

It holds no prompts, no file paths, no project names, no API key and no login. The CLI asks for none of those.

The CLI makes no network call itself. It prints the exact Usage Summary and the Share Link that encodes it, then waits. When you press Enter it hands the link to your system's opener (`open`, `xdg-open` or `start`), and your browser contacts the site. Run `npx tokenshame --dry-run` to print the summary and the link without opening anything.

The server stores nothing. The link is the only copy of your numbers, and there is no database and no leaderboard.

## What the Share Page and Share Card show

The Share Page is rendered from the link alone. It shows the headline, the Roast Lines and the key numbers. The headline is Tokens Processed: the raw total of every count in your Usage Summary. The page also has a "how we calculated" note that links to the section below, a Post on X button, a Copy image button, and a box with `npx tokenshame`. Search engines are told not to index it.

The Share Card is a 1200×630 image of the same roast: the headline, the three most dreadful Roast Lines, the domain and the command. X shows it as the link preview. Copy image puts it on your clipboard so you can paste it into a post.

The same link always gives the same lines. The root of the site redirects here, to this README.

## How we calculate

The headline is not an estimate. Tokens Processed is the sum of the input, output, cache read and cache write counts in the link.

Everything after the headline is an estimate, and a rough one. Nobody publishes the energy a coding agent uses per token, so the factors below are public figures from different years and different models, put together. Treat the Roast Lines as jokes with a footnote. The tables list every number the engine multiplies by, where it came from, and the day we last checked it. The code is in [`apps/web/src/server/roast`](apps/web/src/server/roast), and a test fails when this section and the code disagree.

The steps:

1. Weighted tokens = input + output + cache write + cache read × `cacheReadWeight`. We count a cache read as a tenth of a token, the ratio Anthropic bills it at. The real compute per cache read is not published.
2. Energy in kWh = weighted tokens × `energyPerToken`.
3. CO2 in tons = energy × `gridCo2` ÷ 1,000,000.
4. Water in litres = energy × `waterPerKwh`.
5. The comparisons:
   - Villages supplied (for a day) = water ÷ (`villagePopulation` × `waterPerPerson`).
   - Hours of the Vindhyachal coal plant = CO2 ÷ `coalPlantCo2` × 8,760 hours.
   - Flights, London to New York = CO2 ÷ `flightCo2`. For a small share of a flight the page shows kilometres, using `flightKm`.
   - Trees for a year = CO2 ÷ `treeCo2`.
   - Homes heated for a year = energy ÷ `homeHeating`.
   - Packs of cigarettes = cost ÷ `cigarettePackPrice`.
   - Tons of CO2 = the CO2 figure from step 3.
6. Cost = each model's counts × its list price from the second table, with cache reads at their own price. A model id that is not in the table is priced as Claude Sonnet 4.6 and shown as "Other models". The cost only feeds the cigarette comparison.

A comparison that comes out as zero is left out. The rest are ranked by how bad they sound, and a figure of 1 or more outranks a fraction. Ties break by a hash of the link, so the order is fixed for a link and the card shows the first three.

### Factors

| Factor               | Value      | Unit                                                                                     | Source                                                                                                                 | Date       | Note                                                                                                                                                                                                                                                                                                             |
| -------------------- | ---------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cacheReadWeight`    | 0.1        | weighted tokens per cache-read token                                                     | [platform.claude.com](https://platform.claude.com/docs/en/about-claude/pricing)                                        | 2026-11-11 | Editorial choice (grill Q24). Anthropic bills a cache hit at 0.1 times the base input price, and we use the same ratio as a proxy for compute. Real compute per cache read is not published.                                                                                                                     |
| `energyPerToken`     | 0.00000024 | kWh per weighted token                                                                   | [epoch.ai](https://epoch.ai/gradient-updates/how-much-energy-does-chatgpt-use)                                         | 2026-11-11 | Rough estimate. Epoch AI puts a GPT-4o query with about 10,000 input and 500 output tokens near 2.5 Wh (Feb 2025), which is 0.24 mWh per token. Google measured 0.24 Wh for a median Gemini text prompt (arXiv 2508.15734, Aug 2025). Real values change with model and hardware, by a factor of ten either way. |
| `gridCo2`            | 473        | g CO2 per kWh                                                                            | [ember-energy.org](https://ember-energy.org/latest-insights/global-electricity-review-2025/global-electricity-trends/) | 2026-11-11 | World average carbon intensity of electricity in 2024, from Ember. Data centers differ by region.                                                                                                                                                                                                                |
| `waterPerKwh`        | 1.08       | litres of water per kWh                                                                  | [arxiv.org](https://arxiv.org/abs/2508.15734)                                                                          | 2026-11-11 | Derived from Google's median Gemini prompt: 0.26 mL of water for 0.24 Wh (2025). It counts the whole data center, cooling included. Rough estimate for other providers.                                                                                                                                          |
| `flightCo2`          | 0.38       | tons CO2 per one-way economy passenger, London to New York                               | [greencalculus.com](https://greencalculus.com/convert/co2e-to-flights-london-new-york/)                                | 2026-11-11 | About 5,540 km at the UK DEFRA 2026 long-haul economy factor, without the radiative-forcing uplift. We count CO2 only, so the figure is the low end. With the uplift it is about 0.65 t. The page is a secondary source for the DEFRA numbers.                                                                   |
| `flightKm`           | 5,540      | km, London to New York great-circle distance                                             | [greencalculus.com](https://greencalculus.com/convert/co2e-to-flights-london-new-york/)                                | 2026-11-11 | Used to show a small share of a flight as kilometers flown.                                                                                                                                                                                                                                                      |
| `coalPlantCo2`       | 33,877,953 | tons CO2 per year, Vindhyachal Super Thermal Power Station (NTPC, Madhya Pradesh, India) | [doi.org](https://doi.org/10.1088/1748-9326/ac13f1)                                                                    | 2026-11-11 | 2018 emissions of the plant ranked second worst on Earth in Grant, Zelinka and Mitova, Environmental Research Letters 16(9), 2021. It is India's top CO2 emitter among power plants. Climate TRACE lists a similar 33.4 Mt for a later year. We spread the year evenly over 8,760 hours.                         |
| `treeCo2`            | 0.06       | tons CO2 absorbed per urban tree per year                                                | [epa.gov](https://www.epa.gov/energy/greenhouse-gas-equivalencies-calculator-calculations-and-references)              | 2026-11-11 | US EPA: 36.4 lb of carbon per year for a medium urban tree over its first ten years (0.060 t CO2). A forest tree can differ.                                                                                                                                                                                     |
| `homeHeating`        | 8,600      | kWh of space heating per dwelling per year                                               | [odyssee-mure.eu](https://www.odyssee-mure.eu/publications/efficiency-by-sector/households/household-eu.pdf)           | 2026-11-11 | EU average, 0.74 toe per dwelling (ODYSSEE-MURE, from Eurostat), at 11,630 kWh per toe. The range across member states is about 700 to 16,500 kWh. All GPU electricity ends up as heat.                                                                                                                          |
| `villagePopulation`  | 1,000      | people per village                                                                       | [en.wikipedia.org](https://en.wikipedia.org/wiki/2011_Census_of_India)                                                 | 2026-11-11 | Round number chosen by us. The 2011 Census of India counts 833,087,662 rural people in more than 600,000 villages, about 1,300 per village on average. Many villages are smaller.                                                                                                                                |
| `waterPerPerson`     | 20         | litres per person per day                                                                | [iris.who.int](https://iris.who.int/server/api/core/bitstreams/c1461987-2c3f-4e63-8f4c-7e44498e5644/content)           | 2026-11-11 | WHO basic access to water: at least 20 L per person per day, for drinking and basic hygiene. WHO calls it a guide, not a formal guideline.                                                                                                                                                                       |
| `cigarettePackPrice` | 9.95       | US dollars per pack of 20 cigarettes                                                     | [tobaccoinsider.com](https://tobaccoinsider.com/usa-cigarette-prices/)                                                 | 2026-11-11 | US average retail price of a mainstream brand, weighted by sales volume, with taxes (page posted 2026-08-26). The unweighted state average is $10.34.                                                                                                                                                            |

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
bun run dev:cli        # build and run the CLI
bunx turbo run test    # every test suite
bun run check-types    # TypeScript across all workspaces
bun run check          # oxlint and oxfmt
```

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

`apps/web` is meant for the Vercel project `tokenshame`, at <https://tokenshame.vercel.app>. The CLI opens its Share Links on that address. It is not live yet.

## Specs and plan

The decisions, the spec and the task plan live in the repository:

- [Spec, architecture and plan](apps/wiki/content/docs/project/specs/tokenshame/usage-roast-share)
- [Grill log](apps/wiki/content/docs/project/grilling/tokenshame-grill-log.md)

## Licence

The repository has no licence file yet.
