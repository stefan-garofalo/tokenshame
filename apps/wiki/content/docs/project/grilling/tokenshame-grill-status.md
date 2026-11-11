---
title: "Tokenshame Grill Status"
surface: project
permission: project
---

# Tokenshame Grill Status

## Branch Dashboard

| Branch | Completion | Target altitude | Settled altitude | Locked direction | Open items | Parked |
| --- | --- | --- | --- | --- | --- | --- |
| Usage collection | 100% | L3 | L3 | L1 locks (Q3, Q4, Q15, Q16, Q24, Q26, Q29); CLI: no server, Effect bundled, `node:sqlite` read-only, engines >=22.13, hand protobuf, system open + printed link (Q37) | — | — |
| Share payload | 100% | L3 | L3 | L1 locks (Q5, Q6, Q27, Q32); `packages/share-link` owns format (Q33); raw per-model counts top 8 + other, sessions, busiest hour, first day, version (Q34); old links decode forever (Q38) | — | — |
| Share page | 100% | L3 | L3 | L1 locks (Q2, Q8, Q9, Q17, Q18, Q19, Q22, Q25, Q31, Q32); server does all math (Q35); SSR + Nitro on Vercel Node, immutable card cache (Q36); `/design-taste-frontend` mandatory for web pages (Q48); rule covers pages, card follows the direction, `--allow` only for picture-floor and motion-count (Q49) | — | — |
| Roast content | 100% | L1 | L1 | Self-roast; agent writes all (Q11, Q12); vices, dreadful CO2, trees, homes heated, villages supplied, no ozone (Q20, Q21); deterministic (Q28); roast engine in `apps/web/src/server/roast/` (Q50, supersedes the folder in Q45) | — | — |
| Distribution | 100% | L1 | L1 | npm `tokenshame` (Q13); no Deno/jq (Q14); `tokenshame.vercel.app` (Q23) | — | — |

## Precision Inputs

- Brief import: none
- Fog: not supplied
- Altitude upgrade: not needed
- Auto-pin: not authorized
- Conservative closure: not requested
- Compile gaps: none
- Prior research (non-decision input): handoff `/var/folders/y8/fw7tz9gn7yx645tf162zwlnr0000gp/T/handoff-tokenshame-2026-11-11.md`; T3 thread `2fff6874-5270-4b0a-afbd-721916400609`
- Wiki root: `apps/wiki` did not exist; grill files created at the contract path with no wiki app. Flagged to user R1.

## Current Round

- Round: R7
- Altitude: L3
- Current frontier: empty
- Shared-understanding confirmation: confirmed
- Closure: closed R10

| Question id | Name | Branch | Altitude | Prerequisites | Question | State |
| --- | --- | --- | --- | --- | --- | --- |
| Q39–Q47 | L3 round | code branches | L3 | see log | see log | answered |
| Q48 | Design skill mandatory | Share page | L3 | Q36, Q40 | Which process builds web pages? | answered |
| Q49 | Design skill scope | Share page | L3 | Q25, Q48; fact: skill gate demands 4+ real pictures and 8+ moving elements | Does the rule cover the Share Card, and how does the skill gate apply to a data page? | answered |
| Q50 | Roast engine folder | Share page | L3 | Q45; fact: `known-top-level` lint error | Where does the roast engine live? | answered |

## Required Calls

### R1

- grilling: R1 run — Q3, Q4, Q5, Q6, Q7, Q8, Q9, Q10, Q11, Q12, Q13, Q14
- wait-what: R1 run
- show-me: R1 run — share flow data-flow view via markdown
- domain-modeling: R1 run — added **Impact Estimate**; Share Card now also the pasteable image; resolved "page" ambiguity (Q7)
- flow-lenses: R1 run — image-in-post vs "CLI sends nothing" conflict -> Q22; no landing page leaves root URL undefined -> Q17; methodology home -> Q19; ozone claim fact-check risk -> Q21
- expand: R1 run — Q15, Q16, Q17, Q18, Q19, Q20, Q21, Q22, Q23
- level derivation: R1 not due

### R2

- grilling: R2 run — Q15, Q16, Q17, Q18, Q19, Q20, Q21, Q22, Q23
- wait-what: R2 run
- show-me: R2 run — provider tier table via markdown
- domain-modeling: R2 run — Impact Estimate set widened (vices, flights, coal-plant hours, homes heated, villages supplied); no ozone
- flow-lenses: R2 run — cache-read inflation of Impact Estimates -> Q24; card contents undefined -> Q25; Windows paths -> Q26; empty logs and forged links -> Q27; card/page line mismatch under X cache -> Q28; Muse folder -> Q29
- expand: R2 run — Q24, Q25, Q26, Q27, Q28, Q29
- level derivation: R2 not due

### R3

