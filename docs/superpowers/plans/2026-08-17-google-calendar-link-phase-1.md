# Google Calendar link — Phase 1 (read) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** [2026-08-17-google-calendar-link-design.md](../specs/2026-08-17-google-calendar-link-design.md)

**Goal:** Connect a Google account, mirror its calendar events into Convex on a
15-minute cron, and draw them on the timer's calendar grid as unfilled ghost
blocks with a read-only detail popover.

**Architecture:** A server cron pulls events with `events.list` + `syncToken`
into a bounded mirror table; the grid reads that mirror through an ordinary
reactive Convex query, so no browser ever talks to Google. Nothing in this phase
creates or modifies a `timeEntries` row — the entire write path (the per-meeting
checkbox, the timer switch, backfill, undo) is Phase 2 and gets its own plan.

**Tech Stack:** Convex `^1.43`, Better Auth `~1.6.15` via
`@convex-dev/better-auth`, TanStack Router/Start, FullCalendar `^7`, React 19,
Tailwind 4, Vitest + `convex-test` + `@edge-runtime/vm`.

## Global Constraints

- **Read-only.** No code in this phase may write to Google, and no code may
  create, patch, or delete a `timeEntries` row.
- **Absolute instants only.** Event times are stored as `number` epoch
  milliseconds. Never store or pass a wall-clock string. Google returns RFC3339
  with an offset, so `Date.parse` is lossless.
- **`userId` leads every user-facing index**, matching `convex/schema.ts`. The
  two internal cron indexes that deviate are named and justified in Task 1.
- **Never read the wall clock inside a query.** `Date.now()` is fine in
  mutations and actions. Queries take `nowMs`-style values as arguments.
- **Public functions never accept a `userId` argument.** The house pattern is a
  `*Impl(ctx, userId, args)` helper, a public wrapper that calls
  `requireUserId(ctx)`, and an `internal*` wrapper taking an explicit `userId`
  for tests. See `convex/projects.ts:97-103`.
- **Errors go through `traceError(code, message)`** from `convex/errors.ts`, with
  the code declared in `convex/lib/codes.ts`.
- **`convex/lib` is aliased `@shared` and compiled into the client bundle.**
  Nothing that is server-only may live there.
- **Return validators are spread from the schema's field consts** via
  `convex/lib/docs.ts`. Never hand-copy a document shape.
- **Database call style matches the existing codebase**: `ctx.db.get(id)`,
  `ctx.db.patch(id, {...})`, `ctx.db.insert("table", {...})`. The generated
  guidelines show a newer table-name-first form; do **not** introduce it here.
- **Tailwind utilities only.** Never hand-write a class in `styles.css`.
- **No new colour tokens.** A meeting block takes no fill, a soft border, and
  muted text. `enlarger` is reserved for a running timer (the Cold Light Rule)
  and hue is reserved for money (the Two Temperatures Rule).
- **Commands:** `npx vitest run <path>` for one file, `npm run typecheck` for
  both tsconfigs, `npm run lint`.

---

## File Structure

**New — server**

| File | Responsibility |
| --- | --- |
| `convex/googleEvents.ts` | Pure: Google JSON → mirror row, plus predicates. Server-only, at the convex root and NOT under `convex/lib`, for the reason `schema.ts` gives about `entryTags.ts` — `convex/lib` is compiled into the browser bundle and none of this is needed there |
| `convex/googleEvents.test.ts` | Fixture tests for the mapper and predicates |
| `convex/googleApi.ts` | The HTTP layer. Takes an injected `fetch` so tests never touch the network |
| `convex/googleApi.test.ts` | 410/401/429 handling, pagination, token plumbing |
| `convex/google.ts` | Queries, mutations, and the sync action |
| `convex/google.test.ts` | Authorization, cross-user isolation, sync page application, prune |
| `convex/crons.ts` | `googleSync` every 15 minutes |

**New — client**

| File | Responsibility |
| --- | --- |
| `src/lib/calendar-meetings.ts` | Pure: mirror rows → FullCalendar `EventInput`, and the ghost-suppression rule |
| `src/lib/calendar-meetings.test.ts` | Tests for the above |
| `src/components/calendar/calendar-meeting-popover.tsx` | The read-only detail popover |
| `src/components/settings/google-calendar-section.tsx` | Connect / disconnect / per-calendar Show + project |

**Modified**

| File | Change |
| --- | --- |
| `convex/schema.ts` | Four new tables and their field consts. **No change to `timeEntries`** |
| `convex/lib/docs.ts` | `returns` validators for the new tables |
| `convex/lib/codes.ts` | `GOOGLE_NOT_CONNECTED`, `GOOGLE_REAUTH_REQUIRED` |
| `convex/auth.ts` | The Google social provider |
| `src/components/calendar/calendar-panel.tsx` | `meetings` prop, meeting class list, `eventOrder`, popover routing |
| `src/routes/_authed/timer.tsx` | The meetings query, passed down |
| `src/routes/_authed/settings.tsx` | Mount the Google Calendar section |
| `.env.example` | The two Google variables, documented as deployment-set |

### Two refinements to the spec, made here

Both are corrections the spec's own text implies. They are called out so a
reviewer does not read them as drift.

1. **A fourth table, `googleConnections`.** The spec's failure-modes table says
   a revoked token must "flag the connection as needing re-consent" and the
   Settings block must show a banner. That flag needs a home, and it is also the
   exact list the cron iterates and where the once-a-day calendar-list refresh
   timestamp lives.
2. **A cancelled event is deleted from the mirror, not stored as ineligible.**
   Google's incremental sync reports a deleted or cancelled event as
   `{ id, status: "cancelled" }` with no start or end at all — it is a
   tombstone, not an event. Storing it would leave a ghost on the grid for a
   meeting that is not happening, and it has no times to store anyway. So the
   mapper returns a delete instruction for it and `status` in the mirror only
   ever holds `"confirmed"` or `"tentative"`.

---

## Task 1: The four tables and their validators

**Files:**
- Modify: `convex/schema.ts`
- Modify: `convex/lib/docs.ts`
- Modify: `convex/lib/codes.ts`
- Test: `convex/google.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: tables `googleConnections`, `googleCalendars`, `googleEvents`,
  `googleEventTracking`; field consts `googleConnectionFields`,
  `googleCalendarFields`, `googleEventFields`, `googleEventTrackingFields`;
  validators `googleCalendarDoc`, `googleEventDoc`, `googleEventTrackingDoc`,
  `googleConnectionDoc`; constants `MAX_ATTENDEES`, `MAX_DESCRIPTION_LENGTH`;
  error codes `GOOGLE_NOT_CONNECTED`, `GOOGLE_REAUTH_REQUIRED`.

- [ ] **Step 1: Write the failing test**

Create `convex/google.test.ts`:

```ts
/// <reference types="vite/client" />
// The Google Calendar mirror.
//
// The tables are tested before anything writes to them because two of their
// shapes are load-bearing and silent when wrong: `googleEvents` holds ONLY
// Google's facts and is replaced wholesale by every sync, while
// `googleEventTracking` holds the user's tick and is never pruned. A field on
// the wrong side of that line is lost on the next poll, with no error anywhere.
import { convexTest } from "convex-test"
import { describe, expect, it } from "vitest"
import schema from "./schema"
import { internal } from "./_generated/api"

const modules = import.meta.glob("./**/*.*s")
const setup = () => convexTest(schema, modules)

const ALICE = "user_alice"

