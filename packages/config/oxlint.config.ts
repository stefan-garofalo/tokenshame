// Built by hi update from the selected lint assets; local edits are overwritten.
// Project lint rules belong in oxlint.local.ts, which applies last and is never overwritten.
import type { OxlintConfig } from "oxlint";
import { defineConfig } from "oxlint";
import core from "ultracite/oxlint/core";
import ultraciteVitest from "ultracite/oxlint/vitest";

import projectConfig from "./oxlint.local.ts";

const managed = {
  jsPlugins: [
    {
      name: "anti-slop-packages-config",
      specifier: "./tools/oxlint/anti-slop/index.mjs",
    },
  ],
  rules: {
    "anti-slop-packages-config/no-chained-type-assertions": "error",
    "anti-slop-packages-config/no-conditional-empty-object-spread": "error",
    "anti-slop-packages-config/no-known-value-widening": "error",
    "anti-slop-packages-config/no-module-mocking": "error",
    "anti-slop-packages-config/no-object-parameters": "error",
    "anti-slop-packages-config/no-reflect-apply": "error",
    "anti-slop-packages-config/no-reflect-get": "error",
    "anti-slop-packages-config/no-runtime-typeof": "error",
    "anti-slop-packages-config/no-shape-in-symbol-names": "error",
    "anti-slop-packages-config/no-unknown-parameters": "error",
    "anti-slop-packages-config/no-unknown-returns": "error",
    "anti-slop-packages-config/no-unknown-type-aliases": "error",
    "anti-slop-packages-config/no-unsafe-dictionary-type": "error",
    "anti-slop-packages-config/no-widen-then-assert": "error",
    "anti-slop-packages-config/require-safety-comment-for-type-assertion":
      "error",
  },
} satisfies OxlintConfig;

const project: OxlintConfig = projectConfig;

export default defineConfig({
  ...project,
  extends: [core, ultraciteVitest, ...(project.extends ?? [])],
  ignorePatterns: [
    ...(core.ignorePatterns ?? []),
    ".devpunks/**",
    "tools/oxlint/anti-slop/**",
    ...(project.ignorePatterns ?? []),
  ],
  jsPlugins: [...managed.jsPlugins, ...(project.jsPlugins ?? [])],
  rules: { ...managed.rules, ...project.rules },
});
