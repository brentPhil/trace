# Dashboard Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the top nav with a persistent shadcn sidebar, lift the timer bar into the app shell so it works from every page, split `/today` and `/history` into `/timer` and `/reports`, and delete the recap entirely.

**Architecture:** `_authed.tsx` stays a thin guard and renders `<AppShell><Outlet/></AppShell>`. The shell owns the sidebar, the timer bar and the running-entry mutations; child routes render content only. The Timer page reads its list through the existing paginated `listPage` query and derives its totals from a separate week-bounded `listRange`, so the totals can never mean "of the pages loaded so far".

**Tech Stack:** TanStack Start (router 1.168.39), React 19, Convex, Base UI (`@base-ui/react`), shadcn registry style `base-luma`, Tailwind v4, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-08-dashboard-sidebar-shell-design.md`

## Global Constraints

- **`npx` does not work on this machine** (`C:` is at 0 bytes free). Invoke binaries directly: `node node_modules/vitest/vitest.mjs run`, `node node_modules/typescript/bin/tsc --noEmit`, `node node_modules/eslint/bin/eslint.js .`, `node node_modules/convex/bin/main.js <cmd>`, `node node_modules/prettier/bin/prettier.cjs --write <path>`.
- **Full verification command set**, run before every commit:
  ```bash
  node node_modules/vitest/vitest.mjs run && node node_modules/typescript/bin/tsc --noEmit && node node_modules/typescript/bin/tsc --noEmit -p convex && node node_modules/eslint/bin/eslint.js .
  ```
- **Files are UTF-8 without BOM, LF line endings.** `.editorconfig` and `.gitattributes` enforce this. Never write a BOM — nine files once shipped mojibake into page titles this way.
- **Components take their writes as props.** Nothing under `src/components/**` may import `useMutation`, `useConvexMutation`, `convexQuery`, or `convex/_generated/api`. The one existing exception is `entry-log.tsx`. Do not add a second.
- **Every Convex public function needs `args` and `returns` validators.** Read `convex/_generated/ai/guidelines.md` before touching `convex/`.
- **Baseline at plan start:** 354 tests across 18 files, all green.
- **Do not `git push`.** Commit only.

---

## File Structure

**Created**

| Path | Responsibility |
|---|---|
| `src/components/ui/sidebar.tsx` | Vendored shadcn sidebar (Base UI based) |
| `src/components/ui/sheet.tsx` | Vendored — mobile off-canvas container |
| `src/components/ui/skeleton.tsx` | Vendored — sidebar registry dep |
| `src/components/ui/tooltip.tsx` | Vendored — icon-rail labels |
| `src/hooks/use-mobile.ts` | Vendored — 768px matchMedia hook |
| `src/lib/sidebar-cookie.ts` | Parse + isomorphic read of `sidebar_state` |
| `src/lib/sidebar-cookie.test.ts` | Tests for the parser |
| `src/lib/period-totals.ts` | Pure `periodTotals(entries, tz, today, now)` |
| `src/lib/period-totals.test.ts` | Tests for it |
| `src/components/shell/app-sidebar.tsx` | Nav, header, footer |
| `src/components/shell/app-sidebar.test.tsx` | Nav rendering + active state |
| `src/components/shell/app-shell.tsx` | Sidebar + timer bar + content region |
| `src/test-utils/router.tsx` | Memory-router harness for DOM tests |
| `src/routes/_authed/timer.tsx` | Was `today.tsx` |
| `src/routes/_authed/reports.tsx` | Was `history.tsx` |
| `convex/purgeRecap.ts` | One-off internal migration, deleted in Task 4 |

**Deleted**

`src/components/app-header.tsx`, `src/components/recap/recap-panel.tsx`, `src/routes/_authed/today.tsx`, `src/routes/_authed/history.tsx`, `convex/recap.ts`, `convex/lib/recap.ts`, `convex/lib/render.ts`, `convex/recap.test.ts`, `convex/lib/recap.test.ts`, `convex/purgeRecap.ts`.

**Modified**

`convex/schema.ts`, `convex/settings.ts`, `src/routes/_authed.tsx`, `src/routes/_authed/settings.tsx`, `src/routes/_authed/projects.tsx`, `src/routes/index.tsx`, `src/components/timer/timer-bar.tsx`, `src/components/a11y/shortcuts-overlay.tsx`, `src/lib/redirect.test.ts`, the plan doc.

**Task order rationale:** the recap goes first (Tasks 1–4). It shrinks the surface being restructured, and its schema migration is the only irreversible work — doing it while the app is otherwise stable means a failure there is isolated from the shell work.

---

## Task 1: Remove the recap from the client

Removes every reader of the recap API. Nothing server-side changes yet, so this is fully reversible and the app stays working.

**Files:**
- Delete: `src/components/recap/recap-panel.tsx`
- Modify: `src/routes/_authed/today.tsx`
- Modify: `src/routes/_authed/settings.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing. After this task no client code references `api.recap.*` or `settings.recapMinuteLocal`.

- [ ] **Step 1: Delete the panel and confirm nothing else imports it**

```bash
git rm src/components/recap/recap-panel.tsx
grep -rn "recap-panel\|RecapPanel" src/ --include=*.tsx --include=*.ts
```

Expected: no output from `grep` other than `today.tsx`, which the next step fixes.

- [ ] **Step 2: Strip the recap from `today.tsx`**

Remove these four things:

1. The import line `import { RecapPanel } from "@/components/recap/recap-panel"`.
2. These two lines (currently ~116–117):

```tsx
  const { data: recap } = useSuspenseQuery(convexQuery(api.recap.get, { day: today }))
  const setRecapFields = useConvexMutation(api.recap.setFields)
```

3. The `highlighted` state and its effect (currently ~134–137):

```tsx
  // Which entry a recap bullet was drilled into. Cleared when the day changes,
  // since the id would then point at a row no longer on screen.
  const [highlighted, setHighlighted] = useState<string | null>(null)
  useEffect(() => setHighlighted(null), [today])
```

4. The whole `<RecapPanel .../>` element (currently ~233–239).

Then change the `EntryLog` usage to drop the now-undefined prop:

```tsx
      <main className="flex-1">
        <EntryLog
          groups={groups}
          timeZone={settings.timezone}
          use12Hour={settings.timeFormat === "12"}
          display={settings.durationDisplay}
        />
      </main>
```

Also remove the `useConvexMutation` import if nothing else in the file uses it, and `useEffect` if nothing else uses it. `tsc` and eslint in Step 4 will tell you which.

- [ ] **Step 3: Remove the recap field from `/settings`**

Delete the whole `<Section title="Recap reminder" …>` block (currently ~152–169), and the two helpers at the bottom of the file that only it used:

```tsx
function minutesToTime(minutes: number): string {
```
```tsx
function timeToMinutes(value: string): number | null {
```

- [ ] **Step 4: Verify**

```bash
node node_modules/vitest/vitest.mjs run && node node_modules/typescript/bin/tsc --noEmit && node node_modules/eslint/bin/eslint.js .
```

Expected: all 354 tests pass, no type errors, no lint errors. `convex/recap.test.ts` still passes — the server side is untouched.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: remove the recap from the client

The panel, the two queries behind it, the drill-down highlight state and the
recap-time setting. The Convex side still stands; nothing reads it now."
```

---

## Task 2: Make `recapMinuteLocal` optional and purge the data

Convex validates existing documents against the schema, so the field cannot be removed while rows carry it. This is step 1 and step 2 of the three-step migration in spec §9.2.

**Files:**
- Modify: `convex/schema.ts:123`
- Modify: `convex/settings.ts`
- Create: `convex/purgeRecap.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `internal.purgeRecap.run` — an `internalMutation` taking no args, returning `{ settingsCleared: number, recapDaysDeleted: number }`. Deleted in Task 4.

- [ ] **Step 1: Make the field optional in the schema**

In `convex/schema.ts`, change the `userSettings` field:

```ts
    recapMinuteLocal: v.optional(v.number()),
```

- [ ] **Step 2: Make the reads tolerate its absence**

In `convex/settings.ts`, three edits so the optional field still type-checks:

`Settings` type — make it optional:
```ts
  recapMinuteLocal?: number
```

`settingsReturns` validator:
```ts
  recapMinuteLocal: v.optional(v.number()),
```

`getImpl`'s return object keeps `recapMinuteLocal: row.recapMinuteLocal` unchanged — it is now `number | undefined`, which matches.

- [ ] **Step 3: Write the one-off purge mutation**

Create `convex/purgeRecap.ts`:

```ts
import { v } from "convex/values"
import { internalMutation } from "./_generated/server"

/**
 * One-off migration. DELETED in the task that removes the schema entries.
 *
 * Convex validates stored documents against the schema, so `recapMinuteLocal`
 * and the `recapDays` table cannot simply disappear from schema.ts while rows
 * still carry them — the deploy fails validation. This clears the data so the
 * final removal is legal.
 *
 * Unbounded `.collect()` is acceptable exactly here: this is a single manual
 * run on a single-user deployment with a handful of rows, not a code path any
 * user reaches. If it ever needs to run against a large deployment, bound it
 * the way convex/lib/scan.ts describes.
 */
