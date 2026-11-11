import { defineConfig } from "tsdown";

// Effect, the platform deps, and @tokenshame/share-link are devDependencies, so tsdown
// inlines them: the published package has zero runtime dependencies to audit.
export default defineConfig({
  entry: ["src/index.ts"],
  platform: "node",
  target: "node22",
});
