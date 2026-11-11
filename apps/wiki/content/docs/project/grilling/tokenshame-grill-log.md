---
title: "Tokenshame Grill Log"
surface: project
permission: project
---

# Tokenshame Grill Log

Topic: the tokenshame share flow. A CLI reads local coding-agent usage logs.
A public share page on the user's Vercel app shows roast lines, with SEO meta
and an OG image for X.

Prior research: `/var/folders/y8/fw7tz9gn7yx645tf162zwlnr0000gp/T/handoff-tokenshame-2026-11-11.md`
and T3 thread `2fff6874-5270-4b0a-afbd-721916400609`. Proposals in that
handoff are recommendations, not decisions, unless an entry below records them
as answered.

## Branch: Usage collection

### Q1: Read local agent logs

Prerequisites:
- none

Altitude: L1

Question:
How does the product get the user's token usage?

Accepted answer:
- A small CLI reads the usage logs that coding agents already write to local
  folders. No provider login and no API key.
- Source: user, thread `80f95c41` R3 ("a tiny cli that reads from there.
  good.") and the current request ("the cli tracking local .agents etc...
  folders").

Rejected alternatives:
- "Sign in with ChatGPT/Claude": gives identity, not usage history; Claude.ai
  third-party login is banned (handoff research).

## Branch: Share page

### Q2: Public share page on Vercel

Prerequisites:
- none

Altitude: L1

Question:
Where does the shareable page live?

Accepted answer:
- An HTML page served by the user's Vercel app, with proper SEO meta and an
  OG image for X sharing.
- Source: user, current request; thread `80f95c41` R3 ("a website for maximum
  x postcard seo thumbnail sharing experience").

Rejected alternatives:
- A page generated and served only on the user's machine: X cannot fetch a
  card for a non-public URL (Twitterbot must reach the page and image).

## R1 answers (checkpoint R1)

### Q3: Launch usage sources

Prerequisites:
- Q1; fact: local source survey reported

Altitude: L1

Question:
Which agents does v1 read?

Accepted answer:
- All three: Claude Code, Codex, opencode.
- Also survey other agents (Pi, Antigravity, the T3 Code providers) and read
  each one that keeps local token data. Which of them ship at v1 → Q16.

Rejected alternatives:
- Claude Code and Codex only (agent recommendation).

### Q4: Usage time window

Prerequisites:
- Q1; fact: date ranges reported

Altitude: L1

Question:
Which period do the numbers cover?

Accepted answer:
- All time.
- Claude Code gap handling → Q15 (30-day logs + stale all-time cache).

Rejected alternatives:
- "Everything found in the logs" with the date range shown (agent
  recommendation).

### Q5: Consent before sharing

Prerequisites:
- Q2

Altitude: L1

Question:
What must the user see and approve before numbers leave the machine?

Accepted answer:
- The CLI prints the exact Usage Summary. Enter opens the Share Link in the
  browser. The CLI itself sends nothing over the network. `--dry-run` exists.

### Q6: No storage, no leaderboard

Prerequisites:
- Q2

Altitude: L1

Question:
Is the Share Link the only copy of the data, with no leaderboard?

Accepted answer:
- Yes. No database, no stored shares, no leaderboard. The user also wants
  this for cost: no database or backend to host beyond the stateless page.

### Q7: Local report page fate

Prerequisites:
- Q2; fact: CLI serves SPA on 127.0.0.1

Altitude: L1

Question:
Keep or drop the local report page the CLI serves now?

Accepted answer:
- Drop it. The terminal shows the Usage Summary; Enter opens the Vercel
  Share Page.

Code consequence:
- `apps/cli/src/index.ts:reportServer` and the web copy in
  `apps/cli/tsdown.config.ts` go away (detail at L2/L3).

### Q8: X post format

Prerequisites:
- Q2

Altitude: L1

Question:
Link card, image in post, or both at v1?

Accepted answer:
- Both: the link card (Share Card from the Share Link) and an image the user
  can paste into the post. How the image reaches the clipboard → Q22.

### Q9: Share page contents

Prerequisites:
- Q2

Altitude: L1

Question:
What does a viewer see on the Share Page?

Accepted answer:
- Roast Lines and the key numbers, an "ⓘ how we calculated" note, a "Post on
  X" button, and a "run it yourself: `npx tokenshame`" box.

### Q10: Search indexing scope

Prerequisites:
- Q2

Altitude: L1

Question:
Which pages may search engines index?

Accepted answer:
- No landing page and no methodology page on the site. The project
  presentation lives in the GitHub README.
- Root URL behavior → Q17; Share Page indexing → Q18; where the full method
  lives → Q19.

Rejected alternatives:
- Indexable landing page and methodology page (agent recommendation):
  "absolutely not".

### Q11: Comparisons and tone

Prerequisites:
- none

Altitude: L1

Question:
Which comparisons and which tone?

Accepted answer:
- Self-roast tone ("you did this").
- Everyday comparisons: Olympic pools, years of your own showers, bottles of
  water.
- API-price cost, framed "like cigarettes" → meaning in Q20.
- Add other earth resources: trees, CO2, ozone hole, heat made by GPUs →
  Q21.

### Q12: Roast line author

Prerequisites:
- none

Altitude: L1

Question:
Who writes the first Roast Lines?

Accepted answer:
- The agent writes all of them. The user does not review line by line. Use
  `$humanizer` and `$human-writing` on the copy.

### Q13: Name and domain

Prerequisites:
- fact: npm `tokenshame` free

Altitude: L1

Question:
Product name, npm name, and share domain?

Accepted answer:
- Product and npm name: `tokenshame`.
- Share domain still open → Q23.

### Q14: No-network mode timing

Prerequisites:
- Q1

Altitude: L1

Question:
Ship the Deno no-network mode at v1 or later?

Accepted answer:
- Neither. Drop it; the user does not care. The jq one-liner paranoid mode
  from the handoff is dropped with it.

Rejected alternatives:
- Deno `--allow-read` no-network mode at v1 or later.

## R2 answers (checkpoint R2)

### Q15: Claude older history

Prerequisites:
- Q4; fact: print-mode `/stats` does not refresh `~/.claude/stats-cache.json` (Claude Code 2.1.322)

Altitude: L1

Question:
How do all-time Claude Code numbers handle the stale cache and the gap?

Accepted answer:
- Use `stats-cache.json` totals up to its `lastComputedDate`, then the jsonl
  logs for days after it. When days are missing, the Share Page and Share Card
  say so (for example "Claude Code: missing Aug 10–Oct 11").
- No "run /stats first" hint (refresh behavior unverified).

Rejected alternatives:
- CLI keeps its own local history across runs (adds local state; after v1).

### Q16: Extra agents at v1

Prerequisites:
- Q3; fact: provider survey reported

Altitude: L1

Question:
Which extra agents ship at v1?

Accepted answer:
- All agents that keep local token data, now: Claude Code, Codex, opencode,
  Copilot CLI, Pi, Gemini CLI, Grok, Qwen, Amp, Droid, Kimi, Goose,
  Antigravity, and Muse (Muse folder → Q29).
- Excluded by fact: Cursor, Kiro, Devin (server-side data only).
- T3 Code scan cache is never a Usage Source (double count).

Rejected alternatives:
- Tiered launch (agent recommendation): "no all of them now".

### Q17: Root URL behavior

Prerequisites:
- Q10

Altitude: L1

Question:
What does the bare domain show?

Accepted answer:
- Redirect to the GitHub repo.

### Q18: Share page indexing

Prerequisites:
- Q10

Altitude: L1

Question:
`noindex` on Share Pages, or indexable?

Accepted answer:
- `noindex` on Share Pages. Full OG and Twitter tags stay.

### Q19: Full method location

Prerequisites:
- Q9, Q10

Altitude: L1

Question:
Where do the full Impact Estimate sources live?

Accepted answer:
- Each "how we calculated" note shows its assumption on the Share Page and
  links to a "How we calculate" section in the README.

### Q20: Cigarettes framing meaning

Prerequisites:
- Q11

Altitude: L1

Question:
What does "like cigarettes" mean?

Accepted answer:
- Convert API-price cost into vices and commodities: cigarette packs and
  similar vices. The agent picks the set (Q12).

Rejected alternatives:
- Cigarette-pack health-warning card style (not what the user meant).

### Q21: Earth resource metrics

Prerequisites:
- Q11

Altitude: L1

Question:
Which extra Impact Estimates, and how to treat the ozone claim?

Accepted answer:
- CO2 with dreadful conversions: airline flights, tons, hours of the most
  polluting coal plant in India or the ex-ILVA Taranto works. Car km is fine
  but not enough.
- Trees needed to absorb that CO2 for a year.
- GPU heat as cynical conversions: how many homes you could have heated.
- Water keeps the village framing: "number of underdeveloped villages this
  water could have supplied" (user wording "powered"; water supplies, it
  does not power). Fact-check basis: WHO basic access ~20 L/person/day.
- No ozone metric at all.
- Fact prerequisite for copy: sourced CO2/hour of the chosen plant (ILVA
  Taranto is a steelworks, not a power plant).

Rejected alternatives:
- Kettles boiled / space-heater hours: not cynical enough.
- Ozone joke line: drop.
- Dropping the villages framing: "no you may not".

### Q22: Pasteable image path

Prerequisites:
- Q5, Q8

Altitude: L1

Question:
How does the image reach the clipboard without the CLI sending data?

Accepted answer:
- A "Copy image" button on the Share Page, next to "Post on X". The user
  pastes with Cmd+V. The CLI stays network-free.

Rejected alternatives:
- CLI downloads the Share Card to the clipboard: breaks Q5.

### Q23: Share domain and home

Prerequisites:
- Q13; fact: Vercel domains and whois reported

Altitude: L1

Question:
Which domain and which Vercel project serve the Share Page?

Accepted answer:
- Vercel default domain `*.vercel.app` (target `tokenshame.vercel.app`; it
  returns 404 now, so the name looks free). New Vercel project for `apps/web`.

Rejected alternatives:
- `tokenshame.com`: "not a chance".
- `tokenshame.stefangarofalo.dev`.

## R3 answers (checkpoint R3)

### Q24: Which tokens count

Prerequisites:
- Q11, Q21; fact: cache reads ~900x output for Opus (handoff)

Altitude: L1

Question:
Which token count drives the headline and the Impact Estimates?

Accepted answer:
- Headline: the raw total of all tokens, labelled "tokens processed". The
  label never mentions cache.
- Impact Estimates use compute-weighted tokens (a cache read counts as about
  0.1 token).
- API-price cost uses real per-model prices, cache reads at their own price.

Rejected alternatives:
- Label "tokens processed (incl. cache)": "do not mention cache".
- Raw total for every Impact Estimate: inflates ~10x; fails fact-checks.

### Q25: Share Card contents

Prerequisites:
- Q8, Q9, Q16

Altitude: L1

Question:
What is printed on the Share Card?

Accepted answer:
- One headline number ("N tokens processed").
- The three most dreadful Roast Lines, chosen by the agent from the accepted
  Impact Estimate list.
- The domain and `npx tokenshame`.
- No agent list, no date range, no missing-days note on the card.
- When the card renders → Q30.

Rejected alternatives:
- Agent list, date range, and gap note on the card: "no need for this".

### Q15 amendment: gap note placement

Supersedes:
- Q15 "the Share Page and Share Card say so" — the card part only (Q25).

Accepted answer:
- The Share Card shows no missing-days note. Share Page placement → Q31.

### Q26: Supported operating systems

Prerequisites:
- Q3

Altitude: L1

Question:
Which OS does v1 support?

Accepted answer:
- macOS, Linux, Windows. Paths resolve from the home folder. Tested on macOS
  only.

### Q27: Empty and broken states

Prerequisites:
- Q5, Q6

Altitude: L1

Question:
What happens with no logs found or a broken Share Link?

Accepted answer:
- No logs: the CLI lists the folders it checked and exits with no link.
- Broken or edited Share Link: the Share Page says "this roast is broken. Run
  `npx tokenshame`" with a generic Share Card.

### Q28: Roast line selection

Prerequisites:
- Q12

Altitude: L1

Question:
Same link always shows the same lines?

Accepted answer:
- Yes. Lines are chosen deterministically from the Usage Summary, so the
  Share Page and the Share Card always match, also after X caches the card.

Rejected alternatives:
- Random lines per view.

### Q29: Muse folder discovery

Prerequisites:
- Q16; fact: Muse home comes from the running muse binary
  (`~/.t3/source/*/packages/provider-muse/src/server/MuseUsageHome.ts:36`)

Altitude: L1

Question:
How does the CLI find Muse data?

Accepted answer:
- Read Muse's default folder if research finds one, and accept a `MUSE_HOME`
  variable. Never start the Muse program.
- If no default folder is found, drop Muse from v1.
- Fact prerequisite: Muse default home folder (research at L2).

## R4 answers (checkpoint R4)

### Q31: Gap note on page

Prerequisites:
- Q15, Q25

Altitude: L1

Question:
Does the Share Page show the missing-days note and agent list?

Accepted answer:
- No. Neither the Share Page nor the Share Card shows the agent list, date
  range, or missing-days note.

Rejected alternatives:
- Small honesty footer on the Share Page: "no nothing".

### Q15 amendment 2: gap note removed

Supersedes:
- Q15 "the Share Page and Share Card say so" — fully (Q25, Q31).

Accepted answer:
- Merge rule stays (cache up to `lastComputedDate`, logs after). No public
  missing-days note.

### Q30: Card render timing meaning

Prerequisites:
- Q6, Q25

Altitude: L1

Question:
What does "generated at build (render) time" mean for the Share Card?

Accepted answer:
- Leaning render time ("mh yeah"), but the user's mental model is "the CLI
  generates the HTML locally and we share it through Vercel". That conflicts
  with Q5/Q6 as recorded. Resolution → Q32.

## R5 answer (checkpoint R5)

### Q32: Where the HTML is made

Prerequisites:
- Q5, Q6, Q30

Altitude: L1

Question:
Does Vercel build the HTML from the numbers in the link, or does the CLI build
HTML and upload it?

Accepted answer:
- A: the CLI packs the Usage Summary into the Share Link. Vercel builds the
  Share Page HTML and the Share Card from the link the first time someone
  opens it; the CDN keeps the result. Nothing is stored. This also resolves
  Q30 ("render time").

Rejected alternatives:
- B: CLI builds HTML and uploads it to Vercel (CLI network call, storage,
  open upload endpoint).

## Level note: L1 settled R5

All five branches settle at L1. Roast content and Distribution are at their
Target Altitude (L1). Usage collection, Share payload and Share page descend to
L2.

## R6 answers (checkpoint R6) — user: "all recs ok, go"

### Q33: Shared link contract owner

Prerequisites:
- Q32

Altitude: L2

Question:
Which part owns the Share Link format both sides use?

Accepted answer:
- New workspace package `packages/share-link`: schema, encode, decode,
  version. `apps/cli` bundles it (tsdown inlines; zero runtime deps);
  `apps/web` imports it.

Rejected alternatives:
- Copy the format into both apps.

### Q34: Share Link contents

Prerequisites:
- Q24, Q32

Altitude: L2

Question:
Which numbers travel in the link?

Accepted answer:
- Raw token counts per model family: input, output, cacheRead, cacheWrite.
  Top 8 models by tokens, the rest summed as "other".
- Extras: session count, busiest hour, first-day date, link version.
- Never project names, paths, or prompt text.
- Target length well under 2,000 characters.

Rejected alternatives:
- Final results only (cost, water…): server could not fix math later.

### Q35: Where the math runs

Prerequisites:
- Q24, Q34

Altitude: L2

Question:
Does the server or the CLI compute Impact Estimates, cost, and Roast Lines?

Accepted answer:
- The server (`apps/web`). It owns the price table and water, CO2, heat
  factors, each with source and date, and turns raw counts into Impact
  Estimates and Roast Lines. The CLI only counts.
- Cards X already cached keep their old numbers.

### Q36: Web rendering and hosting

Prerequisites:
- Q32; fact: SPA shell emits root `head()` only; Nitro vite plugin for Vercel

Altitude: L2

Question:
How does `apps/web` render and deploy?

Accepted answer:
- Drop SPA mode; server-render with TanStack Start.
- Nitro Vite plugin; deploy to Vercel Node functions.
- Share Card route sends `Cache-Control: public, immutable` so the Vercel CDN
  keeps each card.

Rejected alternatives:
- Vercel Edge functions (image renderer limits).

### Q37: CLI runtime shape

Prerequisites:
- Q7, Q16, Q26; fact: SQLite needed for opencode, Copilot, Goose, Antigravity

Altitude: L2

Question:
What runtime pieces does the CLI use?

Accepted answer:
- Remove the local HTTP server.
- Keep Effect, bundled; zero runtime dependencies.
- SQLite sources via built-in `node:sqlite`, read-only; `engines.node`
  `>=22.13`; hide the one-time experimental warning.
- Antigravity: tiny hand-written protobuf decoder for the needed fields.
- Open the browser with `open` / `xdg-open` / `start`; always print the link.

Rejected alternatives:
- SQLite npm package (breaks zero deps, native builds).

### Q38: Old link lifetime

Prerequisites:
- Q33

Altitude: L2

Question:
How long must old Share Links keep working?

Accepted answer:
- Forever. The server decodes every link version it ever shipped. A link it
  cannot decode shows the "this roast is broken" page (Q27).

## Level note: L2 settled R6

Usage collection, Share payload and Share page settle at L2 and descend to L3.

## R7 answers (checkpoint R7) — user: "agree all rest"

User asked why SQLite is needed (no decision change): opencode, Copilot CLI,
Goose and Antigravity store usage in SQLite database files; reading them needs
a SQLite reader. `node:sqlite` is built in, so zero dependencies hold (Q37).

### Q39: Share Card renderer

Prerequisites:
- Q36; fact: bench in `/tmp/ts-ground-web/bench` (takumi WASM 41 ms first / ~5 ms warm, 6.7 MB function; satori+resvg ~130 ms; `@vercel/og` loads wasm/font from disk, breaks under Nitro)

Altitude: L3

Evidence anchor:
- proposed `apps/web/src/routes/r/$link/og[.]png.tsx`; `takumi-js@2.20.0` `takumi-js/response` `ImageResponse`
- Nitro adds `unwasm` condition (`nitro/dist/_chunks/nitro.mjs:167`), so takumi resolves to WASM backend

Accepted scope:
- `takumi-js` 2.20.0, default WASM backend under Nitro (no `exportConditions` override).
- Font: WOFF2 imported with `?inline`, decoded to a Buffer once at module load.

Rejected alternatives:
- Native takumi build (12 MB, builder-OS binary), satori + resvg-js, `@vercel/og`.

### Q40: Web route files

Prerequisites:
- Q17, Q36; fact: `[.]` escape, `headers()` route option, `redirect({ href, statusCode: 308 })` verified

Altitude: L3

Accepted scope:
- `apps/web/src/routes/index.tsx`: `beforeLoad` throws `redirect({ href: <repo>, statusCode: 308 })`.
- `apps/web/src/routes/r/$link.tsx`: decode in loader; `head()` sets title, description, `og:*`, `twitter:card=summary_large_image`, `twitter:image`, `robots=noindex`; `headers()` sets caching.
- `apps/web/src/routes/r/$link/og[.]png.tsx`: `server.handlers.GET` returns the PNG with `Cache-Control: public, immutable`.
- Page UI under `apps/web/src/composition/routing/pages/share/`.
- `vite.config.ts`: drop `spa`; plugins `[tanstackStart(), nitro(), viteReact()]` (plus existing varlock, tailwind).

### Q41: Absolute site address

Prerequisites:
- Q36

Altitude: L3

Accepted scope:
- `VERCEL_PROJECT_PRODUCTION_URL` declared in `apps/web/.env.schema` (varlock), `http://localhost:3001` in local dev.

### Q42: Share-link package design

Prerequisites:
- Q33, Q34, Q38; fact: `Schema.StringFromBase64Url` round-trip verified (effect 4.1.2)

Altitude: L3

Accepted scope:
- `packages/share-link/src/{summary.ts, link.ts, version.ts}` with tests; exports `"./*": "./src/*.ts"` like `packages/ui`.
- Effect Schema; JSON with short keys → base64url; `v: 1`. `effect` joins the web bundle.
- CLI sends raw model ids; the server maps ids to names and prices.

Rejected alternatives:
- zod in the shared package.

### Q43: CLI module layout

Prerequisites:
- Q37; fact: lint rules (`apps/cli/oxlint.config.ts`), `effect/Terminal`, `effect/process`, `node:sqlite` WAL read-only verified

Altitude: L3

Accepted scope:
- `apps/cli/src/index.ts` (command, flags, SQLite warning filter), `agents/<agent>.ts` (one plain reader per agent, one registry list), `agents/sqlite.ts`, `summary.ts`, `render.ts`, `prompt.ts`.
- No Effect services, no barrels; imports by module path.
- Remove `reportServer`, the tsdown web copy, and the `web` devDependency.
- A source that fails to open (e.g. `-wal` without `-shm` in a read-only folder) is skipped with a message.

### Q44: Test runner

Prerequisites:
- Q43; fact: no runner installed

Altitude: L3

Accepted scope:
- `vitest` + `@effect/vitest`; turbo `test` task; colocated `*.test.ts`.
- Per-agent fixtures with fake numbers and no real prompts, incl. Claude duplicate lines and Codex cumulative totals.

### Q45: Roast engine modules

Prerequisites:
- Q21, Q24, Q28, Q35

Altitude: L3

Accepted scope:
- `apps/web/src/roast/factors.ts`, `prices.ts` (each entry: value, unit, source, date), `impacts.ts`, `lines.ts`, `pick.ts`.
- Rank lines by dread; card shows top 3, page shows all; ties broken by a hash of the link (deterministic).

### Q46: GitHub repo for redirect

Prerequisites:
- Q17; fact: no git remote; `stefan-garofalo/tokenshame` does not exist yet

Altitude: L3

Accepted scope:
- `https://github.com/stefan-garofalo/tokenshame`, public (to be created).

### Q47: Web Node version

Prerequisites:
- Q36; fact: Nitro requires Node >=22.22; Vercel preset reads `engines.node`

Altitude: L3

Accepted scope:
- `apps/web/package.json` `engines.node` = `24.x`.

## Level note: L3 settled R7

All code-bearing branches settle at L3. Every branch is at its Target
Altitude. Open fact for implementation: Muse default home folder (Q29 rule:
if none found, Muse is dropped).

## R8 answer (checkpoint R8) — user: "yes agree all good. make sure to encode that we MUST use /design-taste-frontend skill for the web app pages"

Shared-understanding confirmation (quoted): "yes agree all good". The reply
does not close the grill; closure was requested as "confirmed, close".

### Q48: Design skill is mandatory for web pages

Prerequisites:
- Q36, Q40

Altitude: L3

Question:
Which design process builds the `apps/web` pages?

Accepted answer:
- Every `apps/web` page must be designed and built with the
  `/design-taste-frontend` skill. This is a constraint, not a preference.
- Pages in scope today: the Share Page and the broken-link page (Q27, Q40).
  The `/` route only redirects (Q17).

Code consequence:
- The architecture and spec carry this as a constraint on `apps/web`; the plan
  gives each page task a design step that runs the skill (draw, idea,
  copy deck, build, `lint.mjs` + `inspect.mjs` gate, critique).
- `apps/web/AGENTS.md` (written from its prompt spec) states the rule.
- Open scope points → Q49.

## R9 answer (checkpoint R9) — user: "recs, confirmed, close"

### Q49: Design skill scope

Prerequisites:
- Q25, Q48; fact: skill inspector fails under 4 real pictures and under 8 moving elements

Altitude: L3

Question:
Does the rule cover the Share Card, and how does the skill gate apply to a data page?

Accepted answer:
- The rule covers the Share Page and the broken-link page. The Share Card
  takes the direction, colours and type the skill picks for the pages, and is
  still drawn with takumi (Q39).
- The inspector's banned-style rules apply in full. For the picture-floor and
  motion-count checks, `--allow` is accepted for those two rules only, each
  use noted in the report. Pictures only where an honest one exists.

Rejected alternatives:
- Card outside the rule.
- Add pictures and motion to pass the checks without an override.

## Closure

Shared-understanding confirmation: "yes agree all good" (R8).
Closure: "recs, confirmed, close" (R9).

Handoff: status and log go to `$create-architecture`, then `$create-spec`.
Remaining non-design work: Muse default home folder (Q29 rule: none found →
Muse dropped); create the public GitHub repo `stefan-garofalo/tokenshame`
(Q46); add the Vercel project; add the test runner (Q44).

## Reopened R10 (compile gap from create-plan) — user: "1 and 2 recommended"

Gap found while planning: the accepted roast folder `apps/web/src/roast/`
(Q45) fails the web app's `frontend-layers/known-top-level` lint rule, set to
`error` with zero warnings allowed
(`apps/web/oxlint.config.ts`, `apps/web/tools/oxlint/frontend-layers/index.mjs:629`).
The layer root may hold only the layer folders and `server/`.

### Q50: Roast engine folder

Prerequisites:
- Q45; fact: `known-top-level` rule allows `server/`; a `server/<domain>/index.ts` is the Server Contract for pure code shared by server and browser (`.agents/skills/frontend-domain-structure/references/structure.md`, section Server)

Altitude: L3

Supersedes:
- Q45 — the folder path only. The file names, the ranking rule, and the hash tie-break in Q45 stay accepted.

Question:
Where does the roast engine live so that it passes the web lint rules?

Accepted answer:
- `apps/web/src/server/roast/{factors,prices,impacts,lines,pick}.ts`, with the
  domain `index.ts` as its Server Contract (pure code only).
- Recommendation accepted as given; alternative `features/roast/` rejected.

Rejected alternatives:
- `apps/web/src/roast/` (lint error).
- `features/roast/` (a route-level card handler would import a feature; worse fit).

Code consequence:
- Architecture ARC-010 and the Modules tree, and the spec's Accepted Technical
  Decisions, use the new path. Selectors and spec codes stay the same.

## Closure (R10)

Closure: "1 and 2 recommended" (R10). Grill closed again at R10.