export const run = internalMutation({
  args: {},
  returns: v.object({
    settingsCleared: v.number(),
    recapDaysDeleted: v.number(),
  }),
  handler: async (ctx) => {
    const settings = await ctx.db.query("userSettings").collect()
    let settingsCleared = 0
    for (const row of settings) {
      if (row.recapMinuteLocal === undefined) continue
      // `undefined` on a patch REMOVES the field, which is what the schema
      // removal needs — setting it to 0 would leave a value behind.
      await ctx.db.patch(row._id, { recapMinuteLocal: undefined })
      settingsCleared += 1
    }

    const days = await ctx.db.query("recapDays").collect()
    for (const row of days) await ctx.db.delete(row._id)

    return { settingsCleared, recapDaysDeleted: days.length }
  },
})
```

- [ ] **Step 4: Deploy the optional schema**

```bash
node node_modules/convex/bin/main.js dev --once
```

Expected: `Convex functions ready!` with no schema validation error.

- [ ] **Step 5: Run the purge**

```bash
node node_modules/convex/bin/main.js run purgeRecap:run
```

Expected: JSON like `{ "settingsCleared": 1, "recapDaysDeleted": 0 }`. Any numbers are fine; a validation error is not.

- [ ] **Step 6: Verify the data is actually gone**

```bash
node node_modules/convex/bin/main.js data recapDays
```

Expected: an empty table.

- [ ] **Step 7: Run the test suite**

```bash
node node_modules/vitest/vitest.mjs run && node node_modules/typescript/bin/tsc --noEmit -p convex
```

Expected: green. `convex/settings.test.ts` asserts against `SETTINGS_DEFAULTS` wholesale, so it follows the optional field without edits. If `convex/recap.test.ts` fails on the seeded `recapMinuteLocal` at line 36, delete that one line — the file is removed entirely in Task 3.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: make recapMinuteLocal optional and purge recap data

Step one and two of three. Convex validates stored documents against the
schema, so the field and the recapDays table cannot be removed while rows
still carry them."
```

---

## Task 3: Delete the recap backend and the schema entries

Step 3 of the migration. Only legal because Task 2 cleared the data.

**Files:**
- Delete: `convex/recap.ts`, `convex/lib/recap.ts`, `convex/lib/render.ts`, `convex/recap.test.ts`, `convex/lib/recap.test.ts`
- Modify: `convex/schema.ts`, `convex/settings.ts`

**Interfaces:**
- Consumes: `internal.purgeRecap.run` must have been run.
- Produces: nothing. `api.recap` ceases to exist.

- [ ] **Step 1: Confirm nothing outside the deleted set imports these**

```bash
grep -rn "lib/recap\|lib/render\|@shared/recap\|api\.recap\|recapDuration" src/ convex/ --include=*.ts --include=*.tsx | grep -v _generated
```

Expected: matches only inside the five files about to be deleted. `recapDuration` lives in `convex/lib/recap.ts`, **not** the shared duration module — `formatCompactDuration`, `formatClock`, `spokenDuration` and `formatDecimalHours` are in `convex/lib/duration.ts` and stay. If the grep shows a caller outside the deleted set, stop and report it.

- [ ] **Step 2: Delete the files**

```bash
git rm convex/recap.ts convex/lib/recap.ts convex/lib/render.ts convex/recap.test.ts convex/lib/recap.test.ts
```

- [ ] **Step 3: Remove the table and the field from the schema**

In `convex/schema.ts`, delete the entire `recapDays` table definition including its docblock, and delete the `recapMinuteLocal` line from `userSettings`.

- [ ] **Step 4: Remove the field from `settings.ts`**

Delete `recapMinuteLocal` from the `Settings` type, from `SETTINGS_DEFAULTS`, from `settingsReturns`, from `getImpl`'s returned object, from `updateArgs`, and from the `UpdateArgs` type. Six sites.

- [ ] **Step 5: Deploy**

```bash
node node_modules/convex/bin/main.js dev --once
```

Expected: `Convex functions ready!`. A schema validation error here means Task 2's purge did not take — re-run it before proceeding.

- [ ] **Step 6: Verify**

```bash
node node_modules/vitest/vitest.mjs run && node node_modules/typescript/bin/tsc --noEmit && node node_modules/typescript/bin/tsc --noEmit -p convex && node node_modules/eslint/bin/eslint.js .
```

Expected: green. Test count drops by the two deleted convex test files.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat!: delete the recap

Step three of three. The assembler, both renderers, the two Convex functions,
the recapDays table and the recapMinuteLocal setting.

