# Prompt Spec

Target file: `AGENTS.md`
Scope: `root`
Workspace: `.`

This prompt spec is a Built Artifact. `hi update` renders it again from Project settings and the Recorded Shape. Do not edit it. Write `AGENTS.md` from this spec and from real repository evidence.

## Root Prompt Criteria

- Write the final root prompt from real repository evidence. Do not copy this spec as the final prompt body.
- Keep the final root prompt concise: surface map, workflow routing, cross-surface contract rules, validation routing, then only short repository-wide source, URL, and docs rules.
- Do not add a root `Primary skills here` line. Workflow entrypoints are explicit, not always-on scoped defaults.

## Root Prompt Concepts

### Repo Surface Map

Purpose: Tell the agent where work belongs.

Invariants:
- Name the real apps, packages, services, infra folders, docs and wiki roots, generated-code homes, and shared contract owners in this repository.
- For each surface, say what belongs there and what stays elsewhere.
- Route single-surface implementation to the nearest scoped prompt.
- For cross-surface work, name the owning surfaces before editing.

### Workflow Routing

Purpose: Tell the agent which lifecycle entrypoint applies.

Invariants:
- Start Finder only from an explicit human invocation of `business-finder` or `functional-finder`.
- Unclear requirements or product decisions route to `requirements-phase`.
- Product design work with existing evidence routes to explicit `design-phase`.
- Scoped implementation from an accepted spec, issue, or plan routes to `delivery-phase`.
- Runtime failures, crashes, broken local flows, and production-like symptoms route to `debugging-phase`.
- Review requests, branch reviews, and PR reviews route to `review-phase`.
- Docs or knowledge updates after proven changes route to `docs-ingest-phase`.
- Readonly investigation that splits across independent surfaces or hypotheses routes to `parallel-research`.
- Route only to entrypoints listed under "Available workflow entrypoints" below.

### Cross-Surface Contract Rules

Purpose: Tell the agent which boundaries must stay aligned.

Invariants:
- API contracts, generated clients, schemas, env and config, infra wiring, deployment assumptions, and docs stay aligned across owning surfaces.
- Backend or service contract changes are reflected in generated clients and consumers.
- Infra or deployment changes that affect runtime config, callbacks, CORS, queues, storage, or secrets are reflected in the owning scope and docs.
- Product logic does not move across surfaces just to finish a local task.

### Validation Routing

Purpose: Tell the agent how to prove cross-surface work.

Invariants:
- Run the narrowest validation that proves the touched surface first.
- Run contract generation or type checks when APIs or schemas change.
- Run browser, simulator, or manual UI checks when user-facing behavior changes.
- Run infra synth, plan, or dry-run checks when infrastructure changes.
- Record blockers when an expected validation cannot run.

## Root-Wide Invariants

- Write from real repository evidence: manifests, package and workspace names, docs and wiki roots, infra and config files, generated assets, existing prompts, and committed project conventions.
- Do not invent product-specific prose from examples.
- Before working in any directory, inspect the nearest `AGENTS.md` files from the repository root down to each touched path.
- Nested docs and workspace skill pointers are local trigger requirements: for matching work, read each named skill, apply it with root guidance, prefer the most specific directory guidance, and activate every touched scope.
- For review requests, run `review-phase`: one fresh reviewer checks security, performance, contract drift, unrequested behavior and costly smells, and reports at most five P0-P2 findings with file and line references; route deeper redesign to `improve-codebase-architecture`.
- When routed learning artifacts exist, consult relevant learnings during discovery, planning, debugging, and review.
- Hand implementation work to scoped workers in plan-derived waves. Launch every unblocked task whose write scope is disjoint. The parent coordinates, reviews, validates, and advances the graph.
- Before relying on subagents, verify active global and project agent settings, then `.agents/subagents/manifest.mjs` and the selected specialist's owned paths, guidance files, and skills.
- Treat every authored `AGENTS.md` file as the neutral source of truth, with a sibling `CLAUDE.md` symlink that points to it.
- Add `opensrc` source-inspection guidance only when this repository needs it.
- Keep portless guidance repository-wide unless a scoped prompt directly owns local URL, origin, callback, CORS, or proxy configuration.
- End with the docs-update rule when work changes setup, workflow, contracts, architecture, deployment behavior, or non-obvious behavior.

## Installed Packs

- `core`
- `debug`
- `docs`
- `effect`
- `frontend`
- `misc`
- `planning`
- `quality`
- `react`
- `requirements`
- `research`
- `security`
- `shadcn`
- `subagents`
- `tanstack-query`
- `turborepo`
- `typescript`
- `verification`

## Available workflow entrypoints

- `business-finder`
- `functional-finder`
- `requirements-phase`
- `design-phase`
- `delivery-phase`
- `debugging-phase`
- `review-phase`
- `docs-ingest-phase`
- `parallel-research`

## Source inspection

- Decide which core libraries materially affect prompt or lint authoring. Read the matching `opensrc/<package>.md` guide when it exists, then run `opensrc path --cwd . <package>` or `opensrc path owner/repo`.
- Do not invent `opensrc` repositories that the repository does not use.

## Authoring guidance

- Activate `writing-for-agents`, then `rule-authoring`, before you write `AGENTS.md` or maintain `.agents/rules/index.md`. Keep detailed patterns in granular rule files.
- Keep the final prompt concise, imperative, and scope-first.
- Preserve the router shape: guidance, surface map, workflow routing, cross-surface contracts, validation routing, optional `opensrc`, docs-update rule.
- Keep phase skills and Finder wrappers out of every scoped `AGENTS.md`. Finder wrappers require explicit human invocation; other phases run from the parent goal or handoff.
- If `AGENTS.md` already exists, keep its repository-specific constraints and reconcile them with the installed Packs.
