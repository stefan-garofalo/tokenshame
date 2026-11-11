# Prompt Spec

Target file: `.agents/AGENTS.md`
Scope: `shared`
Workspace: `.agents`

This prompt spec is a Built Artifact. `hi update` renders it again from Project settings and the Recorded Shape. Do not edit it.

`.agents/AGENTS.md` is the shared prompt. It is a Copied Artifact from the Registry: do not edit it. This spec gives the house structure that each root, docs, and workspace `AGENTS.md` follows.

## House structure

- Start with one `## <Scope> Guidance` heading.
- Put one `## Skills` table near the top with one exact task trigger per selected skill and its installed `SKILL.md` path.
- Keep `business-finder`, `functional-finder`, and lifecycle phases as global orchestration entrypoints, not scoped table rows.
- Follow with one short paragraph that defines the scope boundary: what belongs here and what belongs elsewhere.
- Treat every authored `AGENTS.md` file as the neutral source of truth, with a sibling `CLAUDE.md` symlink that points to it.
- Add `opensrc` source-inspection guidance only when the scope needs it.
- Add portless guidance only to the root prompt, or to a scoped prompt that directly owns local URL, origin, callback, CORS, or proxy configuration.
- End with the docs-update rule when work in the scope changes setup, workflow, contracts, or non-obvious behavior.
- Add extra focused sections only when the scope truly needs them.

## Default Packs

- `core`
- `debug`
- `docs`
- `misc`
- `planning`
- `quality`
- `requirements`
- `research`
- `security`
- `subagents`
- `verification`

## Primary skills

- `architect-pipeline`: `skills/architect-pipeline/SKILL.md`
- `ask-hi`: `skills/ask-hi/SKILL.md`
- `audit-cicd-security`: `skills/audit-cicd-security/SKILL.md`
- `brainstorm`: `skills/brainstorm/SKILL.md`
- `codebase-design`: `skills/codebase-design/SKILL.md`
- `create-architecture`: `skills/create-architecture/SKILL.md`
- `create-plan`: `skills/create-plan/SKILL.md`
- `create-spec`: `skills/create-spec/SKILL.md`
- `create-verification-skill`: `skills/create-verification-skill/SKILL.md`
- `debug-agent`: `skills/debug-agent/SKILL.md`
- `docs-onboarding`: `skills/docs-onboarding/SKILL.md`
- `domain-modeling`: `skills/domain-modeling/SKILL.md`
- `flow-lenses`: `skills/flow-lenses/SKILL.md`
- `goalify`: `skills/goalify/SKILL.md`
- `grilling`: `skills/grilling/SKILL.md`
- `handoff`: `skills/handoff/SKILL.md`
- `implement-spec`: `skills/implement-spec/SKILL.md`
- `improve-codebase-architecture`: `skills/improve-codebase-architecture/SKILL.md`
- `make-tsuite`: `skills/make-tsuite/SKILL.md`
- `parallel-research`: `skills/parallel-research/SKILL.md`
- `pr`: `skills/pr/SKILL.md`
- `prototype`: `skills/prototype/SKILL.md`
- `repo-asset-management`: `skills/repo-asset-management/SKILL.md`
- `requirements-grill`: `skills/requirements-grill/SKILL.md`
- `retro`: `skills/retro/SKILL.md`
- `rule-authoring`: `skills/rule-authoring/SKILL.md`
- `security-best-practices`: `skills/security-best-practices/SKILL.md`
- `show-me`: `skills/show-me/SKILL.md`
- `simplify`: `skills/simplify/SKILL.md`
- `swarm-planner`: `skills/swarm-planner/SKILL.md`
- `tdd`: `skills/tdd/SKILL.md`
- `update-verification-skill`: `skills/update-verification-skill/SKILL.md`
- `verify-behavior`: `skills/verify-behavior/SKILL.md`
- `wait-what`: `skills/wait-what/SKILL.md`
- `wayfinder`: `skills/wayfinder/SKILL.md`
- `write-backlog`: `skills/write-backlog/SKILL.md`
- `write-graph-based-skills`: `skills/write-graph-based-skills/SKILL.md`
- `writing-beats`: `skills/writing-beats/SKILL.md`
- `writing-for-agents`: `skills/writing-for-agents/SKILL.md`
- `writing-fragments`: `skills/writing-fragments/SKILL.md`
- `writing-shape`: `skills/writing-shape/SKILL.md`

## Authoring guidance

- Activate `writing-for-agents`, then `rule-authoring`, before you write a scoped `AGENTS.md` or maintain `.agents/rules/index.md`. Keep detailed patterns in granular rule files.
- Keep repository-local coding standards in docs and workspace prompts, not in the shared prompt.
- Keep phase skills and Finder wrappers out of every scoped `AGENTS.md`. Finder wrappers require explicit human invocation; other phases run from the parent goal or handoff.
