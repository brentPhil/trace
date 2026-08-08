# Dashboard shell: sidebar, global timer, Timer/Reports split

**Date:** 2026-08-08
**Status:** approved, not implemented

Replaces the top nav bar with a persistent left sidebar and lifts the timer out
of a single page into the app shell, so a timer can be started and stopped from
anywhere. Splits `/today` and `/history` into Toggl's arrangement: one **Timer**
page that is the bar plus one continuous scrolling log, and one **Reports** page
that is the filtering and totals. **Deletes the recap** (§9).

The shell work needs no new Convex functions — every query it uses already
exists. The recap removal does change the schema, and that part has an ordering
constraint (§9.2).

---

## 1. Why

The current shell is a horizontal nav with four links, and the timer bar lives
inside `/today`. Two consequences:

- **You cannot start a timer from anywhere but Today.** For a product whose
  first principle is that starting must never be blocked, requiring a navigation
  first is the largest remaining friction in the app.
- **`/today` and `/history` are the same list twice.** They differ in that one
  is capped at 30 days and the other has filters. A user deciding which page to
  open is answering a question about the implementation, not about their work.

## 2. Information architecture

| Nav item | Route | Contents |
|---|---|---|
| Timer | `/timer` | Week totals, then one continuous day-grouped log with infinite scroll back |
| Reports | `/reports` | Filter bar, exact range summary, filtered day-grouped list |
| Projects | `/projects` | Unchanged |
| Settings | `/settings` | Unchanged |

`_authed/today.tsx` → `_authed/timer.tsx`. `_authed/history.tsx` →
`_authed/reports.tsx`. `index.tsx`'s "Go to today" button and the post-login
redirect both target `/timer`.

The timer bar itself is **not** part of any page. It is in the shell, above the
outlet, on all four routes.

### Old paths

`/today` and `/history` are dropped without redirects. The app has one user, no
external links point at it, and a redirect route retained indefinitely to serve
a bookmark nobody holds is dead weight. `src/lib/redirect.test.ts` uses `/today`
purely as an arbitrary sample path in `safeRedirect` assertions — those change to
`/timer` for tidiness; nothing about the test depends on the path existing.

## 3. Shell architecture

| File | Role |
|---|---|
| `src/routes/_authed.tsx` | Guard + error boundary. Gains the shell's loader work and the sidebar-cookie read. Renders `<AppShell><Outlet/></AppShell>` |
| `src/components/shell/app-shell.tsx` | Sidebar + timer bar + content region. Owns the running entry and its mutations |
| `src/components/shell/app-sidebar.tsx` | Nav, header, footer. Pure — props only |
| `src/components/ui/sidebar.tsx` | Vendored from shadcn registry, style `base-luma` |
| `src/components/ui/sheet.tsx`, `skeleton.tsx`, `tooltip.tsx` | Registry dependencies of sidebar |
| `src/hooks/use-mobile.ts` | Registry dependency of sidebar |
| `src/lib/sidebar-cookie.ts` | Isomorphic read of the persisted collapse state |
| ~~`src/components/app-header.tsx`~~ | Deleted. Four routes drop their `<AppHeader>` |

`app-sidebar.tsx` takes `email` and `onSignOut` and nothing else. It reaches for
no query and no mutation, matching the invariant the rest of the codebase
already holds: components take their writes as props. That is what lets it be
tested with no router and no backend.

### Why shadcn's sidebar is safe here

The project's `components.json` sets `"style": "base-luma"`, and that style's
sidebar is built on Base UI — `@base-ui/react/merge-props` and
`@base-ui/react/use-render`. It pulls in **no Radix**, so it composes with the
existing `ui/` wrappers rather than introducing a second primitive library.

The sidebar CSS custom properties are **already** in `src/styles.css` (lines
75–82), mapped to this project's palette: `--sidebar: var(--surface)`,
`--sidebar-border: var(--edge)`, and so on. Nothing new is needed for theming.

Of the registry dependencies, `button`, `input` and `separator` already exist.
Only `sheet`, `skeleton`, `tooltip` and `use-mobile` are added.

### Loader consolidation

`settings`, `getRunning`, `projects.list`, `tags.list` and `titleSuggestions`
move from `today.tsx`'s loader up to `_authed.tsx`'s, so they are fetched once
per session rather than once per page. `reports.tsx` and `projects.tsx` drop
their now-duplicate classifier prefetches.

## 4. SSR mechanics

Two hazards, both established by reading the registry source rather than assumed.

### The collapsed rail flashes without a server-side cookie read

`SidebarProvider` accepts `defaultOpen` (default `true`) and persists toggles by
writing `document.cookie` directly — `sidebar_state`, 7-day max-age. **Nothing
reads it back.** shadcn's own docs expect the host app to read the cookie
server-side and pass `defaultOpen`. Without that, a user who collapsed the rail
gets SSR at `16rem`, hydration at `3rem`, and a 208px layout jump on every load.

