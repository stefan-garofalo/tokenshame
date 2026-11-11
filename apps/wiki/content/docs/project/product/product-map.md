---
title: "Tokenshame Product Map"
surface: project
permission: project
---

# Tokenshame Product Map

Durable identities for the backlog objects in the GitHub project. Provider issue numbers are in each issue and in the project, not here.

| Kind | Durable identity | Name | Parent |
| --- | --- | --- | --- |
| Product Area | `PA-usage-roast` | Usage Roast | — |
| Initiative | `INI-shareable-usage-roasts-for-x` | Shareable usage roasts for X | `PA-usage-roast` |
| Epic | `EPIC-usage-roast-share` | Usage Roast Share | `INI-shareable-usage-roasts-for-x` |
| Story | `STORY-run-cli-see-usage` | Run the CLI and see my usage | `EPIC-usage-roast-share` |
| Story | `STORY-roast-on-share-page` | See my roast on a share page | `EPIC-usage-roast-share` |
| Story | `STORY-share-roast-on-x` | Share my roast on X | `EPIC-usage-roast-share` |
| Story | `STORY-install-and-open-for-real` | Install it and open it for real | `EPIC-usage-roast-share` |
| Task | `TASK-test-tooling` | Test tooling: vitest and turbo test | `STORY-install-and-open-for-real` |
| Task | `TASK-share-link-package` | Share link package | `STORY-run-cli-see-usage` |
| Task | `TASK-claude-reader` | Claude Code reader with stats-cache merge | `STORY-run-cli-see-usage` |
| Task | `TASK-codex-reader` | Codex reader | `STORY-run-cli-see-usage` |
| Task | `TASK-opencode-reader` | opencode reader and SQLite helper | `STORY-run-cli-see-usage` |
| Task | `TASK-json-agent-readers` | Readers for Pi, Gemini CLI, Grok, Qwen, Amp, Droid, Kimi | `STORY-run-cli-see-usage` |
| Task | `TASK-sqlite-agent-readers` | Readers for Copilot CLI, Goose, Antigravity, Muse | `STORY-run-cli-see-usage` |
| Task | `TASK-cli-command` | CLI command, consent prompt, launcher, dry run | `STORY-run-cli-see-usage` |
| Task | `TASK-web-ssr` | Server-rendered web app, page tags, root redirect | `STORY-roast-on-share-page` |
| Task | `TASK-roast-engine` | Roast engine | `STORY-roast-on-share-page` |
| Task | `TASK-share-page` | Share page and broken-link page | `STORY-roast-on-share-page` |
| Task | `TASK-share-card` | Share card route | `STORY-share-roast-on-x` |
| Task | `TASK-share-buttons` | Copy image and Post on X buttons | `STORY-share-roast-on-x` |
| Task | `TASK-npm-package` | npm package for the CLI | `STORY-install-and-open-for-real` |
| Task | `TASK-vercel-deploy` | Vercel project and deploy | `STORY-install-and-open-for-real` |
| Task | `TASK-readme` | README with project pitch and How we calculate | `STORY-install-and-open-for-real` |

Milestone: `V1` (repository milestone). Spec: [usage-roast-share](../specs/tokenshame/usage-roast-share/SPEC.md).
