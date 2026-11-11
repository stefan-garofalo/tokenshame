# Managed lint

Built by `hi update` from the Harness Intelligence Registry; local edits are overwritten. Change
`.devpunks/settings.json` (`packs`, `lint.scopes`, `lint.exclude`, `lint.disabledAssets`) and run
`hi update` instead. `lint.disabledAssets` lists asset ids that are never installed.

Each Software Scope gets a Built `oxlint.config.ts`: the Ultracite `core` preset first, then framework
presets and config extensions, then each selected asset's plugins and rules, then the scope's
`oxlint.local.ts` last, so project rules win. Asset specs live in `.devpunks/specs/lint/assets/`. The
first install adds the toolchain `oxfmt@0.72.0`, `oxlint@1.90.0`, `ultracite@7.12.4` only where a package is missing. After that, the
project owns these versions; `hi update` does not change them.

## Project lint rules

Put project-specific rules, categories, `env`, `overrides`, and `ignorePatterns` in the scope's
`oxlint.local.ts`. `hi` writes it once (seeded from an existing `oxlint.config.ts` on adoption) and never
changes it. A rule for a JS plugin must name a built-in Oxlint plugin or a `jsPlugins` alias that
`oxlint.local.ts` declares itself. The root scope never lints the Managed Artifact homes `.agents`,
`.claude`, `.codex`, `.cursor`, `.devpunks`, `.devpunks-cache`, `.opencode`, and `opensrc`.

Run `node .agents/scripts/managed-lint-runner.mjs` from the repository root for every scope, or the
`lint` script inside one scope. Pass explicit files after `--`, or as a list with `--files-from <file>`
or `--files-from -` (standard input; NUL- or newline-separated). Exit codes: `0` clean, `1` findings,
`2` operational failure.

When `@effect/tsgo` 0.59.0 or later is installed, managed lint runs Oxlint through `effect-tsgo oxlint`,
so Effect rules need no patched `node_modules`. An editor that starts stock `oxlint` needs the
project's own `effect-tsgo patch --no-typescript --oxlint`.

Set `lint.typeAwareBackend` to `"tsrs"` (default `"tsgolint"`) and run `hi update` to run the
type-aware rules of `effect-tsgo-recommended` scopes on tsrs: `effect-tsgo --tsrs-lint oxlint`. It
needs `@effect/tsgo` 0.67.0 or later, does not use `oxlint-tsgolint`, and is experimental upstream.

## Type-checking the lint config

The Built `oxlint.config.ts` imports `./oxlint.local.ts` with its `.ts` extension, because Oxlint loads
the config with Node's native `import()`, which needs it. A tsconfig that includes `**/*.ts`, such as
the Next.js default, then type-checks both files and fails with TS5097 ("An import path can only end
with a '.ts' extension when 'allowImportingTsExtensions' is enabled"). The project owns its tsconfig;
`hi update` never changes it. Use one of these fixes in that tsconfig:

- Add `"allowImportingTsExtensions": true` to `compilerOptions`. TypeScript accepts it only with
  `noEmit` or `emitDeclarationOnly`; the Next.js tsconfig already sets `noEmit: true`.
- Add `oxlint.config.ts` and `oxlint.local.ts` to `exclude`. This is simpler, but then nothing
  type-checks the lint config.

## Software Scopes

- `apps/cli`: `effect-no-barrel-imports`, `effect-tsgo-recommended`, `typescript-anti-slop`, `vitest-core`
- `apps/web`: `react-core`, `react-frontend-layers`, `react-you-might-not-need-an-effect`, `tanstack-query-core`, `typescript-anti-slop`, `vitest-core`
- `packages/config`: `typescript-anti-slop`, `vitest-core`
- `packages/ui`: `react-core`, `react-frontend-layers`, `react-you-might-not-need-an-effect`, `typescript-anti-slop`, `vitest-core`

## Selected assets

### effect-no-barrel-imports

- Description: Effect architectural rule that blocks barrel-package imports.
- Packs: `effect`
- Oxlint presets: (none)
- Required dev dependencies: `@effect/eslint-plugin`, `@typescript-eslint/utils`, `eslint`

### effect-tsgo-recommended

- Description: Effect tsgo recommended type-aware Oxlint rules.
- Packs: `effect`
- Oxlint presets: (none)
- Required dev dependencies: `@effect/tsgo`, `oxlint-tsgolint`

### punks-anti-slop-transition

- Description: Explicit Anti-Slop adoption policy for existing Harness workspaces.
- Packs: (none)
- Package names: `@punks/api`, `@punks/auth`, `@punks/backoffice`, `@punks/cli`, `@punks/config`, `@punks/contract`, `@punks/db`, `@punks/env`, `@punks/scaffold`, `@punks/ui`, `@punks/web`, `@punks/wiki`
- Oxlint presets: (none)
- Required dev dependencies: (none)

### punks-backoffice-canonical

- Description: Canonical lint exceptions for the Harness backoffice package.
- Packs: (none)
- Package names: `@punks/backoffice`
- Oxlint presets: (none)
- Required dev dependencies: (none)

### punks-cli-canonical

- Description: Canonical lint policy for the shipped Harness CLI package.
- Packs: (none)
- Package names: `@punks/cli`
- Oxlint presets: (none)
- Required dev dependencies: (none)

### react-core

- Description: Ultracite React preset for rendered app and shared UI code.
- Packs: `react`
- Oxlint presets: `ultracite/oxlint/react`
- Required dev dependencies: (none)

### react-frontend-layers

- Description: First-party frontend-domain-structure rules enforcing the layer model: routes, composition, features, entities, modules, integrations, ui.
- Packs: `react`
- Oxlint presets: (none)
- Required dev dependencies: `@oxlint/plugins`

### react-you-might-not-need-an-effect

- Description: Guidance rules that push React code away from unnecessary effects.
- Packs: `react`
- Oxlint presets: (none)
- Required dev dependencies: `eslint-plugin-react-you-might-not-need-an-effect`

### tanstack-query-core

- Description: Ultracite TanStack preset for query/router/start framework linting.
- Packs: `tanstack-query`
- Oxlint presets: `ultracite/oxlint/tanstack`
- Required dev dependencies: (none)

### typescript-anti-slop

- Description: Vendored Anti-Slop rules for rejecting low-evidence TypeScript and JavaScript patterns.
- Packs: `typescript`
- Oxlint presets: (none)
- Required dev dependencies: `@oxlint/plugins`

### vitest-core

- Description: Ultracite Vitest preset for repo-owned test globs.
- Packs: `quality`
- Oxlint presets: `ultracite/oxlint/vitest`
- Required dev dependencies: (none)