describe("the mirror tables", () => {
  it("round-trips a full event row", async () => {
    const t = setup()
    await t.run(async (ctx) => {
      await ctx.db.insert("googleEvents", {
        userId: ALICE,
        calendarId: "primary",
        eventId: "evt_1",
        title: "Standup",
        startedAt: 1_700_000_000_000,
        endedAt: 1_700_000_900_000,
        isAllDay: false,
        status: "confirmed",
        myResponse: "accepted",
        attendees: [{ email: "a@example.com", response: "accepted" }],
        attendeeCount: 1,
        googleUpdatedAt: 1_700_000_000_000,
        updatedAt: 1_700_000_000_000,
      })
    })

    const rows = await t.query(internal.google.allEventsForTest, {
      userId: ALICE,
    })
    expect(rows).toHaveLength(1)
    expect(rows[0].title).toBe("Standup")
    expect(rows[0].startedAt).toBe(1_700_000_000_000)
  })

  it("keeps a tracking row independent of the event row", async () => {
    const t = setup()
    await t.run(async (ctx) => {
      await ctx.db.insert("googleEventTracking", {
        userId: ALICE,
        calendarId: "primary",
        eventId: "evt_1",
        trackOnStart: true,
        entryId: null,
        interruptedEntryId: null,
        updatedAt: 1_700_000_000_000,
      })
    })

    const rows = await t.query(internal.google.allTrackingForTest, {
      userId: ALICE,
    })
    expect(rows).toEqual([
      expect.objectContaining({ eventId: "evt_1", trackOnStart: true }),
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run convex/google.test.ts`
Expected: FAIL — the tables do not exist and `internal.google` has no
`allEventsForTest`.

- [ ] **Step 3: Add the field consts and tables**

In `convex/schema.ts`, after `entryTagFields` and before `export default
defineSchema({`:

```ts
/**
 * The Google Calendar mirror, and the line down the middle of it.
 *
 * `googleEvents` holds ONLY Google's facts. Every sync is free to replace a row
 * without reading it first, and the prune is free to delete one, because
 * nothing the user did is stored here — so nothing the user did can be lost by
 * either. `googleEventTracking` beside it holds OUR facts about the same event
 * and is never pruned.
 *
 * Two writers with different rights is the whole argument. Put the tick on the
 * mirror row and every upsert has to be field-selective forever; the day
 * someone writes a whole-row `replace`, every user's ticks disappear with no
 * error. It is the same case `entryTags` makes for existing beside `tagIds`
 * rather than replacing it — derived state and user-owned state have different
 * lifetimes.
 */

/** One row per user who has linked Google. Where the re-consent flag lives, and
 *  the list the cron iterates. */
export const googleConnectionFields = {
  userId: v.string(),
  /** "reauth" means Google refused the refresh token. Sync STOPS for this user
   *  until they consent again — retrying a revoked grant every 15 minutes
   *  forever is how a quiet failure becomes an expensive one. */
  status: v.union(v.literal("ok"), v.literal("reauth")),
  /** The calendar LIST is refreshed at most once a day; events are polled every
   *  15 minutes. Held here so the interval is a stored fact rather than a
   *  second cron nobody can see the schedule of. */
  calendarsRefreshedAt: v.union(v.number(), v.null()),
  lastSyncedAt: v.union(v.number(), v.null()),
  lastErrorAt: v.union(v.number(), v.null()),
  lastError: v.optional(v.string()),
  updatedAt: v.number(),
}

export const googleCalendarFields = {
  userId: v.string(),
  /** Google's calendar id — "primary", or an address. Not a `v.id()`: it names
   *  a document in Google's namespace, the same way `userId` names one in Better
   *  Auth's. */
  googleId: v.string(),
  summary: v.string(),
  /** Whether this calendar is drawn AND fetched. A calendar nothing may draw is
   *  not mirrored: there is no point paying for rows nobody can see. It is also
   *  what makes hiding a calendar suspend its pending ticks in Phase 2 —
   *  `googleTick` reads the mirror, and a hidden calendar has nothing in it. */
  show: v.boolean(),
  /** What an entry made from this calendar's meetings is classified as. Optional
   *  and stays optional: an unclassified entry is already a normal state. */
  defaultProjectId: v.optional(v.id("projects")),
  /** What makes polling cheap — Google returns only what changed since this was
   *  issued. `null` means the next fetch is a full window fetch, which is both
   *  the first-run state and the recovery from a 410. */
  syncToken: v.union(v.string(), v.null()),
  lastSyncedAt: v.union(v.number(), v.null()),
  updatedAt: v.number(),
}

/** The most attendees stored on one event row.
 *
 *  A bound, not a preference. Convex caps a document at 1MB and the schema
 *  guidelines warn against unbounded arrays in a document; a company-wide invite
 *  has thousands of attendees and would both blow the cap and rewrite the whole
 *  row on every poll. `attendeeCount` beside the array is what lets the popover
 *  say "+ 40 more" honestly rather than implying the list is complete. */
export const MAX_ATTENDEES = 50

/** Google descriptions carry pasted agendas and mail footers and are routinely
 *  tens of kilobytes. Truncated on write for the same reason as the attendee
 *  cap, and truncated ONCE on the way in rather than at every render. */
export const MAX_DESCRIPTION_LENGTH = 4_000

export const googleEventFields = {
  userId: v.string(),
  /** The `googleCalendars.googleId` this came from. */
  calendarId: v.string(),
  /** Google's event id, unique per calendar. A recurring meeting arrives as
   *  instances under `singleEvents: true`, each with its own id, which is what
   *  keeps a daily standup from collapsing into one row. */
  eventId: v.string(),
  /** Google's `summary`. "" is legal and normal; the grid falls back to
   *  "Untitled", the same fallback `titleOf` already applies to an entry. */
  title: v.string(),
  /** ABSOLUTE INSTANTS. Google returns RFC3339 with an offset, so `Date.parse`
   *  is lossless. Never a wall-clock string — the failure `calendar-events.ts`
   *  documents for entries applies here identically, and an event drawn an hour
   *  off its real start is the defect this feature can least afford. */
  startedAt: v.number(),
  endedAt: v.number(),
  /** True when Google returned `date` rather than `dateTime`. Such an event has
   *  no clock, and the grid has no all-day rail (`allDaySlot={false}`), so it is
   *  stored and never drawn. */
  isAllDay: v.boolean(),
  /** "confirmed" | "tentative". NEVER "cancelled": a cancelled event arrives
   *  from incremental sync as a tombstone with no times at all, and is deleted
   *  from the mirror rather than stored — see convex/googleEvents.ts. */
  status: v.string(),
  /** The signed-in user's RSVP, read off the attendee Google marks `self: true`,
   *  or "none" when there is no such attendee.
   *
   *  STORED AND DISPLAYED, NEVER BRANCHED ON. It is written down because the
   *  field looks exactly like a gate and an earlier draft of this feature used
   *  it as one. In Phase 2 the checkbox is the only thing that decides whether a
   *  meeting is tracked; an RSVP heuristic here would be the product guessing on
   *  the user's behalf. */
  myResponse: v.string(),
  location: v.optional(v.string()),
  /** Truncated to MAX_DESCRIPTION_LENGTH on write. */
  description: v.optional(v.string()),
  conferenceUrl: v.optional(v.string()),
  htmlLink: v.optional(v.string()),
  organizer: v.optional(
    v.object({ name: v.optional(v.string()), email: v.optional(v.string()) })
  ),
  /** Capped at MAX_ATTENDEES. */
  attendees: v.array(
    v.object({
      name: v.optional(v.string()),
      email: v.optional(v.string()),
      response: v.string(),
    })
  ),
  /** How many Google actually reported, which may exceed the array's length. */
  attendeeCount: v.number(),
  /** Google's own `updated`, so a change is detectable without diffing fields. */
  googleUpdatedAt: v.number(),
  updatedAt: v.number(),
}

export const googleEventTrackingFields = {
  userId: v.string(),
  calendarId: v.string(),
  eventId: v.string(),
  /** The checkbox. Phase 2 owns the writer; the READER ships in Phase 1,
   *  because it is what suppresses a ghost whose entry already exists. */
  trackOnStart: v.boolean(),
  /** Which entry this meeting produced. Also what suppresses the ghost: the grid
   *  never draws an hour twice. */
  entryId: v.union(v.id("timeEntries"), v.null()),
  /** Which entry the switch closed, so undo can reopen it. */
  interruptedEntryId: v.union(v.id("timeEntries"), v.null()),
  updatedAt: v.number(),
}
```

Then inside `defineSchema({ ... })`, after `entryTags`:

```ts
  googleConnections: defineTable(googleConnectionFields)
    .index("by_user", ["userId"])
    /*
     * NOT led by userId, and the exception is deliberate.
     *
     * Every other index in this file starts with `userId` because ownership must
     * be a key prefix rather than a filter someone can forget. This one is read
     * by exactly one caller — the sync cron, which is an internalAction
     * enumerating work ACROSS users and has no user to scope to. It is never
     * reachable from a user-facing query, and `by_user` above is what those use.
     */
    .index("by_status", ["status"]),

  googleCalendars: defineTable(googleCalendarFields)
    .index("by_user_googleId", ["userId", "googleId"])
    .index("by_user_show", ["userId", "show"]),

  googleEvents: defineTable(googleEventFields)
    // The upsert's key.
    .index("by_user_calendar_event", ["userId", "calendarId", "eventId"])
    // The grid's range read, and the prune's scan.
    .index("by_user_started", ["userId", "startedAt"]),

  googleEventTracking: defineTable(googleEventTrackingFields).index(
    "by_user_calendar_event",
    ["userId", "calendarId", "eventId"]
  ),
```

- [ ] **Step 4: Add the return validators**

In `convex/lib/docs.ts`, extend the import from `"../schema"` with
`googleCalendarFields`, `googleConnectionFields`, `googleEventFields`,
`googleEventTrackingFields`, then append:

```ts
export const googleConnectionDoc = v.object({
  _id: v.id("googleConnections"),
  _creationTime: v.number(),
  ...googleConnectionFields,
})

export const googleCalendarDoc = v.object({
  _id: v.id("googleCalendars"),
  _creationTime: v.number(),
  ...googleCalendarFields,
})

export const googleEventDoc = v.object({
  _id: v.id("googleEvents"),
  _creationTime: v.number(),
  ...googleEventFields,
})

export const googleEventTrackingDoc = v.object({
  _id: v.id("googleEventTracking"),
  _creationTime: v.number(),
  ...googleEventTrackingFields,
})
```

- [ ] **Step 5: Add the two error codes**

In `convex/lib/codes.ts`, add to the `TraceErrorCode` union before the closing:

```ts
  /** No Google account is linked, so there is nothing to sync or list. Its own
   *  code rather than NOT_FOUND: the caller's recovery is "connect Google",
   *  which is a button, not a missing row. */
  | "GOOGLE_NOT_CONNECTED"
  /** Google refused the stored refresh token — the user revoked access, or the
   *  grant expired. Distinct from GOOGLE_NOT_CONNECTED because the account IS
   *  linked and the recovery is to consent again rather than to connect; a
   *  caller branching on the code would otherwise offer to link an account that
   *  is already there. */
  | "GOOGLE_REAUTH_REQUIRED"
```

- [ ] **Step 6: Add the two test-only internal queries**

Create `convex/google.ts`:

```ts
import { v } from "convex/values"
import { internalQuery } from "./_generated/server"
import { googleEventDoc, googleEventTrackingDoc } from "./lib/docs"

/*
 * Google Calendar: the read side.
 *
 * Nothing in this file writes a `timeEntries` row. That is Phase 2, and keeping
 * it out is what makes this phase unable to put a wrong number on an invoice.
 */

/** Test-only. Named `*ForTest` so the audit "what can reach my data" reads
 *  honestly: this is internal, so it is unreachable from a client. */
export const allEventsForTest = internalQuery({
  args: { userId: v.string() },
  returns: v.array(googleEventDoc),
  handler: async (ctx, args) =>
    await ctx.db
      .query("googleEvents")
      .withIndex("by_user_started", (q) => q.eq("userId", args.userId))
      .take(100),
})

export const allTrackingForTest = internalQuery({
  args: { userId: v.string() },
  returns: v.array(googleEventTrackingDoc),
  handler: async (ctx, args) =>
    await ctx.db
      .query("googleEventTracking")
      .withIndex("by_user_calendar_event", (q) => q.eq("userId", args.userId))
      .take(100),
})
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run convex/google.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 8: Typecheck**

Run: `npm run typecheck`
Expected: no errors from either tsconfig.

- [ ] **Step 9: Commit**

```bash
git add convex/schema.ts convex/lib/docs.ts convex/lib/codes.ts convex/google.ts convex/google.test.ts
git commit -m "feat(google): mirror tables for the calendar link"
```

---

## Task 2: The pure mapper and predicates

**Files:**
- Create: `convex/googleEvents.ts`
- Test: `convex/googleEvents.test.ts`

**Interfaces:**
- Consumes: `MAX_ATTENDEES`, `MAX_DESCRIPTION_LENGTH` from `./schema`.
- Produces:
  - `type GoogleEventRow` — every `googleEventFields` key except `userId` and
    `updatedAt`.
  - `type GoogleSyncItem = { kind: "delete"; eventId: string } | { kind: "upsert"; row: GoogleEventRow }`
  - `mapGoogleEvent(raw: unknown, calendarId: string): GoogleSyncItem | null`
  - `isDrawable(row: { isAllDay: boolean }): boolean`

**Not here:** an `overlaps` predicate. Phase 2's backfill is its only caller, and
a function written before anything reads it is a claim the code does not keep —
the objection this codebase raises against `billable` on a calendar event. It
lands with the code that needs it.

- [ ] **Step 1: Write the failing test**

Create `convex/googleEvents.test.ts`:

```ts
// The Google → mirror mapping.
//
// A mapping is cheaper to pin down as a function than through a sync, and this
// one has four cases that are invisible to a typecheck and expensive in
// production: a tombstone with no times, an all-day event with no clock, an
// offset that is not the user's zone, and an attendee list long enough to blow
// the document limit.
import { describe, expect, it } from "vitest"
import { isDrawable, mapGoogleEvent } from "./googleEvents"
import { MAX_ATTENDEES } from "./schema"

const CAL = "primary"

/** A timed event, in the shape Google actually returns. */
function raw(over: Record<string, unknown> = {}) {
  return {
    id: "evt_1",
    status: "confirmed",
    summary: "Standup",
    updated: "2026-08-17T09:00:00.000Z",
    start: { dateTime: "2026-08-17T10:00:00+08:00" },
    end: { dateTime: "2026-08-17T10:15:00+08:00" },
    ...over,
  }
}

describe("mapGoogleEvent", () => {
  it("maps a timed event to absolute instants", () => {
    const item = mapGoogleEvent(raw(), CAL)
    expect(item?.kind).toBe("upsert")
    if (item?.kind !== "upsert") throw new Error("expected upsert")
    // 10:00 at +08:00 is 02:00 UTC. The offset is honoured, not dropped.
    expect(item.row.startedAt).toBe(Date.parse("2026-08-17T02:00:00.000Z"))
    expect(item.row.endedAt).toBe(Date.parse("2026-08-17T02:15:00.000Z"))
    expect(item.row.isAllDay).toBe(false)
    expect(item.row.title).toBe("Standup")
    expect(item.row.calendarId).toBe(CAL)
  })

  it("treats a cancelled event as a deletion", () => {
    // This is the shape incremental sync sends for a deleted event: an id, a
    // status, and nothing else. There are no times to store.
    const item = mapGoogleEvent({ id: "evt_1", status: "cancelled" }, CAL)
    expect(item).toEqual({ kind: "delete", eventId: "evt_1" })
  })

  it("marks an all-day event and gives it a usable span", () => {
    const item = mapGoogleEvent(
      raw({ start: { date: "2026-08-17" }, end: { date: "2026-08-18" } }),
      CAL
    )
    if (item?.kind !== "upsert") throw new Error("expected upsert")
    expect(item.row.isAllDay).toBe(true)
    expect(item.row.endedAt).toBeGreaterThan(item.row.startedAt)
  })

  it("keeps a missing summary as an empty title rather than inventing one", () => {
    const item = mapGoogleEvent(raw({ summary: undefined }), CAL)
    if (item?.kind !== "upsert") throw new Error("expected upsert")
    expect(item.row.title).toBe("")
  })

  it("reads the RSVP off the self attendee", () => {
    const item = mapGoogleEvent(
      raw({
        attendees: [
          { email: "other@example.com", responseStatus: "accepted" },
          { email: "me@example.com", self: true, responseStatus: "declined" },
        ],
      }),
      CAL
    )
    if (item?.kind !== "upsert") throw new Error("expected upsert")
    expect(item.row.myResponse).toBe("declined")
    expect(item.row.attendeeCount).toBe(2)
  })

  it("reports 'none' when there is no self attendee", () => {
    const item = mapGoogleEvent(raw({ attendees: [] }), CAL)
    if (item?.kind !== "upsert") throw new Error("expected upsert")
    expect(item.row.myResponse).toBe("none")
  })

  it("caps the attendee array but reports the true count", () => {
    const attendees = Array.from({ length: MAX_ATTENDEES + 12 }, (_, i) => ({
      email: `a${i}@example.com`,
      responseStatus: "needsAction",
    }))
    const item = mapGoogleEvent(raw({ attendees }), CAL)
    if (item?.kind !== "upsert") throw new Error("expected upsert")
    expect(item.row.attendees).toHaveLength(MAX_ATTENDEES)
    expect(item.row.attendeeCount).toBe(MAX_ATTENDEES + 12)
  })

  it("takes the conference link from Google's entry points", () => {
    const item = mapGoogleEvent(
      raw({
        conferenceData: {
          entryPoints: [
            { entryPointType: "phone", uri: "tel:+1234" },
            { entryPointType: "video", uri: "https://meet.google.com/abc-defg" },
          ],
        },
      }),
      CAL
    )
    if (item?.kind !== "upsert") throw new Error("expected upsert")
    expect(item.row.conferenceUrl).toBe("https://meet.google.com/abc-defg")
  })

  it("returns null for an event with no id", () => {
    expect(mapGoogleEvent({ status: "confirmed" }, CAL)).toBeNull()
  })

  it("returns null for a timed event with an unparseable start", () => {
    expect(mapGoogleEvent(raw({ start: { dateTime: "nonsense" } }), CAL)).toBeNull()
  })
})

describe("isDrawable", () => {
  it("excludes an all-day event", () => {
    expect(isDrawable({ isAllDay: true })).toBe(false)
    expect(isDrawable({ isAllDay: false })).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run convex/googleEvents.test.ts`
Expected: FAIL — cannot resolve `./googleEvents`.

- [ ] **Step 3: Write the implementation**

Create `convex/googleEvents.ts`:

```ts
import { MAX_ATTENDEES, MAX_DESCRIPTION_LENGTH } from "./schema"

/*
 * Google Calendar JSON, mapped to the mirror.
 *
 * PURE, and at the convex root rather than under convex/lib — that directory is
 * aliased `@shared` and compiled into the client bundle, and none of this is
 * needed in a browser. The same placement `entryTags.ts` has, for the same
 * reason `schema.ts` gives for it.
 *
 * Everything here treats its input as `unknown` and narrows. The Calendar API is
 * a network boundary: a field that is documented as present is still absent in
 * practice on some rows, and a mapper that trusts the shape crashes the cron for
 * every user at once.
 */

export type GoogleAttendee = {
  name?: string
  email?: string
  response: string
}

export type GoogleEventRow = {
  calendarId: string
  eventId: string
  title: string
  startedAt: number
  endedAt: number
  isAllDay: boolean
  status: string
  myResponse: string
  location?: string
  description?: string
  conferenceUrl?: string
  htmlLink?: string
  organizer?: { name?: string; email?: string }
  attendees: Array<GoogleAttendee>
  attendeeCount: number
  googleUpdatedAt: number
}

/**
 * What one item in a sync page means.
 *
 * A DELETE is not an error case, it is half the protocol. Incremental sync
 * reports a removed or cancelled event as `{ id, status: "cancelled" }` with no
 * `start` and no `end` — a tombstone. Storing it would leave a block on the grid
 * for a meeting that is not happening, and there are no times to store anyway.
 */
export type GoogleSyncItem =
  | { kind: "delete"; eventId: string }
  | { kind: "upsert"; row: GoogleEventRow }

function str(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined
}

function obj(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined
}

/**
 * One end of an event, as an instant.
 *
 * Google sends either `dateTime` (RFC3339 WITH an offset — absolute, so
 * `Date.parse` is lossless) or `date` (a bare calendar day, for an all-day
 * event). A bare day has no zone and therefore no single instant; it is parsed
 * as UTC midnight and the row is flagged `isAllDay`, which is what stops it
 * being drawn. Nothing downstream may treat an all-day span as a working window.
 */
function instantOf(
  end: Record<string, unknown> | undefined
): { ms: number; allDay: boolean } | null {
  if (end === undefined) return null
  const dateTime = str(end.dateTime)
  if (dateTime !== undefined) {
    const ms = Date.parse(dateTime)
    return Number.isFinite(ms) ? { ms, allDay: false } : null
  }
  const date = str(end.date)
  if (date !== undefined) {
    const ms = Date.parse(`${date}T00:00:00.000Z`)
    return Number.isFinite(ms) ? { ms, allDay: true } : null
  }
  return null
}

/** The video link, if Google gave one. `entryPoints` also carries phone numbers
 *  and SIP addresses; only the video one is a thing to click from here. */
function conferenceUrlOf(raw: Record<string, unknown>): string | undefined {
  const data = obj(raw.conferenceData)
  const points = data === undefined ? undefined : data.entryPoints
  if (!Array.isArray(points)) return str(obj(raw)?.hangoutLink)
  for (const point of points) {
    const entry = obj(point)
    if (entry !== undefined && entry.entryPointType === "video") {
      const uri = str(entry.uri)
      if (uri !== undefined) return uri
    }
  }
  return str(raw.hangoutLink)
}

export function mapGoogleEvent(
  raw: unknown,
  calendarId: string
): GoogleSyncItem | null {
  const event = obj(raw)
  if (event === undefined) return null

  const eventId = str(event.id)
  if (eventId === undefined) return null

  if (event.status === "cancelled") return { kind: "delete", eventId }

  const start = instantOf(obj(event.start))
  const end = instantOf(obj(event.end))
  if (start === null || end === null) return null

  const rawAttendees = Array.isArray(event.attendees) ? event.attendees : []
  const attendees: Array<GoogleAttendee> = []
  let myResponse = "none"
  for (const candidate of rawAttendees) {
    const attendee = obj(candidate)
    if (attendee === undefined) continue
    // The RSVP is read off EVERY attendee, not only the capped slice: the self
    // attendee can sit past MAX_ATTENDEES on a large invite, and losing it there
    // would silently report "none" on exactly the meetings with most people in
    // them.
    if (attendee.self === true) {
      myResponse = str(attendee.responseStatus) ?? "needsAction"
    }
    if (attendees.length < MAX_ATTENDEES) {
      attendees.push({
        name: str(attendee.displayName),
        email: str(attendee.email),
        response: str(attendee.responseStatus) ?? "needsAction",
      })
    }
  }

  const organizerRaw = obj(event.organizer)
  const description = str(event.description)
  const updated = Date.parse(str(event.updated) ?? "")

  return {
    kind: "upsert",
    row: {
      calendarId,
      eventId,
      // "" is legal and normal. A nameless event must still be drawable, and the
      // grid's own `titleOf` fallback is what names it.
      title: str(event.summary) ?? "",
      startedAt: start.ms,
      // An all-day end is Google's EXCLUSIVE next-day midnight, which is already
      // the span we want. A timed end that is not after its start would make a
      // zero-height block; one minute is the same floor `calendarEvents` applies
      // to an entry, for the same reason.
      endedAt: Math.max(end.ms, start.ms + 60_000),
      isAllDay: start.allDay || end.allDay,
      status: str(event.status) ?? "confirmed",
      myResponse,
      location: str(event.location),
      description:
        description === undefined
          ? undefined
          : description.slice(0, MAX_DESCRIPTION_LENGTH),
      conferenceUrl: conferenceUrlOf(event),
      htmlLink: str(event.htmlLink),
      organizer:
        organizerRaw === undefined
          ? undefined
          : {
              name: str(organizerRaw.displayName),
              email: str(organizerRaw.email),
            },
      attendees,
      attendeeCount: rawAttendees.length,
      googleUpdatedAt: Number.isFinite(updated) ? updated : start.ms,
    },
  }
}

/** Whether a mirrored event may be drawn on the time grid at all.
 *
 *  All-day events are the whole rule: they have no clock, so they have no
 *  defensible span — and `allDaySlot={false}` means the grid has no rail to put
 *  them on anyway. */
export function isDrawable(row: { isAllDay: boolean }): boolean {
  return !row.isAllDay
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run convex/googleEvents.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add convex/googleEvents.ts convex/googleEvents.test.ts
git commit -m "feat(google): pure event mapper and span predicates"
```

---

## Task 3: The Google HTTP layer

**Files:**
- Create: `convex/googleApi.ts`
- Test: `convex/googleApi.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `class GoogleAuthError extends Error` — the grant is dead; stop syncing.
  - `class GoogleTransientError extends Error` — back off and try next run.
  - `type EventsPage = { items: Array<unknown>; nextPageToken: string | null; nextSyncToken: string | null; gone: boolean }`
  - `fetchCalendarList(fetchImpl: typeof fetch, accessToken: string): Promise<Array<{ googleId: string; summary: string }>>`
  - `fetchEventsPage(fetchImpl: typeof fetch, accessToken: string, args: { calendarId: string; syncToken: string | null; timeMinMs: number; timeMaxMs: number; pageToken: string | null }): Promise<EventsPage>`

- [ ] **Step 1: Write the failing test**

Create `convex/googleApi.test.ts`:

```ts
// The Calendar API boundary.
//
// Every branch here is a response this code will actually receive and must not
// treat as a crash: a 410 on a stale syncToken is ROUTINE, a 401 means the grant
// is gone and retrying it forever is the expensive failure, and a 429 must leave
// the mirror stale rather than empty. `fetch` is injected so none of that needs
// a network.
import { describe, expect, it, vi } from "vitest"
import {
  GoogleAuthError,
  GoogleTransientError,
  fetchCalendarList,
  fetchEventsPage,
} from "./googleApi"

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

const PAGE_ARGS = {
  calendarId: "primary",
  syncToken: null,
  timeMinMs: Date.parse("2026-06-01T00:00:00.000Z"),
  timeMaxMs: Date.parse("2026-12-01T00:00:00.000Z"),
  pageToken: null,
}

describe("fetchEventsPage", () => {
  it("sends the token, the window, and singleEvents on a full fetch", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ items: [], nextSyncToken: "tok_1" })
    )
    const page = await fetchEventsPage(
      fetchImpl as unknown as typeof fetch,
      "at_abc",
      PAGE_ARGS
    )

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toContain("/calendars/primary/events")
    expect(url).toContain("singleEvents=true")
    expect(url).toContain("timeMin=2026-06-01T00%3A00%3A00.000Z")
    expect(url).toContain("timeMax=2026-12-01T00%3A00%3A00.000Z")
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer at_abc"
    )
    expect(page.nextSyncToken).toBe("tok_1")
    expect(page.gone).toBe(false)
  })

  it("sends syncToken instead of the window when it has one", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ items: [] }))
    await fetchEventsPage(fetchImpl as unknown as typeof fetch, "at_abc", {
      ...PAGE_ARGS,
      syncToken: "tok_1",
    })
    const [url] = fetchImpl.mock.calls[0] as [string]
    expect(url).toContain("syncToken=tok_1")
    // Google rejects the combination outright, so this is not a preference.
    expect(url).not.toContain("timeMin")
  })

  it("reports gone on a 410 instead of throwing", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: { message: "Sync token is no longer valid" } }, 410)
    )
    const page = await fetchEventsPage(
      fetchImpl as unknown as typeof fetch,
      "at_abc",
      { ...PAGE_ARGS, syncToken: "stale" }
    )
    expect(page.gone).toBe(true)
    expect(page.items).toEqual([])
  })

  it("throws GoogleAuthError on a 401", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 401))
    await expect(
      fetchEventsPage(fetchImpl as unknown as typeof fetch, "at_abc", PAGE_ARGS)
    ).rejects.toBeInstanceOf(GoogleAuthError)
  })

  it("throws GoogleTransientError on a 429 and on a 503", async () => {
    for (const status of [429, 503]) {
      const fetchImpl = vi.fn(async () => jsonResponse({}, status))
      await expect(
        fetchEventsPage(fetchImpl as unknown as typeof fetch, "at", PAGE_ARGS)
      ).rejects.toBeInstanceOf(GoogleTransientError)
    }
  })

  it("passes a page token through", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ items: [], nextPageToken: "pg_2" })
    )
    const page = await fetchEventsPage(
      fetchImpl as unknown as typeof fetch,
      "at",
      { ...PAGE_ARGS, pageToken: "pg_1" }
    )
    const [url] = fetchImpl.mock.calls[0] as [string]
    expect(url).toContain("pageToken=pg_1")
    expect(page.nextPageToken).toBe("pg_2")
  })
})

