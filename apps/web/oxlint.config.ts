// Built by hi update from the selected lint assets; local edits are overwritten.
// Project lint rules belong in oxlint.local.ts, which applies last and is never overwritten.
import type { OxlintConfig } from "oxlint";
import { defineConfig } from "oxlint";
import core from "ultracite/oxlint/core";
import ultraciteReact from "ultracite/oxlint/react";
import ultraciteTanstack from "ultracite/oxlint/tanstack";
import ultraciteVitest from "ultracite/oxlint/vitest";

import projectConfig from "./oxlint.local.ts";

const managed = {
  categories: {
    correctness: "error",
  },
  jsPlugins: [
    {
      name: "frontend-layers-apps-web",
      specifier: "./tools/oxlint/frontend-layers/index.mjs",
    },
    {
      name: "react-you-might-not-need-an-effect-js",
      specifier: "eslint-plugin-react-you-might-not-need-an-effect",
    },
    {
      name: "anti-slop-apps-web",
      specifier: "./tools/oxlint/anti-slop/index.mjs",
    },
  ],
  plugins: ["react"],
  rules: {
    "anti-slop-apps-web/no-chained-type-assertions": "error",
    "anti-slop-apps-web/no-conditional-empty-object-spread": "error",
    "anti-slop-apps-web/no-known-value-widening": "error",
    "anti-slop-apps-web/no-module-mocking": "error",
    "anti-slop-apps-web/no-object-parameters": "error",
    "anti-slop-apps-web/no-reflect-apply": "error",
    "anti-slop-apps-web/no-reflect-get": "error",
    "anti-slop-apps-web/no-runtime-typeof": "error",
    "anti-slop-apps-web/no-shape-in-symbol-names": "error",
    "anti-slop-apps-web/no-unknown-parameters": "error",
    "anti-slop-apps-web/no-unknown-returns": "error",
    "anti-slop-apps-web/no-unknown-type-aliases": "error",
    "anti-slop-apps-web/no-unsafe-dictionary-type": "error",
    "anti-slop-apps-web/no-widen-then-assert": "error",
    "anti-slop-apps-web/require-safety-comment-for-type-assertion": "error",
    "frontend-layers-apps-web/composition-shape": "error",
    "frontend-layers-apps-web/data-source-imports": "error",
    "frontend-layers-apps-web/index-reexports-only": "error",
    "frontend-layers-apps-web/known-top-level": "error",
    "frontend-layers-apps-web/layer-order": "error",
    "frontend-layers-apps-web/layout-placement": "error",
    "frontend-layers-apps-web/no-peer-entity": "error",
    "frontend-layers-apps-web/no-peer-feature": "error",
    "frontend-layers-apps-web/no-prefix-siblings": "error",
    "frontend-layers-apps-web/no-prototype-folder": "error",
    "frontend-layers-apps-web/no-self-index-import": "error",
    "frontend-layers-apps-web/public-entrypoint": "error",
    "frontend-layers-apps-web/route-imports": "error",
    "frontend-layers-apps-web/server-contract-purity": "error",
    "frontend-layers-apps-web/ui-placement": "error",
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
  extends: [
    core,
    ultraciteReact,
    ultraciteTanstack,
    ultraciteVitest,
    ...(project.extends ?? []),
  ],
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
