# React Source Guide

This is an index card for the global `opensrc` cache. Do not commit cloned source here.

## Resolve Source

```bash
opensrc path --cwd . react
```

Fallback repository lookup:

```bash
opensrc path facebook/react
```

## Use When

- React rendering, hooks, suspense, or client/server integration behavior affects implementation.
- Docs explain the API but not the runtime edge case being debugged.

## Inspect First

- `packages/react/src`
- `packages/react-reconciler/src`

## Rules

- Prefer official docs first when they answer the question.
- Use `opensrc path --cwd .` so npm package resolution can use this repo's lockfile.
- Keep the cloned source in the global `~/.opensrc` cache unless the user explicitly asks for a different cache root.
- Do not copy upstream source into this directory.