Notes stay. Nothing consumes them now — they are a description on a row, still
searchable in Reports. That is a deliberate narrowing of the product, recorded
in the spec's section 9."
```

---

## Task 4: Delete the migration and update the plan document

**Files:**
- Delete: `convex/purgeRecap.ts`
- Modify: `docs/superpowers/plans/2026-08-08-time-tracking-implementation-plan.md`

- [ ] **Step 1: Delete the one-off**

```bash
git rm convex/purgeRecap.ts
node node_modules/convex/bin/main.js dev --once
```

Expected: `Convex functions ready!`.

- [ ] **Step 2: Update the plan's six recap references**

In `docs/superpowers/plans/2026-08-08-time-tracking-implementation-plan.md`, edit each of these. Do not delete the history — mark what was cut and why, so the document stays an accurate record:

- **§2.2** — the notes rationale. Add a note that the recap it points to was removed on 2026-08-08, and that notes are now retained for search and for reading the log.
- **§4** — remove `recap.getDay` / `recap.setDayFields` from the function surface table.
- **§5 Phase 6** — mark the phase `CUT 2026-08-08` with a one-line reason and a pointer to the shell spec.
- **§5.9** — add a deviation row: recap built and then removed.
- **§6 Tier 2 #11 and #14** — remove (recap nudge, recap snapshots).
- **§7** — remove weekly/per-client recaps and the per-bullet LLM item.
- **§8.3** — the `recapDays` open item is resolved: the table is gone.

- [ ] **Step 3: Verify and commit**

```bash
node node_modules/vitest/vitest.mjs run
git add -A
git commit -m "docs: record the recap removal in the implementation plan

Six sites referenced a feature that no longer exists. Marked as cut with the
date and reason rather than deleted outright — the plan is a record of what was
decided, and silently erasing a shipped-then-removed phase makes it a worse one."
```

---

## Task 5: Vendor the shadcn sidebar

**Files:**
- Create: `src/components/ui/sidebar.tsx`, `src/components/ui/sheet.tsx`, `src/components/ui/skeleton.tsx`, `src/components/ui/tooltip.tsx`, `src/hooks/use-mobile.ts`

**Interfaces:**
- Produces: `SidebarProvider`, `Sidebar`, `SidebarContent`, `SidebarHeader`, `SidebarFooter`, `SidebarMenu`, `SidebarMenuItem`, `SidebarMenuButton`, `SidebarTrigger`, `SidebarInset`, `useSidebar` from `@/components/ui/sidebar`. `useIsMobile` from `@/hooks/use-mobile`.

- [ ] **Step 1: Record the current state of the shared primitives**

The sidebar's registry dependencies include `button`, `input` and `separator`, which already exist and are customised. The CLI may offer to overwrite them.

```bash
git status --porcelain
md5sum src/components/ui/button.tsx src/components/ui/input.tsx src/components/ui/separator.tsx
```

Expected: clean tree, and three hashes noted for Step 3.

- [ ] **Step 2: Add the component**

```bash
node node_modules/shadcn/dist/index.js add sidebar
```

If prompted to overwrite existing files, **decline** for `button`, `input` and `separator`. Accept `sidebar`, `sheet`, `skeleton`, `tooltip`, `use-mobile`.

- [ ] **Step 3: Verify the existing primitives were not clobbered**

```bash
md5sum src/components/ui/button.tsx src/components/ui/input.tsx src/components/ui/separator.tsx
git status --porcelain
```

Expected: the three hashes match Step 1. If any changed, restore it:

```bash
git checkout -- src/components/ui/button.tsx
```

- [ ] **Step 4: Fix the import paths**

The registry writes `@/registry/base-luma/...` paths. Rewrite them to this project's aliases in every added file:

- `@/registry/base-luma/lib/utils` → `@/lib/utils`
- `@/registry/base-luma/ui/<name>` → `@/components/ui/<name>`
- `@/registry/base-luma/hooks/use-mobile` → `@/hooks/use-mobile`

Also delete any import of `@/app/(create)/components/icon-placeholder` and the JSX that uses it — it is registry demo scaffolding, not part of the component.

```bash
grep -rn "registry/base-luma\|icon-placeholder" src/
```

Expected: no output.

- [ ] **Step 5: Add the breakpoint-agreement comments**

The desktop sidebar is hidden by a Tailwind `md:` class while `useIsMobile` uses a hardcoded `768`. They agree only because both are defaults, and if either moves alone a phone gets a permanently invisible sidebar.

In `src/hooks/use-mobile.ts`, above the constant:

```ts
// 768 MUST equal Tailwind's `md` breakpoint. src/components/ui/sidebar.tsx
// hides the desktop sidebar with `hidden md:block` and shows the Sheet when
// this hook is true; if the two numbers drift apart, one viewport range gets
// neither, and the sidebar silently disappears with no error anywhere.
const MOBILE_BREAKPOINT = 768
```

In `src/components/ui/sidebar.tsx`, on the line carrying `hidden ... md:block`:

```tsx
        // `md:` MUST equal MOBILE_BREAKPOINT in src/hooks/use-mobile.ts. See
        // the comment there.
```

- [ ] **Step 6: Verify it compiles**

```bash
node node_modules/typescript/bin/tsc --noEmit && node node_modules/eslint/bin/eslint.js . && node node_modules/vitest/vitest.mjs run
```

Expected: green. Nothing renders the sidebar yet.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: vendor the shadcn sidebar

Style base-luma, so it is built on Base UI rather than Radix and composes with
the existing ui/ wrappers instead of introducing a second primitive library.

The 768px in use-mobile and the md: in sidebar.tsx must not drift — a comment
at each site says so, because the failure is a silently invisible sidebar."
```

---

## Task 6: The sidebar cookie

**Files:**
- Create: `src/lib/sidebar-cookie.ts`, `src/lib/sidebar-cookie.test.ts`

**Interfaces:**
- Produces: `parseSidebarOpen(cookieHeader: string | undefined): boolean` and `readSidebarOpen(): boolean`, both from `@/lib/sidebar-cookie`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/sidebar-cookie.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { parseSidebarOpen } from "./sidebar-cookie"

/*
 * SidebarProvider writes `sidebar_state` and never reads it back — the host app
 * is expected to. Without a server-side read, anyone who collapsed the rail is
 * served 16rem, hydrates at 3rem, and watches a 208px jump on every load.
 *
 * Open is the default: an absent cookie must mean expanded, so a first-time
 * visitor is not shown four unlabelled icons.
 */
