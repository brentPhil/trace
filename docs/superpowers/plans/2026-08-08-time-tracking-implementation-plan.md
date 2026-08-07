# Trace — Time Tracking Implementation Plan

**Date:** 2026-08-08
**Status:** proposed
**Reference product:** Toggl Track (studied for workflow, terminology, and foundational behaviours; not copied in branding or interface)
**Builds on:** `docs/superpowers/specs/2026-08-07-convex-backend-design.md`, `PRODUCT.md`, `DESIGN.md`

---

## 0. What already exists

Auth is done and committed. This plan starts at the domain layer.

| Layer | State |
|---|---|
| App shell | TanStack Start (SSR) + TanStack Router file routes + React 19 + Vite 8 |
| Backend | Convex 1.43. `convex/schema.ts` is `defineSchema({})` — the domain is greenfield |
| Auth | Better Auth via `@convex-dev/better-auth`. `requireUser` / `safeGetUser` in `convex/auth.ts` |
| Data plumbing | `ConvexQueryClient` is TanStack Query's `queryFn` (`src/router.tsx`), `expectAuth: true` |
| Authenticated SSR | Root `beforeLoad` → `getToken()` server fn → `serverHttpClient.setAuth(token)` |
| Route guard | `src/routes/_authed.tsx` (UX only — real authorization is `requireUser` inside Convex) |
| UI kit | shadcn `base-luma` on **Base UI** (`render` prop, **not** `asChild`). Installed: button, input, label, field, separator |
| Design system | "The Darkroom", committed in `DESIGN.md` |
| Tests | vitest 4 + RTL + jsdom. 7 tests, all in `src/lib/redirect.test.ts` |

**The user id is a `string`** from the Better Auth component namespace — never a `v.id("users")`. Every domain row carries `userId: v.string()`.

---

## 1. Product shape, decided

Toggl Track was studied across five lenses (timer mechanics, API/domain model, reporting, power-user behaviours, mobile + peer products). The full research is condensed below into only what changes what we build.

### 1.1 Terminology — Trace vs Toggl

| Toggl | Trace | Call |
|---|---|---|
| Time entry | **Entry** | Keep |
| Description (one field: title + prose + grouping key + autocomplete key) | **`title`** + **`note`** — two fields | **The core divergence.** Toggl's single field means writing prose breaks your own grouping. `note` is never a grouping, matching, or autocomplete key |
| Continue | **Resume** | Creates a *new* entry. Never extends the old one — gaps stay visible |
| Workspace, Organization | — | **Dropped entirely.** One user. Removes a scoping predicate from every query |
| Task | — | **Dropped permanently.** A mandatory third taxonomy level with nobody to assign to |
| Client | **Client** | Fast-follow. Reached transitively via project; an entry must *never* carry a `clientId` |
| Project, Tag, Billable | same | Keep. Tags stay flat — flatness is the feature |
| `duration = -start` (running) | `endedAt === null` | See §2.3 |
| Summary / Detailed / Weekly reports | **The log** (one view + filters) | See §1.4 |
| Pomodoro, OS idle detection, timeline, autotracker | — | **Ruled out, not deferred.** They need native access. Toggl itself ships Pomodoro to five clients and deliberately not the web app |

### 1.2 The core loop

**Start** — `N` or the play control starts *immediately*. Nothing is required: empty title, no project, no tags. **This is the single most important behavioural rule in the product.** Any validation lives at stop, never at start.

**Stop** — `S`. Sets `endedAt = now`. **Stop opens the note sheet**, already focused, keyboard up, with a one-tap Skip. The timer is *already stopped*, so the note never blocks anything. This is the inversion of Toggl's slide-up sheet, which opens on Play — when you don't yet know what you'll do.

**Resume** — `C` or a per-row control. Clones `title`, `projectId`, `tagIds`, `billable`. **Never clones `note`** — a note describes a specific stretch of work.

**Manual** — `M` toggles the same bar into manual mode. Same bar, not a separate screen.

**Reconciliation rule** (start / end / duration are over-determined — Toggl ships this as a *preference*, which is evidence a hidden rule confuses people; one rule, stated in the UI):

> **Timestamps are facts; duration is arithmetic.**
> - Edit **start** → duration recomputes. End does not move.
> - Edit **end** → duration recomputes. Start does not move.
> - Edit **duration** → **end** moves. Start is anchored.
> - On a **running** entry there is no end, so editing duration moves **start**. Surface this explicitly — same gesture, different meaning.

Never move a timestamp the user didn't type. Anchor the immovable field visually with weight or a glyph — never a hue (Two Temperatures Rule).

**One duration parser, everywhere.** Toggl's own live pages contradict each other: bare `5` is 5 *hours* in Timesheet view and 5 *minutes* in the timer bar. That is the bug class that produces a wrong invoice.

| Input | Parses to | Rule |
|---|---|---|
| `90`, `5` | 1:30:00, 0:05:00 | **Bare integer = minutes** |
| `1.5`, `1,5` | 1:30:00 | Decimal = hours |
| `1:30`, `1:30:45` | as written | `h:mm`, `h:mm:ss` |
| `90m`, `1h`, `1h30`, `1.5h`, `45s` | as written | Explicit units always win |
| anything else | no commit | Inline hint, confirm disabled |

Bare-integer-as-minutes is chosen on asymmetric risk: `8` misread as 8 hours over-bills and may go unnoticed; misread as 8 minutes under-records and is caught instantly. **Echo the parse before commit** (`→ 1:30:00`, right-aligned, tabular). Reject > 24 h with a "longer than a day — split it?" prompt.

### 1.3 The differentiator, stated precisely

No product combines tracked durations with human-written per-entry notes. Harvest/Everhour/Clockify have notes but no summary — and in practice the note is write-only, surfacing nowhere until you build a Detailed report. Timely/Rize generate summaries but from surveilled window titles: they describe which files you touched, not what you decided or why you're stuck. Geekbot/DailyBot generate good standups but carry no durations.

