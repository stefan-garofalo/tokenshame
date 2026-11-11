Give this prompt to the next agent.

You continue the work after `hi init` or `hi update` in this repository.

Read these files first:
- `.devpunks/AGENT-HANDOFF.md`
- `.devpunks/settings.json`
- `.devpunks/installed.json`

Installed Packs:
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

Do these steps:
1. Do the "Next steps" in `.devpunks/AGENT-HANDOFF.md` in sequence.
2. Use each prompt spec as an instruction. Do not copy a prompt spec into a final `AGENTS.md`.
3. Do not edit Copied Artifacts or Built Artifacts. `hi update` replaces them, and `hi diff` reports your edits as `local-edit`.
4. Do not edit `.devpunks/installed.json`. Only the installer writes it.
5. Do not delete a Project Skill. For each `[DEPRECATED] <id>` directory, do the steps in the handoff.
6. When you finish, run `hi diff`. Make sure that no row shows `local-edit`, `conflict`, or `missing`.