describe("parseSidebarOpen", () => {
  it("defaults to open when there is no cookie header at all", () => {
    expect(parseSidebarOpen(undefined)).toBe(true)
  })

  it("defaults to open for an empty header", () => {
    expect(parseSidebarOpen("")).toBe(true)
  })

  it("is collapsed when the cookie says false", () => {
    expect(parseSidebarOpen("sidebar_state=false")).toBe(false)
  })

  it("is open when the cookie says true", () => {
    expect(parseSidebarOpen("sidebar_state=true")).toBe(true)
  })

  it("finds the cookie among others", () => {
    expect(parseSidebarOpen("theme=dark; sidebar_state=false; foo=1")).toBe(false)
  })

  /**
   * The reason this is a parser and not `cookie.includes("sidebar_state=false")`.
   * A different key ENDING in the same characters must not match.
   */
  it("does not match a different cookie whose name ends with the same text", () => {
    expect(parseSidebarOpen("my_sidebar_state=false")).toBe(true)
  })

  /** Nor a value that merely starts with "false". */
  it("does not match a value that only starts with false", () => {
    expect(parseSidebarOpen("sidebar_state=falsey")).toBe(true)
  })

  it("tolerates no space after the separator", () => {
    expect(parseSidebarOpen("a=1;sidebar_state=false")).toBe(false)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node node_modules/vitest/vitest.mjs run src/lib/sidebar-cookie.test.ts
```

Expected: FAIL — `Failed to resolve import "./sidebar-cookie"`.

- [ ] **Step 3: Implement it**

Create `src/lib/sidebar-cookie.ts`:

```ts
import { createIsomorphicFn } from "@tanstack/react-start"
import { getCookie } from "@tanstack/react-start/server"

const COOKIE_NAME = "sidebar_state"

/**
 * Whether the sidebar should render expanded, given a raw Cookie header.
 *
 * Split out from the read below so it can be tested without a request or a
 * document. The regex anchors on a cookie boundary at the front and a value
 * boundary at the back, because a substring test would match `my_sidebar_state`
 * and `falsey` — both of which are legal cookies that mean nothing to us.
 *
 * Absent means OPEN. A first-time visitor has no cookie and must not be shown
 * four unlabelled icons.
 */
export function parseSidebarOpen(cookieHeader: string | undefined): boolean {
  if (cookieHeader === undefined || cookieHeader === "") return true
  return !new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=false(?:\\s*;|\\s*$)`).test(
    cookieHeader
  )
}

/**
 * Reads the persisted state on either side of the wire.
 *
 * `createIsomorphicFn` splits the bundle, so the `/server` import never reaches
 * the browser. Deliberately NOT a `createServerFn`: that is a network round trip
 * on every client navigation to read a cookie the browser already holds.
 *
 * Reading a cookie during SSR is safe in a way that reading a TIMEZONE is not
 * (see the implementation plan's section 5.9) — a cookie travels with the
 * request, so the server and the client observe the same value.
 */
export const readSidebarOpen = createIsomorphicFn()
  .server(() => getCookie(COOKIE_NAME) !== "false")
  .client(() => parseSidebarOpen(document.cookie))
```

- [ ] **Step 4: Run the tests**

```bash
node node_modules/vitest/vitest.mjs run src/lib/sidebar-cookie.test.ts
```

Expected: PASS, 8 tests.

- [ ] **Step 5: Verify the whole suite and types**

```bash
node node_modules/vitest/vitest.mjs run && node node_modules/typescript/bin/tsc --noEmit && node node_modules/eslint/bin/eslint.js .
```

Expected: green.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: read the persisted sidebar collapse state

The parser is separate from the isomorphic read so it can be tested without a
request or a document, and because a substring match would treat
my_sidebar_state=false and sidebar_state=falsey as a collapsed sidebar."
```

---

## Task 7: The sidebar component

**Files:**
- Create: `src/test-utils/router.tsx`, `src/components/shell/app-sidebar.tsx`, `src/components/shell/app-sidebar.test.tsx`

**Interfaces:**
- Consumes: `SidebarProvider` etc. from Task 5.
- Produces: `AppSidebar({ email, onSignOut }: { email?: string; onSignOut: () => void })` and `NAV_ITEMS` from `@/components/shell/app-sidebar`. `renderWithRouter(ui, { path })` from `@/test-utils/router`.

**Note:** the spec said this component needs no router to test. That was wrong — it renders TanStack `<Link>`, which requires a router in context. Hence the harness below.

- [ ] **Step 1: Write the router harness**

Create `src/test-utils/router.tsx`:

```tsx
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router"
import type { ReactNode } from "react"

/**
 * Renders a component that contains TanStack `Link`s, at a chosen path.
 *
 * A `Link` reads the router from context and throws without one, so a component
 * with navigation in it cannot be rendered bare however pure it otherwise is.
 * The routes here are stubs — only their paths matter, because what is being
 * asserted is which link is marked current.
 */
export function renderWithRouter(ui: ReactNode, { path }: { path: string }) {
  const rootRoute = createRootRoute({ component: () => <>{ui}</> })
  const children = ["/timer", "/reports", "/projects", "/settings"].map((p) =>
    createRoute({ getParentRoute: () => rootRoute, path: p, component: () => null })
  )
  rootRoute.addChildren(children)

  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: [path] }),
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return <RouterProvider router={router as any} />
}
```

- [ ] **Step 2: Write the failing test**

Create `src/components/shell/app-sidebar.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { SidebarProvider } from "@/components/ui/sidebar"
import { AppSidebar, NAV_ITEMS } from "./app-sidebar"
import { renderWithRouter } from "@/test-utils/router"

afterEach(cleanup)

function mount(path: string, onSignOut = vi.fn()) {
  render(
    renderWithRouter(
      <SidebarProvider defaultOpen>
        <AppSidebar email="a@b.com" onSignOut={onSignOut} />
      </SidebarProvider>,
      { path }
    )
  )
  return onSignOut
}

describe("AppSidebar", () => {
  it("lists exactly the four destinations", () => {
    expect(NAV_ITEMS.map((item) => item.label)).toEqual([
      "Timer",
      "Reports",
      "Projects",
      "Settings",
    ])
  })

  /**
   * `aria-current` is what a screen reader announces. The visual treatment is
   * a separate concern and must never be the only carrier — the header this
   * replaces was explicit about that and the rule does not change.
   */
  it("marks the current page with aria-current", async () => {
    mount("/reports")
    await waitFor(() =>
      expect(screen.getByRole("link", { name: "Reports" })).toHaveAttribute(
        "aria-current",
        "page"
      )
    )
    expect(screen.getByRole("link", { name: "Timer" })).not.toHaveAttribute(
      "aria-current"
    )
  })

  it("shows the signed-in email", () => {
    mount("/timer")
    expect(screen.getByText("a@b.com")).toBeTruthy()
  })

  it("calls onSignOut rather than signing out itself", () => {
    const onSignOut = mount("/timer")
    fireEvent.click(screen.getByRole("button", { name: /sign out/i }))
    expect(onSignOut).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 3: Run it and watch it fail**

```bash
node node_modules/vitest/vitest.mjs run src/components/shell/app-sidebar.test.tsx
```

Expected: FAIL — cannot resolve `./app-sidebar`.

- [ ] **Step 4: Implement the sidebar**

Create `src/components/shell/app-sidebar.tsx`:

```tsx
import { Link } from "@tanstack/react-router"
import { Clock, FolderKanban, Settings, Table2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import type { LucideIcon } from "lucide-react"

/**
 * The four destinations, as data.
 *
 * Exported so a test can assert the set without rendering, and so the count is
 * checkable at a glance: four, and adding a fifth should be an argument, not an
 * edit. Toggl's web app has a two-level nav with a dozen entries and the tracker
 * itself is one of them.
 */
export const NAV_ITEMS: Array<{ to: string; label: string; icon: LucideIcon }> = [
  { to: "/timer", label: "Timer", icon: Clock },
  { to: "/reports", label: "Reports", icon: Table2 },
  { to: "/projects", label: "Projects", icon: FolderKanban },
  { to: "/settings", label: "Settings", icon: Settings },
]

/**
 * Pure. Takes the email it displays and the sign-out it calls, so it holds no
 * query and no mutation — the same rule every other component here follows.
 */
export function AppSidebar({
  email,
  onSignOut,
}: {
  email?: string
  onSignOut: () => void
}) {
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <Link
          to="/timer"
          className="flex items-center gap-2 px-2 py-1.5 text-base font-medium tracking-tight"
        >
          {/* The wordmark collapses to its initial on the icon rail. */}
          <span className="group-data-[collapsible=icon]:hidden">Trace</span>
          <span className="hidden group-data-[collapsible=icon]:inline">T</span>
        </Link>
      </SidebarHeader>

      <SidebarContent>
        <SidebarMenu>
          {NAV_ITEMS.map((item) => (
            <SidebarMenuItem key={item.to}>
              {/* `tooltip` is what makes the collapsed rail usable; it is
                  rendered only when the sidebar is collapsed. */}
              <SidebarMenuButton asChild tooltip={item.label}>
                <Link
                  to={item.to}
                  activeProps={{ "aria-current": "page", "data-active": true }}
                >
                  <item.icon />
                  <span>{item.label}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarContent>

      <SidebarFooter>
        {email === undefined ? null : (
          <span className="truncate px-2 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
            {email}
          </span>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={onSignOut}
          className="justify-start"
        >
          <span className="group-data-[collapsible=icon]:hidden">Sign out</span>
          <span className="hidden group-data-[collapsible=icon]:inline">⎋</span>
        </Button>
      </SidebarFooter>
    </Sidebar>
  )
}
```

If `SidebarMenuButton` in the vendored file does not accept `asChild`, use its `render` prop instead — Base UI's `useRender` convention. Check the vendored source.

- [ ] **Step 5: Run the tests**

```bash
node node_modules/vitest/vitest.mjs run src/components/shell/app-sidebar.test.tsx
```

Expected: PASS, 4 tests.

- [ ] **Step 6: Full verification**

```bash
node node_modules/vitest/vitest.mjs run && node node_modules/typescript/bin/tsc --noEmit && node node_modules/eslint/bin/eslint.js .
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: the app sidebar

Four destinations as exported data, active state carried by aria-current and
not by colour alone, and no query or mutation inside it — email and sign-out
are props, matching every other component here.

Needs a memory-router harness to test, because Link reads the router from
context. The spec claimed otherwise; it was wrong."
```

---

## Task 8: The app shell

**Files:**
- Create: `src/components/shell/app-shell.tsx`

**Interfaces:**
- Consumes: `AppSidebar` (Task 7), `SidebarProvider`/`SidebarInset`/`SidebarTrigger` (Task 5).
- Produces: `AppShell({ children, email, sidebarDefaultOpen, timer })` from `@/components/shell/app-shell`, where `timer` is a `ReactNode` rendered in the pinned bar region.

- [ ] **Step 1: Implement the shell**

Create `src/components/shell/app-shell.tsx`:

```tsx
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/shell/app-sidebar"
import { cn } from "@/lib/utils"
import type { ReactNode } from "react"

/**
 * The dashboard frame: sidebar, timer bar, content.
 *
 * The timer bar is passed in rather than constructed here, so this file stays
 * layout and the running-entry wiring stays in the route that owns the queries.
 *
 * `sidebarDefaultOpen` comes from the request cookie, read in _authed.tsx. It
 * is not optional-with-a-default on purpose: forgetting to thread it through is
 * exactly the bug that produces a 208px layout jump on every load, and a
 * required prop makes that a type error instead of a subtle regression.
 */
export function AppShell({
  children,
  email,
  onSignOut,
  sidebarDefaultOpen,
  timer,
}: {
  children: ReactNode
  email?: string
  onSignOut: () => void
  sidebarDefaultOpen: boolean
  timer: ReactNode
}) {
  return (
    <SidebarProvider defaultOpen={sidebarDefaultOpen}>
      <AppSidebar email={email} onSignOut={onSignOut} />

      <SidebarInset className="min-w-0">
        {/*
          Below `md` the bar is pinned to the BOTTOM of the viewport rather than
          sitting at the top of the document.

          On a phone the start control belongs under the thumb, not behind a
          scroll — and the log is what you scroll, so the one control pressed
          twenty times a day must not scroll away with it. It is in the shell
          now, so that holds on every page rather than only on Today.

          Toggl has publicly declined to fix its mobile web app. This is the
          surface the incumbent abandoned, and it costs one breakpoint.
        */}
        <div
          className={cn(
            "fixed inset-x-0 bottom-0 z-30 flex items-center gap-2",
            "border-t border-edge-soft bg-ground px-3 pt-2",
            "pb-[max(0.5rem,env(safe-area-inset-bottom))]",
            "md:static md:z-auto md:border-t-0 md:bg-transparent",
            "md:gap-3 md:px-4 md:pt-3 md:pb-0"
          )}
        >
          {/* The hamburger. Hidden on desktop, where the rail is always there
              and ⌘B toggles it. */}
          <SidebarTrigger className="shrink-0 md:hidden" />
          <div className="min-w-0 flex-1">{timer}</div>
        </div>

        <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-0 md:px-2">
          {children}
        </div>

        {/*
          Reserves the fixed bar's height so the last row of a log can always be
          scrolled clear of it. Sized generously — the bar grows a second line
          while recording — because a too-small spacer hides the newest entry,
          which is the one being worked on.
        */}
        <div aria-hidden="true" className="h-[6.5rem] shrink-0 md:hidden" />
      </SidebarInset>
    </SidebarProvider>
  )
}
```

- [ ] **Step 2: Verify it compiles**

```bash
node node_modules/typescript/bin/tsc --noEmit && node node_modules/eslint/bin/eslint.js . && node node_modules/vitest/vitest.mjs run
```

Expected: green. Nothing renders it yet.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: the app shell

Sidebar, timer region and content. The timer node is a prop so this file stays
layout; sidebarDefaultOpen is required rather than defaulted, because
forgetting to thread the cookie through is precisely the 208px layout jump it
exists to prevent, and a required prop turns that into a type error."
```

---

## Task 9: Mount the shell and delete the header

**Files:**
- Modify: `src/routes/_authed.tsx`
- Delete: `src/components/app-header.tsx`
- Modify: `src/routes/_authed/today.tsx`, `src/routes/_authed/history.tsx`, `src/routes/_authed/projects.tsx`, `src/routes/_authed/settings.tsx`

**Interfaces:**
- Consumes: `AppShell` (Task 8), `readSidebarOpen` (Task 6).
- Produces: route context gains `sidebarOpen: boolean`. Child routes must no longer render `<AppHeader>` or their own outer `min-h-svh max-w-4xl` wrapper.

- [ ] **Step 1: Rewrite the layout route's component**

In `src/routes/_authed.tsx`, add to the imports:

```tsx
import { useSuspenseQuery } from "@tanstack/react-query"
import { convexQuery } from "@convex-dev/react-query"
import { Toast } from "@/components/ui/toast"
import { AppShell } from "@/components/shell/app-shell"
import { TimerBar } from "@/components/timer/timer-bar"
import { RunawayBanner } from "@/components/timer/runaway-banner"
import { readSidebarOpen } from "@/lib/sidebar-cookie"
import { signOutAndLeave } from "@/lib/auth-client"
import { errorMessage } from "@/lib/error-message"
import { useClassifierMutations, useClassifiers } from "@/hooks/use-classifiers"
import { useEntryEditMutations } from "@/hooks/use-entry-edit-mutations"
import { useEntryMutations } from "@/hooks/use-entry-mutations"
import { useReplayPendingStart, useTabTitleClock } from "@/hooks/use-timer-effects"
import { api } from "../../convex/_generated/api"
import type { TimerBarActions } from "@/components/timer/timer-bar"
import { useMemo } from "react"
```

Extend `beforeLoad` to carry the cookie, and add the loader:

```tsx
  beforeLoad: ({ context, location }) => {
    if (!context.isAuthenticated) {
      throw redirect({
        to: "/login",
        search: { redirect: location.href },
      })
    }
    // Read here, not in the shell: the value must be known before the first
    // render on the server, or the rail's width changes at hydration.
    return { sidebarOpen: readSidebarOpen() }
  },
  loader: async ({ context }) => {
    // Fetched once for the session rather than once per page, now that the
    // timer bar lives above the outlet and every page needs the same data.
    await Promise.all([
      context.queryClient.ensureQueryData(convexQuery(api.settings.get, {})),
      context.queryClient.ensureQueryData(
        convexQuery(api.auth.getAuthenticatedUser, {})
      ),
      context.queryClient.ensureQueryData(convexQuery(api.entries.getRunning, {})),
      context.queryClient.ensureQueryData(convexQuery(api.projects.list, {})),
      context.queryClient.ensureQueryData(convexQuery(api.tags.list, {})),
      context.queryClient.ensureQueryData(
        convexQuery(api.entries.titleSuggestions, { limit: 40 })
      ),
    ])
  },
```

Replace `AuthedLayout` with the shell version. This is the block moved verbatim out of `today.tsx`:

```tsx
function AuthedLayout() {
  useEnsureSettings()

  const { sidebarOpen } = Route.useRouteContext()
  const { data: user } = useSuspenseQuery(
    convexQuery(api.auth.getAuthenticatedUser, {})
  )
  const { data: settings } = useSuspenseQuery(convexQuery(api.settings.get, {}))
  const { data: running } = useSuspenseQuery(convexQuery(api.entries.getRunning, {}))
  const { data: suggestions } = useSuspenseQuery(
    convexQuery(api.entries.titleSuggestions, { limit: 40 })
  )

  useTabTitleClock(running, settings.tabTitleClock)
  useReplayPendingStart(running)

  const entryMutations = useEntryMutations()
  const editMutations = useEntryEditMutations()
  const { projects, tags } = useClassifiers()
  const { createProject, ensureTag } = useClassifierMutations()

  const toasts = Toast.useToastManager()
  const report = (thrown: unknown) => {
    toasts.add({ title: errorMessage(thrown), priority: "high", timeout: 8_000 })
  }

  const timerActions: TimerBarActions = useMemo(
    () => ({
      start: entryMutations.start,
      stop: entryMutations.stop,
      discard: entryMutations.discard,
      setTitle: entryMutations.setTitle,
      classify: async (entryId, change) => {
        await editMutations.update({
          entryId,
          ...(change.projectId !== undefined ? { projectId: change.projectId } : {}),
          ...(change.tagIds !== undefined ? { tagIds: change.tagIds } : {}),
          ...(change.billable !== undefined ? { billable: change.billable } : {}),
        })
      },
      createProject: async (name) => await createProject({ name }),
      createTag: async (name) => await ensureTag(name),
    }),
    [entryMutations, editMutations, createProject, ensureTag]
  )

  return (
    <AppShell
      email={user.email}
      onSignOut={() => signOutAndLeave()}
      sidebarDefaultOpen={sidebarOpen}
      timer={
        <>
          <TimerBar
            running={running}
            actions={timerActions}
            projects={projects}
            tags={tags}
            suggestions={suggestions}
            onError={report}
          />
          <RunawayBanner
            running={running}
            thresholdMs={settings.runawayThresholdMs}
            onStop={() => void entryMutations.stop().catch(report)}
            onDiscard={() => void entryMutations.discard().catch(report)}
          />
        </>
      }
    >
      <Outlet />
    </AppShell>
  )
}
```

- [ ] **Step 2: Remove `onStopped` from `TimerBar`**

In `src/components/timer/timer-bar.tsx`, delete the `onStopped` prop from the destructuring, from the props type (including its docblock), and the `onStopped?.({...})` call inside `onToggle`. The surrounding `if (result.stoppedEntryIds.length > 0) { … announce(…) … }` block stays — the announcement is still wanted.

- [ ] **Step 3: Strip the four child routes**

In each of `today.tsx`, `history.tsx`, `projects.tsx`, `settings.tsx`:

- Delete the `import { AppHeader } …` line and the `<AppHeader … />` element.
- Delete the now-unused `user` suspense query, if the header was its only consumer.
- Replace the outer `<div className="mx-auto flex min-h-svh w-full max-w-4xl flex-col">` with a plain `<div className="flex flex-col">` — the shell supplies the width, centring and min-height now.

In `today.tsx` additionally delete the timer-bar block, the `RunawayBanner`, the mobile spacer, `timerActions`, `entryMutations`, `report`/`toasts`, `useTabTitleClock`, `useReplayPendingStart`, and the `running`/`suggestions` queries — all moved to the layout. Keep `editMutations` (the manual-entry dialog and the log still need it), `settings`, `useClassifiers`, and the entries query.

In `projects.tsx` and `history.tsx`, delete the `api.projects.list` / `api.tags.list` prefetches from their loaders — the layout does it now.

- [ ] **Step 4: Delete the header**

```bash
git rm src/components/app-header.tsx
grep -rn "AppHeader" src/
```

Expected: no output.

- [ ] **Step 5: Verify**

```bash
node node_modules/vitest/vitest.mjs run && node node_modules/typescript/bin/tsc --noEmit && node node_modules/eslint/bin/eslint.js . && node node_modules/vite/bin/vite.js build
```

Expected: green, and `✓ built`.

- [ ] **Step 6: Verify in the browser**

The dev server runs on port 3000 and the session is already signed in.

```
preview_start { name: "trace" }
navigate  http://localhost:3000/today
```

Then check, via `read_page` or `javascript_tool`:
- the sidebar renders with four links;
- the timer bar is present above the content;
- `read_console_messages` with `onlyErrors: true` returns nothing;
- `resize_window` to the `mobile` preset, reload, and confirm the hamburger appears and the timer bar is at the bottom.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: lift the timer bar into the app shell

The layout route now owns the running entry, its mutations and the classifier
lists, so a timer can be started and stopped from any page rather than only
from Today. The four child routes drop their header and their own page frame,
and the duplicated classifier prefetches go with them.

TimerBar's onStopped prop is removed with its only consumer."
```

---

## Task 10: `/today` becomes `/timer`

**Files:**
- Create: `src/lib/period-totals.ts`, `src/lib/period-totals.test.ts`
- Rename: `src/routes/_authed/today.tsx` → `src/routes/_authed/timer.tsx`

**Interfaces:**
- Consumes: `groupByDay`, `sumRange` from `@/lib/group-entries`.
- Produces: `periodTotals(weekEntries, timeZone, today, now): { todayMs, weekMs, billableMs }` from `@/lib/period-totals`.

- [ ] **Step 1: Write the failing test for the totals**

Create `src/lib/period-totals.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { periodTotals } from "./period-totals"
import type { Entry } from "./group-entries"

/*
 * The Timer page's list is paginated, and its totals must NOT be derived from
 * it. A figure summed from loaded pages silently means "of the rows fetched so
 * far" — the number that ends up understated on an invoice with nothing on
 * screen to reveal it.
 *
 * Making that impossible is a matter of input: this function takes the
 * week-bounded query's rows, and the paginated list is not one of its
 * arguments, so it cannot depend on how much has loaded.
 */

const HOUR = 3_600_000
const NOON = Date.UTC(2026, 7, 8, 12) // Sat 8 Aug 2026

function entry(over: Partial<Entry> & { startedAt: number }): Entry {
  const durationMs = over.durationMs === undefined ? HOUR : over.durationMs
  return {
    _id: `e-${over.startedAt}` as Entry["_id"],
    _creationTime: 0,
    userId: "u",
    clientKey: `k-${over.startedAt}`,
    title: "Work",
    endedAt: durationMs === null ? null : over.startedAt + durationMs,
    durationMs,
    tagIds: [],
    billable: false,
    source: "web",
    updatedAt: 0,
    deletedAt: null,
    ...over,
  }
}

describe("periodTotals", () => {
  it("is all zero for no entries", () => {
    expect(periodTotals([], "UTC", "2026-08-08", NOON)).toEqual({
      todayMs: 0,
      weekMs: 0,
      billableMs: 0,
    })
  })

  it("separates today from the rest of the week", () => {
    const totals = periodTotals(
      [
        entry({ startedAt: NOON - 2 * HOUR }), // today
        entry({ startedAt: NOON - 48 * HOUR }), // Thursday
      ],
      "UTC",
      "2026-08-08",
      NOON
    )

    expect(totals.todayMs).toBe(HOUR)
    expect(totals.weekMs).toBe(2 * HOUR)
  })

  it("counts only billable entries in the billable total", () => {
    const totals = periodTotals(
      [
        entry({ startedAt: NOON - 2 * HOUR, billable: true }),
        entry({ startedAt: NOON - 3 * HOUR }),
      ],
      "UTC",
      "2026-08-08",
      NOON
    )

    expect(totals.billableMs).toBe(HOUR)
    expect(totals.weekMs).toBe(2 * HOUR)
  })

  /** The running entry has no row in the log, but its time is real. */
  it("includes a running entry's elapsed time", () => {
    const totals = periodTotals(
      [entry({ startedAt: NOON - 90_000, durationMs: null })],
      "UTC",
      "2026-08-08",
      NOON
    )

    expect(totals.todayMs).toBe(90_000)
    expect(totals.weekMs).toBe(90_000)
  })

  it("attributes an entry to the day it STARTED, in the user's zone", () => {
    // 23:30 UTC on 8 Aug is 11:30 on 9 Aug in Auckland.
    const late = Date.UTC(2026, 7, 8, 23, 30)
    const totals = periodTotals(
      [entry({ startedAt: late })],
      "Pacific/Auckland",
      "2026-08-09",
      late
    )

    expect(totals.todayMs).toBe(HOUR)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node node_modules/vitest/vitest.mjs run src/lib/period-totals.test.ts
```

Expected: FAIL — cannot resolve `./period-totals`.

- [ ] **Step 3: Implement it**

Create `src/lib/period-totals.ts`:

```ts
import { groupByDay, sumRange } from "@/lib/group-entries"
import type { Entry } from "@/lib/group-entries"
import type { DayString } from "@shared/day"

/**
 * The "Today" and "This week" figures.
 *
 * Takes the rows of a WEEK-BOUNDED query, deliberately. The Timer page's list is
 * paginated, and totalling the loaded pages would produce a number that silently
 * means "of what has been fetched so far" — which is the figure that reaches an
 * invoice understated with nothing on screen to reveal it. Because the paginated
 * list is not an argument here, that mistake is not expressible.
 *
 * Running entries contribute their elapsed time, so these tick with the bar.
 */
export function periodTotals(
  weekEntries: Array<Entry>,
  timeZone: string,
  today: DayString,
  now: number
): { todayMs: number; weekMs: number; billableMs: number } {
  const groups = groupByDay(weekEntries, timeZone, now)
  const week = sumRange(groups)
  return {
    todayMs: groups.find((group) => group.day === today)?.totalMs ?? 0,
    weekMs: week.totalMs,
    billableMs: week.billableMs,
  }
}
```

- [ ] **Step 4: Run the tests**

```bash
node node_modules/vitest/vitest.mjs run src/lib/period-totals.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Rename the route**

```bash
git mv src/routes/_authed/today.tsx src/routes/_authed/timer.tsx
```

- [ ] **Step 6: Rewrite the route for pagination**

In `src/routes/_authed/timer.tsx`:

Change the route id and title:

```tsx
export const Route = createFileRoute("/_authed/timer")({
  head: () => ({ meta: [{ title: "Timer — Trace" }] }),
  component: Timer,
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(convexQuery(api.settings.get, {}))
  },
})
```

Rename the component function `Today` → `Timer`.

Replace the 30-day `listRange` query with two queries — a paginated list and a week-bounded range:

```tsx
const PAGE_SIZE = 50

// …inside the component, replacing `range` and the `entries` query:

  const week = weekWindow(today, settings.timezone, settings.weekStartDay)

  const weekRange = useMemo(
    () => ({
      fromMs: dayWindow(week.firstDay, settings.timezone).fromMs,
      toMs: dayWindow(week.lastDay, settings.timezone).toMs,
    }),
    [week.firstDay, week.lastDay, settings.timezone]
  )

  // Bounded to the current week and used ONLY for the totals. See
  // src/lib/period-totals.ts for why they are not derived from the list below.
  const { data: weekEntries } = useSuspenseQuery(
    convexQuery(api.entries.listRange, weekRange)
  )

  // The log itself, all the way back. `toMs` is the end of today rather than
  // Infinity so a clock-skewed future entry cannot sit permanently on top.
  const listRange = useMemo(
    () => ({ fromMs: 0, toMs: dayWindow(today, settings.timezone).toMs }),
    [today, settings.timezone]
  )

  const { results, status, loadMore } = usePaginatedQuery(
    api.entries.listPage,
    listRange,
    { initialNumItems: PAGE_SIZE }
  )

  const groups = useMemo(
    () => groupByDay(results, settings.timezone, nowMs),
    [results, settings.timezone, nowMs]
  )

  const totals = periodTotals(weekEntries, settings.timezone, today, nowMs)
```

Update the totals row and add the load-more control:

```tsx
      <div className="flex items-center justify-between gap-3 pr-2">
        <TotalsRow
          className="py-3"
          todayMs={totals.todayMs}
          weekMs={totals.weekMs}
          billableMs={totals.billableMs}
          display={settings.durationDisplay}
        />
        <ManualEntryDialog
          today={today}
          timeZone={settings.timezone}
          onCreate={editMutations.create}
        />
      </div>

      <main className="flex-1">
        <EntryLog
          groups={groups}
          timeZone={settings.timezone}
          use12Hour={settings.timeFormat === "12"}
          display={settings.durationDisplay}
        />

        {/*
          A button, not scroll-triggered loading. Reports already works this
          way, the day headers are sticky and auto-loading fights them, and a
          control the user presses is one they can also choose not to press.
        */}
        {status === "CanLoadMore" ? (
          <div className="flex justify-center py-4">
            <Button variant="outline" onClick={() => loadMore(PAGE_SIZE)}>
              Load earlier entries
            </Button>
          </div>
        ) : null}
      </main>
```

Add the imports this needs: `usePaginatedQuery` from `convex/react`, `Button` from `@/components/ui/button`, `periodTotals` from `@/lib/period-totals`, `weekWindow` from `@shared/day`. Remove `sumRange` and `LOG_DAYS` and `addDays` if now unused — `tsc` will say.

- [ ] **Step 7: Verify**

```bash
node node_modules/vitest/vitest.mjs run && node node_modules/typescript/bin/tsc --noEmit && node node_modules/eslint/bin/eslint.js . && node node_modules/vite/bin/vite.js build
```

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: /today becomes /timer, with the whole log in it

The list is paginated through listPage and reaches all the way back, so Timer
and History are no longer the same list twice.

The totals come from a separate week-bounded query, extracted as a pure
function whose arguments do not include the paginated list — a total summed
from loaded pages silently means 'of what has been fetched so far', and making
that inexpressible is better than remembering not to do it."
```

---

## Task 11: `/history` becomes `/reports`

**Files:**
- Rename: `src/routes/_authed/history.tsx` → `src/routes/_authed/reports.tsx`

- [ ] **Step 1: Rename**

```bash
git mv src/routes/_authed/history.tsx src/routes/_authed/reports.tsx
```

- [ ] **Step 2: Update the route**

```tsx
export const Route = createFileRoute("/_authed/reports")({
  head: () => ({ meta: [{ title: "Reports — Trace" }] }),
  component: Reports,
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(convexQuery(api.settings.get, {}))
  },
})
```

Rename the component `History` → `Reports`. Behaviour is otherwise unchanged: same filters, same presets, same `rangeSummary`, same period stepping.

- [ ] **Step 3: Verify**

```bash
node node_modules/vitest/vitest.mjs run && node node_modules/typescript/bin/tsc --noEmit && node node_modules/eslint/bin/eslint.js .
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: /history becomes /reports

Same filters, same totals, same period stepping. It is named for what it is now
that the log lives on Timer."
```

---

## Task 12: Loose ends and final verification

**Files:**
- Modify: `src/routes/index.tsx`, `src/lib/redirect.test.ts`, `src/components/a11y/shortcuts-overlay.tsx`

- [ ] **Step 1: Repoint the landing link**

In `src/routes/index.tsx`, change the link:

```tsx
              <Link to="/timer" className={cn(buttonVariants())}>
                Go to timer
              </Link>
```

- [ ] **Step 2: Update the sample paths in the redirect tests**

In `src/lib/redirect.test.ts`, replace each `"/today"` with `"/timer"`. These are arbitrary sample paths in `safeRedirect` assertions; nothing about the tests depends on the route existing, but leaving a dead path in them is misleading.

- [ ] **Step 3: Document the new shortcut**

In `src/components/a11y/shortcuts-overlay.tsx`, rename the `"History"` group to `"Reports"`, and add the sidebar toggle to the `"Anywhere"` group:

```tsx
  {
    group: "Anywhere",
    items: [
      ["⌘ / Ctrl + B", "Collapse or expand the sidebar"],
      ["?", "This list"],
      ["F6", "Move focus into a toast, to reach Undo"],
    ],
  },
```

- [ ] **Step 4: Confirm no stale references remain**

```bash
grep -rn '"/today"\|"/history"\|to="/today"\|to="/history"' src/ --include=*.tsx --include=*.ts | grep -v routeTree
```

Expected: no output.

- [ ] **Step 5: Full verification**

```bash
node node_modules/vitest/vitest.mjs run && node node_modules/typescript/bin/tsc --noEmit && node node_modules/typescript/bin/tsc --noEmit -p convex && node node_modules/eslint/bin/eslint.js . && node node_modules/vite/bin/vite.js build
```

Expected: all green.

- [ ] **Step 6: Verify in the browser, signed in**

```
preview_start { name: "trace" }
navigate  http://localhost:3000/timer
```

Check each of these and report the actual observed values, not assumptions:

1. The sidebar shows Timer, Reports, Projects, Settings; the current one carries `aria-current="page"`.
2. The timer bar is above the content and a timer can be started from `/projects`.
3. Press `⌘B` (or `Ctrl+B`). The rail collapses to icons. **Reload the page.** It must still be collapsed, with no width jump during load — this is the cookie path, and it is the one thing most likely to be silently broken.
4. `read_console_messages { onlyErrors: true }` returns nothing.
5. `resize_window { preset: "mobile" }`, reload: hamburger present, sidebar opens as a sheet, timer bar pinned at the bottom, no horizontal scroll.
6. `/reports` still filters, steps periods with `←`/`→`, and shows its summary sentence.

- [ ] **Step 7: Final commit**

```bash
git add -A
git commit -m "chore: repoint the last references at the new routes

The landing link, the shortcuts overlay's group name and the new ⌘B row, and
the sample paths in the redirect tests."
```

---

## Self-Review

**Spec coverage.** §2 IA → Tasks 10, 11, 12. §3 file structure → Tasks 5, 7, 8, 9. §4 SSR cookie → Task 6; the `useIsMobile` breakpoint comments → Task 5 Step 5. §5 Timer queries → Task 10. §6 mobile → Task 8 (shell) and Task 12 Step 6 (verification). §7 collapse → Task 7 (`collapsible="icon"`) and Task 12 (shortcut docs). §8 note sheet → Task 9 Step 2. §9 recap removal → Tasks 1–4, with §9.2's three deploys as Tasks 2, 3 and their explicit deploy steps. §10 testing → Tasks 6, 7, 10. §11 out of scope → nothing here exceeds it.

**Corrections made to the spec while planning.** Two, both recorded above rather than silently applied:

1. §10 claimed `app-sidebar.tsx` is testable with no router. It renders TanStack `<Link>`, which throws without router context. Task 7 adds a memory-router harness.
2. §2's "infinite scroll" is realised as a "Load earlier entries" button, matching Reports. Auto-loading on scroll fights the sticky day headers and is not built.

**Known risk.** Task 5 Step 2 depends on the shadcn CLI's interactive overwrite prompts. If it runs non-interactively and clobbers `button.tsx`, `input.tsx` or `separator.tsx`, Step 3's hash comparison catches it and Step 3 restores them from git. That check is not optional.
