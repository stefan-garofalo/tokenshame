import { defineConfig } from "vitest/config";

// One project per workspace, so a new package needs no edit here.
export default defineConfig({
  test: {
    projects: ["apps/*", "packages/*"],
  },
});