```ts
// src/lib/sidebar-cookie.ts
import { createIsomorphicFn } from "@tanstack/react-start"
import { getCookie } from "@tanstack/react-start/server"

export const readSidebarOpen = createIsomorphicFn()
  .server(() => getCookie("sidebar_state") !== "false")
  .client(() => !/(^|;\s*)sidebar_state=false/.test(document.cookie))
```

Both imports were confirmed present in the installed tree, not assumed.
`createIsomorphicFn` comes from `@tanstack/react-start` 1.168.39.
`getCookie(name): string | undefined` reaches `@tanstack/react-start/server`
through a chain of re-exports — `react-start-server` → `start-server-core` →
`request-response` — so it does not appear in a grep of `server.d.ts`, which is a
single `export *` line.

`createIsomorphicFn` splits the bundle, so the `/server` import never reaches the
client. Deliberately **not** `createServerFn`: that would be a network round trip
on every client navigation to read a cookie the browser already holds.
Called in `_authed.tsx`'s `beforeLoad`, returned into route context, passed to
`SidebarProvider` as `defaultOpen`.

Reading a cookie in `beforeLoad` is safe in a way that reading a *timezone* there
is not (see the plan's §5.9): the cookie travels with the request, so the server
and the client observe the same value. The hazard that made `settings.ensure`
client-only does not apply.

### `useIsMobile` returns `false` during SSR, and that is fine

The hook is `useState<boolean | undefined>(undefined)` plus an effect, so the
server and the first client paint both take the desktop branch. This is harmless,
and the reason is worth recording so nobody later "fixes" it into a real bug:

- The desktop branch carries `hidden ... md:block`, so on a phone it renders and
  is immediately hidden by CSS.
- The mobile branch is a `Sheet` that is closed by default, rendering nothing.

Both states are visually empty on a phone. There is nothing to flash.

**The real constraint is that the two breakpoints must agree.** `use-mobile.ts`
uses `MOBILE_BREAKPOINT = 768`; the sidebar class uses Tailwind's `md:`, which is
also 768px. They match by coincidence of both being defaults. If either moves
without the other, a phone gets a permanently invisible sidebar with no error.
A comment stating this goes at **both** sites.

## 5. The Timer page's queries

Merging the two lists means Timer must scroll back through all history, not 30
days. That forces a query change.

| Concern | `/today` now | `/timer` |
|---|---|---|
| The list | `listRange`, 30 days, cap 500 | `listPage` — the paginated query Reports already uses |
| Today / This week totals | client-summed over those 30 days | a **separate** `listRange` bounded to the current week |
| Recap | `recap.get(today)` | gone (§9) |

The second row is the load-bearing decision. Summing the totals from the
*paginated* results would silently mean "of the pages loaded so far" — exactly
the half-loaded figure Reports goes out of its way to avoid reporting. So Timer
keeps a small bounded `listRange` over the current week for its totals, which
also preserves the live running-entry time in them. A week is a cheap bounded
read; the scrolling list gets pagination.

Two things fall out of this:

- `listRange`'s unclamped `limit` stops being load-bearing once it only ever
  spans a week, closing the silent-truncation hole a review flagged on `/today`.
- Timer inherits the auto-load-while-filtering behaviour only if filters exist
  there, and they do not — so its pagination is plain infinite scroll.

## 6. Mobile

The sidebar collapses to a hamburger that opens an off-canvas `Sheet`. The timer
bar stays **pinned to the bottom of the viewport**, under the thumb — now on all
four routes rather than only Today.

This preserves a decision the plan argues explicitly ("the start control belongs
under the thumb… Toggl has publicly declined to fix its mobile web app"), and
the shell extends it: the surface the incumbent abandoned now has a persistent
start control on every page.

`pb-[max(0.5rem,env(safe-area-inset-bottom))]` and the content spacer move from
`today.tsx` into the shell.

## 7. Desktop collapse

`collapsible="icon"`. Full labels by default; ⌘B / Ctrl+B collapses to a ~48px
icon rail with tooltips; the choice persists via the cookie above.

The shortcut is added to the `?` shortcuts overlay. It does not collide: the app
binds `?`, `←`/`→` (Reports only), and `⌘Enter` (note sheet).

## 8. The note sheet no longer opens on stop

**Decision:** stopping a timer does not raise the note sheet. Notes are added by
clicking a row in the log.

The plan's §2.2 argues the opposite — that the moment of stopping is the single
most valuable moment to ask what someone just did. That argument is not wrong,
and the risk it names is real: if notes never get written, the recap is empty and
the product is Toggl with extra steps. It is accepted anyway, because a modal
interrupting *every* stop is a tax on the most frequent action in the app, and
the affordance does not disappear:

- Every row without a note shows a hatched `+ add note`, always visible rather
  than hover-revealed (the Hatch Rule).
- The day header's `N of M noted` still states the gap.
- Reports searches note text, so a note remains the thing that makes an old
  entry findable.

Consequences:

- `TimerBar`'s `onStopped` prop loses its only consumer and is removed.
- `timer.tsx` sheds the `stopped` / `noteOpen` state that `today.tsx` carries.
- `NoteSheet` stays exactly where it is, inside `EntryLog`, driven by row clicks.
- `entry-log.tsx`'s "the sheet reads a snapshot rather than the live row" comment
  becomes straightforwardly true, since the only path in is now a row click.

**If the noted-count drops after this ships, revisit** — a non-modal nudge on the
just-stopped row is the next thing to try, not a return to the modal.

## 9. Removing the recap

**Decision:** the recap is deleted, not hidden. Notes stay; the thing that
consumed them does not.

This is worth stating plainly because it is the larger of the two decisions and
it compounds with §8. The plan's thesis was notes → recap → paste into a channel,
and §2.2 justified collecting notes at all by pointing at the recap. With both
the stop-prompt and the recap gone, a note is a description on a row: still
useful, still searchable in Reports, still the thing that makes an old entry
findable — but no longer feeding anything downstream. The product this leaves is
coherent (Toggl with a real notes field, a working mobile web app, and undo);
it is simply a different product from the one the plan describes, and the plan
must be edited to say so rather than left implying otherwise.

Deleted rather than flag-hidden because ~1,100 lines of tested code with no
caller is exactly the dead weight the last review flagged elsewhere, and git
keeps it recoverable.

### 9.1 What goes

| Path | Note |
|---|---|
| `convex/recap.ts` | `get`, `getAs`, `setFields`, `setFieldsAs`, the tombstone |
| `convex/lib/recap.ts` | `assembleRecap`, `suggestBlocked`, `BULLET_CAP`, `NO_PROJECT` |
| `convex/lib/render.ts` | `renderMrkdwn`, `renderPlain` |
| `convex/recap.test.ts`, `convex/lib/recap.test.ts` | |
| `src/components/recap/recap-panel.tsx` | |
| `recapDays` table | Schema |
| `userSettings.recapMinuteLocal` | Schema, plus `SETTINGS_DEFAULTS`, `settings.update` args, and the field in `/settings` (seven fields → six) |

Verified couplings, so the deletion does not strand anything or over-reach:

- **`recapDuration`** lives in `convex/lib/recap.ts`, not the shared duration
  module, and its only callers are `lib/render.ts` and `recap-panel.tsx` — both
  deleted. It goes with them. `formatCompactDuration`, `formatClock`,
  `spokenDuration` and `formatDecimalHours` in `convex/lib/duration.ts` are
  untouched and still have callers.
- **`minutesToTime` / `timeToMinutes`** are local helpers in `settings.tsx` used
  only by the recap-time field. They are deleted with it.
- **`convex/settings.test.ts`** asserts against `SETTINGS_DEFAULTS` wholesale
  rather than field by field, so it follows the change with no edit — one of the
  17 tests added last week paying for itself.
- **`convex/recap.test.ts:36`** seeds `recapMinuteLocal`, but the whole file is
  deleted, so it is not a blocker.

### 9.2 Schema removal has an order

Convex validates existing documents against the schema, so a field or table
cannot simply disappear from `schema.ts` while rows still carry it — the deploy
fails. Three steps, in this order, each deployed:

1. Make `recapMinuteLocal` optional (`v.optional(v.number())`) and deploy.
2. Clear it from every `userSettings` row, and delete every `recapDays` row.
3. Remove the field and the table from `schema.ts`, and deploy.

Steps 1 and 3 cannot be collapsed. This is the only part of the whole spec that
touches production data, and it is the only part that is not trivially
reversible, so it is done deliberately and separately from the shell work.

### 9.3 Plan edits

`docs/superpowers/plans/2026-08-08-time-tracking-implementation-plan.md` needs
§2.2's rationale, §4's function surface, §5's Phase 6, §8.3's `recapDays` open
item, and Tier 2 #11 (recap nudge) and #14 (recap snapshots) updated. Tier 3's
weekly/per-client recaps and per-bullet LLM entries go too — they were
extensions of a feature that no longer exists.

## 10. Testing

| Unit | How |
|---|---|
| `app-sidebar.tsx` | DOM tests: active nav state per route, footer renders email, `onSignOut` fires. Pure props, so no router or backend |
| `sidebar-cookie.ts` | Unit tests for both branches, including absent cookie → open, `sidebar_state=false` → collapsed, and a cookie string where another key contains the substring |
| Collapse behaviour | DOM test that ⌘B toggles `data-state`, and that `defaultOpen={false}` renders collapsed on first paint |
| Timer page totals | Extract the week-total derivation into a pure function taking `(weekEntries, now)` and test it directly. The property that matters — that the figure does not change with how many pages are loaded — is only assertable if the totals do not take the paginated list as an input, so making it testable and making it correct are the same edit |

`history-filters.test.ts` and `group-entries.test.ts` are unaffected and do not
move.

## 11. Out of scope

Named so the work cannot silently expand:

- No project list in the sidebar, and no workspace/client switcher.
- No changes to Projects or Settings beyond dropping `<AppHeader>`.
- Reports keeps its current filter behaviour exactly — no new filters, no saved
  views, no CSV.
- No new Convex functions or validators. The only schema changes are the two
  recap removals in §9.2.
- No redirects for `/today` and `/history`.
- No replacement for the recap. Nothing is built to fill the gap it leaves —
  if something should consume notes later, that is a new spec, not a rename of
  this one.
