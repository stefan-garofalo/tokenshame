# Effect Source Guide

This is an index card for the global `opensrc` cache. Do not commit cloned source here.

## Resolve Effect v4 Source

```bash
opensrc path Effect-TS/effect
```

This resolves the Effect v4 authority at https://github.com/Effect-TS/effect/tree/main.

Resolve the project-pinned package only when exact installed-version behavior matters:

```bash
opensrc path --cwd . effect
```

## Use When

- Effect runtime, Schema, Layer, Stream, or service behavior affects implementation.
- Official docs are not specific enough for the call path being changed.

## Inspect First

- `packages/effect/src`
- `packages/effect/test`
- `packages/platform/src`

## Rules

- Use the Effect repository main branch as the primary v4 source authority.
- Use project-pinned package resolution only for exact installed-version behavior.
- Keep the cloned source in the global `~/.opensrc` cache unless the user explicitly asks for a different cache root.
- Do not copy upstream source into this directory.
