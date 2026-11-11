import { defineConfig } from "tsdown";

// Effect and platform deps are devDependencies, so tsdown inlines them:
// the published package has zero runtime dependencies to audit.
export default defineConfig({
  copy: [{ from: "../web/dist/client", rename: "web", to: "dist" }],
  entry: ["src/index.ts"],
  platform: "node",
  target: "node22",
});
