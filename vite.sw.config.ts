import { defineConfig } from "vite"

/**
 * The service worker is built by a SECOND Vite invocation into the client
 * output, because vite-plugin-pwa does not run under TanStack Start's build
 * (TanStack/router#4988) and a worker cannot be a chunk of the app bundle.
 * Runs after `vite build`; `emptyOutDir: false` keeps the app's output.
 */
export default defineConfig({
  resolve: { tsconfigPaths: true },
  build: {
    outDir: "dist/client",
    emptyOutDir: false,
    lib: {
      entry: "src/sw/index.ts",
      formats: ["iife"],
      name: "sw",
      fileName: () => "sw.js",
    },
  },
})
