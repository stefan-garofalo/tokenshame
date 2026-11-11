// Built by hi update from the selected lint assets; local edits are overwritten.
// Project lint rules belong in oxlint.local.ts, which applies last and is never overwritten.
import { recommended as effectTsgoRecommended } from "@effect/tsgo/oxlint-presets";
import type { OxlintConfig } from "oxlint";
import { defineConfig } from "oxlint";
import core from "ultracite/oxlint/core";
import ultraciteVitest from "ultracite/oxlint/vitest";

import projectConfig from "./oxlint.local.ts";

const managed = {
  jsPlugins: [
    {
      name: "effect-js",
      specifier: "@effect/eslint-plugin",
    },
    {
      name: "anti-slop-apps-cli",
      specifier: "./tools/oxlint/anti-slop/index.mjs",
    },
  ],
  rules: {
    "anti-slop-apps-cli/no-chained-type-assertions": "error",
    "anti-slop-apps-cli/no-conditional-empty-object-spread": "error",
    "anti-slop-apps-cli/no-known-value-widening": "error",
    "anti-slop-apps-cli/no-module-mocking": "error",
    "anti-slop-apps-cli/no-object-parameters": "error",
    "anti-slop-apps-cli/no-reflect-apply": "error",
    "anti-slop-apps-cli/no-reflect-get": "error",
    "anti-slop-apps-cli/no-runtime-typeof": "error",
    "anti-slop-apps-cli/no-shape-in-symbol-names": "error",
    "anti-slop-apps-cli/no-unknown-parameters": "error",
    "anti-slop-apps-cli/no-unknown-returns": "error",
    "anti-slop-apps-cli/no-unknown-type-aliases": "error",
    "anti-slop-apps-cli/no-unsafe-dictionary-type": "error",
    "anti-slop-apps-cli/no-widen-then-assert": "error",
    "anti-slop-apps-cli/require-safety-comment-for-type-assertion": "error",
    "effect-js/no-import-from-barrel-package": [
      "error",
      {
        packageNames: ["effect"],
      },
    ],
    "typescript/promise-function-async": "off",
  },
} satisfies OxlintConfig;

const project: OxlintConfig = projectConfig;

export default defineConfig({
  ...project,
  extends: [
    core,
    ultraciteVitest,
    effectTsgoRecommended,
    ...(project.extends ?? []),
  ],
  ignorePatterns: [
    ...(core.ignorePatterns ?? []),
    ".devpunks/**",
    "tools/oxlint/anti-slop/**",
    ...(project.ignorePatterns ?? []),
  ],
  jsPlugins: [...managed.jsPlugins, ...(project.jsPlugins ?? [])],
  rules: { ...managed.rules, ...project.rules },
});
