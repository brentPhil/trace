import { defineConfig } from "vite"
import { devtools } from "@tanstack/devtools-vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    devtools({
      /*
       * FullCalendar is not given a `data-tsd-source` attribute.
       *
       * The devtools plugin stamps every JSX element with one so a click can
       * jump to its source. FullCalendar's React component treats EVERY prop it
       * does not recognise as a calendar option and logs
       * `Unknown option 'data-tsd-source'` for it — once per render of the
       * grid, into the same console a developer is reading real warnings from.
       *
       * Scoped to that one element rather than turning injection off: the
       * feature is useful everywhere else, and the conflict is specific to a
       * third-party component that validates its own props. Matching is on the
       * JSX element name, so this is the `<Calendar>` imported from
       * `@fullcalendar/react` in `calendar-panel.tsx`.
       */
      injectSource: {
        enabled: true,
        ignore: { components: ["Calendar"] },
      },
    }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
  // Must be bundled during SSR, otherwise module resolution fails.
  ssr: {
    noExternal: ["@convex-dev/better-auth"],
  },
})

export default config
