---
title: "Tokenshame Product Brief"
surface: project
permission: project
---

# Tokenshame Product Brief

Source: the closed requirements grill ([log](../grilling/tokenshame-grill-log.md), [status](../grilling/tokenshame-grill-status.md)). This page adds no new product claims.

- **Product**: `tokenshame` turns a developer's local AI-agent usage into a funny, cynical roast that they can share on X.
- **Target users**: developers who use coding agents (14 supported: Claude Code, Codex, opencode, Copilot CLI, Pi, Gemini CLI, Grok, Qwen, Amp, Droid, Kimi, Goose, Antigravity, Muse).
- **Business objective**: a CLI run produces a Share Link whose Share Page and Share Card get shared on X, with proper SEO and OG image, at no hosting cost beyond a stateless Vercel page.
- **Product boundaries**: no database, no leaderboard, no login or key, no local report page, no landing page. See the spec's Non-Goals.
- **Durable constraints**: no prompt text leaves the machine; the CLI makes no network request; the share domain stores nothing; every web page is built with `/design-taste-frontend`.
- **Owner**: Stefan Garofalo (`stefan-garofalo`).
- **Repository**: https://github.com/stefan-garofalo/tokenshame
- **Backlog root**: https://github.com/users/stefan-garofalo/projects/7
- **Operating rules**: Tasks are the execution graph; blockers define order; one pull request per plan for this repository.
- **Versions**: `V1` — The CLI and the Vercel share page work end to end for all 14 agents. Accepted by the user's "just go" on the recommended name.
