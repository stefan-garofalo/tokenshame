# Subagent Manifest Prompt

Tailor `.agents/subagents/manifest.mjs` to this repository. `hi` writes the manifest once and never overwrites it; `hi update` rebuilds the Claude, Codex, Cursor, and OpenCode agent files from it.

## Workspaces

- `.`
- `apps/cli`
- `apps/web`
- `packages/config`
- `packages/ui`

## Selected Packs

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

## Steps

1. Activate `writing-for-agents` before editing the manifest.
2. Add one specialist per workspace above. For `apps/api`: `name: "apps-api"`, `ownedPaths: ["apps/api", "apps/api/**"]`, `guidanceFiles: ["apps/api/AGENTS.md"]`. For `.` (the root package): `ownedPaths: ["**/*"]`, `guidanceFiles: ["AGENTS.md"]`. Give each specialist `boundaries`, `activationInstructions`, and the `packs` that fit its workspace, defined in `capabilityPacks` from the Selected Packs. Done when every listed workspace has exactly one specialist.
3. Keep the shipped workflow and review specialists, include `simplify` in every implementation specialist, and give `docs/` its own docs specialist when it exists.
4. Run `hi update`. Done when each specialist has one agent file in each of `.claude/agents`, `.codex/agents`, `.cursor/agents`, and `.opencode/agents`.

## Manifest rules

- One self-contained module exporting `agents` and `capabilityPacks`; relative imports cannot load.
- Agent names and skill ids are file names: letters, digits, `.`, `_`, `-`.
- Every pack an agent lists is defined in `capabilityPacks`. An agent's `skills`, when present, replaces the skills of its packs.
- `activationInstructions` is a flat list of strings.
