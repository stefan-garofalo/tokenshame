# Agent Handoff

`hi` installed Registry Items from the Registry into this repository. This file tells you what the installer wrote and what you must do next.

This file is a Built Artifact. `hi update` renders it again from Project settings and the Recorded Shape. Do not edit it.

## Managed Artifacts

- Copied Artifact: the installer writes it verbatim from a Registry Item. `hi update` overwrites it. Do not edit it.
- Built Artifact: the installer renders it from a Registry Item template, Project settings, and the Recorded Shape. `hi update` renders it again. Do not edit it. To change it, change `.devpunks/settings.json`, then run `hi update`.
- Authored Artifact: the installer writes it only when it is absent. The installer never compares or overwrites it after that. You own it.
- `.devpunks/installed.json` is the Installed Record. Only the installer writes it. Do not edit it.

## Installed Packs

| Pack | Skills |
| --- | --- |
| `core` | (none) |
| `debug` | `bug-discovery-phase`, `bug-resolution-phase`, `debug-agent`, `debugging-phase` |
| `docs` | `docs-ingest-phase`, `docs-onboarding`, `rule-authoring`, `write-graph-based-skills`, `writing-beats`, `writing-for-agents`, `writing-fragments`, `writing-shape` |
| `effect` | `effect`, `effect-backend-structure`, `effect-recoverable-actions`, `effect-service-design` |
| `frontend` | `agent-browser`, `animate`, `brandkit`, `break-ui`, `design-phase`, `design-taste-frontend`, `emil-design-eng`, `find-animation-opportunities`, `frontend-domain-structure`, `image-to-code`, `imagegen-frontend-mobile`, `imagegen-frontend-web`, `mobile-native`, `prototype-variants`, `review-animations` |
| `misc` | `ask-hi`, `pr`, `retro`, `show-me`, `wait-what` |
| `planning` | `business-finder`, `create-architecture`, `create-plan`, `create-spec`, `delivery-phase`, `finder-phase`, `functional-finder`, `goalify`, `grilling`, `handoff`, `implement-spec`, `prototype-phase`, `repo-asset-management`, `resolve-debt-phase`, `review-phase`, `wayfinder` |
| `quality` | `codebase-design`, `make-tsuite`, `simplify`, `tdd` |
| `react` | `async-react-patterns`, `react-doctor`, `vercel-composition-patterns`, `vercel-react-best-practices` |
| `requirements` | `brainstorm`, `domain-modeling`, `flow-lenses`, `repo-asset-management`, `requirements-grill`, `requirements-phase`, `write-backlog` |
| `research` | `improve-codebase-architecture`, `parallel-research`, `prototype` |
| `security` | `architect-pipeline`, `audit-cicd-security`, `security-best-practices` |
| `shadcn` | `shadcn` |
| `subagents` | `swarm-planner` |
| `tanstack-query` | `tanstack-query` |
| `turborepo` | `turborepo` |
| `typescript` | `model-checking`, `quality-types` |
| `verification` | `create-verification-skill`, `update-verification-skill`, `verify-behavior` |

To change the Packs, run `hi init` again or edit `packs` in `.devpunks/settings.json`. Then run `hi update`.

## Software Scopes

- `apps/cli`
- `apps/web`
- `packages/config`
- `packages/ui`

## Recorded Shape

- Monorepo: `yes`
- Workspace `apps/cli`: technologies `effect`
- Workspace `apps/web`: technologies `react`, `shadcn`, `tanstack-query`
- Workspace `packages/config`: technologies (none)
- Workspace `packages/ui`: technologies `react`, `shadcn`

## Prompt specs

Each prompt spec is a Built Artifact. A prompt spec is an instruction, not a final prompt. Write each target `AGENTS.md` from its prompt spec and from real repository evidence. Use the house structure in `.devpunks/specs/prompts/shared-agents.md` for each target.

| Prompt spec | Target |
| --- | --- |
| `.devpunks/specs/prompts/root.md` | `AGENTS.md` |
| `.devpunks/specs/prompts/apps/cli/prompt.md` | `apps/cli/AGENTS.md` |
| `.devpunks/specs/prompts/apps/web/prompt.md` | `apps/web/AGENTS.md` |
| `.devpunks/specs/prompts/packages/config/prompt.md` | `packages/config/AGENTS.md` |
| `.devpunks/specs/prompts/packages/ui/prompt.md` | `packages/ui/AGENTS.md` |

## TypeScript semantic reads in Codex

- `hi update` registers one Typegraph server per Compiler Project in `.codex/config.toml`, named `typegraph_<project>`. Use the server whose `TYPEGRAPH_TSCONFIG` owns the file.
- Each server exposes five reads: `ts_find_symbol`, `ts_definition`, `ts_references`, `ts_type_info`, `ts_module_exports`. They are always approved.
- Answers reflect source edits on disk. After a tsconfig, dependency, or branch change, start a new Codex session.
- Semantic reads never replace format, lint, or typecheck evidence.

## Pack rules

- A Pack rule is a Built Artifact in `.agents/rules/packs/`. `hi update` owns that folder: it writes each Pack rule again and removes a Pack rule that no installed Pack Builds. Do not edit a Pack rule.
- Put each project rule in a different folder, `.agents/rules/<scope>/`. Never use `packs/` as a project rule scope.
- Add one row for each Pack rule below to `.agents/rules/index.md`. Use the values as written. Remove the row of a Pack rule that this list no longer shows.

- No installed Pack has a rule.

## Project Skills

- A skill under `.agents/skills/<id>` that no Registry Item provides is a Project Skill. A Project Skill is an Authored Artifact.
- The installer never removes, compares, or overwrites a Project Skill.
- If a Registry Item provides a skill with the same id, the installer renames the Project Skill directory to `[DEPRECATED] <id>` and installs the Registry skill. The `hi update` report shows each rename.
- For each `[DEPRECATED] <id>` directory, move the useful content into a Project Skill with a new id, or delete the directory.

## Next steps

1. Activate `writing-for-agents`, then `rule-authoring`. Do this before you write prompts, scoped guidance, or `.agents/rules/`.
2. Read `.devpunks/settings.json`. Make sure that each required tool is available: (none). If a tool is missing, install it before other work.
3. Write each target `AGENTS.md` from its prompt spec. Start with the root prompt spec. Each `AGENTS.md` is an Authored Artifact.
4. Put a `CLAUDE.md` symlink beside each `AGENTS.md`. The symlink must point to `AGENTS.md`.
5. Keep detailed project patterns in `.agents/rules/`. `.agents/rules/index.md` lists every project rule and every Pack rule. Each scoped `AGENTS.md` has one pointer to `.agents/rules/index.md`.
6. Change `.agents/subagents/manifest.mjs` so that it agrees with the real repository: owned paths, guidance files, Packs, and skills for each agent. The subagent manifest is an Authored Artifact.
7. Run `hi update` after you change the subagent manifest. `hi update` rebuilds the harness agent files in `.claude/agents`, `.codex/agents`, `.cursor/agents`, and `.opencode/agents`. Do not edit those files.
8. Before you write prompts or plans, find the core libraries whose source behavior matters. Read `opensrc/<package>.md` when it exists. Then run `opensrc path --cwd . <package>`.
9. Run `hi diff` for a Drift Check. Each managed path shows one class: `update-available`, `local-edit`, `conflict`, `shape-drift`, `missing`, `stale`, or `link-failed`. `hi diff` writes nothing.
10. Run `hi check` to compare the installed Baseline with the latest Baseline.
