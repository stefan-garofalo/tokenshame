import { defineConfig } from "oxlint";

// Project-owned lint rules for this Software Scope. hi writes this file once and never changes it.
export default defineConfig({
  rules: {
    // Effect 4 marks every `effect/cli`, `effect/http` and platform-node API `@stability unstable`,
    // so a CLI built on them cannot satisfy this rule. The exact `effect` pin in the root catalog
    // guards against breaking changes instead.
    "effecttsgo/unstable-api-usage": "off",
  },
});
