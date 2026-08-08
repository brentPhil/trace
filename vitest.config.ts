import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"
import viteReact from "@vitejs/plugin-react"

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

// Deliberately a separate config from vite.config.ts. Loading the app config
// would pull in the TanStack Start plugin, which expects to be building a
// server and does not belong in a test run.
//
// Three projects rather than one, because the code under test has three
// genuinely different runtime requirements:
//
//   unit    - pure functions (convex/lib, src/lib). Node. No DOM, no ICU
//             surprises: `Intl` with a real timezone database is the whole
//             point of convex/lib/day.ts, and Node ships full ICU.
//   dom     - React components. jsdom.
//   convex  - Convex function tests via convex-test, which requires the edge
//             runtime because that is what Convex functions actually run in.
//
// `environmentMatchGlobs` is NOT used here: it was removed in Vitest 3 and
// this project is on Vitest 4.
const alias = {
  "@": r("./src"),
  // The pure shared layer. Imported by Convex functions and by the client, so
  // there is exactly one duration parser and one day-boundary function in the
  // product rather than one on each side of the wire.
  "@shared": r("./convex/lib"),
}

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          environment: "node",
          include: ["src/**/*.test.ts", "convex/lib/**/*.test.ts"],
        },
      },
      {
        plugins: [viteReact()],
        resolve: { alias },
        test: {
          name: "dom",
          environment: "jsdom",
          include: ["src/**/*.test.tsx"],
          // jsdom has no CSS media-query evaluator and so never defines
          // `window.matchMedia`. Anything that renders the vendored Sidebar
          // hits it via `useIsMobile` (src/hooks/use-mobile.ts).
          setupFiles: ["./src/test-utils/setup-dom.ts"],
        },
      },
      {
        resolve: { alias },
        test: {
          name: "convex",
          environment: "edge-runtime",
          // Function tests only. Anything under convex/lib is pure and runs in
          // the `unit` project.
          include: ["convex/*.test.ts", "convex/!(lib)/**/*.test.ts"],
          server: { deps: { inline: ["convex-test"] } },
        },
      },
    ],
  },
})