- grilling: R3 run — Q24, Q25, Q26, Q27, Q28, Q29
- wait-what: R3 run
- show-me: R3 run — Share Card mock via markdown
- domain-modeling: R3 run — "tokens processed" is the public label; cache never named publicly
- flow-lenses: R3 run — build-time card impossible with data-in-link and no DB -> Q30; gap note now has no home -> Q31
- expand: R3 run — Q30, Q31
- level derivation: R3 not due (L1 open)

### R4

- grilling: R4 run — Q30, Q31
- wait-what: R4 run
- show-me: R4 run — card render timeline via markdown
- domain-modeling: R4 run — Flagged Ambiguity: "HTML generated locally" vs Share Link rendering
- flow-lenses: R4 run — upload model needs storage + CLI network call + open upload endpoint -> Q32
- expand: R4 run — Q32
- level derivation: R4 not due (L1 open)

### R5

- grilling: R5 run — Q32
- wait-what: R5 run
- show-me: R5 run — two-model comparison via markdown
- domain-modeling: R5 run — "HTML generated locally" ambiguity resolved: Vercel renders from the Share Link
- flow-lenses: R5 run — none at L1
- expand: R5 run — none
- level derivation: R5 run — Share payload L2: Q33, Q34, Q38; Share page L2: Q35, Q36; Usage collection L2: Q37

### R6

- grilling: R6 run — Q33, Q34, Q35, Q36, Q37, Q38
- wait-what: R6 run
- show-me: R6 run — deployables and contract view via markdown
- domain-modeling: R6 run — no change
- flow-lenses: R6 run — absolute og:image URL -> Q41; redirect target repo missing -> Q46; Nitro Node floor -> Q47; no test runner -> Q44
- expand: R6 run — none at L2
- level derivation: R6 run — Share page L3: Q39, Q40, Q41, Q45, Q46, Q47; Share payload L3: Q42; Usage collection L3: Q43, Q44

### R7

- grilling: R7 run — Q39–Q47
- wait-what: R7 run
- show-me: R7 run — module tree via markdown
- domain-modeling: R7 run — no change
- flow-lenses: R7 run — none
- expand: R7 run — none
- level derivation: R7 not due (all branches at Target Altitude)

### Close

- domain-modeling: run — final pass, terms consistent with log
- show-me: run — persisted understanding via markdown
- wiki synthesis: run — domains/tokenshame-glossary.mdx

## Technical Grounding

| Branch | Evidence anchors | Applicable dimensions | Open technical decisions | Grounding |
| --- | --- | --- | --- | --- |
| Usage collection | existing `apps/cli/src/index.ts:tokenshame` (Effect 4.1.2 CLI, no readers yet); Claude `~/.claude/projects/**/*.jsonl` (2026-10-12..2026-11-11), `~/.claude/stats-cache.json` (lastComputedDate 2026-08-09; `claude -p /stats` on 2.1.322 shows session cost only, cache not refreshed); Codex `~/.codex/sessions/**/*.jsonl` (2026-10-05..2026-11-06); opencode `~/.local/share/opencode/opencode.db` (`session.tokens_*`, sum session or message, not both); Copilot CLI `~/.copilot/session-store.db` table `assistant_usage_events` (on this Mac: 8 rows, 2026-07-10). Known formats, no data here: Pi `~/.pi/agent/sessions/**/*.jsonl`, Grok `~/.grok/sessions/**/updates.jsonl`, Gemini CLI `~/.gemini/tmp/*/chats/*`, Qwen `~/.qwen/projects/*/chats/*.jsonl`, Amp `~/.local/share/amp/**`, Droid `~/.factory/sessions/**/*.settings.json`, Kimi `~/.kimi*/sessions/**/wire.jsonl`, Goose `~/.local/share/goose/sessions/sessions.db`, Antigravity `~/.gemini/antigravity*/conversations/*.db` (protobuf in SQLite), Muse (home unknown). Remote only: Cursor, Kiro, Devin (probable). Do not count T3 scan cache `~/.t3/userdata/usage-scan-cache-v*.json`. Reference readers: T3 Code `packages/provider-*`, `ryoppippi/ccusage` `rust/adapters/*` | sources, dedupe, retention, runtime (node>=22; SQLite reader) | none (fact for implementation: Muse default home) | grounded |
| Share payload | proposed URL-encoded Usage Summary; no schema yet | contract, privacy, versioning | none | grounded |
| Share page | existing `apps/web/vite.config.ts` `tanstackStart({ spa: { enabled: true } })` (@tanstack/react-start 1.169.5); SPA shell renders root `head()` only (`router-core/dist/esm/load-server.js:78`), so per-share meta needs SSR; server route `createFileRoute(path)({ server: { handlers: { GET } } })` returns `Response`; Vercel via `nitro/vite` (not installed); no OG renderer installed | topology, rendering mode, deploy target, OG renderer | none | grounded |
| CLI↔web coupling | existing `apps/cli/tsdown.config.ts` copies `../web/dist/client`; `apps/cli/src/index.ts:reportServer` serves `_shell.html` on 127.0.0.1 (to remove per Q7) | topology | none | grounded |
| Distribution | Vercel team `stefangarofalos-projects`, domain `stefangarofalo.dev` (Vercel registrar, expires 2026-12-29), subdomain pattern in use (`cv.`, `react-composition.torinojs.`); whois: `tokenshame.com`, `.lol`, `.ai` unregistered; `.dev`, `.app` inconclusive | domain | none (`tokenshame.vercel.app` 404 = unclaimed) | grounded |

