import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { varlockVitePlugin } from "@varlock/vite-integration";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

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
    varlockVitePlugin({ ssrInjectMode: "auto-load" }),
    tailwindcss(),
    tanstackStart(),
    ...(mode === "test" ? [] : [nitro()]),
    viteReact(),
  ],
}));