**The recap, not the timer, is the product.** The timer is table stakes and must be excellent; the recap is why anyone switches.

### 1.4 Reporting: one view

Ship **the log** — reverse-chronological entries under day headers, each note rendered in full. Every "report" is that same view with a filter applied, not a different view.

This is structural, not budgetary. Toggl needs Summary and Weekly because a duration plus a four-word label is meaningless alone and only acquires meaning by aggregation. Trace's entries are meaningful one at a time. Toggl's Summary groups by *exact description string* — its own docs tell you to keep descriptions identical for it to work. Unique prose gives you N groups of one. **Do not port it.**

- **Filters:** four, hardcoded. Date range (with presets), project, billable, text. AND across fields, OR within a multi-select. No operator vocabulary, no filter groups.
- **Totals are a sentence, not a dashboard:** `18h 20m across 4 projects · 15h 10m billable`. Three numbers maximum. Four bordered cards with large numerals is the exact thing `DESIGN.md` forbids.
- **No charts.** A chart of a week of prose communicates strictly less than the prose.
- **Sort:** date-descending, hardcoded. Sort-by-duration turns a journal into a leaderboard.
- **Named presets as chips:** "No project", "No note", "Under a minute". These find unbillable drift.

---

## 2. Architecture decisions

Four independent design tracks produced conflicting proposals; an adversarial review found 20 contradictions and 12 technical errors across them. The decisions below resolve every one that affects the build order. **Each is load-bearing — changing one later is expensive.**

### 2.1 Day boundaries: `dayKey` is **derived**, never stored — DECIDED

The single highest-leverage decision in the plan. Entries are stored as UTC instants but grouped by the user's local day.

**Rejected:** a stored authoritative `dayKey` column. It appears cheaper (index-range on a string) but creates an irreversible failure: the ordinary inline edit path recomputes `dayKey` under the user's *current* timezone. A London freelancer who logs 23:30 on 6 Aug, moves to Tokyo, then fixes a typo in that entry's start time in September silently moves the entry to 7 Aug — changing an already-invoiced month with no diff and no audit trail. It also forces a re-bucket migration tool, a `tzAtWrite` column, and a timezone-confirmation flow into the MVP.

**Decided:** store `startedAt` only. Compute day windows from `(dateString, timezone)` at query time.

```ts
// convex/lib/day.ts — pure, shared by client and server
export function dayWindow(day: string, tz: string): { fromMs: number; toMs: number }
export function dayOf(instantMs: number, tz: string): string   // "YYYY-MM-DD"
```

Queries range on `by_user_started` with `.gte("startedAt", fromMs).lt("startedAt", toMs)`. Day headers in the log are derived client-side by comparing `dayOf()` between consecutive rows — which also makes pagination-splits-a-day-header a non-problem.

Consequences, accepted:
- Changing the timezone setting re-buckets history. This is **reversible** (change it back) and user-initiated. The stored variant's failure mode is irreversible.
- The log and the recap resolve days through the *same* function, so they cannot disagree. Under the stored design they demonstrably could ("my recap says 5h but my log says 6h" — unrecoverable in a billing tool).
- No `tzAtWrite`, no re-bucket tool, no `timezoneConfirmedAt` at MVP.

