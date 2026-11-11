---
title: "Usage Roast Share Implementation Notes"
domain: "tokenshame"
type: implementation-notes
status: implemented
created: 2026-11-11
updated: 2026-11-12
---

# Implementation Notes

Parent-owned record of the `usage-roast-share` delivery. Branch `feat/usage-roast-share`, pull request #22, provider-task mode (issues #6 to #21 of project 7).

## Execution and Reconciliation

Each Task Gate ran the full `bunx turbo run check-types test lint` (plus the task's own RED and GREEN commands) before the task commit. Reconciliation of `PLAN.md` is complete for all 16 tasks. Code Review is the next phase and is not recorded here.

| Task | Commit | Parent Task Gate | Reconciliation | Architecture Checkpoint | Final acceptance |
| --- | --- | --- | --- | --- | --- |
| T1 (#6) | `1659187` | passed | complete | A1 | met |
| T2 (#7) | `0ab75eb` | passed | complete | A1 | met |
| T3 (#8) | `20087ca` | passed | complete | A2 | met |
| T4 (#9) | `37bc089` | passed | complete | A2 | met |
| T5 (#10) | `f27bbfa` | passed | complete | A2 | met |
| T6 (#11) | `92e5fad` | passed | complete | A2 | met |
| T7 (#12) | `2a9c2c8` | passed | complete | A2 | met |
| T8 (#13) | `6d2c12d` | passed | complete | A3 | met |
| T9 (#14) | `8936540`, `f8dbfd1`, `08e1037` | passed after two defect repairs | complete | A2 | met |
| T10 (#15) | `173084a` | passed | complete | A2 | met |
| T11 (#16) | `52edf00`, `08e1037` | passed after one defect repair | complete | A3 | met |
| T12 (#17) | `243e617` | passed | complete | A4 | met |
| T13 (#18) | `21bbe84` | passed | complete | A4 | met |
| T14 (#19) | `a2ba274`, `8a746ac` | passed | complete | A5 | met (npm publish not run) |
| T15 (#20) | `f8dbfd1`, `08e1037` (deploys) | passed after the first deploy failed | complete | A5 | met |
| T16 (#21) | `ae43a53`, `2579563` | passed | complete | A5 | met |

Baseline commits before T1 (scaffold, lint tooling, CLI scaffold, web and ui layers): `d7e3549`, `fd3fe17`, `c42e09f`, `8285e60`. They hold the user's earlier uncommitted tree; nothing in them was edited except the lint fixes the commit gate demanded (`packages/config/package.json` formatting).

## Summary

- `npx tokenshame` (built from `apps/cli`) reads 14 agents, prints the exact Usage Summary and Share Link, and opens the link on Enter. `--dry-run` opens nothing. It makes no network call and ships with zero runtime dependencies.
- `packages/share-link` is the single owner of the link format (Effect Schema, short keys, base64url, `v: 1`).
- `apps/web` renders the Share Page and the Share Card on the server from the link alone (Nitro on Vercel Node 24, `takumi-js` WASM). Page and card use one roast engine in `apps/web/src/server/roast/`.
- Production runs at https://tokenshame.vercel.app (Vercel project `tokenshame`, root directory `apps/web`).
- The README presents the project and lists every factor and price (generated from the engine data; a test keeps them equal).

## Deviations From the Plan

- **Launcher on Windows.** AC-012 and the plan name `start`. The CLI uses `rundll32 url.dll,FileProtocolHandler <url>` on win32 because `cmd /c start` runs `&` in a URL as a second command. A Share Link is base64url and holds no `&`. Not run on real Windows.
- **Licence.** T14 first declared `MIT`. The owner has chosen no licence and the repo has no LICENSE file, so the field was removed. The README states there is no licence file yet.
- **`apps/web/vite.config.ts`** (T9 file, edited three times as defect repairs): `ssrInjectMode: "resolved-env"` (see Surprises) and an optional `WEB_BUILD_DIR` so HTTP tests build into their own folder.
- **`share/index.ts` exports only `shareRoute`.** `SharePage` and `BrokenLinkPage` live in their own files and the route reaches them through that export. The seam table in the plan lists them as composition exports; behavior is the same and the lint rules pass.
- **Shell header removed.** T11 removed `<Header />` from `root-document.tsx` and deleted `shells/root/header.tsx` (the user's file, orphaned by the redirect and the design). Recorded as a scope transfer approved by the parent.
- **Web tests use plain `vitest`.** The CLI and share-link use `@effect/vitest`. AC-043 names `@effect/vitest`; web tests are HTTP and DOM tests where `it.effect` adds nothing.
- **`apps/cli/dist` ships 3 files** (index plus 2 chunks) because the registry loads lazily after the SQLite warning filter is installed.
- **The CLI `dev` script lost `--port 4747`**, and the README documents `bun run dev:cli -- --dry-run`.

## Surprises and Decisions

- **First production deploy returned 500 on every route.** The scaffold's `ssrInjectMode: "auto-load"` runs the `varlock` CLI at server start; Vercel has none. `init-only` also failed (it expects the platform to inject env). `resolved-env` bakes the all-`@public` env into the bundle. A new test starts the built server from a copied folder with a minimal `PATH` and reproduced the production error before the fix.
- **HTTP tests raced with `check-types`.** Both ran `vite build` into `apps/web/.output` while the harness copied it. Fixed by building into `node_modules/.http-harness` (`WEB_BUILD_DIR`). Ten consecutive full runs passed, then four more at the parent gate.
- **A crafted all-zero Share Link broke `head()`** (no `noindex`, no tags). Found by the independent audit; fixed with a test; verified on production.
- **Muse default folder.** No Meta source documents one. Four independent readers agree on `~/.local/share/muse`; `MUSE_HOME` appears only in log Q29 and may not be a real Muse variable. `XDG_DATA_HOME` is an addition not in the spec.
- **The stats-cache has no per-session split.** Claude Code history before `lastComputedDate` becomes synthetic records (sessions from `dailyActivity`, busiest hour weighted by tokens), so sessions and busiest hour are approximate for that history.
- **Print format, exit codes and non-TTY behavior** were not specified: the CLI prints a facts block and a model table, exits 1 only when no source has data, and treats closed input as "no".
- **Editor diagnostics repeatedly disagreed with `tsc`** during parallel work (stale views of half-written files). `tsc` and turbo `check-types` are the authority.
- **Coal-plant factor** is Vindhyachal (NTPC), from a peer-reviewed 2018 emissions figure, not the parked ILVA item (a steelworks).
- **Share-alike pictures.** The Share Page shows four Wikimedia Commons pictures (CC BY-SA 4.0/2.0, CC BY 4.0) with credits on the page. The Share Card uses no pictures.

## Sanity Checks

| Check | Result | Notes |
| --- | --- | --- |
| `bunx turbo run check-types test lint --force` at head `08e1037` | pass, 11/11 tasks, four times in a row | share-link 42, CLI 155, web 156 tests |
| Managed lint runner, apps/cli and apps/web | exit 0 | zero warnings allowed |
| `oxfmt --check` on code | clean | wiki docs are outside the gate scopes and have 6 pre-existing format notices |
| Built CLI from an empty folder | prints summary and link, exit 0, no bare imports | `/tmp` copy of `dist`, fake HOME |
| Built CLI on this machine's real logs, `--dry-run` | 3.6B tokens, 537 sessions, exit 0, empty stderr | counts only were printed |
| Packed tarball with `npm exec --offline` | pass on Node 24.9 and 26.13 | Node 22.13 is not installed here; the floor is untested |
| Production GET `/` | 308 to https://github.com/stefan-garofalo/tokenshame | |
| Production GET real link from the real-log run | page 200 with 7 roast lines; card 200 `image/png` 1200x630 | |
| Design `inspect.mjs` on the production share page, 4 runs | 0 FAIL, 2 WARN (`size-count`, `no-footage`) | the audit reported one `blank-gap` FAIL once; not reproduced |
| `npm publish` | not run | not authorized; needs the owner's npm login |

## Skill Application Evidence

| Task | Skill | Status | How/where |
| --- | --- | --- | --- |
| T1 | turborepo | applied | `test` task with inputs, no outputs, in `turbo.json` |
| T1 | tdd | applied | RED: missing `test` task; same command GREEN |
| T2 | effect | applied | `summary.ts`, `link.ts`: Schema at the boundary, typed `BrokenLink`, module imports |
| T2 | quality-types | applied | no casts; fixture decoded in test |
| T2 | codebase-design | applied | seam is `encode`/`decode`/`shareUrl`; tests use only it |
| T2 | tdd | applied | RED `Cannot find module './link'` first; 9 mutants |
| T3 | effect, quality-types, tdd | applied | `claude.ts`, `claude.test.ts`; RED then GREEN |
| T4 | effect, quality-types, tdd | applied | `codex.ts`, `codex.test.ts`; streams lines, Schema decode |
| T5 | effect, quality-types, codebase-design, tdd | applied | `sqlite.ts` adapter, `opencode.ts`; doubled-total mutant |
| T6 | effect, quality-types, tdd | applied | seven readers; sensitivity on Gemini and Kimi |
| T7 | effect, quality-types, codebase-design, tdd | applied | `copilot/goose/antigravity/muse/protobuf.ts` |
| T8 | effect, quality-types, codebase-design, tdd | applied | `summary.ts` pure, `prompt.ts` only spawner, `registry.ts` single list |
| T9 | frontend-domain-structure, seo-audit, tdd | applied | routes import composition only; tag assertions in `routes.test.ts` |
| T10 | quality-types, codebase-design, tdd, frontend-domain-structure | applied | `server/roast/index.ts` seam; 4 mutants |
| T10 | effect | loaded | used for `Arbitrary` property tests only |
| T10 | humanizer, human-writing | applied | roast line copy in `lines.ts` |
| T11 | design-taste-frontend | applied | direction "Dressed as something else" (seed 1824682679); idea: a cigarette-pack health warning sets each roast line; `lint.mjs` 0/0, `inspect.mjs` 0 FAIL |
| T11 | frontend-domain-structure, vercel-react-best-practices, tdd | applied | server-rendered page, CSS-only motion, layer lint clean |
| T12 | design-taste-frontend | applied | card mirrors page tokens; token parity test; `lint.mjs` 0/0 (`inspect.mjs` not applicable to a PNG) |
| T12 | frontend-domain-structure, codebase-design, tdd | applied | `takumi-js` only in `integrations/takumi`; seam `shareCardResponse` |
| T13 | design-taste-frontend | applied in part | existing direction and tokens reused; first-action WARN cleared; no new draw |
| T13 | frontend-domain-structure, tdd | applied | components in the page folder; RED `Failed to resolve import` |
| T14 | tdd | applied | RED 2 of 8 failed; tarball test |
| T15 | vercel-cli | not_applicable | the skill file was not loaded; the parent ran the Vercel CLI directly (project add, link, API patch read back, two prod deploys). Assessed in the T15 gate on 2026-11-12 |
| T15 | verify-behavior | applied | production GET evidence and the real-link run below (done by the parent, not as a separate skill run) |
| T16 | tdd | applied | RED 72 failed; GREEN 72 |
| T16 | writing-for-agents | applied | README structure; humanizer and human-writing for prose |

## Architecture Conformance Evidence

| Wave | Ownership and dependency evidence | Due criteria | Public seam delta | Migration ledger | Verdict |
| --- | --- | --- | --- | --- | --- |
| A1 | `packages/share-link` created; apps depend on it as `workspace:*`; no second schema outside it | RAC-1 met: `grep` for `StringFromBase64Url` and short-key definitions finds only `packages/share-link/src/link.ts` | `@tokenshame/share-link` `./*` and `./fixtures/*.json` | empty | conformant |
| A2 | 14 readers behind one `Reader` type; `server/roast` pure; web SSR, routes import composition only | RAC-2 (reader tests, lint, no summary or network import), RAC-3 (scan test: no `node:`, `server-only`, `Math.random`, `Date.now`), RAC-4 (HTTP tests, `route-imports` lint) met; RAC-1 holds | `Reader`, registry, `server/roast/index.ts`, routes | empty | conformant |
| A3 | CLI command through the registry and share-link; share page in `pages/share` | RAC-5 (no server, no network, `reportServer` gone), RAC-6 (design gate, layer lint) met | `tokenshame [--dry-run]`; `shareRoute` | empty | conformant |
| A4 | card route calls a composition export; `takumi-js` imported in one file | RAC-7 met: `grep` finds `takumi-js` only in `integrations/takumi/image-response.ts` | `shareCardResponse`; `/r/$link/og.png` | empty | conformant |
| A5 | tarball has zero dependencies; production serves page and card; README table equals engine data | RAC-8 met | none | empty | conformant |
| Final | all RAC met; no temporary seam was introduced; the migration ledger is empty | RAC-1 to RAC-8 | as above | empty | zero drift |

## UI Evidence Links

Evidence files are in the delivery workspace under `/tmp/delivery/ui/` (not durable). Durable links are not produced because `repo-asset-management` was not run; the PR body carries the description. Before = T9 stub page; After = final pages.

| Surface | Viewport | Before | After | Notes |
| --- | --- | --- | --- | --- |
| Share Page | 1440, 768, 390 | `/tmp/delivery/ui/before/` | `/tmp/delivery/ui/after/share/`, `/tmp/delivery/ui/after-t13/` | buttons mounted in T13 |
| Broken-link page | 1440, 768, 390 | `/tmp/delivery/ui/before/` | `/tmp/delivery/ui/after/broken/` | `--allow few-pictures,still-page` |
| Share Card | 1200x630 | none (new) | `/tmp/delivery/ui/card-fixture.png`, `/tmp/delivery/ui/card-broken.png`, `/tmp/card-prod.png` | production render of the fixture link |

`--allow` uses (AC-039): share page none; broken-link page `few-pictures` (one-screen apology, no honest picture exists) and `still-page` (6 moving elements, below the 8 minimum; padding it would be decoration).

## Runtime Validation Evidence

| Task | Scenario and target | Public action | Expected result | Observed result and evidence | Cleanup | Status |
| --- | --- | --- | --- | --- | --- | --- |
| T12 | Local production build | `GET /r/<fixture>/og.png`, `GET /r/not-a-share-link/og.png` | 200 `image/png` 1200x630 | 37234 and 19159 bytes, first request 0.138 s; images viewed | servers killed | met |
| T14 | Packed tarball in a clean folder | `npm exec --offline --package <tgz> -- tokenshame --dry-run`, stdin closed | summary and link, exit 0 | output matched on Node 24.9 and 26.13; tarball sha256 `4be941e5d8594443a70848d8fa0ea2c815498678ec36e8bcbf7318b3c7eac67e` (superseded by the later package.json edit; repacked by `prepack`) | temp folders removed | met (Node 22.13 not run) |
| T15 | Vercel production `tokenshame.vercel.app` | GET `/`, `/r/<fixture>`, its `og.png`, a broken link, an all-zero link | 308; 200 with tags; 200 PNG; 200; 200 | all matched after deploy `tokenshame-qznghz82o-stefangarofalos-projects.vercel.app` | preview deployments: none created | met |
| T15 | First deploy | same | same | **failed**: 500, `Unable to find varlock executable`; fixed in `f8dbfd1` | n/a | resolved |

## Behavior Verification Evidence

| Story and criterion | Ref | Channel | Scenario | Status | Durable evidence |
| --- | --- | --- | --- | --- | --- |
| Run the CLI and see my usage, AC-011, AC-013 | `6d2c12d` | terminal, built `dist` | dry run on this machine's real logs | met | Sanity Checks row "Built CLI on this machine's real logs" |
| See my roast on a share page, AC-023, AC-024 | `08e1037` | production HTTP | the real link from that run | met | page 200, 7 roast lines, no "cache"; card 200 PNG |
| Share my roast on X, AC-030, AC-031 | `21bbe84` | real browser (agent-browser) | Copy image then read the clipboard; click Post on X | met | clipboard held `image/png` (PNG signature); new tab `x.com/intent/post?url=…`; nothing posted |
| Install it and open it for real, AC-041 | `a2ba274` | tarball | see Runtime Validation T14 | met | |

Not verified: a real press of Enter that opens a real browser from the CLI (tests use a stub opener and a pty with a fake `open`); a real X unfurl of the production link.

## Visual Evidence Acceptance Map

| Source | Backlog attachment or fallback | PR-ready before/after evidence |
| --- | --- | --- |
| Share Page, broken page, Share Card | fallback: description in this file and PR #22 | local screenshot paths above; no durable asset links |

## Acceptance Criteria Status

Independent read-only audit of head `f8dbfd1` (then repairs in `8a746ac`, `2579563`, `08e1037`). The audit's findings and their disposition:

| Criterion | Status | Notes |
| --- | --- | --- |
| AC-001 to AC-008 | met | readers, dedupe, cumulative totals, session or message once, cache merge, excluded sources, Usage Summary shape, no window |
| AC-009 | met | audit found no per-OS test; `home-layouts.test.ts` (30 tests) added in `8a746ac`. Windows uses a stub `Path` (effect 4.1.2 ships only POSIX) and was not run on Windows |
| AC-010 | met | no server code; test greps non-test sources for listen and network imports |
| AC-011, AC-013 | met | exact output and dry run tests; real-log run |
| AC-012 | met | launcher mapping tested for three platforms; win32 uses `rundll32` (see Deviations) |
| AC-014 to AC-017 | met | network stubs now include dns, tls, dgram; filter wiring tested through the packed entry |
| AC-018 | met with caveat | Muse default folder `~/.local/share/muse` rests on third-party tools, not Meta docs |
| AC-019 to AC-021 | met | round trip property, worst-case 1904 chars, v1 fixture, unknown model fallback |
| AC-022, AC-023 | met | broken link; tags on page. A zero-usage link broke tags: fixed in `08e1037` and verified in production |
| AC-024 | met | audit showed the unit test could not detect missing buttons; `share-page-http.test.ts` asserts the served HTML and fails when a button is removed |
| AC-025, AC-026, AC-027, AC-029 | met | origin from `VERCEL_PROJECT_PRODUCTION_URL`; PNG 1200x630; card content; no cookie, no redirect (observed, not asserted in a test) |
| AC-028 | met | header is `public, max-age=31536000, immutable` (contains both required directives) |
| AC-030, AC-031 | met | unit tests plus real browser check |
| AC-032 to AC-036 | met | headline raw total; weighted impacts; README lists every factor and price; seven comparisons |
| AC-037 | met | determinism and card equals first three lines; the tie hash is over the decoded summary, which is one-to-one with the link |
| AC-038 | met | `/` returns 308 |
| AC-039 | met | `lint.mjs` 0 FAIL 0 WARN; `inspect.mjs` 0 FAIL on four production runs; `--allow` recorded above. The auditor saw one `blank-gap` FAIL that I could not reproduce |
| AC-040 | met | token parity test |
| AC-041 | met | tarball test and `npm exec` run; `npm publish` and the registry `npx tokenshame` run are not done |
| AC-042 | met | production responds |
| AC-043 | met with deviation | repo is public; CLI and share-link use `@effect/vitest`; web uses plain `vitest`, with HTTP tests under `apps/web/tests/` |
| INV-001 to INV-003 | met | property tests; identical bytes for repeated requests |

## Manual Review Checklist

| Area | Check | How to perform | Expected result |
| --- | --- | --- | --- |
| CLI | Run it on your real machine | `cd apps/cli && bun run build && node dist/index.mjs --dry-run` | summary of your own usage, a link, "nothing was opened", exit 0 |
| CLI | Enter opens the browser | run `node apps/cli/dist/index.mjs` in a terminal, press Enter | default browser opens the production Share Page; Ctrl-C opens nothing |
| CLI | No network | run with the network off | identical output |
| Share Page | Look at it | open the link printed by the dry run | red hero with the raw token total, roast lines, cost, Post on X and Copy image buttons, `npx tokenshame` box; no agent list or date range |
| Share Page | Copy image | press Copy image in Chrome, paste into a post box | the 1200x630 card pastes |
| Share Card on X | Unfurl | paste a production Share Link into an X post draft | large card with the headline and three lines (not verified in this delivery) |
| Broken link | Cut a character | open `/r/<link minus last 10 chars>` | in-voice message, no crash, generic card |
| Vercel | Project settings | check the Vercel project `tokenshame` | root `apps/web`, Node 24.x, domain `tokenshame.vercel.app` |
| npm | Publish | `cd apps/cli && npm publish` with your login | package `tokenshame` on npm; then `npx tokenshame` works; choose a licence first |
| Windows | Launcher | run the CLI on Windows, press Enter | browser opens (never run on Windows here) |
| Node 22.13 | Floor | run the packed CLI on Node 22.13 | works (not installed here) |

## Pre-existing Issues

- The user's earlier tree was uncommitted; it was committed as baseline after a secret and path scan (no findings).
- The 6 wiki markdown files fail `oxfmt --check`; the wiki is outside the commit-gate scopes.
- Project 7 views exist with filters; grouping and sorting cannot be set through the API.

## Out of Scope Observations

- `hi ensure` does not exist in `hi` 6.12.0 although the `hi-cli` skill documents it (Harness friction).
- The coal-plant, flight, water and energy factors are rough public estimates, labeled in the README; the energy per token is good to about a factor of ten.
- Models not in `prices.ts` fall back to the Claude Sonnet 4.6 price and may over or understate cost.
- `npm` publishes `tokenshame` only when the owner runs it.

## Remaining Work

- Owner: choose a licence and add a LICENSE file; run `npm publish`; set the project 7 view grouping by hand.
- Unverified: Windows launcher, Node 22.13, a real X unfurl, Muse's real default folder.

## Steering

| Date | Feedback | Changes |
| --- | --- | --- |
| 2026-11-11 | "just go", "get this done and working" | full delivery without further questions; npm publish excluded as not authorized |
