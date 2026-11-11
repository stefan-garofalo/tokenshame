# TanStack Query Source Guide

This is an index card for the global `opensrc` cache. Do not commit cloned source here.

## Resolve Source

```bash
opensrc path --cwd . @tanstack/react-query
```

Fallback repository lookup:

```bash
opensrc path TanStack/query
```

## Use When

- Query invalidation, mutation, cache, hydration, or observer behavior affects implementation.
- A usage pattern depends on library internals or version-specific behavior.

## Inspect First

- `packages/react-query/src`
- `packages/query-core/src`

## Rules

- Prefer official docs first when they answer the question.
- Use `opensrc path --cwd .` so npm package resolution can use this repo's lockfile.
- Keep the cloned source in the global `~/.opensrc` cache unless the user explicitly asks for a different cache root.
- Do not copy upstream source into this directory.