**Midnight-crossing entries are attributed to their start date** (Toggl's rule, kept). Split is the manual correction, and it is fast-follow.

**`instantOfLocal` must be written correctly.** The naive two-pass implementation is subtly wrong on DST fall-back and — worse — *zone-dependently* wrong: with `a === b` early-return it yields the second occurrence of an ambiguous local time in `Europe/London` and the first in `America/New_York`. A London freelancer backfilling 00:45–01:30 on 25 Oct 2026 gets 1 h 45 m instead of 45 m — an hour of phantom billable time, twice a year, in half the world's timezones. Both branches (spring gap, autumn fold) get explicit named tests. See Phase 1.

### 2.2 The recap is **deterministic assembly**. No LLM at MVP — DECIDED

> The recap is a pure function of the day's entries plus the user's own edits, in which **every character is either something the user typed, a duration computed from stored milliseconds, or one of about twenty fixed literals.**

An LLM may later exist only as a **per-bullet, opt-in, user-invoked rewrite of text the user has already written** — never the generator, never automatic, and *structurally incapable* of seeing an entry that has no note. That last clause makes the feared failure (a model inventing work the user didn't do) impossible rather than unlikely: the assist's input is one existing note string and its contract is "tighten this", not "describe this".

This follows directly from *Defensible by default* — the user bills from this data — and it is also the cheaper, faster, offline-capable, zero-cost option. The concession is real and accepted: a user who writes "pool thing fixed" gets "pool thing fixed". That is correct behaviour. It trains better notes.

**Cut from MVP:** `recap.compose` (the LLM action), `recapSnapshots`, `recapOverrides`, per-bullet staleness/fingerprints, `acceptStale`, snapshot history. That is a hand-rolled conflict-resolution layer over a document that regenerates in under a millisecond. MVP recap = derive, render, copy.

### 2.3 Running-entry encoding and enforcement — DECIDED

A running entry is `endedAt === null`, stored as `v.union(v.number(), v.null())` — **not** `v.optional`, so it is indexable.

**Do not adopt Toggl's negative-duration convention.** It makes a field whose *units flip with its sign*, so every `SUM(duration)` that happens to include the running row returns roughly −1.75 billion. Confine it to one named adapter at the import/export boundary, if ever.

**Elapsed time is derived on every render from `startedAt`.** Never a `setInterval` accumulator. This one decision *is* "never lose time": reload, crash, laptop sleep, tab discard and cross-device handoff all become non-events.

**At-most-one-running is enforced server-side**, in the mutation. Convex mutations are serializable transactions, so a read-then-write is atomic without a DB constraint. Starting while running **atomically stops the previous entry at the new entry's start time** — one round trip, no gap, no overlap. Toggl leaves this to client convention and consequently cannot state the guarantee in its own docs.

Two corrections the review forced:

- **Read the running entry with `.first()`, never `.unique()`.** `.unique()` throws when two rows match. If a second `endedAt === null` row ever appears — import bug, restore bug, split bug — `.unique()` means the user **can never stop their timer again**, with no repair path. That is the worst possible outcome for "never lose time", reached from the code written to protect it. `.first()` degrades; `.unique()` bricks. Log the anomaly, stop all of them, never block.
- **`startEntry` must never refuse.** A phone whose clock is 40 s behind a laptop that started 10 s ago would compute a `startedAt` before the running entry's start and get rejected — telling the user to go find and stop something on another device, in a product whose #1 rule is that start is never blocked. **Clamp forward** to `running.startedAt + 1` instead of throwing.

**Idempotency:** the client generates a UUIDv7 `clientKey` on every create; the mutation looks it up on `by_user_clientKey` and returns the existing `_id` instead of inserting. Toggl has zero idempotency in a 907 KB spec — a phone on bad signal POSTs, loses the response, retries, and duplicates the entry precisely when nobody is watching. Nearly free on day one, expensive to retrofit.

### 2.4 Authorization: `requireUser` + `getOwned`. **No RLS layer** — DECIDED

The proposed `wrapDatabaseReader(..., { defaultPolicy: "deny" })` from `convex-helpers` **does not exist** — that helper takes three arguments and no options object, and tables without a rule are *unrestricted*, not denied. Since `defaultPolicy: "deny"` was the entire argument for adding the layer, the layer goes.

```ts
// convex/lib/owned.ts
export async function getOwned<T extends TableNames>(
  ctx: QueryCtx, userId: string, table: T, id: Id<T>
): Promise<Doc<T>>   // throws NOT_FOUND if missing, deleted, or owned by someone else
```

Plus one hard convention, enforced by review: **`userId` never appears in an args validator.** It always comes from `requireUser(ctx)`. RLS is additive and can be added later if the app ever grows a second actor.

### 2.5 List primitives: split by surface — DECIDED

Convex optimistic updates (`localStore.getQuery(fn, args)`) address a *single* query+args pair. They cannot reach a TanStack `useInfiniteQuery` cache (a `{pages, pageParams}` structure in a different store), and `usePaginatedQuery` is a `convex/react` hook with internal multi-page state that cannot be `ensureQueryData`'d in a loader. Mixing them silently breaks every optimistic update.

| Surface | Primitive | SSR | Optimistic |
|---|---|---|---|
| `/today` — one day, bounded | plain `convexQuery(api.entries.listDay, { day })` | yes, via loader | **yes** |
| `/history` — unbounded | `usePaginatedQuery` | no, client-only | **no** — Convex reactivity round-trips fast enough |

They never overlap, so no optimistic update ever targets a paginated query. **Phase 2 proves one optimistic insert end-to-end before any list UI is written** (ordering hazard: getting this wrong after 30 components means rewriting all their data plumbing).

### 2.6 Smaller decisions, settled

| Question | Decision |
|---|---|
| `projects.color` | **In the schema.** Required on create, chosen from a fixed 12-swatch palette. Colour here is legibility, not decoration, and never the sole carrier of meaning |
| Clock skew source | The **`startEntry`/`resumeEntry` mutation return value**, not a `serverNow` field on a query. `Date.now()` inside a query resolves to the transaction timestamp and creates no subscription to the passage of time, so a query-sourced skew freezes at first evaluation and can silently clamp a running clock to `0:00:00` |
| Shared pure code | **`convex/lib/`** is the single home; `src/lib/` imports from it via a `@shared/*` path alias. One parser, one location. Note `convex/lib/errors.ts` imports `ConvexError` from `convex/values`, so the "imports nothing from Convex" rule is stated as "imports nothing from `convex/_generated` or `convex/server`" |
| `tagIds` cap | **10** |
| Delete | Soft (`deletedAt`) on every table from day one + a 6 s undo toast. **The trash view is fast-follow** — the column is free now and painful to retrofit; the view, the purge cron and the permanent-delete dialog are not MVP |
| `settings` bootstrap | `settings.ensure({ suggestedTimezone })` called from `_authed.tsx`'s **`beforeLoad`**, returning settings into route context. TanStack Router runs *loaders in parallel* — a child loader cannot assume a parent loader resolved. This is why the dependency lives in `beforeLoad`, which does chain |
| vitest config | `test.projects` with per-project `environment`. **`environmentMatchGlobs` was removed in Vitest 3** and this project is on Vitest 4 |
| Recap `Copy as plain` | Rendered from the same document model as mrkdwn, **not** `mrkdwn.replaceAll("*","")`. A note reading `use *args, not **kwargs` would otherwise have three asterisks silently deleted from the user's own prose — and would break bold pairing for the rest of the Slack message |

---

## 3. Data model

Four tables. `userId` is the Better Auth string id.

```ts
// convex/schema.ts
export default defineSchema({
  timeEntries: defineTable({
    userId: v.string(),
    clientKey: v.string(),                        // UUIDv7 from the client — idempotency
    title: v.string(),                            // "" allowed. Grouping + autocomplete key
    note: v.optional(v.string()),                 // ≤2000 chars. THE differentiator.
                                                  // Never a grouping or matching key.
    startedAt: v.number(),                        // ms epoch, UTC. No dayKey — see §2.1
    endedAt: v.union(v.number(), v.null()),       // null === running
    durationMs: v.union(v.number(), v.null()),    // denormalised; MUST equal endedAt - startedAt
    projectId: v.optional(v.id("projects")),
    tagIds: v.array(v.id("tags")),                // ≤10, unique, sorted
    billable: v.boolean(),
    source: v.string(),                           // "web" | "import" | "api"
    updatedAt: v.number(),
    deletedAt: v.union(v.number(), v.null()),
  })
    // Every operational index leads with userId. Ownership is a prefix, not a filter.
    .index("by_user_ended", ["userId", "endedAt"])       // the running-entry lookup
    .index("by_user_started", ["userId", "startedAt"])   // day windows, the log, the recap
    .index("by_user_clientKey", ["userId", "clientKey"]) // idempotent create
    .index("by_user_project", ["userId", "projectId"]),  // "is this project referenced?"

  projects: defineTable({
    userId: v.string(),
    name: v.string(),
    color: v.string(),                            // one of 12 fixed swatch keys
    archived: v.boolean(),                        // archive, never delete
    billableByDefault: v.boolean(),
    hourlyRateCents: v.optional(v.number()),
    updatedAt: v.number(),
    deletedAt: v.union(v.number(), v.null()),
  }).index("by_user_archived_name", ["userId", "archived", "name"]),

  tags: defineTable({
    userId: v.string(),
    name: v.string(),
    updatedAt: v.number(),
    deletedAt: v.union(v.number(), v.null()),
  }).index("by_user_name", ["userId", "name"]),

  userSettings: defineTable({
    userId: v.string(),
    timezone: v.string(),                         // IANA. First-class, never the browser's
    weekStartDay: v.number(),                     // 0=Sun..6
    durationDisplay: v.union(v.literal("hms"), v.literal("decimal")),
    timeFormat: v.union(v.literal("12"), v.literal("24")),
    runawayThresholdMs: v.number(),               // default 8h
    tabTitleClock: v.boolean(),                   // default true; a11y opt-out
    recapMinuteLocal: v.number(),                 // minutes past local midnight. Default 1050 (17:30)
    updatedAt: v.number(),
  }).index("by_user", ["userId"]),

  // Day-scoped user prose only. The recap body itself is NEVER stored — see §2.2.
  recapDays: defineTable({
    userId: v.string(),
    day: v.string(),                              // "YYYY-MM-DD" in the user's tz
    next: v.optional(v.string()),
    blocked: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_user_day", ["userId", "day"]),
})
```

**Notes on the shape.**

- `recapMinuteLocal`, not `recapHourLocal`. The default is 17:30, which is not an hour; and an hourly cron cannot serve `Asia/Kolkata`, `Asia/Kathmandu`, or `Pacific/Chatham` at all. Minutes-past-midnight is the only unit that expresses every real timezone offset.
- Units live in names: `durationMs`, `hourlyRateCents`. Toggl ships a `tracked_seconds` field documented as "in milliseconds, not in seconds".
- `deletedAt` uses **one** name on every table. Toggl uses `server_deleted_at` everywhere except tags, which use `deleted_at` — a guaranteed year-two bug.
- No `createdAt`; `_creationTime` is it.
- **No search indexes at MVP.** Two of them double write amplification on every insert and every title/note edit, and the design that was proposed doesn't work anyway: Convex search indexes accept *equality* filters only, so a date range becomes a JS post-filter over an already-capped relevance set. A user searching "acme" filtered to last week would get the 500 highest-relevance all-time hits, three of which are in range, plus a banner advising them to narrow the date range — which changes nothing. See §7 for what MVP search does instead.
- **No `startPrecision`** at MVP. Duration-only entries ("2 hours on Acme yesterday, don't ask when") add a conditional to every row renderer, the edit sheet, the export, and the recap drill-down. Ship when asked for.

**Invariants**, each with its enforcement point:

| # | Invariant | Enforced by |
|---|---|---|
| 1 | At most one `endedAt === null` per user | `startEntry` / `resumeEntry`, transactionally |
| 2 | `endedAt !== null ⇒ endedAt > startedAt` | `entryTimes()` — the sole writer of time fields |
| 3 | `durationMs === endedAt - startedAt`, or both null | `entryTimes()` |
| 4 | `clientKey` unique per user | `by_user_clientKey` lookup before insert |
| 5 | `tagIds` unique, sorted, ≤10 | `normaliseTagIds()` in the mutation |
| 6 | A live entry's `projectId` always resolves | Project delete refuses while referenced (§5) |
| 7 | `userId` never comes from client args | Code review + one lint rule |

---

## 4. Convex function surface

```
convex/
  lib/            # PURE. No convex/_generated, no convex/server. Shared with src/ via @shared/*
    day.ts        # dayOf, dayWindow, weekWindow, instantOfLocal, startOfDay, addDays  [SHIPPED]
    duration.ts   # parseDuration, formatClock, formatCompactDuration,
                  #   formatDecimalHours, spokenDuration, msToIsoDuration            [SHIPPED]
    timeOfDay.ts  # parseTimeOfDay, resolveEndAfterStart, formatTimeOfDay            [SHIPPED]
    entryTimes.ts # entryTimes, applyTimeEdit, assertEnteredDuration, elapsedMs      [SHIPPED]
    codes.ts      # TraceErrorCode union, isTraceError, traceErrorCode               [SHIPPED]
    recap.ts      # assembleRecap(entries, projects, dayFields) -> RecapDoc
    render.ts     # renderMrkdwn(doc), renderPlain(doc) — both from RecapDoc
  errors.ts       # traceError() — server-side, because ConvexError is convex/values [SHIPPED]
  owned.ts        # getOwned, assertOwned                                            [SHIPPED]
  entries.ts      # the tracking loop                                                [SHIPPED]
  projects.ts
  tags.ts
  settings.ts
  recap.ts
  crons.ts        # fast-follow (recap nudge)
```

Two naming decisions differ from earlier drafts of this plan, recorded here
because callers written later would otherwise import something that does not
exist:

- **`formatCompactDuration`, not `formatRecapDuration`.** It is the same
  function the recap needs (`5h 44m` / `47m` / `<1m`, floored), but day headers
  and totals use it too, so it is not named for one caller.
- **The error vocabulary is split.** `convex/lib/codes.ts` holds the
  `TraceErrorCode` union and the guards, because the *client* needs those and
  cannot import anything that pulls in `convex/server`. `convex/errors.ts` holds
  `traceError()`, which throws and therefore needs `ConvexError` from
  `convex/values`. This keeps `convex/lib` free of Convex imports entirely,
  which is stricter than this plan originally proposed and worth the extra file.

### Queries

| Function | Args | Returns | Index |
|---|---|---|---|
| `entries.getRunning` | — | entry \| null | `by_user_ended` |
| `entries.listDay` | `{ day }` | entries + `{ totalMs, billableMs, notedCount }` | `by_user_started` |
| `entries.log` | `{ paginationOpts, filters }` | page of entries | `by_user_started` |
| `entries.recentTitles` | `{ prefix? }` | ≤12 distinct titles + their inherited fields | `by_user_started` desc, take 200, dedupe |
| `entries.weekTotals` | `{ anchorDay }` | `{ totalMs, billableMs }` | `by_user_started` |
| `projects.list` / `tags.list` | — | live rows | `by_user_archived_name` / `by_user_name` |
| `settings.get` | — | settings \| defaults | `by_user` |
| `recap.getDay` | `{ day }` | `RecapDoc` + sources | `by_user_started` + `by_user_day` |

`recentTitles` is an **index scan**, not a search index. A search index returns *relevance* order and cannot answer an empty prefix at all — so autocomplete-on-focus has no answer, and a freelancer whose most recent entry is a one-off would never see it.

### Mutations

| Function | Contract |
|---|---|
| `entries.start` | Idempotent on `clientKey`. Stops any running entry at the new `startedAt`. **Clamps rather than refuses** (§2.3). Returns `{ entry, stoppedEntryId, serverNow }` |
| `entries.stop` | Sets `endedAt`. **Returns the entry unchanged if already stopped** — a second tab pressing `S` is a no-op, not an error |
| `entries.resume` | Clones title/project/tags/billable from a source entry. Never the note. Same idempotency and same stop-the-running behaviour as `start` |
| `entries.createManual` | Completed entry. Does **not** touch the running entry; overlaps are permitted and visible |
| `entries.update` | Applies the §1.2 reconciliation rule via `entryTimes()` |
| `entries.updateNote` | **Separate, cheap, last-write-wins.** No optimistic-concurrency check — a debounced note editor would fight it and produce a conflict modal in the middle of typing, on the one write path that must cost less than skipping |
| `entries.softDelete` / `restore` | Sets / clears `deletedAt` |
| `entries.discardRunning` | Soft-deletes the running entry, leaving `endedAt = now` so restore yields a valid row |
| `projects.create/update/setArchived` | — |
| `projects.remove` | **Refuses while live entries reference it**, surfacing "archive instead". This is what makes the absence of a project-name snapshot safe: a dangling `projectId` cannot occur, so a July invoice stays reproducible in September |
| `tags.ensureByName` / `tags.remove` | Same referential rule |
| `settings.ensure` / `update` | `ensure` seeds the row with the browser's suggested IANA zone on first authed load |
| `recap.setDayFields` | `{ day, next?, blocked? }` |

### Error taxonomy

As shipped in `convex/lib/codes.ts`: `UNAUTHENTICATED`, `NOT_FOUND`,
`INVALID_DURATION`, `END_NOT_AFTER_START`, `DURATION_TOO_LONG`,
`TOO_MANY_TAGS`, `IN_USE`, `TOO_LONG`, `INVALID_TIMEZONE`,
`INVARIANT_MULTIPLE_RUNNING`.

`IN_USE` rather than `PROJECT_IN_USE`: tags need the same refusal, and one code
with a `meta.kind` beats two codes that drift.

Note what is deliberately absent: there is no error code for "cannot start".
Start does not fail.

### Where the 24-hour ceiling lives

Worth stating explicitly, because getting it wrong produced a real bug during
Phase 2. There are two different questions and they need different answers:

| Path | Ceiling? | Why |
|---|---|---|
| `entryTimes()` — the sole writer of the time fields | **No** | A timer left running over a weekend is real recorded time. Refusing it here made `stop()` silently fail, which is a timer that can never be stopped |
| `parseDuration()` — a duration the user typed | Yes (`too-long`) | Offers "longer than a day — split it?" |
| `applyTimeEdit()` — any of the three edit fields | Yes | A mistyped year in the *start* field wrote a 584-day entry when only the field literally named `duration` was capped |

The ceiling is policy about **input**; `entryTimes` enforces **consistency**.

---

## 5. Implementation phases — MVP

> **Status: all eight phases are built.** See §5.9 below for what shipped, what
> deviates from this plan and why, and what remains unverified.

Each phase ends in something runnable and testable. Ordering respects the hazards found in review: **the schema is settled before any code; pure time functions are proven before anything depends on them; the list primitive and one optimistic mutation are proven before any list UI.**

### Phase 0 — Foundations *(~0.5 d)*

Infrastructure that would otherwise burn an afternoon mid-phase.

1. `vitest.config.ts` with `test.projects` — a jsdom project for `src/**`, an edge-runtime project for `convex/**`. Install `convex-test` + `@edge-runtime/vm`.
2. `@shared/*` → `./convex/lib/*` path alias in both `tsconfig.json` and `convex/tsconfig.json`. Note the root config sets `verbatimModuleSyntax: true` and `convex/tsconfig.json` does not — shared modules must use `import type` or they typecheck under one and fail under the other.
3. Narrow the eslint `ignores: ["convex/**"]` to keep `convex/lib` linted, adding `convex/tsconfig.json` to the typed-lint project service.
4. **Verify base-luma registry names before any batch install** — its Base UI registry names a few primitives differently, and a miss mid-batch leaves `src/components/ui` half-written and `components.json` mutated. Add them one at a time or verify the list first.

**Done when:** `pnpm typecheck && pnpm lint && pnpm test` is green with one trivial test in each vitest project.

### Phase 1 — Pure time domain *(~1.5 d)*

No Convex, no React. This is where the invoice-correctness bugs live.

- `convex/lib/day.ts` — `instantOfLocal`, `dayOf`, `dayWindow`, `weekWindow`.
- `convex/lib/duration.ts` — `parseDuration` (the table in §1.2), `formatDuration`, `formatDecimalHours`, `formatRecapDuration`.
- `convex/lib/timeOfDay.ts` — nearest-time parsing (`1`–`11` → nearest AM/PM; `0` → 00:00; `12` by context; `9a`/`4pm` override; end times always resolve forward).
- `convex/lib/entryTimes.ts` — the reconciliation rule as one pure function.

**Tests are the deliverable here**, not an afterthought:
- DST spring-forward gap (`America/New_York`, 8 Mar 2026, local 02:30 does not exist).
- DST autumn fold **in both hemispheres and both offset signs** — `Europe/London` 25 Oct 2026 *and* `America/New_York` 1 Nov 2026 must both resolve to the **first** occurrence. The naive implementation gets one right and one wrong, and nothing in the code tells you which.
- `dayOf` at 23:59:59.999 and 00:00:00.000 in `Pacific/Kiritimati` (UTC+14) and `Pacific/Niue` (UTC−11).
- Every row of the duration-parser table, plus rejection cases.
- `formatRecapDuration` floors, never rounds — no bullet may ever display more time than was recorded.

**Done when:** ~40 tests pass and no function in this directory imports from `convex/server` or `convex/_generated`.

### Phase 2 — Schema, authorization, and the tracking loop *(~2 d)*

1. `convex/schema.ts` exactly as §3. **Nothing else starts until this is deployed** — index changes are drop-and-recreate across two deploys.
2. `convex/owned.ts` + `convex/lib/errors.ts`.
3. `entries.start` / `stop` / `getRunning`, with the idempotency lookup, the atomic stop-the-running behaviour, `.first()` (not `.unique()`), and the clamp-don't-refuse rule.
4. **The spike that gates everything after it:** wire `/today` to `getRunning` with one optimistic `start`, and prove the optimistic insert lands. Confirm whether optimistic updates come from `convex/react`'s `useMutation(...).withOptimisticUpdate` or `@convex-dev/react-query`'s `useConvexMutation`, and standardise on one.

**Tests (`convex-test`):** anonymous callers are rejected on every function; user B cannot read or stop user A's entry; starting while running produces exactly one running entry with a zero-gap handoff; a replayed `clientKey` returns the same `_id` and does not insert; `stop` on an already-stopped entry is a no-op.

**Done when:** you can start and stop a timer from `/today` and it survives a hard reload.

### Phase 3 — The timer bar and the running clock *(~2.5 d)*

The most important surface in the product.

- `useSecond()` — a module-level `useSyncExternalStore` with a **self-correcting `setTimeout` anchored to the next wall-clock second boundary**, not `setInterval`. Elapsed is recomputed from `Date.now()` on every tick; there is no counter, so drift is structurally impossible. A tick that arrives 9 hours late (laptop sleep) still paints the correct number. Re-anchor on `visibilitychange`, `pageshow`, `focus`, and `online`.
- `RunningDuration` is the **only** component subscribing to the clock, so a ticking timer never re-renders the entry list.
- Clock skew from the mutation return (§2.6). If skew is implausible, show an explicit error — never clamp a running clock to zero. *Ambiguity is a defect.*
- Timer bar: title input, project/tag pickers via `@` and `#` inline, billable toggle, play/stop. Idle vs running states differ by **shape and label**, with `--enlarger` as the running signal (Cold Light Rule) — never colour alone.
- Tab title clock at **minute** granularity (per-second title changes get announced by screen readers), with the `tabTitleClock` opt-out.
- Manual mode toggle sharing the same bar.
- **Pending-start replay:** write the `clientKey` to `localStorage` *before* calling `start`; clear on confirmation; on boot, if a pending key exists and `getRunning` is null, replay it. Convex's in-memory mutation buffer does not survive a reload, and a start lost to a discarded tab is otherwise a total, invisible loss of everything the user watched tick. ~40 lines; the general offline queue stays fast-follow.

**Done when:** a timer runs correctly across reload, sleep, a backgrounded tab, and two open tabs.

### Phase 4 — The day list, editing, and the note *(~3 d)*

- `entries.listDay` + `EntryList` / `EntryRow` with roving tabindex.
- Day header: `6h 15m · 4 of 7 noted`.
- **Inline edit in the list** — no modal, no save button, no route change. The common correction is one field; a modal turns a 2 s fix into open-change-save-close, ten times a day.
- `entries.update` wired to `entryTimes()`, with the anchored-field affordance.
- Soft delete + 6 s undo toast, bottom-anchored for thumb reach.
- `discardRunning` as a **separate control** from delete. Killing a mistaken timer and destroying recorded history are different intents with different risk.
- **The note sheet on stop** — compact, note field already focused, read-only header (`Acme redesign · 47m`), `Esc`/Skip dismisses, `⌘Enter` saves. Target ≤15 s.
- **The Hatch Rule for missing notes:** `.hatch-empty` (a `repeating-linear-gradient` plus a dashed border, with a `forced-colors: active` fallback where the dashed border is the carrier) and an `+ add note` slot. One class name, defined once in `src/styles.css`.
- Manual create.

**Done when:** a full day can be recorded, corrected and annotated without touching the mouse.

### Phase 5 — Projects and tags *(~1.5 d)*

- CRUD, archive-not-delete, the 12-swatch palette, `billableByDefault` inheritance.
- `projects.remove` refuses while referenced.
- Pickers reachable via `@` / `#` from inside the title input and independently from the edit row.
- Title autocomplete inheriting **project, tags, billable — never the note**, with Resume inheriting *exactly the same set*. Toggl's two paths differ on tags, and that inconsistency erodes trust in both.

### Phase 6 — The recap *(~3 d)*

The reason the product exists. Build the engine as a pure function first, tested, before any UI.

- `convex/lib/recap.ts` — `assembleRecap(entries, projects, dayFields) → RecapDoc`.
  - Group by **project**, not chronology. A standup answers "which client got what".
  - Blocks ordered by `billableMs` desc → `durationMs` desc → name. This is how admin buckets sort last without the product ever guessing what "admin" means.
  - Bullets within a block by `durationMs` desc → `startedAt` asc.
  - Entries sharing a title emit one bullet per *noted* entry plus **at most one** title-only bullet summing the un-noted ones. **Un-noted time never folds into a noted bullet** — the Hatch Rule exists so missing notes are visible, and the separate line is the pressure.
  - No note, has a title → title-only bullet, verbatim, indistinguishable in the copied text. Never omitted, never flagged *in the artifact* — omitting loses billable time from a document beside an invoice, and annotating advertises the user's hygiene to their client. The pressure stays in the app.
  - No note and no title → `• 1 unlabelled entry (23m)`. Counted, visible, not editorialised.
  - **No duration threshold ever excludes an entry.** Short entries are handled by ordering, not filtering.
  - Cap at 8 content bullets; every block keeps its top bullet; the remainder rolls into `• plus 3 more (35m)`. The panel is **not** capped and shows exactly what the clipboard omits.
  - `Next` / `Blocked` omitted entirely when empty — never print `Blocked: none`. `Blocked` prefills from the last noted entry's shortest clause-bounded suffix containing `?` / `blocked` / `waiting` / `need` — always a contiguous verbatim substring.
- `convex/lib/render.ts` — `renderMrkdwn(doc)` and `renderPlain(doc)`, **both from `RecapDoc`**. Single `*` is the only markup token. `·` as the separator (it doesn't read as a line break when Slack wraps on a 375 px phone). Duration last, in parentheses: the sentence is the content, the number is the receipt. Note text needs explicit newline collapsing and must never have the user's own asterisks stripped.
- Recap panel on `/today`, drill-down from every bullet to its source entry, `Copy` and `Copy as plain`.
- **Keyboard collision to resolve:** the recap panel lives on `/today` alongside the entry list, where `R` already means "resume the focused row" and `E` means "edit". Recap actions get different bindings or a scoped context.

**Target output:**

```
*Thu 6 Aug — 5h 44m across 2 projects*

*Acme redesign · 2h 57m*
• Rebuilt the checkout form validation — card errors now surface inline (1h 46m)
• Reviewed Priya's PR #218; left notes on the state-machine transitions (47m)

*Bellweather API · 2h 47m*
• Traced the intermittent 502s to a connection-pool leak in the webhook worker (2h 05m)

*Next:* ship the pool fix behind a flag once staging is up
*Blocked:* waiting on Dana for the legal wording
```

No greeting, no sign-off, no "Here's my standup for". The user is pasting into a channel that already supplies that context.

**Tests:** the three worked days (clean, messy, fragmented) as golden-output tests; block subtotals always sum to the header; no bullet ever exceeds its block subtotal (the floor property); asterisks and newlines in note text survive both renderers intact.

### Phase 7 — History, filters, and search *(~2 d)*

- `/history` with `usePaginatedQuery`, day headers derived client-side.
- Four filters (date range with presets, project, billable, text). `←`/`→` step periods preserving filters.
- Preset chips: "No project", "No note", "Under a minute".
- **Text search at MVP is a filter over the loaded range, not a search index** (§3). Within a bounded date range this is correct, cheap, and — unlike the search-index design — actually works with a date filter. Promote to a real search index when someone has enough history to need it.
- Totals as a sentence.

### Phase 8 — Settings, responsive, accessibility *(~2 d)*

- Settings: timezone, week start, 12/24 h, decimal hours, runaway threshold, tab-title clock, recap time.
- **Decimal hours needs a stated contract** — 2 dp, floor, applied to totals and export only, never to the recap. An unspecified decimal conversion on an invoice number is the exact bug class the duration parser exists to prevent.
- Responsive: sticky bottom timer bar under 768 px, rows reflow to cards, edit as a two-height slide-up sheet (**not** a route change — the back button must not become ambiguous with cancel). Toggl has publicly declined to fix mobile web; this is a free win on the surface the incumbent abandoned.
- Live region announcing start/stop/discard; focus management on sheet open/close; running state conveyed to screen readers without colour; `prefers-reduced-motion` throughout.
- `?` shortcut overlay. Runaway-entry banner (client-side, from `startedAt`).
- Empty state answering the two questions a new freelancer actually has: how do I get hours out for an invoice, and what happens when I forget to start the timer.

**MVP total: ~18 working days.**

### 5.9 — What actually shipped

All eight phases are implemented and committed. Where the build departs from
the plan above, it is recorded here rather than left as a silent difference.

**Deviations, and why**

| Plan said | Built | Why |
|---|---|---|
| `/history` totals from `usePaginatedQuery` | Pagination for the LIST; `entries.rangeSummary` for the TOTALS | A total derived from loaded pages silently means "of the rows fetched so far". That is the number that ends up understated on an invoice with nothing on screen to reveal it. |
| Text search filters "the loaded range" | With any client-side filter active, the whole period is auto-loaded first | Otherwise a half-loaded month silently searches a prefix of itself and reports a total for it. The date filter bounds the range, so it terminates. |
| Edit as a two-height slide-up sheet on mobile | Inline editing at every width; the note is the only sheet | Inline edit was already built in Phase 4 and works at 375px. A second editing model for one breakpoint is a second thing to maintain and to learn. |
| Roving tabindex on the entry list | Native tab order | Every control on a row is a real focusable element already. Revisit if the list grows long enough that tabbing through it is the complaint. |
| `R` / `E` row shortcuts, and the recap keyboard collision | Not bound | The collision the plan flagged was resolved by not creating it. Click-to-edit and Enter/Escape cover the same ground; `?` documents what exists. |

**Not built, deliberately** — `hourlyRateCents` is in the schema and nothing
reads it (§8.2, unchanged); the trash view and untracked-gap hatching remain
Tier 2, so `DESIGN.md`'s Hatch Rule is still two-thirds implemented.

**Verification status**

- 298 tests across three projects; typecheck and lint clean.
- The pure layers — day boundaries, durations, the recap assembler and both
  renderers, history filters — are covered directly and adversarially.
- Convex functions are covered by `convex-test`, including every authorization
  refusal and cross-user isolation case.
- Components that hold tricky state (the timer bar's draft, the pickers) have
  DOM tests, and each was verified to go red when its defect is reintroduced.
- **Not verified end-to-end in a browser while signed in.** Every authed route
  renders under SSR and redirects correctly when signed out, but no one has
  driven the real app with a real session. That is the first thing to do.

---

## 6. Tier 2 — shortly after MVP

Ordered by value ÷ cost.

| # | Feature | Notes |
|---|---|---|
| 1 | **Persist the pending-mutation queue to IndexedDB** | Generalises Phase 3's narrow start-replay to all mutations. Mark unsynced entries with a visible per-entry indicator |
| 2 | **Untracked gaps in the day list** | `DESIGN.md`'s Hatch Rule covers "gaps, untracked time, and entries missing a note" — MVP implements only the third. A pure function over an already-loaded day |
| 3 | **Trash view (30 day)** | Beats Toggl outright, which gives a 5 s toast and then permanent loss — even though their own API soft-deletes. Needs the purge cron and the one irreversible-action dialog |
| 4 | Duplicate; Split | Split is the manual fix for midnight-spanning and two-clients-in-one-block |
| 5 | Pinned entries on `1`–`9` | `C` + autocomplete already cover most of this |
| 6 | Heartbeat + resume-gap prompt | The honest web substitute for idle detection. **Do not fake OS idle detection** — a hidden tab is not an idle user; switching to your IDE is work |
| 7 | Day-scoped bulk edit | Repair after a messy week is why people abandon trackers |
| 8 | Clients | One table + one optional field on `projects`, **zero** backfill of entries |
| 9 | CSV export | Accountants demand it. Be clear-eyed: multi-line prose with commas is mangled by Excel |
| 10 | Rounding (display/export only) | Never mutate stored durations. Per-entry vs per-subtotal rounding produce materially different totals from identical data — twelve 4-minute entries rounded to 15 each is 3 h; the 48-minute total rounded is 48 m. The scope must be explicit and shown |
| 11 | Recap nudge at `recapMinuteLocal` | Convex cron every 5 min against a `nextRecapAt` index — hourly cannot serve half-hour-offset timezones |
| 12 | Collapse identical entries | **Off by default** — with notes attached, near-identical rows are no longer redundant, and collapsing must never hide a note |
| 13 | Real search indexes | When history justifies the write amplification |
| 14 | Recap snapshots | The first time someone asks "what did I send?" |

---

## 7. Tier 3 — longer term

- **Document export (print/PDF)** — the highest-value non-MVP deliverable and the place to diverge hardest. Toggl's PDF is a table because Toggl's payload is numbers. Trace's must be a *document*: dated sections, project headings, notes as flowing paragraphs, hours as a quiet right-aligned tabular annotation. It should read like a consultant's status memo.
- **Weekly and per-client recaps** — a change of grouping key, not a new document type.
- **Per-bullet LLM "tighten this"** — opt-in, user-invoked, input is one existing note, structurally unable to see an un-noted entry (§2.2).
- Calendar/day view with drag-create — the best gap-finder there is, but pointer-first and a full second layout with overlap/zoom/snap logic. If built: a gap-finder that prompts for a *note*, not a scheduling grid.
- Toggl import (the one place the negative-duration adapter is allowed to exist).
- Account deletion + full data export, with a bounded-transaction cascade strategy.
- Copy start link, with permalink→day resolution.

**Ruled out, not deferred:** Pomodoro, OS idle detection, activity timeline, autotracker. Two need native access, and Toggl shipped Pomodoro to five clients and deliberately not the web app.

---

## 8. Open items

Three things this plan decides but that are worth a second look before Phase 2 deploys the schema, since they are the expensive ones to change:

1. **Derived vs stored `dayKey`** (§2.1). Decided: derived. The tradeoff is that changing your timezone re-buckets history — reversible, but visible.
2. **`hourlyRateCents` at MVP.** It is in the schema but nothing reads it until rates ship in Tier 2. Keeping it costs nothing; dropping it means a schema change later.
3. **`recapDays` at MVP.** Two optional strings per day. Justified only because `Next`/`Blocked` are part of the recap's value proposition, not because the recap body is stored — it is not.

Two things deliberately left out of MVP that the design system references:

- Untracked gaps (Tier 2 #2) — `DESIGN.md`'s Hatch Rule is only two-thirds implemented at MVP.
- The trash view (Tier 2 #3) — the `deletedAt` column ships now, the view does not.
