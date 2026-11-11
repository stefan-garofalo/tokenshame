# Prompt Spec

Target file: `apps/web/AGENTS.md`
Scope: `apps/web`

This prompt spec is a Built Artifact. `hi update` renders it again from Project settings and the Recorded Shape. Do not edit it. Write `apps/web/AGENTS.md` from this spec and from real repository evidence.

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
| `agent-browser` | When the task explicitly invokes `agent-browser`, read `../../.agents/skills/agent-browser/SKILL.md`. |
| `animate` | When the task explicitly invokes `animate`, read `../../.agents/skills/animate/SKILL.md`. |
| `async-react-patterns` | When the task explicitly invokes `async-react-patterns`, read `../../.agents/skills/async-react-patterns/SKILL.md`. |
| `brandkit` | When the task explicitly invokes `brandkit`, read `../../.agents/skills/brandkit/SKILL.md`. |
| `break-ui` | When the task explicitly invokes `break-ui`, read `../../.agents/skills/break-ui/SKILL.md`. |
| `design-taste-frontend` | When the task explicitly invokes `design-taste-frontend`, read `../../.agents/skills/design-taste-frontend/SKILL.md`. |
| `emil-design-eng` | When the task explicitly invokes `emil-design-eng`, read `../../.agents/skills/emil-design-eng/SKILL.md`. |
| `find-animation-opportunities` | When the task explicitly invokes `find-animation-opportunities`, read `../../.agents/skills/find-animation-opportunities/SKILL.md`. |
| `frontend-domain-structure` | When the task explicitly invokes `frontend-domain-structure`, read `../../.agents/skills/frontend-domain-structure/SKILL.md`. |
| `image-to-code` | When the task explicitly invokes `image-to-code`, read `../../.agents/skills/image-to-code/SKILL.md`. |
| `imagegen-frontend-mobile` | When the task explicitly invokes `imagegen-frontend-mobile`, read `../../.agents/skills/imagegen-frontend-mobile/SKILL.md`. |
| `imagegen-frontend-web` | When the task explicitly invokes `imagegen-frontend-web`, read `../../.agents/skills/imagegen-frontend-web/SKILL.md`. |
| `mobile-native` | When the task explicitly invokes `mobile-native`, read `../../.agents/skills/mobile-native/SKILL.md`. |
| `model-checking` | When the task explicitly invokes `model-checking`, read `../../.agents/skills/model-checking/SKILL.md`. |
| `prototype-variants` | When the task explicitly invokes `prototype-variants`, read `../../.agents/skills/prototype-variants/SKILL.md`. |
| `quality-types` | When the task explicitly invokes `quality-types`, read `../../.agents/skills/quality-types/SKILL.md`. |
| `react-doctor` | When the task explicitly invokes `react-doctor`, read `../../.agents/skills/react-doctor/SKILL.md`. |
| `review-animations` | When the task explicitly invokes `review-animations`, read `../../.agents/skills/review-animations/SKILL.md`. |
| `shadcn` | When the task explicitly invokes `shadcn`, read `../../.agents/skills/shadcn/SKILL.md`. |
| `tanstack-query` | When the task explicitly invokes `tanstack-query`, read `../../.agents/skills/tanstack-query/SKILL.md`. |
| `vercel-composition-patterns` | When the task explicitly invokes `vercel-composition-patterns`, read `../../.agents/skills/vercel-composition-patterns/SKILL.md`. |
| `vercel-react-best-practices` | When the task explicitly invokes `vercel-react-best-practices`, read `../../.agents/skills/vercel-react-best-practices/SKILL.md`. |

The final `## Skills` table holds exactly the listed skills plus accepted candidate skills, each ID once; delete every other row. Point each row to its installed source with the exact invocation trigger; keep skill semantics in the skill.

## Source Guide

- Link [Source Guide](../../opensrc/README.md) and read it when work depends on third-party library behavior. Keep package commands and precedence there, not here.

## Packs for this scope

- `frontend`
- `react`
- `shadcn`
- `tanstack-query`
- `typescript`

## Authoring guidance

- Activate `writing-for-agents`, then `rule-authoring`, before you write `apps/web/AGENTS.md` or maintain `.agents/rules/index.md`. Keep detailed patterns in granular rule files.
- Keep the final prompt concise, imperative, and scope-first.
- Keep phase skills and Finder wrappers out of every scoped `AGENTS.md`. Finder wrappers require explicit human invocation; other phases run from the parent goal or handoff.
- Route broader repository concerns back to the root prompt instead of repeating them in every scope.
- If `apps/web/AGENTS.md` already exists, keep its repository-specific constraints and reconcile them with the Packs for this scope.
- Keep `$docs-ingest-phase` invocation in prompt files, not in generated docs pages.
