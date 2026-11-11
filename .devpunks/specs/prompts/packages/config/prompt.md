# Prompt Spec

Target file: `packages/config/AGENTS.md`
Scope: `packages/config`

This prompt spec is a Built Artifact. `hi update` renders it again from Project settings and the Recorded Shape. Do not edit it. Write `packages/config/AGENTS.md` from this spec and from real repository evidence.

## Scoped Authoring Contract

- Write one compact coding standard for this scope. Keep root policy inherited, preserve existing project-authored prompts below this scope, and create no deeper `AGENTS.md` files.
- Treat the final `AGENTS.md` as the neutral source, with a sibling `CLAUDE.md` symlink that points to it.

## Repository Invariants

- Include only repository-specific structural invariants: semantic responsibilities, placement and dependency direction, entrypoints, composition, generated and colocation boundaries, and local coding or authoring conventions.
- Derive invariants from current repository behavior and enforced constraints. Omit unresolved conflicts instead of adding generic evidence instructions.
- Point conditional repository detail to scope-owned Markdown with an exact task trigger and relative target.
- End with the narrow validation and docs-update seams that this scope owns.

## Skills

| Skill | Exact trigger |
| --- | --- |
| `model-checking` | When the task explicitly invokes `model-checking`, read `../../.agents/skills/model-checking/SKILL.md`. |
| `quality-types` | When the task explicitly invokes `quality-types`, read `../../.agents/skills/quality-types/SKILL.md`. |

The final `## Skills` table holds exactly the listed skills plus accepted candidate skills, each ID once; delete every other row. Point each row to its installed source with the exact invocation trigger; keep skill semantics in the skill.

## Source Guide

- Link [Source Guide](../../opensrc/README.md) and read it when work depends on third-party library behavior. Keep package commands and precedence there, not here.

## Packs for this scope

- `typescript`

## Authoring guidance

- Activate `writing-for-agents`, then `rule-authoring`, before you write `packages/config/AGENTS.md` or maintain `.agents/rules/index.md`. Keep detailed patterns in granular rule files.
- Keep the final prompt concise, imperative, and scope-first.
- Keep phase skills and Finder wrappers out of every scoped `AGENTS.md`. Finder wrappers require explicit human invocation; other phases run from the parent goal or handoff.
- Route broader repository concerns back to the root prompt instead of repeating them in every scope.
- If `packages/config/AGENTS.md` already exists, keep its repository-specific constraints and reconcile them with the Packs for this scope.
- Keep `$docs-ingest-phase` invocation in prompt files, not in generated docs pages.