describe("fetchCalendarList", () => {
  it("maps id and summary, and falls back to the id when unnamed", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        items: [
          { id: "primary", summary: "Brent" },
          { id: "team@example.com" },
          { summary: "no id, dropped" },
        ],
      })
    )
    const calendars = await fetchCalendarList(
      fetchImpl as unknown as typeof fetch,
      "at"
    )
    expect(calendars).toEqual([
      { googleId: "primary", summary: "Brent" },
      { googleId: "team@example.com", summary: "team@example.com" },
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run convex/googleApi.test.ts`
Expected: FAIL — cannot resolve `./googleApi`.

- [ ] **Step 3: Write the implementation**

Create `convex/googleApi.ts`:

```ts
/*
 * The Google Calendar API boundary.
 *
 * `fetch` is INJECTED rather than reached for. `fetch()` is available in the
 * default Convex runtime so this needs no `"use node"`, but a module that calls
 * the global directly cannot be tested without a network or a global stub, and
 * every branch in here is a response class that has to be handled correctly
 * exactly once.
 *
 * The three outcomes are deliberately different types, because the caller's
 * response to each is different and getting them confused is the expensive
 * failure:
 *
 *   - `gone` (410) is ROUTINE. A syncToken has aged out; clear it and refetch
 *     the window. Not an error, and it must not be logged as one.
 *   - `GoogleAuthError` (401/403 on the grant) means STOP. The user revoked
 *     access; retrying every 15 minutes forever is how a quiet failure becomes
 *     an expensive one, and the recovery needs a human to consent again.
 *   - `GoogleTransientError` (429/5xx) means TRY LATER. The mirror stays
 *     stale-but-present, which is the whole reason there is a mirror.
 */

const CALENDAR_API = "https://www.googleapis.com/calendar/v3"

export class GoogleAuthError extends Error {}
export class GoogleTransientError extends Error {}

export type EventsPage = {
  items: Array<unknown>
  nextPageToken: string | null
  nextSyncToken: string | null
  /** True when Google refused a stale `syncToken`. The caller clears the stored
   *  token and refetches the window; the page carries no items. */
  gone: boolean
}

async function call(
  fetchImpl: typeof fetch,
  accessToken: string,
  url: string
): Promise<Response> {
  const response = await fetchImpl(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  })

  if (response.status === 401 || response.status === 403) {
    throw new GoogleAuthError(`Google refused the grant (${response.status})`)
  }
  if (response.status === 429 || response.status >= 500) {
    throw new GoogleTransientError(`Google is unavailable (${response.status})`)
  }
  return response
}

export async function fetchCalendarList(
  fetchImpl: typeof fetch,
  accessToken: string
): Promise<Array<{ googleId: string; summary: string }>> {
  const response = await call(
    fetchImpl,
    accessToken,
    `${CALENDAR_API}/users/me/calendarList?maxResults=250&minAccessRole=reader`
  )
  if (!response.ok) {
    throw new GoogleTransientError(`calendarList failed (${response.status})`)
  }

  const body: unknown = await response.json()
  const items =
    typeof body === "object" && body !== null && Array.isArray(
      (body as { items?: unknown }).items
    )
      ? ((body as { items: Array<unknown> }).items)
      : []

  const calendars: Array<{ googleId: string; summary: string }> = []
  for (const candidate of items) {
    if (typeof candidate !== "object" || candidate === null) continue
    const item = candidate as { id?: unknown; summary?: unknown }
    if (typeof item.id !== "string" || item.id === "") continue
    calendars.push({
      googleId: item.id,
      // A calendar with no summary is normal — a secondary calendar the user
      // never named. Its address is what they would recognise it by anyway, and
      // an empty row in Settings is unclickable.
      summary:
        typeof item.summary === "string" && item.summary !== ""
          ? item.summary
          : item.id,
    })
  }
  return calendars
}

export async function fetchEventsPage(
  fetchImpl: typeof fetch,
  accessToken: string,
  args: {
    calendarId: string
    syncToken: string | null
    timeMinMs: number
    timeMaxMs: number
    pageToken: string | null
  }
): Promise<EventsPage> {
  const params = new URLSearchParams({
    // Recurrences as INSTANCES, not as a rule plus exceptions. Each instance
    // gets its own event id, which is what keeps a daily standup from being one
    // row — and what makes Phase 2's per-meeting checkbox addressable at all.
    singleEvents: "true",
    maxResults: "250",
  })

  if (args.syncToken !== null) {
    // Google rejects syncToken combined with a time window outright, so this is
    // an either/or rather than a preference.
    params.set("syncToken", args.syncToken)
  } else {
    params.set("timeMin", new Date(args.timeMinMs).toISOString())
    params.set("timeMax", new Date(args.timeMaxMs).toISOString())
  }
  if (args.pageToken !== null) params.set("pageToken", args.pageToken)

  const response = await call(
    fetchImpl,
    accessToken,
    `${CALENDAR_API}/calendars/${encodeURIComponent(args.calendarId)}/events?${params.toString()}`
  )

  if (response.status === 410) {
    return { items: [], nextPageToken: null, nextSyncToken: null, gone: true }
  }
  if (!response.ok) {
    throw new GoogleTransientError(`events.list failed (${response.status})`)
  }

  const body = (await response.json()) as {
    items?: unknown
    nextPageToken?: unknown
    nextSyncToken?: unknown
  }
  return {
    items: Array.isArray(body.items) ? body.items : [],
    nextPageToken:
      typeof body.nextPageToken === "string" ? body.nextPageToken : null,
    nextSyncToken:
      typeof body.nextSyncToken === "string" ? body.nextSyncToken : null,
    gone: false,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run convex/googleApi.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add convex/googleApi.ts convex/googleApi.test.ts
git commit -m "feat(google): calendar API boundary with injected fetch"
```

---

## Task 4: Applying a sync page atomically

**Files:**
- Modify: `convex/google.ts`
- Test: `convex/google.test.ts`

**Interfaces:**
- Consumes: `mapGoogleEvent`, `GoogleSyncItem` (Task 2); the tables (Task 1).
- Produces:
  - `internal.google.upsertCalendars({ userId, calendars, nowMs })`
  - `internal.google.applySyncPage({ userId, calendarId, items, nextSyncToken, nowMs })`
  - `internal.google.pruneEvents({ userId, fromMs, toMs })`
  - `MIRROR_BACK_DAYS = 60`, `MIRROR_FORWARD_DAYS = 90`, `mirrorWindow(nowMs)`

- [ ] **Step 1: Write the failing test**

Append to `convex/google.test.ts`:

```ts
describe("applySyncPage", () => {
  const NOW = Date.parse("2026-08-17T09:00:00.000Z")

  function timed(id: string, startIso: string, endIso: string) {
    return {
      id,
      status: "confirmed",
      summary: id,
      updated: "2026-08-17T08:00:00.000Z",
      start: { dateTime: startIso },
      end: { dateTime: endIso },
    }
  }

  it("writes the rows and the syncToken together", async () => {
    const t = setup()
    await t.run(async (ctx) => {
      await ctx.db.insert("googleCalendars", {
        userId: ALICE,
        googleId: "primary",
        summary: "Brent",
        show: true,
        syncToken: null,
        lastSyncedAt: null,
        updatedAt: NOW,
      })
    })

    await t.mutation(internal.google.applySyncPage, {
      userId: ALICE,
      calendarId: "primary",
      items: [
        timed("evt_1", "2026-08-17T10:00:00.000Z", "2026-08-17T10:30:00.000Z"),
      ],
      nextSyncToken: "tok_1",
      nowMs: NOW,
    })

    const rows = await t.query(internal.google.allEventsForTest, { userId: ALICE })
    expect(rows).toHaveLength(1)
    expect(rows[0].eventId).toBe("evt_1")

    const calendars = await t.query(internal.google.allCalendarsForTest, {
      userId: ALICE,
    })
    expect(calendars[0].syncToken).toBe("tok_1")
    expect(calendars[0].lastSyncedAt).toBe(NOW)
  })

  it("updates an existing row rather than duplicating it", async () => {
    const t = setup()
    await t.run(async (ctx) => {
      await ctx.db.insert("googleCalendars", {
        userId: ALICE,
        googleId: "primary",
        summary: "Brent",
        show: true,
        syncToken: null,
        lastSyncedAt: null,
        updatedAt: NOW,
      })
    })

    const page = (title: string) => ({
      userId: ALICE,
      calendarId: "primary",
      items: [
        {
          ...timed("evt_1", "2026-08-17T10:00:00.000Z", "2026-08-17T10:30:00.000Z"),
          summary: title,
        },
      ],
      nextSyncToken: null,
      nowMs: NOW,
    })

    await t.mutation(internal.google.applySyncPage, page("Standup"))
    await t.mutation(internal.google.applySyncPage, page("Standup, renamed"))

    const rows = await t.query(internal.google.allEventsForTest, { userId: ALICE })
    expect(rows).toHaveLength(1)
    expect(rows[0].title).toBe("Standup, renamed")
  })

  it("deletes a row when Google sends a cancellation tombstone", async () => {
    const t = setup()
    await t.mutation(internal.google.applySyncPage, {
      userId: ALICE,
      calendarId: "primary",
      items: [
        timed("evt_1", "2026-08-17T10:00:00.000Z", "2026-08-17T10:30:00.000Z"),
      ],
      nextSyncToken: null,
      nowMs: NOW,
    })
    await t.mutation(internal.google.applySyncPage, {
      userId: ALICE,
      calendarId: "primary",
      items: [{ id: "evt_1", status: "cancelled" }],
      nextSyncToken: null,
      nowMs: NOW,
    })

    const rows = await t.query(internal.google.allEventsForTest, { userId: ALICE })
    expect(rows).toEqual([])
  })

  it("leaves a tracking row alone when its event is deleted", async () => {
    // The tick survives the mirror. A meeting that moves out of the window and
    // back must not lose the checkbox the user set on it.
    const t = setup()
    await t.run(async (ctx) => {
      await ctx.db.insert("googleEventTracking", {
        userId: ALICE,
        calendarId: "primary",
        eventId: "evt_1",
        trackOnStart: true,
        entryId: null,
        interruptedEntryId: null,
        updatedAt: NOW,
      })
    })
    await t.mutation(internal.google.applySyncPage, {
      userId: ALICE,
      calendarId: "primary",
      items: [{ id: "evt_1", status: "cancelled" }],
      nextSyncToken: null,
      nowMs: NOW,
    })

    const tracking = await t.query(internal.google.allTrackingForTest, {
      userId: ALICE,
    })
    expect(tracking).toHaveLength(1)
    expect(tracking[0].trackOnStart).toBe(true)
  })

  it("does not touch another user's rows", async () => {
    const t = setup()
    await t.mutation(internal.google.applySyncPage, {
      userId: "user_bob",
      calendarId: "primary",
      items: [
        timed("evt_1", "2026-08-17T10:00:00.000Z", "2026-08-17T10:30:00.000Z"),
      ],
      nextSyncToken: null,
      nowMs: NOW,
    })
    const alice = await t.query(internal.google.allEventsForTest, { userId: ALICE })
    expect(alice).toEqual([])
  })
})

describe("pruneEvents", () => {
  const NOW = Date.parse("2026-08-17T09:00:00.000Z")

  it("removes rows outside the window and keeps the ones inside", async () => {
    const t = setup()
    await t.run(async (ctx) => {
      for (const [eventId, startIso] of [
        ["old", "2026-01-01T10:00:00.000Z"],
        ["inside", "2026-08-16T10:00:00.000Z"],
        ["far_future", "2027-06-01T10:00:00.000Z"],
      ] as const) {
        const startedAt = Date.parse(startIso)
        await ctx.db.insert("googleEvents", {
          userId: ALICE,
          calendarId: "primary",
          eventId,
          title: eventId,
          startedAt,
          endedAt: startedAt + 1_800_000,
          isAllDay: false,
          status: "confirmed",
          myResponse: "accepted",
          attendees: [],
          attendeeCount: 0,
          googleUpdatedAt: startedAt,
          updatedAt: startedAt,
        })
      }
    })

    const { fromMs, toMs } = mirrorWindow(NOW)
    await t.mutation(internal.google.pruneEvents, {
      userId: ALICE,
      fromMs,
      toMs,
    })

    const rows = await t.query(internal.google.allEventsForTest, { userId: ALICE })
    expect(rows.map((row) => row.eventId)).toEqual(["inside"])
  })
})
```

Add to the test file's imports:

```ts
import { mirrorWindow } from "./google"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run convex/google.test.ts`
Expected: FAIL — `mirrorWindow`, `applySyncPage`, `pruneEvents`, and
`allCalendarsForTest` do not exist.

- [ ] **Step 3: Write the implementation**

Add to `convex/google.ts` (extend the existing imports):

```ts
import { internalMutation } from "./_generated/server"
import { googleCalendarDoc } from "./lib/docs"
import { mapGoogleEvent } from "./googleEvents"
import type { MutationCtx } from "./_generated/server"

/**
 * How much of the calendar is mirrored, and therefore how much detail about
 * other people is at rest in this deployment.
 *
 * A WINDOW rather than everything, and the bound is the point: the popover
 * exists to show attendees and agendas, which means other people's names and
 * addresses are stored. 60 days back covers "what was that meeting I worked
 * through last month" for a tracker people invoice from; 90 forward covers a
 * quarter of planning. Anything outside is pruned on every sync.
 */
export const MIRROR_BACK_DAYS = 60
export const MIRROR_FORWARD_DAYS = 90
const DAY_MS = 86_400_000

/** The mirrored window around an instant. Half-open, like every other range in
 *  this product. */
export function mirrorWindow(nowMs: number): { fromMs: number; toMs: number } {
  return {
    fromMs: nowMs - MIRROR_BACK_DAYS * DAY_MS,
    toMs: nowMs + MIRROR_FORWARD_DAYS * DAY_MS,
  }
}

export const allCalendarsForTest = internalQuery({
  args: { userId: v.string() },
  returns: v.array(googleCalendarDoc),
  handler: async (ctx, args) =>
    await ctx.db
      .query("googleCalendars")
      .withIndex("by_user_googleId", (q) => q.eq("userId", args.userId))
      .take(100),
})

async function calendarRow(ctx: MutationCtx, userId: string, googleId: string) {
  return await ctx.db
    .query("googleCalendars")
    .withIndex("by_user_googleId", (q) =>
      q.eq("userId", userId).eq("googleId", googleId)
    )
    .unique()
}

/**
 * A page of `events.list`, applied.
 *
 * THE ROWS AND THE `syncToken` COMMIT TOGETHER, and that is the one ordering in
 * this feature that can lose data with no error anywhere. Advance the token in
 * its own mutation and crash before writing the rows, and Google will never
 * mention those changes again — a meeting permanently missing from the mirror,
 * with a healthy-looking cron and nothing in the logs. One transaction, always.
 *
 * `items` is `v.array(v.any())` because it is raw Google JSON crossing a
 * function boundary; `mapGoogleEvent` is what narrows it, and it treats every
 * field as `unknown`.
 */
export const applySyncPage = internalMutation({
  args: {
    userId: v.string(),
    calendarId: v.string(),
    items: v.array(v.any()),
    /** Present only on the LAST page of a run. Google issues it once the pages
     *  are exhausted, and storing it earlier would declare covered a page that
     *  was never fetched. */
    nextSyncToken: v.union(v.string(), v.null()),
    nowMs: v.number(),
  },
  returns: v.object({ upserted: v.number(), deleted: v.number() }),
  handler: async (ctx, args) => {
    let upserted = 0
    let deleted = 0

    for (const raw of args.items) {
      const item = mapGoogleEvent(raw, args.calendarId)
      if (item === null) continue

      const existing = await ctx.db
        .query("googleEvents")
        .withIndex("by_user_calendar_event", (q) =>
          q
            .eq("userId", args.userId)
            .eq("calendarId", args.calendarId)
            .eq("eventId", item.kind === "delete" ? item.eventId : item.row.eventId)
        )
        .unique()

      if (item.kind === "delete") {
        // The MIRROR row goes; the tracking row beside it stays. A cancelled
        // meeting must vanish from the grid, and a tick the user set must
        // survive the event leaving and coming back.
        if (existing !== null) {
          await ctx.db.delete(existing._id)
          deleted += 1
        }
        continue
      }

      const row = {
        userId: args.userId,
        ...item.row,
        updatedAt: args.nowMs,
      }
      if (existing === null) {
        await ctx.db.insert("googleEvents", row)
      } else {
        // `replace`, not `patch`: this table holds ONLY Google's facts, so a
        // field Google has stopped sending must disappear rather than linger as
        // a stale value from three syncs ago.
        await ctx.db.replace(existing._id, row)
      }
      upserted += 1
    }

    const calendar = await calendarRow(ctx, args.userId, args.calendarId)
    if (calendar !== null) {
      await ctx.db.patch(calendar._id, {
        ...(args.nextSyncToken === null ? {} : { syncToken: args.nextSyncToken }),
        lastSyncedAt: args.nowMs,
        updatedAt: args.nowMs,
      })
    }

    return { upserted, deleted }
  },
})

/**
 * The calendar list, reconciled.
 *
 * A NEW CALENDAR ARRIVES HIDDEN (`show: false`). A calendar appearing on the
 * grid because Google added one — a shared team calendar, a subscribed holiday
 * feed — is a surprise, and on this page a surprise costs the user attention
 * they are spending on work. Existing rows keep their `show` and their
 * `defaultProjectId`; only the name is refreshed.
 *
 * A calendar Google no longer reports is DELETED, along with its mirrored
 * events. Its tracking rows are left alone, on the same argument as a
 * cancellation tombstone.
 */
export const upsertCalendars = internalMutation({
  args: {
    userId: v.string(),
    calendars: v.array(
      v.object({ googleId: v.string(), summary: v.string() })
    ),
    nowMs: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const seen = new Set<string>()

    for (const calendar of args.calendars) {
      seen.add(calendar.googleId)
      const existing = await calendarRow(ctx, args.userId, calendar.googleId)
      if (existing === null) {
        await ctx.db.insert("googleCalendars", {
          userId: args.userId,
          googleId: calendar.googleId,
          summary: calendar.summary,
          show: false,
          syncToken: null,
          lastSyncedAt: null,
          updatedAt: args.nowMs,
        })
      } else if (existing.summary !== calendar.summary) {
        await ctx.db.patch(existing._id, {
          summary: calendar.summary,
          updatedAt: args.nowMs,
        })
      }
    }

    const rows = await ctx.db
      .query("googleCalendars")
      .withIndex("by_user_googleId", (q) => q.eq("userId", args.userId))
      .take(250)
    for (const row of rows) {
      if (seen.has(row.googleId)) continue
      const orphans = await ctx.db
        .query("googleEvents")
        .withIndex("by_user_started", (q) => q.eq("userId", args.userId))
        .take(500)
      for (const orphan of orphans) {
        if (orphan.calendarId === row.googleId) await ctx.db.delete(orphan._id)
      }
      await ctx.db.delete(row._id)
    }

    return null
  },
})

/**
 * Mirror rows outside the window, deleted.
 *
 * Bounded at 500 rows a run, and deliberately not self-rescheduling: the cron
 * runs every 15 minutes and the window moves by 15 minutes, so a backlog can
 * only exist right after the window narrows. Draining it over a few runs is
 * cheaper than a mutation that can hit the transaction limit and roll back the
 * whole page.
 */
export const pruneEvents = internalMutation({
  args: { userId: v.string(), fromMs: v.number(), toMs: v.number() },
  returns: v.number(),
  handler: async (ctx, args) => {
    let removed = 0

    const before = await ctx.db
      .query("googleEvents")
      .withIndex("by_user_started", (q) =>
        q.eq("userId", args.userId).lt("startedAt", args.fromMs)
      )
      .take(250)
    const after = await ctx.db
      .query("googleEvents")
      .withIndex("by_user_started", (q) =>
        q.eq("userId", args.userId).gte("startedAt", args.toMs)
      )
      .take(250)

    for (const row of [...before, ...after]) {
      await ctx.db.delete(row._id)
      removed += 1
    }
    return removed
  },
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run convex/google.test.ts`
Expected: PASS — the 2 table tests plus 6 new ones.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add convex/google.ts convex/google.test.ts
git commit -m "feat(google): apply a sync page atomically, prune the window"
```

---

## Task 5: The sync action and the cron

**Files:**
- Modify: `convex/google.ts`
- Create: `convex/crons.ts`
- Test: `convex/google.test.ts`

**Interfaces:**
- Consumes: Task 3's fetch helpers, Task 4's mutations.
- Produces:
  - `internal.google.syncAll({})` — the cron entry point.
  - `internal.google.syncAccount({ userId })`
  - `internal.google.markConnection({ userId, status, nowMs, error })`
  - `internal.google.connectionsToSync({ cursor })`

- [ ] **Step 1: Verify the Better Auth access-token call before writing it**

The token is fetched through Better Auth so there is one token store and
revocation actually revokes. Confirm the exact route shape rather than trusting
this plan:

```bash
grep -n "getAccessToken" node_modules/better-auth/dist/api/routes/account.d.mts
```

Expected: a route whose body takes `providerId` and `userId` and whose result
carries `accessToken`. If the shape differs, adjust the call in Step 3 to match
what is actually exported — do not proceed on the shape written here.

- [ ] **Step 2: Write the failing test**

Append to `convex/google.test.ts`:

```ts
describe("syncAccount", () => {
  const NOW = Date.parse("2026-08-17T09:00:00.000Z")

  it("flags the connection for re-consent when Google refuses the grant", async () => {
    const t = setup()
    await t.run(async (ctx) => {
      await ctx.db.insert("googleConnections", {
        userId: ALICE,
        status: "ok",
        calendarsRefreshedAt: NOW,
        lastSyncedAt: null,
        lastErrorAt: null,
        updatedAt: NOW,
      })
    })

    await t.mutation(internal.google.markConnection, {
      userId: ALICE,
      status: "reauth",
      nowMs: NOW,
      error: "Google refused the grant (401)",
    })

    const rows = await t.query(internal.google.allConnectionsForTest, {
      userId: ALICE,
    })
    expect(rows[0].status).toBe("reauth")
    expect(rows[0].lastError).toContain("401")
  })

  it("skips an account already flagged for re-consent", async () => {
    // The whole point of the flag: a revoked grant must stop being retried, or
    // one user's dead token costs a Google API call every 15 minutes forever.
    const t = setup()
    await t.run(async (ctx) => {
      await ctx.db.insert("googleConnections", {
        userId: ALICE,
        status: "reauth",
        calendarsRefreshedAt: NOW,
        lastSyncedAt: null,
        lastErrorAt: NOW,
        updatedAt: NOW,
      })
    })

    const due = await t.query(internal.google.connectionsToSync, { cursor: null })
    expect(due.userIds).toEqual([])
  })

  it("returns an ok connection as due", async () => {
    const t = setup()
    await t.run(async (ctx) => {
      await ctx.db.insert("googleConnections", {
        userId: ALICE,
        status: "ok",
        calendarsRefreshedAt: null,
        lastSyncedAt: null,
        lastErrorAt: null,
        updatedAt: NOW,
      })
    })
    const due = await t.query(internal.google.connectionsToSync, { cursor: null })
    expect(due.userIds).toEqual([ALICE])
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run convex/google.test.ts`
Expected: FAIL — `markConnection`, `connectionsToSync`, and
`allConnectionsForTest` do not exist.

- [ ] **Step 4: Write the connection helpers**

Add to `convex/google.ts`:

```ts
import { googleConnectionDoc } from "./lib/docs"

/** How many accounts one cron run picks up. A page, not the world: the cron
 *  fires every 15 minutes and each account's work is scheduled separately, so a
 *  slow or failing account cannot starve the others. */
const SYNC_PAGE_SIZE = 100

export const allConnectionsForTest = internalQuery({
  args: { userId: v.string() },
  returns: v.array(googleConnectionDoc),
  handler: async (ctx, args) =>
    await ctx.db
      .query("googleConnections")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .take(10),
})

/**
 * Which accounts are due a sync.
 *
 * `status: "ok"` only. An account flagged `reauth` is skipped entirely until a
 * human consents again — see the schema comment on that field. Read through
 * `by_status`, which is the one index in this feature not led by `userId`,
 * because this caller has no user to scope to.
 */
export const connectionsToSync = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.object({
    userIds: v.array(v.string()),
    cursor: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("googleConnections")
      .withIndex("by_status", (q) => q.eq("status", "ok"))
      .paginate({ numItems: SYNC_PAGE_SIZE, cursor: args.cursor })
    return {
      userIds: page.page.map((row) => row.userId),
      cursor: page.isDone ? null : page.continueCursor,
    }
  },
})

export const markConnection = internalMutation({
  args: {
    userId: v.string(),
    status: v.union(v.literal("ok"), v.literal("reauth")),
    nowMs: v.number(),
    error: v.optional(v.string()),
    calendarsRefreshed: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("googleConnections")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique()
    if (row === null) return null

    await ctx.db.patch(row._id, {
      status: args.status,
      lastSyncedAt: args.status === "ok" ? args.nowMs : row.lastSyncedAt,
      lastErrorAt: args.error === undefined ? row.lastErrorAt : args.nowMs,
      ...(args.error === undefined ? {} : { lastError: args.error }),
      ...(args.calendarsRefreshed === true
        ? { calendarsRefreshedAt: args.nowMs }
        : {}),
      updatedAt: args.nowMs,
    })
    return null
  },
})
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run convex/google.test.ts`
Expected: PASS.

- [ ] **Step 6: Write the sync action**

Add to `convex/google.ts`:

```ts
import { internalAction } from "./_generated/server"
import { internal } from "./_generated/api"
import { createAuth } from "./auth"
import {
  GoogleAuthError,
  GoogleTransientError,
  fetchCalendarList,
  fetchEventsPage,
} from "./googleApi"

/** How stale the calendar LIST may get. Events are polled every 15 minutes;
 *  the set of calendars changes about never, and refetching it every run is
 *  a quota call spent on an answer that has not moved. */
const CALENDAR_LIST_TTL_MS = 24 * 60 * 60 * 1_000

/** A hard stop on pages per calendar per run. A full window fetch of a busy
 *  calendar is a handful of pages; a hundred means something is wrong with the
 *  loop, and an unbounded `while` in an action is how a quota gets burned in
 *  one afternoon. */
const MAX_PAGES = 20

export const syncAccount = internalAction({
  args: { userId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const nowMs = Date.now()

    // The access token comes from Better Auth, which refreshes it from the
    // stored refresh token. One token store — so revoking access in a Google
    // account page actually stops this, rather than stopping it whenever a copy
    // we cached happened to expire.
    let accessToken: string
    try {
      const auth = createAuth(ctx)
      const result = await auth.api.getAccessToken({
        body: { providerId: "google", userId: args.userId },
      })
      accessToken = result.accessToken
    } catch (error) {
      await ctx.runMutation(internal.google.markConnection, {
        userId: args.userId,
        status: "reauth",
        nowMs,
        error: `Could not get an access token: ${String(error)}`,
      })
      return null
    }

    try {
      const connection = await ctx.runQuery(
        internal.google.connectionForSync,
        { userId: args.userId }
      )
      if (connection === null) return null

      const stale =
        connection.calendarsRefreshedAt === null ||
        nowMs - connection.calendarsRefreshedAt > CALENDAR_LIST_TTL_MS
      if (stale) {
        const calendars = await fetchCalendarList(fetch, accessToken)
        await ctx.runMutation(internal.google.upsertCalendars, {
          userId: args.userId,
          calendars,
          nowMs,
        })
      }

      const window = mirrorWindow(nowMs)
      const shown = await ctx.runQuery(internal.google.shownCalendars, {
        userId: args.userId,
      })

      for (const calendar of shown) {
        let pageToken: string | null = null
        let syncToken = calendar.syncToken
        let pages = 0

        do {
          const page = await fetchEventsPage(fetch, accessToken, {
            calendarId: calendar.googleId,
            syncToken,
            timeMinMs: window.fromMs,
            timeMaxMs: window.toMs,
            pageToken,
          })

          if (page.gone) {
            // Routine. The token aged out; drop it and start the window again on
            // the next iteration of this same loop.
            await ctx.runMutation(internal.google.clearSyncToken, {
              userId: args.userId,
              calendarId: calendar.googleId,
              nowMs,
            })
            syncToken = null
            pageToken = null
            pages += 1
            continue
          }

          await ctx.runMutation(internal.google.applySyncPage, {
            userId: args.userId,
            calendarId: calendar.googleId,
            items: page.items,
            // Stored ONLY on the last page. Google issues it when the pages are
            // exhausted, and storing it earlier would declare covered a page
            // that was never fetched.
            nextSyncToken: page.nextPageToken === null ? page.nextSyncToken : null,
            nowMs,
          })

          pageToken = page.nextPageToken
          pages += 1
        } while (pageToken !== null && pages < MAX_PAGES)
      }

      await ctx.runMutation(internal.google.pruneEvents, {
        userId: args.userId,
        fromMs: window.fromMs,
        toMs: window.toMs,
      })

      await ctx.runMutation(internal.google.markConnection, {
        userId: args.userId,
        status: "ok",
        nowMs,
        calendarsRefreshed: stale,
      })
    } catch (error) {
      if (error instanceof GoogleAuthError) {
        await ctx.runMutation(internal.google.markConnection, {
          userId: args.userId,
          status: "reauth",
          nowMs,
          error: error.message,
        })
        return null
      }
      if (error instanceof GoogleTransientError) {
        // Stale-but-present is the whole reason there is a mirror. Record it and
        // let the next run try; no backoff state to get wrong.
        await ctx.runMutation(internal.google.markConnection, {
          userId: args.userId,
          status: "ok",
          nowMs,
          error: error.message,
        })
        return null
      }
      throw error
    }

    return null
  },
})

export const syncAll = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    let cursor: string | null = null
    do {
      const due: { userIds: Array<string>; cursor: string | null } =
        await ctx.runQuery(internal.google.connectionsToSync, { cursor })
      for (const userId of due.userIds) {
        // One scheduled action per account, so a slow or failing account cannot
        // starve the rest — and so a thrown error is scoped to one user.
        await ctx.scheduler.runAfter(0, internal.google.syncAccount, { userId })
      }
      cursor = due.cursor
    } while (cursor !== null)
    return null
  },
})
```

Add the two supporting internal queries and one mutation:

```ts
export const connectionForSync = internalQuery({
  args: { userId: v.string() },
  returns: v.union(googleConnectionDoc, v.null()),
  handler: async (ctx, args) =>
    await ctx.db
      .query("googleConnections")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique(),
})

export const shownCalendars = internalQuery({
  args: { userId: v.string() },
  returns: v.array(googleCalendarDoc),
  handler: async (ctx, args) =>
    await ctx.db
      .query("googleCalendars")
      .withIndex("by_user_show", (q) =>
        q.eq("userId", args.userId).eq("show", true)
      )
      .take(50),
})

export const clearSyncToken = internalMutation({
  args: { userId: v.string(), calendarId: v.string(), nowMs: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const calendar = await calendarRow(ctx, args.userId, args.calendarId)
    if (calendar !== null) {
      await ctx.db.patch(calendar._id, {
        syncToken: null,
        updatedAt: args.nowMs,
      })
    }
    return null
  },
})
```

- [ ] **Step 7: Write the cron**

Create `convex/crons.ts`:

```ts
import { cronJobs } from "convex/server"
import { internal } from "./_generated/api"

/*
 * The only cron this product has.
 *
 * 15 minutes is the staleness the calendar link accepts: a meeting created or
 * moved in Google shows up within a quarter of an hour. Push notifications
 * (`events.watch`) would make it immediate and cost a verified webhook domain
 * plus a channel renewal every seven days — a renewal nobody notices has stopped
 * until the grid quietly stops updating.
 *
 * `crons.interval`, never the `daily`/`hourly` helpers.
 */
const crons = cronJobs()

crons.interval(
  "google calendar sync",
  { minutes: 15 },
  internal.google.syncAll,
  {}
)

export default crons
```

- [ ] **Step 8: Typecheck**

Run: `npm run typecheck`
Expected: no errors. If `auth.api.getAccessToken` does not typecheck, fix the
call against what Step 1 found — do not cast it to `any`.

- [ ] **Step 9: Run the full Convex suite**

Run: `npx vitest run convex/`
Expected: PASS — every existing test plus the new ones.

- [ ] **Step 10: Commit**

```bash
git add convex/google.ts convex/crons.ts convex/google.test.ts
git commit -m "feat(google): polling sync action and its cron"
```

---

## Task 6: The Google provider and the connection surface

**Files:**
- Modify: `convex/auth.ts`
- Modify: `convex/google.ts`
- Modify: `.env.example`
- Test: `convex/google.test.ts`

**Interfaces:**
- Consumes: the connection helpers from Task 5.
- Produces:
  - `api.google.connection({})` → `{ connected: boolean; status: "ok" | "reauth"; lastSyncedAt: number | null }`
  - `api.google.connect({})` → creates the `googleConnections` row and triggers a first sync.
  - `api.google.disconnect({})` → removes the connection, its calendars, and its mirrored events.

- [ ] **Step 1: Write the failing test**

Append to `convex/google.test.ts`:

```ts
describe("the public connection surface", () => {
  it("rejects anonymous callers", async () => {
    const t = setup()
    await expectCode(t.query(api.google.connection, {}), "UNAUTHENTICATED")
    await expectCode(t.mutation(api.google.connect, {}), "UNAUTHENTICATED")
    await expectCode(t.mutation(api.google.disconnect, {}), "UNAUTHENTICATED")
  })

  it("reports not connected before anything is linked", async () => {
    const t = setup()
    const status = await t.query(internal.google.connectionForUser, {
      userId: ALICE,
    })
    expect(status).toEqual({
      connected: false,
      status: "ok",
      lastSyncedAt: null,
    })
  })

  it("disconnect removes the connection, calendars, and mirrored events", async () => {
    const t = setup()
    const NOW = Date.parse("2026-08-17T09:00:00.000Z")
    await t.run(async (ctx) => {
      await ctx.db.insert("googleConnections", {
        userId: ALICE,
        status: "ok",
        calendarsRefreshedAt: NOW,
        lastSyncedAt: NOW,
        lastErrorAt: null,
        updatedAt: NOW,
      })
      await ctx.db.insert("googleCalendars", {
        userId: ALICE,
        googleId: "primary",
        summary: "Brent",
        show: true,
        syncToken: "tok",
        lastSyncedAt: NOW,
        updatedAt: NOW,
      })
      await ctx.db.insert("googleEvents", {
        userId: ALICE,
        calendarId: "primary",
        eventId: "evt_1",
        title: "Standup",
        startedAt: NOW,
        endedAt: NOW + 900_000,
        isAllDay: false,
        status: "confirmed",
        myResponse: "accepted",
        attendees: [],
        attendeeCount: 0,
        googleUpdatedAt: NOW,
        updatedAt: NOW,
      })
    })

    await t.mutation(internal.google.disconnectForUser, { userId: ALICE })

    expect(
      await t.query(internal.google.allEventsForTest, { userId: ALICE })
    ).toEqual([])
    expect(
      await t.query(internal.google.allCalendarsForTest, { userId: ALICE })
    ).toEqual([])
    expect(
      await t.query(internal.google.allConnectionsForTest, { userId: ALICE })
    ).toEqual([])
  })
})
```

Add to the test file's imports: `import { api } from "./_generated/api"` and the
`expectCode` helper copied verbatim from `convex/settings.test.ts:29-39`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run convex/google.test.ts`
Expected: FAIL — `api.google.connection` and the two internal wrappers do not
exist.

- [ ] **Step 3: Add the Google provider to `convex/auth.ts`**

Inside `betterAuth({ ... })`, after the `emailAndPassword` block:

```ts
    /*
     * Google, for the calendar link — and LINKED rather than signed in with.
     *
     * `accessType: "offline"` and `prompt: "consent"` are BOTH required. Without
     * them Google issues an access token with no refresh token, and the link
     * dies about an hour later with nothing on screen to say why: the sync just
     * starts failing, and the failure looks like a revoked grant.
     *
     * `calendar.readonly` and nothing wider. This feature never writes to
     * Google, and a scope that permits writing is a scope somebody will
     * eventually write through.
     *
     * The connect flow calls `linkSocial()` from the client rather than
     * `signIn.social`, so the Google account is ADDED to an existing
     * email-and-password identity. The password login keeps working, and
     * `revokeSessionsOnPasswordReset` above keeps meaning what it says.
     */
    socialProviders: {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID!,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
        accessType: "offline",
        prompt: "consent",
        scope: ["https://www.googleapis.com/auth/calendar.readonly"],
      },
    },
```

- [ ] **Step 4: Add the public surface to `convex/google.ts`**

```ts
import { mutation, query } from "./_generated/server"
import { requireUserId } from "./auth"

const connectionStatus = v.object({
  connected: v.boolean(),
  status: v.union(v.literal("ok"), v.literal("reauth")),
  lastSyncedAt: v.union(v.number(), v.null()),
})

async function connectionStatusImpl(ctx: QueryCtx, userId: string) {
  const row = await ctx.db
    .query("googleConnections")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique()
  // "Not connected" is a valid state the settings page renders, not an error.
  if (row === null) {
    return { connected: false, status: "ok" as const, lastSyncedAt: null }
  }
  return {
    connected: true,
    status: row.status,
    lastSyncedAt: row.lastSyncedAt,
  }
}

export const connection = query({
  args: {},
  returns: connectionStatus,
  handler: async (ctx) =>
    await connectionStatusImpl(ctx, await requireUserId(ctx)),
})

export const connectionForUser = internalQuery({
  args: { userId: v.string() },
  returns: connectionStatus,
  handler: async (ctx, args) => await connectionStatusImpl(ctx, args.userId),
})

async function connectImpl(ctx: MutationCtx, userId: string) {
  const nowMs = Date.now()
  const existing = await ctx.db
    .query("googleConnections")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique()

  if (existing === null) {
    await ctx.db.insert("googleConnections", {
      userId,
      status: "ok",
      // null, so the first sync fetches the calendar list immediately rather
      // than waiting out the TTL against a timestamp nobody earned.
      calendarsRefreshedAt: null,
      lastSyncedAt: null,
      lastErrorAt: null,
      updatedAt: nowMs,
    })
  } else {
    // Re-consenting clears the flag. This is the ONLY thing that does.
    await ctx.db.patch(existing._id, { status: "ok", updatedAt: nowMs })
  }

  // Don't make the user wait 15 minutes to see their calendars.
  await ctx.scheduler.runAfter(0, internal.google.syncAccount, { userId })
  return null
}

/** Called by the client once `linkSocial` has returned. The OAuth grant itself
 *  is Better Auth's; this records that Chroneli should now be syncing. */
export const connect = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => await connectImpl(ctx, await requireUserId(ctx)),
})

export const connectForUser = internalMutation({
  args: { userId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => await connectImpl(ctx, args.userId),
})

/**
 * Disconnect: the mirror goes, the ticks go, the entries STAY.
 *
 * Everything mirrored from Google is Google's and is deleted — leaving a stale
 * mirror behind would draw meetings that no longer sync. Entries already
 * materialised from meetings are the user's own tracked time and are NOT
 * touched: they may already be on an invoice, and a disconnect is not a request
 * to delete a week of work.
 *
 * `googleEventTracking` DOES go here, unlike everywhere else in this feature.
 * Its rows survive a prune and a cancellation because the event may come back;
 * they do not survive a disconnect, because the account they describe is gone
 * and a tick that outlives its calendar would fire against a reconnected
 * account the user never re-armed.
 */
async function disconnectImpl(ctx: MutationCtx, userId: string) {
  for (const table of ["googleEvents", "googleEventTracking"] as const) {
    // Bounded per call. A disconnect on a full mirror is a few thousand rows,
    // which is more than one transaction should write, so it drains over
    // scheduled continuations rather than risking a rollback.
    const rows = await ctx.db
      .query(table)
      .withIndex(
        table === "googleEvents" ? "by_user_started" : "by_user_calendar_event",
        (q) => q.eq("userId", userId)
      )
      .take(500)
    for (const row of rows) await ctx.db.delete(row._id)
    if (rows.length === 500) {
      await ctx.scheduler.runAfter(0, internal.google.disconnectForUser, {
        userId,
      })
      return null
    }
  }

  const calendars = await ctx.db
    .query("googleCalendars")
    .withIndex("by_user_googleId", (q) => q.eq("userId", userId))
    .take(250)
  for (const calendar of calendars) await ctx.db.delete(calendar._id)

  const connectionRow = await ctx.db
    .query("googleConnections")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique()
  if (connectionRow !== null) await ctx.db.delete(connectionRow._id)

  return null
}

export const disconnect = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => await disconnectImpl(ctx, await requireUserId(ctx)),
})

export const disconnectForUser = internalMutation({
  args: { userId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => await disconnectImpl(ctx, args.userId),
})
```

Add `QueryCtx` to the type import at the top of the file.

- [ ] **Step 5: Document the environment variables**

Append to `.env.example`, inside the existing "NOTE: the variables below do NOT
belong here" block:

```
#
# Google Calendar link. Create an OAuth client of type "Web application" in the
# Google Cloud console, enable the Google Calendar API on the project, and add
# <SITE_URL>/api/auth/callback/google as an authorised redirect URI:
#   npx convex env set GOOGLE_CLIENT_ID ...apps.googleusercontent.com
#   npx convex env set GOOGLE_CLIENT_SECRET ...
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run convex/google.test.ts`
Expected: PASS.

- [ ] **Step 7: Typecheck and commit**

```bash
npm run typecheck
git add convex/auth.ts convex/google.ts convex/google.test.ts .env.example
git commit -m "feat(google): link a Google account and manage the connection"
```

---

## Task 7: The calendar settings surface and the meetings query

**Files:**
- Modify: `convex/google.ts`
- Test: `convex/google.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 4, 6.
- Produces:
  - `api.google.listCalendars({})` → `Array<Doc<"googleCalendars">>`
  - `api.google.setCalendarShow({ calendarId, show })`
  - `api.google.setCalendarProject({ calendarId, projectId })`
  - `api.google.listMeetings({ fromMs, toMs })` → `Array<Meeting>` where
    `Meeting = Doc<"googleEvents"> & { trackOnStart: boolean; entryId: Id<"timeEntries"> | null }`

- [ ] **Step 1: Write the failing test**

Append to `convex/google.test.ts`:

```ts
describe("listMeetings", () => {
  const NOW = Date.parse("2026-08-17T09:00:00.000Z")

  async function seed(t: ReturnType<typeof setup>) {
    await t.run(async (ctx) => {
      await ctx.db.insert("googleCalendars", {
        userId: ALICE,
        googleId: "primary",
        summary: "Brent",
        show: true,
        syncToken: null,
        lastSyncedAt: null,
        updatedAt: NOW,
      })
      await ctx.db.insert("googleCalendars", {
        userId: ALICE,
        googleId: "hidden",
        summary: "Personal",
        show: false,
        syncToken: null,
        lastSyncedAt: null,
        updatedAt: NOW,
      })
      for (const [eventId, calendarId, startIso, isAllDay] of [
        ["inside", "primary", "2026-08-17T10:00:00.000Z", false],
        ["outside", "primary", "2026-08-25T10:00:00.000Z", false],
        ["allday", "primary", "2026-08-17T00:00:00.000Z", true],
        ["hidden_cal", "hidden", "2026-08-17T11:00:00.000Z", false],
      ] as const) {
        const startedAt = Date.parse(startIso)
        await ctx.db.insert("googleEvents", {
          userId: ALICE,
          calendarId,
          eventId,
          title: eventId,
          startedAt,
          endedAt: startedAt + 1_800_000,
          isAllDay,
          status: "confirmed",
          myResponse: "accepted",
          attendees: [],
          attendeeCount: 0,
          googleUpdatedAt: startedAt,
          updatedAt: startedAt,
        })
      }
    })
  }

  it("returns only drawable events in range on a shown calendar", async () => {
    const t = setup()
    await seed(t)
    const meetings = await t.query(internal.google.listMeetingsForUser, {
      userId: ALICE,
      fromMs: Date.parse("2026-08-17T00:00:00.000Z"),
      toMs: Date.parse("2026-08-18T00:00:00.000Z"),
    })
    expect(meetings.map((m) => m.eventId)).toEqual(["inside"])
  })

  it("carries the tracking state so the grid can suppress a drawn hour", async () => {
    const t = setup()
    await seed(t)
    await t.run(async (ctx) => {
      await ctx.db.insert("googleEventTracking", {
        userId: ALICE,
        calendarId: "primary",
        eventId: "inside",
        trackOnStart: true,
        entryId: null,
        interruptedEntryId: null,
        updatedAt: NOW,
      })
    })
    const meetings = await t.query(internal.google.listMeetingsForUser, {
      userId: ALICE,
      fromMs: Date.parse("2026-08-17T00:00:00.000Z"),
      toMs: Date.parse("2026-08-18T00:00:00.000Z"),
    })
    expect(meetings[0].trackOnStart).toBe(true)
    expect(meetings[0].entryId).toBeNull()
  })

  it("never returns another user's meetings", async () => {
    const t = setup()
    await seed(t)
    const meetings = await t.query(internal.google.listMeetingsForUser, {
      userId: "user_bob",
      fromMs: Date.parse("2026-08-17T00:00:00.000Z"),
      toMs: Date.parse("2026-08-18T00:00:00.000Z"),
    })
    expect(meetings).toEqual([])
  })

  it("rejects anonymous callers on every public function", async () => {
    const t = setup()
    await expectCode(t.query(api.google.listCalendars, {}), "UNAUTHENTICATED")
    await expectCode(
      t.query(api.google.listMeetings, { fromMs: 0, toMs: 1 }),
      "UNAUTHENTICATED"
    )
    await expectCode(
      t.mutation(api.google.setCalendarShow, {
        calendarId: "primary",
        show: true,
      }),
      "UNAUTHENTICATED"
    )
  })
})

describe("setCalendarShow", () => {
  const NOW = Date.parse("2026-08-17T09:00:00.000Z")

  it("clears the syncToken when a calendar is shown", async () => {
    // A calendar that was hidden was not being fetched, so whatever token it
    // holds describes changes since a point in the past with a gap after it.
    // Reusing it would skip everything that happened while it was hidden.
    const t = setup()
    await t.run(async (ctx) => {
      await ctx.db.insert("googleCalendars", {
        userId: ALICE,
        googleId: "primary",
        summary: "Brent",
        show: false,
        syncToken: "stale_tok",
        lastSyncedAt: NOW,
        updatedAt: NOW,
      })
    })

    await t.mutation(internal.google.setCalendarShowForUser, {
      userId: ALICE,
      calendarId: "primary",
      show: true,
    })

    const calendars = await t.query(internal.google.allCalendarsForTest, {
      userId: ALICE,
    })
    expect(calendars[0].show).toBe(true)
    expect(calendars[0].syncToken).toBeNull()
  })

  it("drops the mirrored events when a calendar is hidden", async () => {
    const t = setup()
    await t.run(async (ctx) => {
      await ctx.db.insert("googleCalendars", {
        userId: ALICE,
        googleId: "primary",
        summary: "Brent",
        show: true,
        syncToken: "tok",
        lastSyncedAt: NOW,
        updatedAt: NOW,
      })
      await ctx.db.insert("googleEvents", {
        userId: ALICE,
        calendarId: "primary",
        eventId: "evt_1",
        title: "Standup",
        startedAt: NOW,
        endedAt: NOW + 900_000,
        isAllDay: false,
        status: "confirmed",
        myResponse: "accepted",
        attendees: [],
        attendeeCount: 0,
        googleUpdatedAt: NOW,
        updatedAt: NOW,
      })
    })

    await t.mutation(internal.google.setCalendarShowForUser, {
      userId: ALICE,
      calendarId: "primary",
      show: false,
    })

    expect(
      await t.query(internal.google.allEventsForTest, { userId: ALICE })
    ).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run convex/google.test.ts`
Expected: FAIL — the new functions do not exist.

- [ ] **Step 3: Write the implementation**

Add to `convex/google.ts`:

```ts
import { getOwned } from "./owned"
import { traceError } from "./errors"
import { googleEventDoc } from "./lib/docs"
import { isDrawable } from "./googleEvents"
import type { Id } from "./_generated/dataModel"

/** A mirrored event plus what this app knows about it. The grid needs both in
 *  one read: `entryId` is what suppresses a ghost whose hour is already drawn as
 *  a real entry. */
const meetingDoc = v.object({
  ...googleEventDoc.fields,
  trackOnStart: v.boolean(),
  entryId: v.union(v.id("timeEntries"), v.null()),
})

/** The most meetings one range read returns. A week of a busy calendar is tens;
 *  250 is a ceiling that cannot be reached by a human's diary and stops an
 *  unbounded read if one ever is. */
const MEETING_LIMIT = 250

async function listMeetingsImpl(
  ctx: QueryCtx,
  userId: string,
  fromMs: number,
  toMs: number
) {
  // `show` is read per calendar rather than joined per event: a diary has a
  // handful of calendars and hundreds of events, so this is the cheap direction.
  const calendars = await ctx.db
    .query("googleCalendars")
    .withIndex("by_user_show", (q) => q.eq("userId", userId).eq("show", true))
    .take(50)
  const shown = new Set(calendars.map((calendar) => calendar.googleId))
  if (shown.size === 0) return []

  const rows = await ctx.db
    .query("googleEvents")
    .withIndex("by_user_started", (q) =>
      // Half-open, matching `dayWindow` and every other range in the product.
      q.eq("userId", userId).gte("startedAt", fromMs).lt("startedAt", toMs)
    )
    .take(MEETING_LIMIT)

  const meetings = []
  for (const row of rows) {
    if (!shown.has(row.calendarId)) continue
    // All-day events have no clock and the grid has no rail for them.
    if (!isDrawable(row)) continue

    const tracking = await ctx.db
      .query("googleEventTracking")
      .withIndex("by_user_calendar_event", (q) =>
        q
          .eq("userId", userId)
          .eq("calendarId", row.calendarId)
          .eq("eventId", row.eventId)
      )
      .unique()

    meetings.push({
      ...row,
      trackOnStart: tracking?.trackOnStart ?? false,
      entryId: tracking?.entryId ?? null,
    })
  }
  return meetings
}

export const listMeetings = query({
  args: { fromMs: v.number(), toMs: v.number() },
  returns: v.array(meetingDoc),
  handler: async (ctx, args) =>
    await listMeetingsImpl(
      ctx,
      await requireUserId(ctx),
      args.fromMs,
      args.toMs
    ),
})

export const listMeetingsForUser = internalQuery({
  args: { userId: v.string(), fromMs: v.number(), toMs: v.number() },
  returns: v.array(meetingDoc),
  handler: async (ctx, args) =>
    await listMeetingsImpl(ctx, args.userId, args.fromMs, args.toMs),
})

async function listCalendarsImpl(ctx: QueryCtx, userId: string) {
  return await ctx.db
    .query("googleCalendars")
    .withIndex("by_user_googleId", (q) => q.eq("userId", userId))
    .take(250)
}

export const listCalendars = query({
  args: {},
  returns: v.array(googleCalendarDoc),
  handler: async (ctx) =>
    await listCalendarsImpl(ctx, await requireUserId(ctx)),
})

/**
 * Show or hide a calendar.
 *
 * SHOWING CLEARS THE `syncToken`. A hidden calendar was not being fetched, so
 * its token describes "changes since" a point with an unfetched gap after it —
 * reusing it would silently skip everything that happened while the calendar was
 * hidden, and the mirror would look healthy while missing a fortnight.
 *
 * HIDING DELETES THE MIRRORED EVENTS. Leaving them would draw a calendar that is
 * no longer syncing, which is worse than drawing nothing: the blocks are stale
 * and nothing on screen says so.
 */
async function setCalendarShowImpl(
  ctx: MutationCtx,
  userId: string,
  calendarId: string,
  show: boolean
) {
  const nowMs = Date.now()
  const calendar = await calendarRow(ctx, userId, calendarId)
  if (calendar === null) {
    traceError("NOT_FOUND", "That calendar is not on this account.")
  }

  await ctx.db.patch(calendar._id, {
    show,
    syncToken: show ? null : calendar.syncToken,
    updatedAt: nowMs,
  })

  if (show) {
    await ctx.scheduler.runAfter(0, internal.google.syncAccount, { userId })
    return null
  }

  const rows = await ctx.db
    .query("googleEvents")
    .withIndex("by_user_started", (q) => q.eq("userId", userId))
    .take(1_000)
  for (const row of rows) {
    if (row.calendarId === calendarId) await ctx.db.delete(row._id)
  }
  return null
}

export const setCalendarShow = mutation({
  args: { calendarId: v.string(), show: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) =>
    await setCalendarShowImpl(
      ctx,
      await requireUserId(ctx),
      args.calendarId,
      args.show
    ),
})

export const setCalendarShowForUser = internalMutation({
  args: { userId: v.string(), calendarId: v.string(), show: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) =>
    await setCalendarShowImpl(ctx, args.userId, args.calendarId, args.show),
})

/** The project entries made from this calendar's meetings are classified as.
 *  `null` clears it, which is a normal state: an unclassified entry is already
 *  normal everywhere else in the product. */
async function setCalendarProjectImpl(
  ctx: MutationCtx,
  userId: string,
  calendarId: string,
  projectId: Id<"projects"> | null
) {
  const calendar = await calendarRow(ctx, userId, calendarId)
  if (calendar === null) {
    traceError("NOT_FOUND", "That calendar is not on this account.")
  }
  // Through `getOwned`, so a project id belonging to someone else is NOT_FOUND
  // rather than quietly stored — the same guard every other classifier write in
  // this product goes through.
  if (projectId !== null) await getOwned(ctx, userId, "projects", projectId)

  await ctx.db.patch(calendar._id, {
    ...(projectId === null
      ? { defaultProjectId: undefined }
      : { defaultProjectId: projectId }),
    updatedAt: Date.now(),
  })
  return null
}

export const setCalendarProject = mutation({
  args: {
    calendarId: v.string(),
    projectId: v.union(v.id("projects"), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, args) =>
    await setCalendarProjectImpl(
      ctx,
      await requireUserId(ctx),
      args.calendarId,
      args.projectId
    ),
})

export const setCalendarProjectForUser = internalMutation({
  args: {
    userId: v.string(),
    calendarId: v.string(),
    projectId: v.union(v.id("projects"), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, args) =>
    await setCalendarProjectImpl(
      ctx,
      args.userId,
      args.calendarId,
      args.projectId
    ),
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run convex/google.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, lint, commit**

```bash
npm run typecheck
npm run lint
git add convex/google.ts convex/google.test.ts
git commit -m "feat(google): calendar settings surface and the meetings range query"
```

---

## Task 8: Mirror rows to FullCalendar events

**Files:**
- Create: `src/lib/calendar-meetings.ts`
- Test: `src/lib/calendar-meetings.test.ts`

**Interfaces:**
- Consumes: the `meetingDoc` shape from Task 7.
- Produces:
  - `type Meeting` — the client-side row type.
  - `type MeetingEventProps = { kind: "meeting"; calendarId: string; eventId: string; startedAt: number; endedAt: number; trackOnStart: boolean }`
  - `meetingEvents(meetings: Array<Meeting>): Array<CalendarEvent>`
  - `isMeetingEvent(props: unknown): props is MeetingEventProps`

- [ ] **Step 1: Write the failing test**

Create `src/lib/calendar-meetings.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { meetingEvents } from "@/lib/calendar-meetings"
import type { Meeting } from "@/lib/calendar-meetings"
import type { Id } from "../../convex/_generated/dataModel"

const START = Date.parse("2026-08-17T02:00:00.000Z")

function meeting(over: Partial<Meeting> = {}): Meeting {
  return {
    _id: "ge_1" as Id<"googleEvents">,
    _creationTime: START,
    userId: "user_alice",
    calendarId: "primary",
    eventId: "evt_1",
    title: "Standup",
    startedAt: START,
    endedAt: START + 900_000,
    isAllDay: false,
    status: "confirmed",
    myResponse: "accepted",
    attendees: [],
    attendeeCount: 0,
    googleUpdatedAt: START,
    updatedAt: START,
    trackOnStart: false,
    entryId: null,
    ...over,
  }
}

describe("meetingEvents", () => {
  it("maps a meeting to an event with absolute Date instants", () => {
    const [event] = meetingEvents([meeting()])
    expect(event.title).toBe("Standup")
    expect((event.start as Date).getTime()).toBe(START)
    expect((event.end as Date).getTime()).toBe(START + 900_000)
    expect(event.extendedProps.kind).toBe("meeting")
  })

  it("drops a meeting whose entry already exists", () => {
    // The grid must never draw the same hour twice: once a meeting has become a
    // real entry, the entry is the thing on screen.
    const tracked = meeting({ entryId: "te_1" as Id<"timeEntries"> })
    expect(meetingEvents([tracked])).toEqual([])
  })

  it("drops an all-day meeting", () => {
    expect(meetingEvents([meeting({ isAllDay: true })])).toEqual([])
  })

  it("floors a zero-length meeting to one minute so it is still drawn", () => {
    const [event] = meetingEvents([meeting({ endedAt: START })])
    expect((event.end as Date).getTime()).toBe(START + 60_000)
  })

  it("gives every event an id distinct from an entry's", () => {
    // FullCalendar keys on `id`. A meeting and an entry sharing one would make
    // the grid drop whichever it saw second.
    const [event] = meetingEvents([meeting()])
    expect(event.id).toBe("meeting:primary:evt_1")
  })

  it("carries trackOnStart through for the checkbox", () => {
    const [event] = meetingEvents([meeting({ trackOnStart: true })])
    expect(event.extendedProps.trackOnStart).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/calendar-meetings.test.ts`
Expected: FAIL — cannot resolve `@/lib/calendar-meetings`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/calendar-meetings.ts`:

```ts
import { MIN_SPAN_MS } from "@/lib/calendar-events"
import type { CalendarEventProps } from "@/lib/calendar-events"
import type { EventInput } from "@fullcalendar/react"
import type { Doc, Id } from "../../convex/_generated/dataModel"

/**
 * Google meetings, in the shape FullCalendar takes.
 *
 * The twin of `calendarEvents` in `calendar-events.ts`, and pure for the same
 * reason: a mapping is cheaper to pin down as a function than through a grid,
 * and jsdom cannot assert geometry.
 */

/** A mirrored event plus what this app knows about it — what `google.listMeetings`
 *  returns. */
export type Meeting = Doc<"googleEvents"> & {
  trackOnStart: boolean
  entryId: Id<"timeEntries"> | null
}

/**
 * The typed half of a meeting block's `extendedProps`.
 *
 * `kind` is what tells the panel's render hooks which sort of block they are
 * looking at. It is a DISCRIMINATOR on the props rather than two separate event
 * arrays, because FullCalendar hands back one `EventApi` from `eventClick` and
 * the handler has to decide which popover to open from that alone.
 */
export type MeetingEventProps = {
  kind: "meeting"
  calendarId: string
  eventId: string
  startedAt: number
  endedAt: number
  trackOnStart: boolean
}

/** The same discriminator on an ENTRY's props, so the panel can narrow either
 *  way. `calendar-events.ts` omits `kind` on its own props; absence is what
 *  identifies an entry, and this predicate is the only place that is relied on. */
export function isMeetingEvent(
  props: CalendarEventProps | MeetingEventProps
): props is MeetingEventProps {
  return "kind" in props && props.kind === "meeting"
}

export function meetingEvents(
  meetings: Array<Meeting>
): Array<EventInput & { extendedProps: MeetingEventProps }> {
  const events: Array<EventInput & { extendedProps: MeetingEventProps }> = []

  for (const meeting of meetings) {
    /*
     * A MEETING THAT HAS BECOME AN ENTRY IS NOT DRAWN.
     *
     * FullCalendar packs overlapping events into side-by-side columns, so a
     * tracked meeting and the entry it produced would each take half the column
     * and show the same hour twice. The entry is the thing worth drawing: it is
     * editable, it counts toward the day's total, and it is what gets invoiced.
     *
     * So a meeting is a ghost right up to the moment it becomes real, and a
     * block on the grid means exactly one thing at a time.
     */
    if (meeting.entryId !== null) continue

    // No clock, and `allDaySlot={false}` means no rail to draw it on. The server
    // filters these too; this is the second half of one rule, kept here because
    // this function must be correct against any input it is handed.
    if (meeting.isAllDay) continue

    events.push({
      /*
       * NAMESPACED, because FullCalendar keys on `id` and this grid now carries
       * two populations. A Convex `_id` from `googleEvents` and one from
       * `timeEntries` cannot collide today, and relying on that is relying on an
       * implementation detail of someone else's id generator.
       */
      id: `meeting:${meeting.calendarId}:${meeting.eventId}`,
      title: meeting.title,
      /*
       * `Date`s from the stored instants, never ISO strings — the same rule
       * `calendarEvents` states at length. FullCalendar reads an offset-less
       * string as wall-clock time in the calendar's own zone, which agrees with
       * the instant today and stops agreeing the moment anything formats the
       * field differently.
       */
      start: new Date(meeting.startedAt),
      // The same one-minute floor an entry gets. FullCalendar drops an event
      // whose end equals its start, and a meeting that exists must be visible or
      // it cannot be read or ticked.
      end: new Date(
        Math.max(meeting.endedAt, meeting.startedAt + MIN_SPAN_MS)
      ),
      extendedProps: {
        kind: "meeting",
        calendarId: meeting.calendarId,
        eventId: meeting.eventId,
        startedAt: meeting.startedAt,
        endedAt: meeting.endedAt,
        trackOnStart: meeting.trackOnStart,
      },
    })
  }

  return events
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/calendar-meetings.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/calendar-meetings.ts src/lib/calendar-meetings.test.ts
git commit -m "feat(calendar): map mirrored meetings to grid events"
```

---

## Task 9: Draw the ghosts on the grid

**Files:**
- Modify: `src/components/calendar/calendar-panel.tsx`
- Test: `src/components/calendar/calendar-panel.test.tsx`

**Interfaces:**
- Consumes: `meetingEvents`, `isMeetingEvent`, `Meeting` (Task 8).
- Produces: a `meetings: Array<Meeting>` prop on `CalendarPanel`, defaulting to
  the module-level `NO_MEETINGS` constant so every existing call site and test
  keeps compiling. Also exports `NO_MEETINGS` for Task 11 to reuse.

- [ ] **Step 1: Write the failing test**

Append to `src/components/calendar/calendar-panel.test.tsx`, following the
existing `renderPanel` helper in that file (read it first — it owns the props and
the timezone the other assertions depend on):

```ts
describe("google meetings", () => {
  it("draws a meeting as an unfilled block with a soft border", () => {
    renderPanel({ meetings: [meetingFixture()] })
    const block = screen.getByRole("button", { name: /Standup/ })
    // Fill means recorded, outline means scheduled. `surface-raised` is an
    // entry's fill and must NOT appear here, and `enlarger` is reserved for a
    // running timer by the Cold Light Rule.
    expect(block.className).toContain("border-edge-soft")
    expect(block.className).not.toContain("bg-surface-raised")
    expect(block.className).not.toContain("enlarger")
  })

  it("does not draw a meeting whose entry already exists", () => {
    renderPanel({
      meetings: [meetingFixture({ entryId: "te_1" as Id<"timeEntries"> })],
    })
    expect(screen.queryByRole("button", { name: /Standup/ })).toBeNull()
  })

  it("draws entries and meetings side by side when both are present", () => {
    renderPanel({
      entries: [entryFixture({ title: "Real work" })],
      meetings: [meetingFixture()],
    })
    expect(screen.getByRole("button", { name: /Real work/ })).toBeTruthy()
    expect(screen.getByRole("button", { name: /Standup/ })).toBeTruthy()
  })

  it("opens the meeting popover rather than the entry editor on click", () => {
    renderPanel({ meetings: [meetingFixture()] })
    fireEvent.click(screen.getByRole("button", { name: /Standup/ }))
    // The meeting popover is read-only and says so: it carries a link out to
    // Google, which the entry editor never does.
    expect(screen.getByRole("link", { name: /Google Calendar/i })).toBeTruthy()
  })
})
```

Add a `meetingFixture` helper beside the file's existing fixtures:

```ts
function meetingFixture(over: Partial<Meeting> = {}): Meeting {
  const startedAt = Date.parse("2026-08-17T02:00:00.000Z")
  return {
    _id: "ge_1" as Id<"googleEvents">,
    _creationTime: startedAt,
    userId: "user_alice",
    calendarId: "primary",
    eventId: "evt_1",
    title: "Standup",
    startedAt,
    endedAt: startedAt + 1_800_000,
    isAllDay: false,
    status: "confirmed",
    myResponse: "accepted",
    attendees: [],
    attendeeCount: 0,
    googleUpdatedAt: startedAt,
    updatedAt: startedAt,
    trackOnStart: false,
    entryId: null,
    ...over,
  }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/calendar/calendar-panel.test.tsx`
Expected: FAIL — `CalendarPanel` has no `meetings` prop.

- [ ] **Step 3: Add the prop and the class list**

In `calendar-panel.tsx`, add to the props type:

```ts
  /**
   * Google meetings for this range, from `google.listMeetings`.
   *
   * A SECOND POPULATION on one grid, and the block styling is what keeps them
   * apart. Defaults to `NO_MEETINGS` so a caller with no Google link — and every
   * existing test — renders exactly as before.
   */
  meetings?: Array<Meeting>
```

Add the meeting class list next to `BLOCK_HOVER`:

```ts
/*
 * A MEETING IS AN OUTLINE, AN ENTRY IS A FILL.
 *
 * DESIGN.md leaves exactly one axis free here and it happens to be the right
 * one. `enlarger` means *a timer is running* (the Cold Light Rule) and cannot be
 * spent on a meeting. Hue means money under the Two Temperatures Rule and blocks
 * take none. A dashed border plus hatch is the Hatch Rule's midnight
 * continuation and is already spoken for.
 *
 * What is left is FILL, and an unfilled block is a true statement: this is
 * scheduled time, not recorded time. It also reads correctly in peripheral
 * vision, which is where this page lives — the filled blocks are the day's
 * substance and the outlines are its plan.
 *
 * `bg-transparent` is stated rather than omitted: the lane behind it is
 * `surface`, and letting the block inherit nothing is what makes the ghost read
 * as a hole in the grid rather than as a second surface.
 */
const MEETING_BLOCK = cn(
  "mx-0.5 mb-px overflow-hidden rounded-md px-1 py-0.5 text-left",
  "border border-edge-soft bg-transparent text-muted-foreground",
  "hover:bg-[color-mix(in_oklch,var(--surface),var(--foreground)_5%)]"
)

/**
 * The empty meetings list, ONE allocation for the life of the module.
 *
 * A `meetings = []` default — or a `?? []` in the page above — mints a fresh
 * array on every render, and this component re-renders once a second. That array
 * is in the `events` memo's dependency list, so a new one busts the memo every
 * tick and reallocates the whole events array forever: exactly the defect the
 * `clockMs` comment below was written to fix, reintroduced through the door
 * beside it. Exported so the page uses the same constant rather than its own
 * literal.
 */
export const NO_MEETINGS: Array<Meeting> = []
```

- [ ] **Step 4: Merge the two event populations**

Replace the `events` memo:

```ts
  /*
   * ONE ARRAY, TWO POPULATIONS.
   *
   * FullCalendar takes a single `events` array and hands back a single
   * `EventApi` from `eventClick`, so the discriminator has to travel on
   * `extendedProps` rather than in a second source. `isMeetingEvent` is the only
   * place that is read.
   *
   * `meetings` is NOT in the clock's dependency: a meeting's end is a stored
   * instant, so nothing in that half of the array moves with `nowMs`.
   */
  const events = useMemo(
    () => [...calendarEvents(entries, clockMs), ...meetingEvents(meetings)],
    [entries, clockMs, meetings]
  )
```

Add to the destructured props: `meetings = NO_MEETINGS,`.

- [ ] **Step 5: Route the class list, the content, and the click**

In `columnEventClass`, return early for a meeting:

```ts
      columnEventClass={(info) => {
        const props = propsOf(info.event)
        if (isMeetingEvent(props)) return cn(MEETING_BLOCK, BLOCK_INTERACTIVE)

        const running = props.endedAt === null
        // ... existing body unchanged
```

In `eventContent`, **replace** the existing first line —
`const { projectId, startedAt, endedAt } = propsOf(info.event)` — with the block
below. It must be a replacement, not an insertion: after `propsOf` is widened in
the next step, destructuring its union directly no longer typechecks, and
`isMeetingEvent` is what narrows it. The destructure moves below the branch, off
the narrowed `props`.

```ts
        const props = propsOf(info.event)
        if (isMeetingEvent(props)) {
          return (
            <div
              title={`${titleOf(info.event)} — ${formatTimeRange(props.startedAt, props.endedAt, timeZone, use12Hour)}`}
              className="flex min-w-0 flex-col gap-0.5"
            >
              <span className="truncate text-xs font-medium">
                {titleOf(info.event)}
              </span>
              <span className="font-mono tabular-nums tracking-[-0.02em] truncate text-[0.6875rem]">
                {formatTimeRange(
                  props.startedAt,
                  props.endedAt,
                  timeZone,
                  use12Hour
                )}
              </span>
            </div>
          )
        }

        // Narrowed to an entry from here down. This is the line that used to
        // open the hook.
        const { projectId, startedAt, endedAt } = props
```

In `eventClick`, branch on the same predicate:

```ts
      eventClick={(info) => {
        info.jsEvent.preventDefault()
        const props = propsOf(info.event)
        if (isMeetingEvent(props)) {
          setSelectedMeeting({
            calendarId: props.calendarId,
            eventId: props.eventId,
            anchor: info.el,
          })
          return
        }
        setSelected({ entryId: props.entryId, anchor: info.el })
      }}
```

Add the selection state beside `selected`:

```ts
  /*
   * The MEETING being read, looked up from `meetings` on every render for the
   * same reason `editing` is looked up from `entries`: a sync that removes the
   * event — cancelled in Google, or the calendar hidden — closes the popover by
   * simply not finding it, with no second flag that could disagree.
   */
  const [selectedMeeting, setSelectedMeeting] = useState<{
    calendarId: string
    eventId: string
    anchor: HTMLElement
  } | null>(null)

  const reading =
    selectedMeeting === null
      ? null
      : (meetings.find(
          (meeting) =>
            meeting.calendarId === selectedMeeting.calendarId &&
            meeting.eventId === selectedMeeting.eventId
        ) ?? null)
```

Widen `propsOf`'s return type:

```ts
function propsOf(event: EventApi): CalendarEventProps | MeetingEventProps {
  return event.extendedProps as CalendarEventProps | MeetingEventProps
}
```

Set `eventOrder` on the `<Calendar>` so entries hold the primary column:

```ts
      /*
       * ENTRIES FIRST when a meeting and an entry share a window.
       *
       * This only happens on a calendar that is shown but whose meetings have
       * produced no entries — a tracked meeting's ghost is not drawn at all. In
       * that case the two pack side by side, which is the honest picture of
       * working through a meeting, and the RECORDED thing should hold the left
       * column: it is the one that counts toward the total and can be edited.
       *
       * A function rather than a field name, because the ordering key is which
       * population a block belongs to and that lives on `extendedProps`.
       */
      eventOrder={(a: unknown, b: unknown) => {
        const rank = (event: unknown) =>
          isMeetingEvent(
            (event as { extendedProps: CalendarEventProps | MeetingEventProps })
              .extendedProps
          )
            ? 1
            : 0
        return rank(a) - rank(b)
      }}
```

Render the popover beside the entry one:

```tsx
      {selectedMeeting === null || reading === null ? null : (
        <CalendarMeetingPopover
          meeting={reading}
          anchor={selectedMeeting.anchor}
          onClose={() => setSelectedMeeting(null)}
          timeZone={timeZone}
          use12Hour={use12Hour}
        />
      )}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/components/calendar/calendar-panel.test.tsx`
Expected: PASS — including the pre-existing assertions, which must not change.

- [ ] **Step 7: Commit**

```bash
git add src/components/calendar/calendar-panel.tsx src/components/calendar/calendar-panel.test.tsx
git commit -m "feat(calendar): draw google meetings as outlined ghost blocks"
```

---

## Task 10: The meeting detail popover

**Files:**
- Create: `src/components/calendar/calendar-meeting-popover.tsx`
- Test: `src/components/calendar/calendar-meeting-popover.test.tsx`

**Interfaces:**
- Consumes: `Meeting` (Task 8).
- Produces: `CalendarMeetingPopover({ meeting, anchor, onClose, timeZone, use12Hour })`.

Read `src/components/calendar/calendar-entry-popover.tsx` first: it owns the
Base UI positioner setup, the anchor prop, and the close behaviour this component
must match exactly. Reuse that structure — do not invent a second popover
pattern.

- [ ] **Step 1: Write the failing test**

Create `src/components/calendar/calendar-meeting-popover.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { CalendarMeetingPopover } from "@/components/calendar/calendar-meeting-popover"
import type { Meeting } from "@/lib/calendar-meetings"
import type { Id } from "../../../convex/_generated/dataModel"

afterEach(cleanup)

const START = Date.parse("2026-08-17T02:00:00.000Z")

function meeting(over: Partial<Meeting> = {}): Meeting {
  return {
    _id: "ge_1" as Id<"googleEvents">,
    _creationTime: START,
    userId: "user_alice",
    calendarId: "primary",
    eventId: "evt_1",
    title: "Sprint planning",
    startedAt: START,
    endedAt: START + 3_600_000,
    isAllDay: false,
    status: "confirmed",
    myResponse: "accepted",
    attendees: [],
    attendeeCount: 0,
    googleUpdatedAt: START,
    updatedAt: START,
    trackOnStart: false,
    entryId: null,
    ...over,
  }
}

function show(over: Partial<Meeting> = {}) {
  const anchor = document.createElement("div")
  document.body.appendChild(anchor)
  render(
    <CalendarMeetingPopover
      meeting={meeting(over)}
      anchor={anchor}
      onClose={vi.fn()}
      timeZone="Asia/Manila"
      use12Hour
    />
  )
}

describe("CalendarMeetingPopover", () => {
  it("shows the title and the time range in the app's own format", () => {
    show()
    expect(screen.getByText("Sprint planning")).toBeTruthy()
    // 02:00 UTC is 10:00 in Asia/Manila. Through `formatTimeRange`, so a meeting
    // is spelled exactly like an entry.
    expect(screen.getByText(/10:00 AM – 11:00 AM/)).toBeTruthy()
  })

  it("names an untitled meeting rather than rendering a blank heading", () => {
    show({ title: "" })
    expect(screen.getByText("Untitled")).toBeTruthy()
  })

  it("lists attendees with their response", () => {
    show({
      attendees: [
        { name: "Ana", email: "ana@example.com", response: "accepted" },
        { email: "bo@example.com", response: "needsAction" },
      ],
      attendeeCount: 2,
    })
    expect(screen.getByText("Ana")).toBeTruthy()
    expect(screen.getByText("bo@example.com")).toBeTruthy()
    expect(screen.getByText(/Accepted/)).toBeTruthy()
    expect(screen.getByText(/No response/)).toBeTruthy()
  })

  it("says how many attendees were not listed", () => {
    show({
      attendees: [{ email: "a@example.com", response: "accepted" }],
      attendeeCount: 51,
    })
    // Honesty about a capped list. A truncated roster that looks complete is
    // worse than one that says it is truncated.
    expect(screen.getByText(/50 more/)).toBeTruthy()
  })

  it("renders the conference link and the link out to Google", () => {
    show({
      conferenceUrl: "https://meet.google.com/abc-defg",
      htmlLink: "https://calendar.google.com/event?eid=x",
    })
    expect(
      screen.getByRole("link", { name: /Join/i }).getAttribute("href")
    ).toBe("https://meet.google.com/abc-defg")
    expect(
      screen.getByRole("link", { name: /Google Calendar/i }).getAttribute("href")
    ).toBe("https://calendar.google.com/event?eid=x")
  })

  it("omits the conference row when there is no link", () => {
    show()
    expect(screen.queryByRole("link", { name: /Join/i })).toBeNull()
  })

  it("has no editable control anywhere in it", () => {
    show({ description: "Agenda: everything" })
    // Read-only by decision. Phase 2 adds exactly one control here — the tick —
    // and nothing else in this popover ever writes.
    expect(screen.queryAllByRole("textbox")).toEqual([])
    expect(screen.queryAllByRole("combobox")).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/calendar/calendar-meeting-popover.test.tsx`
Expected: FAIL — cannot resolve the component.

- [ ] **Step 3: Write the component**

Create `src/components/calendar/calendar-meeting-popover.tsx`.

**The outer shell is copied from `calendar-entry-popover.tsx`, verbatim in
structure**: the same Base UI `Popover` root / positioner / popup elements, the
same `anchor` wiring, the same close-on-Escape and close-on-outside-click
behaviour, the same popup class list. Open that file, take its wrapper, and change
only what is inside the popup. One popover pattern on this grid, not two — and do
not extract a shared shell component as part of this task, because that touches a
working file for a refactor nobody asked for.

The code below is what goes **inside** that popup, plus the module-level constant
above the component: it is the whole body of the file apart from the shell.

```tsx
/** How Google's RSVP strings read to a human. Google's own vocabulary is
 *  `needsAction`, which means nothing to anyone outside its API docs. */
const RESPONSE_LABEL: Record<string, string> = {
  accepted: "Accepted",
  declined: "Declined",
  tentative: "Maybe",
  needsAction: "No response",
}

export function CalendarMeetingPopover({
  meeting,
  anchor,
  onClose,
  timeZone,
  use12Hour,
}: {
  meeting: Meeting
  anchor: HTMLElement
  onClose: () => void
  timeZone: string
  use12Hour: boolean
}) {
  /*
   * READ-ONLY, and that is the whole design of this component.
   *
   * It exists so the user stops leaving the tracker to look a meeting up. Every
   * value in it is Google's, none of it is editable here, and the link out is
   * what handles "actually I need to change this". Phase 2 adds exactly one
   * control — the track-on-start tick — and nothing else in here will ever
   * write.
   */
  const title = meeting.title.trim() === "" ? "Untitled" : meeting.title
  const listed = meeting.attendees.length
  const unlisted = Math.max(0, meeting.attendeeCount - listed)

  return (
    // ⟨ the shell from calendar-entry-popover.tsx wraps everything below, taking
    //   `anchor` and `onClose` exactly as it does there ⟩
    <>
      <div className="grid gap-3 p-3">
        <div className="grid gap-1">
          <span className="text-sm font-medium text-foreground">{title}</span>
          {/* Through `formatTimeRange`, never a local format: a meeting must be
              spelled exactly like the same window on an entry, or one screen
              carries two clocks. The Tabular Rule applies to every digit. */}
          <span className="font-mono tabular-nums tracking-[-0.02em] text-xs text-muted-foreground">
            {formatTimeRange(
              meeting.startedAt,
              meeting.endedAt,
              timeZone,
              use12Hour
            )}
          </span>
        </div>

        {meeting.location === undefined ? null : (
          <span className="text-xs text-muted-foreground">
            {meeting.location}
          </span>
        )}

        {meeting.conferenceUrl === undefined ? null : (
          <a
            href={meeting.conferenceUrl}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-foreground underline underline-offset-2"
          >
            Join the call
          </a>
        )}

        {meeting.organizer?.name === undefined &&
        meeting.organizer?.email === undefined ? null : (
          <span className="text-xs text-muted-foreground">
            Organised by {meeting.organizer.name ?? meeting.organizer.email}
          </span>
        )}

        {listed === 0 ? null : (
          <ul className="grid gap-1">
            {meeting.attendees.map((attendee) => (
              <li
                key={attendee.email ?? attendee.name}
                className="flex items-baseline justify-between gap-3 text-xs"
              >
                <span className="truncate text-foreground">
                  {attendee.name ?? attendee.email}
                </span>
                {/* The RSVP as TEXT, never as a colour alone — PRODUCT.md's rule
                    that meaning is never encoded in hue, which matters here
                    because "declined" and "accepted" are the two a user scans
                    for. */}
                <span className="shrink-0 text-muted-foreground">
                  {RESPONSE_LABEL[attendee.response] ?? attendee.response}
                </span>
              </li>
            ))}
            {unlisted === 0 ? null : (
              <li className="text-xs text-muted-foreground">
                and {unlisted} more
              </li>
            )}
          </ul>
        )}

        {meeting.description === undefined ? null : (
          // `whitespace-pre-wrap`, like a party block on an invoice: this is
          // prose a human wrote, newlines and all. Never parsed, never linkified
          // — rendering someone else's HTML from a calendar invite is not a thing
          // this app is going to do.
          <p className="max-h-40 overflow-y-auto whitespace-pre-wrap text-xs text-muted-foreground">
            {meeting.description}
          </p>
        )}

        {meeting.htmlLink === undefined ? null : (
          <a
            href={meeting.htmlLink}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-muted-foreground underline underline-offset-2"
          >
            Open in Google Calendar
          </a>
        )}
      </div>
    </>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/calendar/calendar-meeting-popover.test.tsx`
Expected: PASS, 7 tests.

- [ ] **Step 5: Run the calendar suite and commit**

```bash
npx vitest run src/components/calendar/
git add src/components/calendar/calendar-meeting-popover.tsx src/components/calendar/calendar-meeting-popover.test.tsx
git commit -m "feat(calendar): read-only meeting detail popover"
```

---

## Task 11: Wire the meetings query into /timer

**Files:**
- Modify: `src/routes/_authed/timer.tsx`

**Interfaces:**
- Consumes: `api.google.listMeetings` (Task 7), the `meetings` prop (Task 9).
- Produces: nothing new.

- [ ] **Step 1: Read how the page already queries entries for the range**

```bash
grep -n "rangeOf\|useQuery\|convexQuery\|range\." src/routes/_authed/timer.tsx | head -30
```

The meetings query must be keyed on the SAME `range.fromMs`/`range.toMs` the
entries query uses, and must not be keyed on `nowMs`.

- [ ] **Step 2: Add the query beside the entries one**

Following whatever pattern the grep showed (`useQuery(convexQuery(...))` from
`@convex-dev/react-query`):

```tsx
  /*
   * Google meetings for the drawn range.
   *
   * Keyed on the SAME two instants as the entries query — `rangeOf` is the one
   * computation both come from, so the grid cannot draw meetings for one week
   * and entries for another. NOT keyed on `nowMs`: a meeting's window is stored,
   * so nothing here moves with the clock, and including it would refetch once a
   * second for the life of the tab on a page this product calls an always-open
   * companion.
   */
  const meetings = useQuery(
    convexQuery(api.google.listMeetings, {
      fromMs: range.fromMs,
      toMs: range.toMs,
    })
  )
```

Pass it down, falling back to the panel's own shared empty array:

```tsx
        meetings={meetings.data ?? NO_MEETINGS}
```

`NO_MEETINGS` from `@/components/calendar/calendar-panel`, **not** a `?? []`
literal: a fresh array here is a new dependency for the panel's `events` memo on
every render, which rebuilds the whole events array once a second. Same defect,
one level up.

A fallback rather than a loading gate, because the grid is useful the instant the
entries arrive — holding the page for the Google half would make an unconnected
account wait on a query that will always return nothing.

- [ ] **Step 3: Verify in the browser**

Start the dev server through the preview tooling (never `npm run dev` in a
shell), open /timer, and confirm: the grid renders as before with no Google
account linked, the console has no errors, and no query loops (the network panel
shows one `listMeetings` per range change, not one per second).

- [ ] **Step 4: Typecheck, full suite, commit**

```bash
npm run typecheck
npx vitest run
git add src/routes/_authed/timer.tsx
git commit -m "feat(timer): load google meetings for the drawn range"
```

---

## Task 12: The Google Calendar settings section

**Files:**
- Create: `src/components/settings/google-calendar-section.tsx`
- Modify: `src/routes/_authed/settings.tsx`
- Test: `src/components/settings/google-calendar-section.test.tsx`

**Interfaces:**
- Consumes: `api.google.connection`, `api.google.listCalendars`,
  `api.google.connect`, `api.google.disconnect`,
  `api.google.setCalendarShow`, `api.google.setCalendarProject`.
- Produces: `GoogleCalendarSection({ connection, calendars, projects, actions })`
  — a presentational component taking its data and its writes as props, so it
  renders against fixtures with no backend anywhere near it. This is the same
  shape `EntryRow` and `CalendarPanel` already use.

- [ ] **Step 1: Write the failing test**

Create `src/components/settings/google-calendar-section.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { GoogleCalendarSection } from "@/components/settings/google-calendar-section"
import type { Doc, Id } from "../../../convex/_generated/dataModel"

afterEach(cleanup)

const NOW = Date.parse("2026-08-17T09:00:00.000Z")

function calendar(over: Partial<Doc<"googleCalendars">> = {}) {
  return {
    _id: "gc_1" as Id<"googleCalendars">,
    _creationTime: NOW,
    userId: "user_alice",
    googleId: "primary",
    summary: "Brent",
    show: false,
    syncToken: null,
    lastSyncedAt: null,
    updatedAt: NOW,
    ...over,
  } as Doc<"googleCalendars">
}

const noActions = {
  connect: vi.fn(),
  disconnect: vi.fn(),
  setShow: vi.fn(),
  setProject: vi.fn(),
}

describe("GoogleCalendarSection", () => {
  it("offers to connect when nothing is linked", () => {
    render(
      <GoogleCalendarSection
        connection={{ connected: false, status: "ok", lastSyncedAt: null }}
        calendars={[]}
        projects={[]}
        actions={noActions}
      />
    )
    expect(screen.getByRole("button", { name: /Connect Google/i })).toBeTruthy()
    expect(screen.queryByRole("switch")).toBeNull()
  })

  it("lists calendars with a Show control once connected", () => {
    render(
      <GoogleCalendarSection
        connection={{ connected: true, status: "ok", lastSyncedAt: NOW }}
        calendars={[calendar(), calendar({ _id: "gc_2" as Id<"googleCalendars">, googleId: "team", summary: "Team" })]}
        projects={[]}
        actions={noActions}
      />
    )
    expect(screen.getByText("Brent")).toBeTruthy()
    expect(screen.getByText("Team")).toBeTruthy()
    expect(screen.getAllByRole("switch")).toHaveLength(2)
  })

  it("calls setShow with the calendar's google id", () => {
    const setShow = vi.fn()
    render(
      <GoogleCalendarSection
        connection={{ connected: true, status: "ok", lastSyncedAt: NOW }}
        calendars={[calendar()]}
        projects={[]}
        actions={{ ...noActions, setShow }}
      />
    )
    fireEvent.click(screen.getByRole("switch"))
    expect(setShow).toHaveBeenCalledWith("primary", true)
  })

  it("shows the re-consent banner when the grant was revoked", () => {
    render(
      <GoogleCalendarSection
        connection={{ connected: true, status: "reauth", lastSyncedAt: NOW }}
        calendars={[calendar({ show: true })]}
        projects={[]}
        actions={noActions}
      />
    )
    // The banner is the ONLY thing that tells a user their calendar stopped
    // syncing. Without it the grid simply goes quiet, which reads as "no
    // meetings this week".
    expect(screen.getByText(/lost access/i)).toBeTruthy()
    expect(screen.getByRole("button", { name: /Reconnect/i })).toBeTruthy()
  })

  it("disables the project picker on a hidden calendar", () => {
    // A hidden calendar is not mirrored, so nothing it holds can become an
    // entry, so a default project on it would be a setting with no effect.
    render(
      <GoogleCalendarSection
        connection={{ connected: true, status: "ok", lastSyncedAt: NOW }}
        calendars={[calendar({ show: false })]}
        projects={[]}
        actions={noActions}
      />
    )
    expect(
      screen.getByRole("button", { name: /project/i }).getAttribute("disabled")
    ).not.toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/settings/google-calendar-section.test.tsx`
Expected: FAIL — cannot resolve the component.

- [ ] **Step 3: Write the component**

Read `src/components/classifiers/classifier-pickers.tsx` for the project picker's
props and `src/routes/_authed/settings.tsx` for the `Switch` import path, then
create `src/components/settings/google-calendar-section.tsx`:

```tsx
import { Switch } from "@/components/ui/switch"
import { ProjectPicker } from "@/components/classifiers/classifier-pickers"
import type { Doc, Id } from "../../../convex/_generated/dataModel"

/*
 * The Google Calendar settings block.
 *
 * PRESENTATIONAL: its data and its writes both arrive as props, exactly as
 * `EntryRow` and `CalendarPanel` take theirs. That is what lets it render against
 * fixtures with no backend anywhere near it, and it keeps every write in this
 * feature originating in one place — the page.
 *
 * THERE IS NO AUTO-TRACK SWITCH HERE, and its absence is the design. An earlier
 * draft had one: nominate a calendar and every meeting on it would interrupt
 * whatever was running. It was replaced by a checkbox on the individual meeting
 * (Phase 2), because a per-calendar switch has to GUESS which meetings were worth
 * interrupting for — an accepted-RSVP test, a sole-attendee test, a grace window
 * — and PRODUCT.md rules out guessing on the user's behalf. Do not add one back.
 */

export type GoogleConnectionStatus = {
  connected: boolean
  status: "ok" | "reauth"
  lastSyncedAt: number | null
}

export type GoogleCalendarActions = {
  connect: () => void
  disconnect: () => void
  setShow: (googleId: string, show: boolean) => void
  setProject: (googleId: string, projectId: Id<"projects"> | null) => void
}

export function GoogleCalendarSection({
  connection,
  calendars,
  projects,
  actions,
}: {
  connection: GoogleConnectionStatus
  calendars: Array<Doc<"googleCalendars">>
  projects: Array<Doc<"projects">>
  actions: GoogleCalendarActions
}) {
  if (!connection.connected) {
    return (
      <div className="grid gap-2">
        <p className="text-sm text-muted-foreground">
          Show your meetings on the calendar view, and read the details without
          leaving this tab. Chroneli only ever reads — nothing is written back to
          Google.
        </p>
        <button
          type="button"
          onClick={actions.connect}
          className="justify-self-start rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-ground"
        >
          Connect Google Calendar
        </button>
      </div>
    )
  }

  return (
    <div className="grid gap-4">
      {/*
        THE RE-CONSENT BANNER, as a SENTENCE.
        It is the only thing that tells a user their calendar stopped syncing —
        without it the grid simply goes quiet, which reads as "no meetings this
        week" rather than as a broken connection. Text and a button, never a
        coloured dot: PRODUCT.md's rule that meaning is never carried by hue
        alone, and this is the case that rule exists for.
      */}
      {connection.status === "reauth" ? (
        <div className="grid gap-2 rounded-md border border-edge-raised p-3">
          <p className="text-sm text-foreground">
            Chroneli has lost access to your Google Calendar, so meetings have
            stopped updating. Reconnect to start syncing again.
          </p>
          <button
            type="button"
            onClick={actions.connect}
            className="justify-self-start rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-ground"
          >
            Reconnect
          </button>
        </div>
      ) : null}

      <ul className="grid gap-3">
        {calendars.map((calendar) => (
          <li
            key={calendar._id}
            className="flex flex-wrap items-center justify-between gap-3"
          >
            <span className="min-w-0 flex-1 truncate text-sm text-foreground">
              {calendar.summary}
            </span>

            {/*
              The project entries made from this calendar's meetings inherit.
              DISABLED while the calendar is hidden: a hidden calendar is not
              mirrored, so nothing on it can become an entry, so a default project
              there is a setting with no effect — and a control that does nothing
              is worse than no control.
            */}
            <ProjectPicker
              projects={projects}
              value={calendar.defaultProjectId ?? null}
              disabled={!calendar.show}
              onChange={(projectId) =>
                actions.setProject(calendar.googleId, projectId)
              }
            />

            <Switch
              checked={calendar.show}
              onCheckedChange={(next) =>
                actions.setShow(calendar.googleId, next)
              }
              aria-label={`Show ${calendar.summary} on the calendar view`}
            />
          </li>
        ))}
      </ul>

      <div className="flex items-center justify-between gap-3">
        {/* Through the app's own time formatter, never a raw timestamp — and
            nothing at all before the first sync, because "never" as a date reads
            as a fault. */}
        <span className="text-xs text-muted-foreground">
          {connection.lastSyncedAt === null
            ? "Not synced yet"
            : `Last synced ${formatTimeOfInstant(connection.lastSyncedAt, timeZone, use12Hour)}`}
        </span>
        <button
          type="button"
          onClick={actions.disconnect}
          className="text-xs text-muted-foreground underline underline-offset-2"
        >
          Disconnect
        </button>
      </div>
    </div>
  )
}
```

Two details to settle while writing it, because they depend on files this task
touches rather than on anything decided here:

1. `ProjectPicker` may not be the exported name or may not take `disabled` — use
   whatever `classifier-pickers.tsx` actually exports, and if it has no disabled
   state, wrap it in a `<div aria-disabled>` with `pointer-events-none` and give
   the test's `getByRole("button", { name: /project/i })` something with a real
   `disabled` attribute to find.
2. The "Last synced" line needs `timeZone` and `use12Hour`. Add both to the props
   type and thread them from the settings page's `settings` query, the same way
   every other formatted time on that page gets them.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/settings/google-calendar-section.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 5: Mount it in /settings**

In `src/routes/_authed/settings.tsx`, add the queries and the mutations and
render the section inside the file's existing `Section` wrapper.

**The connect flow is two hops with a full page navigation between them**, and
that is the thing to get right:

```tsx
  /*
   * `linkSocial`, never `signIn.social`.
   *
   * This ADDS Google to an existing email-and-password identity rather than
   * replacing it: the password login keeps working, and
   * `revokeSessionsOnPasswordReset` keeps meaning what it says. Signing in with
   * Google instead would strand anyone who set this up on a second device.
   */
  const connect = () => {
    void authClient.linkSocial({
      provider: "google",
      callbackURL: window.location.href,
    })
  }

  /*
   * HOP TWO, after Google redirects back.
   *
   * `linkSocial` leaves the page, so nothing can be awaited after it — the
   * `google.connect` mutation has to run on the way BACK IN. This effect is that
   * moment: a Google account now exists on the identity, and our
   * `googleConnections` row does not.
   *
   * The mutation is idempotent (it patches an existing row to "ok" rather than
   * inserting a second), so the guard is an optimisation and not a correctness
   * condition — which is what makes it safe to run on every load.
   */
  useEffect(() => {
    if (connection.data === undefined || connection.data.connected) return
    let cancelled = false
    void authClient.listAccounts().then((result) => {
      const linked = (result.data ?? []).some(
        (account) => account.providerId === "google"
      )
      if (linked && !cancelled) void connectMutation({})
    })
    return () => {
      cancelled = true
    }
  }, [connection.data, connectMutation])

- [ ] **Step 6: Verify the whole flow in the browser**

With `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` set on the dev deployment:

1. Open /settings, click Connect Google, complete consent.
2. Confirm the calendar list appears within a few seconds (the immediate
   `syncAccount` schedule from `connect`).
3. Turn Show on for the primary calendar.
4. Open /timer and confirm meetings appear as outlined blocks with no fill.
5. Click one and confirm the popover shows attendees and links out.
6. Turn Show off and confirm the blocks disappear.
7. Click Disconnect and confirm the section returns to the Connect state.

- [ ] **Step 7: Full verification and commit**

```bash
npm run typecheck
npm run lint
npx vitest run
git add src/components/settings/google-calendar-section.tsx src/components/settings/google-calendar-section.test.tsx src/routes/_authed/settings.tsx
git commit -m "feat(settings): connect google calendar and choose which to show"
```

---

## Phase 1 done when

- [ ] `npm run typecheck` clean on both tsconfigs
- [ ] `npm run lint` clean
- [ ] `npx vitest run` green, including every pre-existing test
- [ ] The browser walkthrough in Task 12 Step 6 passes end to end
- [ ] No `timeEntries` row is created, patched, or deleted by any code added in
      this phase — verify with
      `grep -rn "timeEntries" convex/google.ts convex/googleEvents.ts convex/googleApi.ts`,
      which should match only the `v.id("timeEntries")` type references in the
      tracking table's validators

Phase 2 (the per-meeting checkbox, `googleTick`, backfill, **Track this**, and
the undo toast) gets its own plan, written against this phase's shipped shapes.
