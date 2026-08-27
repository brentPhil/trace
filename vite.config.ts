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
  /*
   * Never watch the Rust build directory.
   *
   * `pnpm tauri:dev` compiles into `src-tauri/target/`, and the moment cargo
   * relinks `chroneli_desktop_lib.dll` the file is locked. Vite's watcher had
   * it open, got EBUSY, and — because chokidar re-emits that as an `error`
   * event on the FSWatcher — took the whole dev server down with it. The
   * symptom is the web server dying seconds after the shell starts building,
   * which reads like an unrelated crash rather than the two watching the same
   * directory.
   *
   * Nothing under `src-tauri/` is part of the web build, so there is no reason
   * to watch any of it. `target/` alone would be enough today; the whole
   * directory is excluded because `gen/` is also generated on every build and
   * the next generated thing should not have to rediscover this.
   */
  server: {
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  // Must be bundled during SSR, otherwise module resolution fails.
  ssr: {
    noExternal: ["@convex-dev/better-auth"],
  },
})

export default config
