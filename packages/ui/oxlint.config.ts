// Built by hi update from the selected lint assets; local edits are overwritten.
// Project lint rules belong in oxlint.local.ts, which applies last and is never overwritten.
import type { OxlintConfig } from "oxlint";
import { defineConfig } from "oxlint";
import core from "ultracite/oxlint/core";
import ultraciteReact from "ultracite/oxlint/react";
import ultraciteVitest from "ultracite/oxlint/vitest";

import projectConfig from "./oxlint.local.ts";

const managed = {
  categories: {
    correctness: "error",
  },
  jsPlugins: [
    {
      name: "frontend-layers-packages-ui",
      specifier: "./tools/oxlint/frontend-layers/index.mjs",
    },
    {
      name: "react-you-might-not-need-an-effect-js",
      specifier: "eslint-plugin-react-you-might-not-need-an-effect",
    },
    {
      name: "anti-slop-packages-ui",
      specifier: "./tools/oxlint/anti-slop/index.mjs",
    },
  ],
  plugins: ["react"],
  rules: {
    "anti-slop-packages-ui/no-chained-type-assertions": "error",
    "anti-slop-packages-ui/no-conditional-empty-object-spread": "error",
    "anti-slop-packages-ui/no-known-value-widening": "error",
    "anti-slop-packages-ui/no-module-mocking": "error",
    "anti-slop-packages-ui/no-object-parameters": "error",
    "anti-slop-packages-ui/no-reflect-apply": "error",
    "anti-slop-packages-ui/no-reflect-get": "error",
    "anti-slop-packages-ui/no-runtime-typeof": "error",
    "anti-slop-packages-ui/no-shape-in-symbol-names": "error",
    "anti-slop-packages-ui/no-unknown-parameters": "error",
    "anti-slop-packages-ui/no-unknown-returns": "error",
    "anti-slop-packages-ui/no-unknown-type-aliases": "error",
    "anti-slop-packages-ui/no-unsafe-dictionary-type": "error",
    "anti-slop-packages-ui/no-widen-then-assert": "error",
    "anti-slop-packages-ui/require-safety-comment-for-type-assertion": "error",
    "frontend-layers-packages-ui/composition-shape": "error",
    "frontend-layers-packages-ui/data-source-imports": "error",
    "frontend-layers-packages-ui/index-reexports-only": "error",
    "frontend-layers-packages-ui/known-top-level": "error",
    "frontend-layers-packages-ui/layer-order": "error",
    "frontend-layers-packages-ui/layout-placement": "error",
    "frontend-layers-packages-ui/no-peer-entity": "error",
    "frontend-layers-packages-ui/no-peer-feature": "error",
    "frontend-layers-packages-ui/no-prefix-siblings": "error",
    "frontend-layers-packages-ui/no-prototype-folder": "error",
    "frontend-layers-packages-ui/no-self-index-import": "error",
    "frontend-layers-packages-ui/public-entrypoint": "error",
    "frontend-layers-packages-ui/route-imports": "error",
    "frontend-layers-packages-ui/server-contract-purity": "error",
    "frontend-layers-packages-ui/ui-placement": "error",
    "react-you-might-not-need-an-effect-js/no-adjust-state-on-prop-change":
      "error",
    "react-you-might-not-need-an-effect-js/no-chain-state-updates": "error",
    "react-you-might-not-need-an-effect-js/no-derived-state": "error",
    "react-you-might-not-need-an-effect-js/no-event-handler": "error",
    "react-you-might-not-need-an-effect-js/no-initialize-state": "error",
    "react-you-might-not-need-an-effect-js/no-pass-data-to-parent": "error",
    "react-you-might-not-need-an-effect-js/no-pass-live-state-to-parent":
      "error",
    "react-you-might-not-need-an-effect-js/no-reset-all-state-on-prop-change":
      "error",
  },
} satisfies OxlintConfig;

const project: OxlintConfig = projectConfig;

export default defineConfig({
  ...project,
  categories: { ...managed.categories, ...project.categories },
  extends: [core, ultraciteReact, ultraciteVitest, ...(project.extends ?? [])],
  ignorePatterns: [
    ...(core.ignorePatterns ?? []),
    ".devpunks/**",
    "tools/oxlint/anti-slop/**",
    "tools/oxlint/frontend-layers/**",
    ...(project.ignorePatterns ?? []),
  ],
  jsPlugins: [...managed.jsPlugins, ...(project.jsPlugins ?? [])],
  plugins: [...managed.plugins, ...(project.plugins ?? [])],
  rules: { ...managed.rules, ...project.rules },
});