## Gate Outcomes

### ground

- Phase: ground
- Status: complete
- Exit: grounded
- Scope: R6; Usage collection, Share payload, Share page (L3 grounding)
- Artifacts: Technical Grounding facts for L3
- Validation: web subagent built a throwaway Start + Nitro app (SSR, `[.]` route, headers, 308, Vercel output) and benchmarked takumi/satori/@vercel/og; CLI subagent verified Effect 4.1.2 imports, `node:sqlite` WAL read-only, tsdown inlining, lint rules
- Grill state: L2 settled on code branches; L3 frontier Q39–Q47
- Next suggested route: round R7 at L3
- Blockers: none
- Resume identity: probe files in `/tmp/ts-ground-web`, `/tmp/ts-ground-cli`

### checkpoint

- Phase: checkpoint
- Status: complete
- Exit: answers recorded
- Scope: R6; code branches
- Artifacts: log Q33–Q38, L2 level note
- Validation: user "all recs ok, go"
- Grill state: L2 settled
- Next suggested route: round R7 at L3
- Blockers: none
- Resume identity: none

### round

- Phase: round
- Status: complete
- Exit: answers recorded R7
- Scope: R7; code branches
- Artifacts: log Q39–Q47, L3 level note
- Validation: user "agree all rest"
- Grill state: all branches at Target Altitude
- Next suggested route: close
- Blockers: none
- Resume identity: none

### close

- Phase: close
- Status: complete
- Exit: grill_closed
- Scope: R7; all branches
- Artifacts: Current Round confirmation pending; Close calls
- Validation: Close Guard passes (no unanswered question; all branches at Target Altitude; code branches grounded)
- Grill state: closed R9; handed to create-architecture; reopened and closed again at R10 for Q50 (roast engine folder)
- Next suggested route: close on user reply
- Blockers: none
- Resume identity: none

## Glossary

### Terms

- **Usage Source**: one local folder or file where a coding agent writes token counts (Claude Code, Codex, opencode, and other agents with local data).
  Avoid: provider, account
- **Usage Summary**: the small set of numbers the CLI computes from Usage Sources. It holds no prompt text.
  Avoid: stats, payload, report
- **Share Link**: a public URL on the share domain that carries the Usage Summary inside itself.
  Avoid: report URL
- **Share Page**: the HTML page a Share Link opens.
  Avoid: report page, result page, landing page
- **Tokens Processed**: the public headline number; the raw total of all tokens. Public copy never says "cache".
  Avoid: tokens consumed, incl. cache
- **Share Card**: the 1200×630 image for a Share Link. X shows it as the link card, and the user can also paste it into a post.
  Avoid: thumbnail, postcard, OG
- **Roast Line**: one generated sentence that turns a Usage Summary number into a joke comparison.
  Avoid: meme, roast copy
- **Impact Estimate**: a real-world quantity (water, CO2, trees, GPU heat, API-price cost) derived from token counts with a stated assumption and source, then converted into a dreadful comparison (villages supplied, flights, coal-plant hours, homes heated, packs of cigarettes).
  Avoid: footprint, damage
- **Consent Prompt**: the CLI step that shows the exact Usage Summary and asks before the browser opens a Share Link.

### Relationships

- A **Usage Summary** is computed from one or more **Usage Sources**.
- A **Share Link** encodes exactly one **Usage Summary**.
- A **Share Page** and its **Share Card** render from the same **Share Link**.
- A **Roast Line** states one **Impact Estimate** or one Usage Summary number.

### Axioms

- No prompt or message text leaves the user's machine.
  Checkable as: invariant
- The CLI never asks for a login, API key, or admin key.
  Checkable as: not-checkable
- The CLI makes no network request; only the user's browser contacts the share domain.
  Checkable as: invariant
- The share domain stores nothing; a Share Link alone renders its Share Page and Share Card.
  Checkable as: invariant

### Flagged Ambiguities

- "page" meant both the local report page and the public **Share Page**. Resolution: the local page is dropped (Q7); "page" means **Share Page**.
- "HTML generated locally by the CLI and shared through Vercel" vs "Vercel renders the **Share Page** from the **Share Link**". Resolution: Q32 — Vercel renders the Share Page from the Share Link.
- "like cigarettes" meant cost converted into vices and commodities, not a warning-label style. Resolution: Q20.
