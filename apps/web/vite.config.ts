import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { varlockVitePlugin } from "@varlock/vite-integration";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import path from "node:path";
import { defineConfig } from "vite";

// The HTTP tests build into a directory of their own (WEB_BUILD_DIR), so the build behind
// `check-types` or a deploy can never rewrite the output the tests serve while they copy it.
const buildDir = process.env.WEB_BUILD_DIR;
const nitroOutput = buildDir
  ? { buildDir: path.join(buildDir, "nitro"), output: { dir: path.join(buildDir, "output") } }
  : {};

// Vitest runs this app's tests through this file. The Nitro plugin makes Vitest
// fail to load workspace packages, and tests never serve the app, so it stays out.
export default defineConfig(({ mode }) => ({
  server: {
    port: 3001,
  },
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [
    // "resolved-env" bakes the resolved env into the server bundle. The env is all
    // @public. "auto-load" runs the varlock CLI at server start, which Vercel lacks,
    // and "init-only" expects the platform to inject the env at runtime.
    varlockVitePlugin({ ssrInjectMode: "resolved-env" }),
    tailwindcss(),
    tanstackStart(),
    ...(mode === "test" ? [] : [nitro(nitroOutput)]),
    viteReact(),
  ],
}));
