# Google Calendar Link — Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A ticked meeting stops whatever is running and starts itself, at its own start instant, with a way back.

**Architecture:** Three server jobs and three write mutations, all keyed on one
idempotency string. `googleTick` is a one-minute cron that asks the mirror "is a
ticked meeting starting?" and switches the timer if so. Backfill rides
`googleSync`'s tail and materialises ticked meetings that already ended. Every
entry a meeting produces carries `clientKey = gcal:{calendarId}:{eventId}`, so
no two paths can create two entries for one meeting, and the link survives
`googleEventTracking` being wrong.

**Tech Stack:** Convex (internalAction / internalMutation / crons /
`convex-test`), TanStack Start + React 19, FullCalendar v7, Vitest, Tailwind 4.

## Global Constraints

Copied verbatim from `docs/superpowers/specs/2026-08-17-google-calendar-link-design.md`.

- **Nothing seizes the timer that the user did not personally point at.** The
  tick *is* the consent. No RSVP heuristic, no sole-attendee test, no grace
  window, no rule anywhere that decides on the user's behalf whether a meeting
  was worth interrupting for.
- **Read-only against Google.** Nothing in this phase writes to Google.
- Which meetings become entries: **"Only ones the user ticked. Nothing else, ever."**
- When: **"At its start instant: the running entry is closed there and a new running entry opens there."**
- What stops it: **"The user, or the next ticked meeting. Never a scheduled end."**
- Missed switch: **"Backfilled as a completed entry over the event's window on the next sync."**
- Backfill over tracked time: **"Skipped. A live entry covering the window wins."**
- The entry's note: **"Left empty. The event description is never copied into it."**
- Ineligible: **all-day and cancelled. That is the whole list.** Declined,
  tentative and unanswered are all eligible.
- `timeEntries` schema change: **none.** A fourth legal `source` value, `"calendar"`.
- Two ticked meetings in one minute: **latest `startedAt` wins, `eventId` breaks the tie.**
- Every time in the UI goes through `formatTimeRange`. Text, never colour alone.
- `convex/lib/entryTimes.ts` is the **sole writer** of `durationMs`. Nothing in
  this plan writes that field directly; it goes through `startImpl` /
  `createImpl` / `closeEntry`, which already do.
- No network in tests. HTTP is mocked at the `fetch` boundary.

## Parallel execution

Work stays on `master`. Tasks inside a wave touch disjoint files and may run
concurrently; a wave does not start until the previous one is committed.

| Wave | Tasks | Files each owns |
| --- | --- | --- |
| A | 1, 2 | 1: `schema.ts`, `entries.ts`, `googleTrack.ts` · 2: `googleEvents.ts` |
| B | 3, 4, 5 | 3: `googleTrack.ts` · 4: `googleTick.ts`, `crons.ts` · 5: `googleBackfill.ts`, `google.ts` |
| C | 6 | `calendar-panel.tsx`, `timer.tsx`, `calendar-meetings.ts` |
| D | 7, 8 | 7: `calendar-meeting-popover.tsx` · 8: `use-switch-undo.ts`, `timer.tsx` |

Wave B's three tasks all consume Task 1's exports and Task 2's predicates. They
do not consume each other.

**`convex/_generated/api.d.ts` is owned by nobody.** It is a tracked file, and a
new module under `convex/` does not appear in `internal.*` until
`npx convex codegen` regenerates it — so Tasks 4 and 5 must each RUN it, or
their own tests cannot call the mutation they just wrote. Neither may COMMIT it:
two agents regenerating one generated file concurrently is the one way this
wave can corrupt itself. Whoever closes the wave runs `npx convex codegen` once
more and commits the result, which by then names every new module.

Task 1 hit this first and committed the file because it ran alone. Tasks 3, 6,
7 and 8 add no new Convex module and need none of this.

## File Structure

**New**

- `convex/googleTrack.ts` — the write path's shared core and the three
  user-facing mutations. Separate from `google.ts` because that file is the
  read/mirror side and says so in its header; this one is the only place in the
  feature that creates a `timeEntries` row.
- `convex/googleTick.ts` — the one-minute cron: find due switches, switch.
- `convex/googleBackfill.ts` — the pass that runs on `googleSync`'s tail.
- `src/lib/use-switch-undo.ts` — the client hook that notices a switch happened
  and offers the way back.

**Modified**

- `convex/schema.ts` — one index. No table changes; `googleEventTracking`
  already carries `trackOnStart`, `entryId` and `interruptedEntryId`.
- `convex/entries.ts` — `startImpl` exported and given a `source` parameter;
  `createImpl`'s `source` union widened by one value.
- `convex/googleEvents.ts` — the pure eligibility and selection predicates.
- `convex/google.ts` — one scheduler call on `syncAccount`'s tail.
- `convex/crons.ts` — the one-minute tick.
- `src/lib/calendar-meetings.ts` — `MeetingEventProps` gains `startable`.
- `src/components/calendar/calendar-panel.tsx` — the checkbox, the handlers
  plumbed to the popover.
- `src/components/calendar/calendar-meeting-popover.tsx` — the tick, or
  **Track this** on a meeting that has already started.
- `src/routes/_authed/timer.tsx` — the mutations, and the undo hook.

---

## Task 1: The write path's foundation

Everything else in this plan calls `materialiseMeeting`. It is the only function
that inserts an entry from a meeting, which is what makes "one meeting, one
entry" a property of the code rather than a rule three callers have to remember.

**Files:**
- Modify: `convex/schema.ts` (the `googleEventTracking` index list, ~line 594)
- Modify: `convex/entries.ts` (`startImpl` ~line 1357, `CreateArgs` ~line 2040)
- Create: `convex/googleTrack.ts`
- Test: `convex/googleTrack.test.ts`

**Interfaces:**
- Consumes: `createImpl` (already exported from `entries.ts`), `getOwned`,
  `requireUserId`, `traceError`.
- Produces:
  ```ts
  // convex/googleTrack.ts
  export function meetingClientKey(calendarId: string, eventId: string): string
  export function parseMeetingClientKey(
    clientKey: string
  ): { calendarId: string; eventId: string } | null
  export type MaterialiseMode = "live" | "completed"
  export type Materialised = {
    entryId: Id<"timeEntries">
    interruptedEntryId: Id<"timeEntries"> | null
  }
  export async function materialiseMeeting(
    ctx: MutationCtx,
    userId: string,
    event: Doc<"googleEvents">,
    mode: MaterialiseMode
  ): Promise<Materialised | null>
  export async function trackingRow(
    ctx: MutationCtx | QueryCtx,
    userId: string,
    calendarId: string,
    eventId: string
  ): Promise<Doc<"googleEventTracking"> | null>
  export async function upsertTracking(
    ctx: MutationCtx,
    userId: string,
    calendarId: string,
    eventId: string,
    patch: Partial<Pick<Doc<"googleEventTracking">,
      "trackOnStart" | "entryId" | "interruptedEntryId">>
  ): Promise<Id<"googleEventTracking">>

  // convex/entries.ts
  export { startImpl }   // now exported, alongside the existing createImpl
  ```
  `startImpl`'s args type gains `source?: "web" | "calendar"`.
  `createImpl`'s `CreateArgs["source"]` becomes `"manual" | "import" | "calendar"`.

- [ ] **Step 1: Write the failing tests**

Create `convex/googleTrack.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { convexTest } from "convex-test"
import schema from "./schema"
import { internal } from "./_generated/api"
import { meetingClientKey, parseMeetingClientKey } from "./googleTrack"
import { modules } from "./test.setup"

const USER = "user_alice"
/** Seeded from the real clock, never a literal. A fixture instant compared
 *  against `Date.now()` inside a mutation passes for a day and then fails on
 *  its own — this suite has already been bitten by exactly that. */
const NOW = Date.now()
const HOUR = 60 * 60 * 1_000

/** A mirrored meeting, as `googleSync` would have written it. */
function eventRow(over: Record<string, unknown> = {}) {
  return {
    userId: USER,
    calendarId: "primary",
    eventId: "evt_standup",
    title: "Team standup",
    startedAt: NOW,
    endedAt: NOW + 30 * 60 * 1_000,
    isAllDay: false,
    status: "confirmed",
    myResponse: "accepted",
    attendees: [],
    attendeeCount: 0,
    googleUpdatedAt: NOW,
    updatedAt: NOW,
    ...over,
  }
}

describe("meetingClientKey", () => {
  it("round-trips a calendar id that contains an @", () => {
    const key = meetingClientKey("brent@gmail.com", "evt_1")
    expect(key).toBe("gcal:brent@gmail.com:evt_1")
    expect(parseMeetingClientKey(key)).toEqual({
      calendarId: "brent@gmail.com",
      eventId: "evt_1",
    })
  })

  it("keeps a colon inside the calendar id on the calendar's side", () => {
    // The event id is the LAST segment, never the second. A Google calendar id
    // is an address and addresses have held stranger things than a colon;
    // splitting from the left would silently move half of one into the other.
    expect(parseMeetingClientKey("gcal:a:b:evt_1")).toEqual({
      calendarId: "a:b",
      eventId: "evt_1",
    })
  })

  it("refuses a clientKey that is not one of ours", () => {
    expect(parseMeetingClientKey("0192f3a4-uuid-v7")).toBeNull()
    expect(parseMeetingClientKey("gcal:onlyonepart")).toBeNull()
  })
})

describe("materialiseMeeting", () => {
  it("closes the running entry at the meeting's start and opens one there", async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      await ctx.db.insert("googleEvents", eventRow())
    })
    const before = await t.mutation(internal.entries.startAs, {
      userId: USER,
      clientKey: "before",
      title: "Deep work",
      startedAt: NOW - 45 * 60 * 1_000,
    })

    const result = await t.mutation(internal.googleTrack.materialiseForTest, {
      userId: USER,
      calendarId: "primary",
      eventId: "evt_standup",
      mode: "live",
    })
    expect(result).not.toBeNull()

    const entries = await t.run(
      async (ctx) => await ctx.db.query("timeEntries").collect()
    )
    const closed = entries.find((e) => e._id === before.entryId)
    const opened = entries.find((e) => e._id === result.entryId)

    // No gap and no overlap: one entry ends on the instant the next begins.
    expect(closed.endedAt).toBe(NOW)
    expect(closed.durationMs).toBe(45 * 60 * 1_000)
    expect(opened.startedAt).toBe(NOW)
    expect(opened.endedAt).toBeNull()
    expect(opened.title).toBe("Team standup")
    expect(opened.source).toBe("calendar")
    // The description is never copied into the note. See the spec.
    expect(opened.note).toBeUndefined()
    expect(result.interruptedEntryId).toBe(before.entryId)
  })

  it("opens a running entry with no interruption when nothing was running", async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      await ctx.db.insert("googleEvents", eventRow())
    })
    const result = await t.mutation(internal.googleTrack.materialiseForTest, {
      userId: USER,
      calendarId: "primary",
      eventId: "evt_standup",
      mode: "live",
    })
    expect(result.interruptedEntryId).toBeNull()
  })

  it("creates a completed entry over the meeting's own window", async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      await ctx.db.insert("googleEvents", eventRow({ endedAt: NOW + HOUR }))
    })
    const result = await t.mutation(internal.googleTrack.materialiseForTest, {
      userId: USER,
      calendarId: "primary",
      eventId: "evt_standup",
      mode: "completed",
    })
    const entry = await t.run(async (ctx) => await ctx.db.get(result.entryId))
    expect(entry.startedAt).toBe(NOW)
    expect(entry.endedAt).toBe(NOW + HOUR)
    expect(entry.durationMs).toBe(HOUR)
  })

  it("does not touch a running entry when it materialises a completed one", async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      await ctx.db.insert("googleEvents", eventRow({ endedAt: NOW + HOUR }))
    })
    const running = await t.mutation(internal.entries.startAs, {
      userId: USER,
      clientKey: "running",
      title: "Deep work",
    })
    await t.mutation(internal.googleTrack.materialiseForTest, {
      userId: USER,
      calendarId: "primary",
      eventId: "evt_standup",
      mode: "completed",
    })
    const still = await t.run(async (ctx) => await ctx.db.get(running.entryId))
    expect(still.endedAt).toBeNull()
  })

  it("is a no-op the second time, through clientKey", async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      await ctx.db.insert("googleEvents", eventRow())
    })
    const first = await t.mutation(internal.googleTrack.materialiseForTest, {
      userId: USER,
      calendarId: "primary",
      eventId: "evt_standup",
      mode: "live",
    })
    const second = await t.mutation(internal.googleTrack.materialiseForTest, {
      userId: USER,
      calendarId: "primary",
      eventId: "evt_standup",
      mode: "live",
    })
    expect(second.entryId).toBe(first.entryId)
    const entries = await t.run(
      async (ctx) => await ctx.db.query("timeEntries").collect()
    )
    expect(entries).toHaveLength(1)
  })

  it("takes the project and billable flag from the calendar's default", async () => {
    const t = convexTest(schema, modules)
    const projectId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("projects", {
        userId: USER,
        name: "Acme",
        color: "amber",
        archived: false,
        billableByDefault: true,
        updatedAt: NOW,
        deletedAt: null,
      })
      await ctx.db.insert("googleCalendars", {
        userId: USER,
        googleId: "primary",
        name: "Work",
        show: true,
        defaultProjectId: id,
        updatedAt: NOW,
      })
      await ctx.db.insert("googleEvents", eventRow())
      return id
    })
    const result = await t.mutation(internal.googleTrack.materialiseForTest, {
      userId: USER,
      calendarId: "primary",
      eventId: "evt_standup",
      mode: "live",
    })
    const entry = await t.run(async (ctx) => await ctx.db.get(result.entryId))
    expect(entry.projectId).toBe(projectId)
    expect(entry.billable).toBe(true)
  })

  it("refuses a meeting longer than the duration ceiling instead of throwing", async () => {
    // `createImpl` applies the 24-hour policy ceiling to typed durations and
    // THROWS when it is exceeded. A backfill batch that throws stops, taking
    // every later meeting in the page with it — so the length is checked here
    // and the meeting is skipped, which is a null return and not an error.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      await ctx.db.insert("googleEvents", eventRow({ endedAt: NOW + 30 * HOUR }))
    })
    const result = await t.mutation(internal.googleTrack.materialiseForTest, {
      userId: USER,
      calendarId: "primary",
      eventId: "evt_standup",
      mode: "completed",
    })
    expect(result).toBeNull()
    const entries = await t.run(
      async (ctx) => await ctx.db.query("timeEntries").collect()
    )
    expect(entries).toHaveLength(0)
  })

  it("records entryId and interruptedEntryId on the tracking row", async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      await ctx.db.insert("googleEvents", eventRow())
    })
    const before = await t.mutation(internal.entries.startAs, {
      userId: USER,
      clientKey: "before",
      title: "Deep work",
      startedAt: NOW - 60_000,
    })
    const result = await t.mutation(internal.googleTrack.materialiseForTest, {
      userId: USER,
      calendarId: "primary",
      eventId: "evt_standup",
      mode: "live",
    })
    const tracking = await t.run(
      async (ctx) => await ctx.db.query("googleEventTracking").collect()
    )
    expect(tracking).toHaveLength(1)
    expect(tracking[0].entryId).toBe(result.entryId)
    expect(tracking[0].interruptedEntryId).toBe(before.entryId)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run convex/googleTrack.test.ts
```

Expected: FAIL — `Cannot find module './googleTrack'`.

- [ ] **Step 3: Add the index**

In `convex/schema.ts`, replace the `googleEventTracking` table definition:

```ts
  googleEventTracking: defineTable(googleEventTrackingFields)
    .index("by_user_calendar_event", ["userId", "calendarId", "eventId"])
    /*
     * The tick's and the backfill's work list: ticked, not yet materialised.
     *
     * `entryId` trails `trackOnStart` so `(userId, true, null)` is an exact key
     * range rather than a scan of every ticked meeting the user has ever had.
     * The set it returns shrinks every time a meeting is materialised, so it
     * stays small without a prune — which is what lets both jobs read it every
     * minute.
     */
    .index("by_user_track_entry", ["userId", "trackOnStart", "entryId"]),
```

- [ ] **Step 4: Plumb `source` through the two entry constructors**

In `convex/entries.ts`, add `source` to `StartArgs`:

```ts
type StartArgs = {
  clientKey: string
  title?: string
  startedAt?: number
  projectId?: Id<"projects">
  tagIds?: Array<Id<"tags">>
  billable?: boolean
  /**
   * How the row got here, for `timeEntries.source`. Internal callers only —
   * `startArgs` does not carry it, so the public `start` mutation cannot be
   * made to claim a switch happened. `convex/googleTrack.ts` is the only
   * caller that passes it.
   */
  source?: "web" | "calendar"
}
```

In `startImpl`'s insert, replace `source: "web",` with:

```ts
    source: args.source ?? "web",
```

Export it, immediately above `export const start =`:

```ts
/** Exported for `convex/googleTrack.ts`, which needs the atomic close-and-open
 *  this performs and must not reimplement it: the handoff instant, the clamp
 *  and the clientKey replay are the three things a second copy would get subtly
 *  wrong. A mutation cannot call another mutation in Convex, so it calls this. */
export { startImpl }
```

Widen `CreateArgs["source"]`:

```ts
  source?: "manual" | "import" | "calendar"
```

- [ ] **Step 5: Write `convex/googleTrack.ts`**

```ts
import { v } from "convex/values"
import { internalMutation } from "./_generated/server"
import { createImpl, startImpl } from "./entries"
import { MAX_DURATION_MS } from "./lib/duration"
import type { MutationCtx, QueryCtx } from "./_generated/server"
import type { Doc, Id } from "./_generated/dataModel"

/*
 * Google Calendar: the write side.
 *
 * The one place in this feature that creates a `timeEntries` row. `google.ts`
 * beside it is the read/mirror side and creates none — the split is what makes
 * "which code can put a number on an invoice" answerable by looking at one file.
 */

/**
 * The dedupe key, and the durable link between an entry and its meeting.
 *
 * `clientKey` already exists for exactly this — the schema calls it what "makes
 * a create idempotent" — and `by_user_clientKey` is already indexed. So "have I
 * made an entry for this meeting?" is one indexed read, the live switch and the
 * backfill cannot both create one, and the link SURVIVES `googleEventTracking`
 * being wrong or absent. A random UUID would have none of those properties.
 *
 * A recurring meeting is a series of instances and Google gives each instance
 * its own `eventId`, so daily standups do not collide.
 */
export function meetingClientKey(calendarId: string, eventId: string): string {
  return `gcal:${calendarId}:${eventId}`
}

/**
 * The inverse, which is what lets undo find a meeting from its entry.
 *
 * Splitting from the RIGHT, not the left: a Google calendar id is an address,
 * and while a colon in one would be strange it is not forbidden, whereas the
 * event id is Google's own base32hex and cannot contain one. Taking the last
 * segment as the event id is therefore always right; taking the second segment
 * as the calendar id would only usually be.
 */
export function parseMeetingClientKey(
  clientKey: string
): { calendarId: string; eventId: string } | null {
  const parts = clientKey.split(":")
  if (parts.length < 3) return null
  if (parts[0] !== "gcal") return null
  const eventId = parts[parts.length - 1]
  const calendarId = parts.slice(1, -1).join(":")
  if (calendarId === "" || eventId === "") return null
  return { calendarId, eventId }
}

export async function trackingRow(
  ctx: MutationCtx | QueryCtx,
  userId: string,
  calendarId: string,
  eventId: string
): Promise<Doc<"googleEventTracking"> | null> {
  return await ctx.db
    .query("googleEventTracking")
    .withIndex("by_user_calendar_event", (q) =>
      q.eq("userId", userId).eq("calendarId", calendarId).eq("eventId", eventId)
    )
    .unique()
}

/**
 * Upsert of our facts about an event.
 *
 * Separate from `googleEvents` on purpose, and the schema says why: that table
 * holds Google's facts and is replaceable at any sync, this one holds the
 * user's and is never pruned. A tick therefore survives its meeting drifting
 * out of the mirror window.
 */
export async function upsertTracking(
  ctx: MutationCtx,
  userId: string,
  calendarId: string,
  eventId: string,
  patch: Partial<
    Pick<
      Doc<"googleEventTracking">,
      "trackOnStart" | "entryId" | "interruptedEntryId"
    >
  >
): Promise<Id<"googleEventTracking">> {
  const now = Date.now()
  const existing = await trackingRow(ctx, userId, calendarId, eventId)
  if (existing !== null) {
    await ctx.db.patch(existing._id, { ...patch, updatedAt: now })
    return existing._id
  }
  return await ctx.db.insert("googleEventTracking", {
    userId,
    calendarId,
    eventId,
    trackOnStart: patch.trackOnStart ?? false,
    entryId: patch.entryId ?? null,
    interruptedEntryId: patch.interruptedEntryId ?? null,
    updatedAt: now,
  })
}

export type MaterialiseMode = "live" | "completed"

export type Materialised = {
  entryId: Id<"timeEntries">
  /** What the switch closed, so undo can reopen it. Always null for
   *  "completed", which closes nothing. */
  interruptedEntryId: Id<"timeEntries"> | null
}

/**
 * Turns a meeting into an entry. The only function that does.
 *
 * `live` closes the running entry at the meeting's start instant and opens a
 * running entry there — one gesture, one transaction, no window in which two
 * timers run or none do. `completed` writes a closed entry over the meeting's
 * own window and does not touch the timer at all.
 *
 * Returns `null` when the meeting cannot become an entry. That is a skip, not a
 * failure: a batch that threw here would take every later meeting in the page
 * down with it.
 */
export async function materialiseMeeting(
  ctx: MutationCtx,
  userId: string,
  event: Doc<"googleEvents">,
  mode: MaterialiseMode
): Promise<Materialised | null> {
  const clientKey = meetingClientKey(event.calendarId, event.eventId)

  /*
   * The calendar's default project, and through it the project's billable flag.
   *
   * Read here rather than passed in because both jobs need the same answer and
   * neither has a reason to know how classification works. A calendar row that
   * is missing — hidden and drained, say — is not an error: an unclassified
   * entry is a normal state everywhere else in this product.
   */
  const calendar = await ctx.db
    .query("googleCalendars")
    .withIndex("by_user_googleId", (q) =>
      q.eq("userId", userId).eq("googleId", event.calendarId)
    )
    .unique()
  const projectId = calendar?.defaultProjectId

  if (mode === "live") {
    const started = await startImpl(ctx, userId, {
      clientKey,
      title: event.title,
      startedAt: event.startedAt,
      projectId,
      source: "calendar",
    })
    const interruptedEntryId = started.stoppedEntryIds[0] ?? null
    await upsertTracking(ctx, userId, event.calendarId, event.eventId, {
      entryId: started.entryId,
      // A replay must not overwrite a real interruption with null. `replayed`
      // is exactly the signal that this transaction closed nothing.
      ...(started.replayed ? {} : { interruptedEntryId }),
    })
    return {
      entryId: started.entryId,
      interruptedEntryId: started.replayed ? null : interruptedEntryId,
    }
  }

  /*
   * THE CEILING IS CHECKED HERE, not left to `createImpl`.
   *
   * `createImpl` applies the 24-hour policy ceiling to typed durations and
   * throws when it is exceeded — correct there, because a person typed it and
   * can see the refusal. Nobody is watching a cron, so a 30-hour event (rare,
   * but legal and not all-day) would kill the batch. Skipping is the honest
   * outcome: the meeting stays ghosted and tickable, and nothing is recorded
   * that the user cannot account for.
   */
  if (event.endedAt - event.startedAt > MAX_DURATION_MS) return null
  if (event.endedAt <= event.startedAt) return null

  const created = await createImpl(ctx, userId, {
    clientKey,
    title: event.title,
    startedAt: event.startedAt,
    endedAt: event.endedAt,
    projectId,
    source: "calendar",
  })
  await upsertTracking(ctx, userId, event.calendarId, event.eventId, {
    entryId: created.entryId,
  })
  return { entryId: created.entryId, interruptedEntryId: null }
}

/** Test-only. Named `*ForTest` so the audit "what can reach my data" reads
 *  honestly: this is internal, so it is unreachable from a client. */
export const materialiseForTest = internalMutation({
  args: {
    userId: v.string(),
    calendarId: v.string(),
    eventId: v.string(),
    mode: v.union(v.literal("live"), v.literal("completed")),
  },
  returns: v.union(
    v.object({
      entryId: v.id("timeEntries"),
      interruptedEntryId: v.union(v.id("timeEntries"), v.null()),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const event = await ctx.db
      .query("googleEvents")
      .withIndex("by_user_calendar_event", (q) =>
        q
          .eq("userId", args.userId)
          .eq("calendarId", args.calendarId)
          .eq("eventId", args.eventId)
      )
      .unique()
    if (event === null) return null
    return await materialiseMeeting(ctx, args.userId, event, args.mode)
  },
})
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
npx vitest run convex/googleTrack.test.ts
```

Expected: PASS, 11 tests.

- [ ] **Step 7: Run the gates**

```bash
npm run typecheck && npm run lint && npx vitest run convex/entries.test.ts convex/import.test.ts
```

Expected: clean, and the existing entry suites still pass — `startImpl`'s
default keeps `source: "web"` for every caller that does not pass one.

- [ ] **Step 8: Commit**

```bash
git add convex/schema.ts convex/entries.ts convex/googleTrack.ts convex/googleTrack.test.ts && git commit -m "feat(calendar): one function turns a meeting into an entry"
```

---

## Task 2: The predicates, pure

Runs concurrently with Task 1 — different file, no shared symbols.

**Files:**
- Modify: `convex/googleEvents.ts` (append; the existing `mapGoogleEvent` and
  `isDrawable` are untouched)
- Test: `convex/googleEvents.test.ts` (append a describe block)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces:
  ```ts
  export type TrackableEvent = { isAllDay: boolean; status: string }
  export function isTrackable(event: TrackableEvent): boolean

  export const SWITCH_LOOKBACK_MS: number   // 10 * 60 * 1_000
  export function isDueForSwitch(startedAt: number, now: number): boolean

  export type SwitchCandidate = { eventId: string; startedAt: number }
  export function pickSwitch<T extends SwitchCandidate>(candidates: Array<T>): T | null

  export type EntrySpan = { startedAt: number; endedAt: number | null }
  export function overlapsWindow(
    entry: EntrySpan,
    windowStart: number,
    windowEnd: number,
    now: number
  ): boolean
  ```

- [ ] **Step 1: Write the failing tests**

Append to `convex/googleEvents.test.ts` (and add the five names to the existing
import from `./googleEvents`):

```ts
describe("isTrackable", () => {
  it("accepts an ordinary confirmed meeting", () => {
    expect(isTrackable({ isAllDay: false, status: "confirmed" })).toBe(true)
  })

  it("refuses an all-day event, which has no clock", () => {
    expect(isTrackable({ isAllDay: true, status: "confirmed" })).toBe(false)
  })

  it("refuses a cancelled meeting, which did not happen", () => {
    expect(isTrackable({ isAllDay: false, status: "cancelled" })).toBe(false)
  })

  it("accepts a meeting the user did not accept", () => {
    // The tick already said what the user wanted. Re-deciding it from an RSVP
    // is exactly the guess this design exists to remove — someone who declines
    // an invite and attends anyway is describing a normal Tuesday.
    expect(isTrackable({ isAllDay: false, status: "tentative" })).toBe(true)
  })
})

describe("isDueForSwitch", () => {
  const now = Date.parse("2026-08-20T10:00:00.000Z")

  it("is due for a meeting that started this minute", () => {
    expect(isDueForSwitch(now, now)).toBe(true)
    expect(isDueForSwitch(now - 30_000, now)).toBe(true)
  })

  it("is due anywhere inside the lookback, so a missed tick recovers", () => {
    expect(isDueForSwitch(now - SWITCH_LOOKBACK_MS + 1, now)).toBe(true)
  })

  it("is not due for a meeting older than the lookback", () => {
    // The blast radius. This is what stops a meeting that started three hours
    // ago from seizing the timer when a deployment comes back up; anything
    // older falls to backfill and becomes a completed entry over its own
    // window instead of stealing the present.
    expect(isDueForSwitch(now - SWITCH_LOOKBACK_MS - 1, now)).toBe(false)
  })

  it("is not due for a meeting that has not started", () => {
    expect(isDueForSwitch(now + 1, now)).toBe(false)
  })
})

describe("pickSwitch", () => {
  it("takes the latest start when two meetings are both due", () => {
    const picked = pickSwitch([
      { eventId: "a", startedAt: 100 },
      { eventId: "b", startedAt: 200 },
    ])
    expect(picked.eventId).toBe("b")
  })

  it("breaks a tie on eventId, so the outcome is deterministic", () => {
    // One running entry, always — the product's oldest invariant. Which of two
    // simultaneous meetings wins matters less than that it is the same one on
    // every retry of the same minute.
    const picked = pickSwitch([
      { eventId: "zulu", startedAt: 100 },
      { eventId: "alpha", startedAt: 100 },
    ])
    expect(picked.eventId).toBe("alpha")
  })

  it("is null for an empty list", () => {
    expect(pickSwitch([])).toBeNull()
  })
})

describe("overlapsWindow", () => {
  const now = Date.parse("2026-08-20T12:00:00.000Z")
  const start = Date.parse("2026-08-20T10:00:00.000Z")
  const end = Date.parse("2026-08-20T11:00:00.000Z")

  it("is true for a completed entry sitting inside the window", () => {
    expect(
      overlapsWindow({ startedAt: start + 60_000, endedAt: end - 60_000 }, start, end, now)
    ).toBe(true)
  })

  it("is true for an entry that straddles the start", () => {
    expect(
      overlapsWindow({ startedAt: start - 60_000, endedAt: start + 60_000 }, start, end, now)
    ).toBe(true)
  })

  it("is false for an entry that ends exactly when the window opens", () => {
    // Touching is not overlapping. The switch's whole contract is that one
    // entry ends on the instant the next begins, so treating that as an
    // overlap would make every switched pair block its own backfill.
    expect(
      overlapsWindow({ startedAt: start - 60_000, endedAt: start }, start, end, now)
    ).toBe(false)
  })

  it("is false for an entry that starts exactly when the window closes", () => {
    expect(
      overlapsWindow({ startedAt: end, endedAt: end + 60_000 }, start, end, now)
    ).toBe(false)
  })

  it("treats a running entry as spanning up to now", () => {
    // The case with no endedAt to compare, and the one that matters: a timer
    // started at nine and still going at noon covers the ten o'clock meeting,
    // and backfilling over it would shadow real recorded time with the
    // calendar's plan for it.
    expect(
      overlapsWindow({ startedAt: start - 60 * 60 * 1_000, endedAt: null }, start, end, now)
    ).toBe(true)
  })

  it("is false for a running entry that started after the window closed", () => {
    expect(
      overlapsWindow({ startedAt: end + 60_000, endedAt: null }, start, end, now)
    ).toBe(false)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run convex/googleEvents.test.ts
```

Expected: FAIL — `isTrackable is not a function`.

- [ ] **Step 3: Append the implementation**

At the end of `convex/googleEvents.ts`:

```ts
/*
 * The predicates the two write jobs share.
 *
 * Pure, and here rather than beside their callers for the reason
 * `lib/entryTimes.ts` gives: a rule that decides whether billable time gets
 * recorded is worth testing directly, against its own table of cases, rather
 * than through a cron that has to be stood up to ask it one question.
 */

export type TrackableEvent = { isAllDay: boolean; status: string }

/**
 * Whether a meeting is allowed to become an entry AT ALL.
 *
 * Two rules, and both are mechanical rather than judgements: an all-day event
 * has no clock so it has no defensible span, and a cancelled meeting did not
 * happen. Declined, tentative and unanswered meetings are all trackable — the
 * user's tick already said what they wanted, and overriding it from an RSVP is
 * the guess this design exists to remove.
 */
export function isTrackable(event: TrackableEvent): boolean {
  return !event.isAllDay && event.status !== "cancelled"
}

/**
 * How far back the live switch will reach.
 *
 * Ten minutes is the blast radius: long enough that a tick missed to a deploy,
 * a cold start or a minute of Convex being busy still lands on the right
 * meeting, short enough that a deployment coming back after lunch cannot seize
 * the timer for something that finished hours ago.
 */
export const SWITCH_LOOKBACK_MS = 10 * 60 * 1_000

export function isDueForSwitch(startedAt: number, now: number): boolean {
  return startedAt <= now && startedAt > now - SWITCH_LOOKBACK_MS
}

export type SwitchCandidate = { eventId: string; startedAt: number }

/**
 * One meeting out of everything due this minute.
 *
 * Latest start wins, because the most recent thing to begin is the one the user
 * is in. `eventId` breaks the tie so that two meetings starting on the same
 * instant resolve the same way on every retry — the alternative is a switch
 * that flips between two entries as the cron re-runs.
 */
export function pickSwitch<T extends SwitchCandidate>(
  candidates: Array<T>
): T | null {
  let best: T | null = null
  for (const candidate of candidates) {
    if (best === null) {
      best = candidate
      continue
    }
    if (candidate.startedAt > best.startedAt) {
      best = candidate
      continue
    }
    if (
      candidate.startedAt === best.startedAt &&
      candidate.eventId < best.eventId
    ) {
      best = candidate
    }
  }
  return best
}

export type EntrySpan = { startedAt: number; endedAt: number | null }

/**
 * Whether recorded time already covers a meeting's window.
 *
 * THE OVERLAP RULE, and it lives here and only here — the backfill consults it,
 * the live switch does not need to, because the switch *closes* the running
 * entry and so cannot create an overlap.
 *
 * A running entry counts as spanning `[startedAt, now]`. Without that, a timer
 * running since nine would be invisible to this test at noon and every meeting
 * inside it would be backfilled on top of real recorded time.
 *
 * Touching endpoints do not overlap. One entry ending on the instant the next
 * begins is the switch's own contract, not a collision.
 */
export function overlapsWindow(
  entry: EntrySpan,
  windowStart: number,
  windowEnd: number,
  now: number
): boolean {
  const end = entry.endedAt ?? Math.max(now, entry.startedAt)
  return entry.startedAt < windowEnd && end > windowStart
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run convex/googleEvents.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add convex/googleEvents.ts convex/googleEvents.test.ts && git commit -m "feat(calendar): the rules the switch and the backfill share"
```

---

## Task 3: The three write mutations

`setTrackOnStart` is the checkbox. `trackNow` is **Track this** on a meeting
that has already started. `undoSwitch` is the way back.

**Files:**
- Modify: `convex/lib/codes.ts` (three new codes)
- Modify: `convex/googleTrack.ts` (append)
- Test: `convex/googleTrack.test.ts` (append)

**Interfaces:**
- Consumes: Task 1's `materialiseMeeting`, `parseMeetingClientKey`,
  `trackingRow`, `upsertTracking`; Task 2's `isTrackable`.
- Produces:
  ```ts
  export const UNDO_WINDOW_MS: number  // 5 * 60 * 1_000
  export const setTrackOnStart: mutation
    // { calendarId: string, eventId: string, track: boolean } => null
  export const setTrackOnStartForUser: internalMutation   // + userId
  export const trackNow: mutation
    // { calendarId: string, eventId: string } => { entryId } | null
  export const trackNowForUser: internalMutation          // + userId
  export const undoSwitch: mutation
    // { entryId: Id<"timeEntries"> } => null
  export const undoSwitchForUser: internalMutation        // + userId
  ```

- [ ] **Step 1: Write the failing tests**

Append to `convex/googleTrack.test.ts`:

```ts
describe("setTrackOnStart", () => {
  it("creates a tracking row the first time and flips it the second", async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      await ctx.db.insert("googleEvents", eventRow())
    })

    await t.mutation(internal.googleTrack.setTrackOnStartForUser, {
      userId: USER, calendarId: "primary", eventId: "evt_standup", track: true,
    })
    let rows = await t.run(
      async (ctx) => await ctx.db.query("googleEventTracking").collect()
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].trackOnStart).toBe(true)

    await t.mutation(internal.googleTrack.setTrackOnStartForUser, {
      userId: USER, calendarId: "primary", eventId: "evt_standup", track: false,
    })
    rows = await t.run(
      async (ctx) => await ctx.db.query("googleEventTracking").collect()
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].trackOnStart).toBe(false)
  })

  it("refuses to tick a meeting that is not on this account", async () => {
    const t = convexTest(schema, modules)
    await expect(
      t.mutation(internal.googleTrack.setTrackOnStartForUser, {
        userId: USER, calendarId: "primary", eventId: "nope", track: true,
      })
    ).rejects.toThrow()
  })

  it("refuses to tick an all-day event", async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      await ctx.db.insert("googleEvents", eventRow({ isAllDay: true }))
    })
    await expect(
      t.mutation(internal.googleTrack.setTrackOnStartForUser, {
        userId: USER, calendarId: "primary", eventId: "evt_standup", track: true,
      })
    ).rejects.toThrow()
  })

  it("leaves an already-materialised entry alone when the tick is removed", async () => {
    // Unticking is not undo. It stops a FUTURE switch; the entry that already
    // exists is recorded time, and only the user removes recorded time.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      await ctx.db.insert("googleEvents", eventRow())
    })
    const made = await t.mutation(internal.googleTrack.materialiseForTest, {
      userId: USER, calendarId: "primary", eventId: "evt_standup", mode: "live",
    })
    await t.mutation(internal.googleTrack.setTrackOnStartForUser, {
      userId: USER, calendarId: "primary", eventId: "evt_standup", track: false,
    })
    const entry = await t.run(async (ctx) => await ctx.db.get(made.entryId))
    expect(entry).not.toBeNull()
    expect(entry.deletedAt).toBeNull()
  })
})

describe("trackNow", () => {
  it("makes a completed entry for a meeting that has already ended", async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      await ctx.db.insert("googleEvents", eventRow({
        startedAt: NOW - 3 * HOUR,
        endedAt: NOW - 2 * HOUR,
      }))
    })
    const result = await t.mutation(internal.googleTrack.trackNowForUser, {
      userId: USER, calendarId: "primary", eventId: "evt_standup",
    })
    const entry = await t.run(async (ctx) => await ctx.db.get(result.entryId))
    expect(entry.endedAt).toBe(NOW - 2 * HOUR)
    expect(entry.source).toBe("calendar")
  })

  it("returns the existing entry rather than a second one", async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      await ctx.db.insert("googleEvents", eventRow({
        startedAt: NOW - 3 * HOUR,
        endedAt: NOW - 2 * HOUR,
      }))
    })
    const first = await t.mutation(internal.googleTrack.trackNowForUser, {
      userId: USER, calendarId: "primary", eventId: "evt_standup",
    })
    const second = await t.mutation(internal.googleTrack.trackNowForUser, {
      userId: USER, calendarId: "primary", eventId: "evt_standup",
    })
    expect(second.entryId).toBe(first.entryId)
  })

  it("takes the timer for a meeting that is still in progress", async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      await ctx.db.insert("googleEvents", eventRow({
        startedAt: NOW - 10 * 60_000,
        endedAt: NOW + 20 * 60_000,
      }))
    })
    const result = await t.mutation(internal.googleTrack.trackNowForUser, {
      userId: USER, calendarId: "primary", eventId: "evt_standup",
    })
    const entry = await t.run(async (ctx) => await ctx.db.get(result.entryId))
    // Running, and dated from the meeting's own start — pressing this at 10:10
    // for a meeting that began at 10:00 must not record it as ten minutes long.
    expect(entry.endedAt).toBeNull()
    expect(entry.startedAt).toBe(NOW - 10 * 60_000)
  })
})

describe("undoSwitch", () => {
  it("deletes the meeting entry and reopens the one it closed", async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      await ctx.db.insert("googleEvents", eventRow())
    })
    const before = await t.mutation(internal.entries.startAs, {
      userId: USER, clientKey: "before", title: "Deep work",
      startedAt: NOW - 45 * 60_000,
    })
    const switched = await t.mutation(internal.googleTrack.materialiseForTest, {
      userId: USER, calendarId: "primary", eventId: "evt_standup", mode: "live",
    })

    await t.mutation(internal.googleTrack.undoSwitchForUser, {
      userId: USER, entryId: switched.entryId,
    })

    const meeting = await t.run(async (ctx) => await ctx.db.get(switched.entryId))
    const reopened = await t.run(async (ctx) => await ctx.db.get(before.entryId))
    expect(meeting).toBeNull()
    expect(reopened.endedAt).toBeNull()
    expect(reopened.durationMs).toBeNull()
  })

  it("clears entryId so the ghost comes back, and unticks so it stays back", async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      await ctx.db.insert("googleEvents", eventRow())
    })
    const switched = await t.mutation(internal.googleTrack.materialiseForTest, {
      userId: USER, calendarId: "primary", eventId: "evt_standup", mode: "live",
    })
    await t.mutation(internal.googleTrack.undoSwitchForUser, {
      userId: USER, entryId: switched.entryId,
    })
    const rows = await t.run(
      async (ctx) => await ctx.db.query("googleEventTracking").collect()
    )
    expect(rows[0].entryId).toBeNull()
    // The tick must go OFF, or the very next cron minute switches straight back
    // in — an undo that undoes itself sixty seconds later is not an undo.
    expect(rows[0].trackOnStart).toBe(false)
  })

  it("just deletes when nothing was interrupted", async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      await ctx.db.insert("googleEvents", eventRow())
    })
    const switched = await t.mutation(internal.googleTrack.materialiseForTest, {
      userId: USER, calendarId: "primary", eventId: "evt_standup", mode: "live",
    })
    await t.mutation(internal.googleTrack.undoSwitchForUser, {
      userId: USER, entryId: switched.entryId,
    })
    const gone = await t.run(async (ctx) => await ctx.db.get(switched.entryId))
    expect(gone).toBeNull()
  })

  it("refuses an entry that is not a calendar switch", async () => {
    const t = convexTest(schema, modules)
    const typed = await t.mutation(internal.entries.startAs, {
      userId: USER, clientKey: "typed", title: "Deep work",
    })
    await expect(
      t.mutation(internal.googleTrack.undoSwitchForUser, {
        userId: USER, entryId: typed.entryId,
      })
    ).rejects.toThrow()
  })

  it("refuses a switch older than the undo window", async () => {
    // The client's toast is long gone by then. The server enforces the same
    // bound so a stale tab cannot reverse this morning's switch.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      await ctx.db.insert("googleEvents", eventRow({ startedAt: NOW - 2 * HOUR }))
    })
    const switched = await t.mutation(internal.googleTrack.materialiseForTest, {
      userId: USER, calendarId: "primary", eventId: "evt_standup", mode: "live",
    })
    await expect(
      t.mutation(internal.googleTrack.undoSwitchForUser, {
        userId: USER, entryId: switched.entryId,
      })
    ).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run to verify they fail**

```bash
npx vitest run convex/googleTrack.test.ts
```

Expected: FAIL — `setTrackOnStartForUser is not a function`.

- [ ] **Step 3: Add the three error codes**

`TraceErrorCode` is a closed union, so a code that is not in it is a compile
error rather than a runtime surprise. Append these to the union in
`convex/lib/codes.ts`, immediately after `"LIBRARY_FULL"` and before the
"THERE ARE NO GOOGLE CODES HERE" comment — and note what that comment demands:
*"add the code back with the throw in the same commit."* All three are thrown in
Step 4, in this commit.

```ts
  /** A meeting that cannot become an entry at all: all-day, so it has no clock,
   *  or cancelled, so it did not happen. Its own code rather than NOT_FOUND —
   *  the meeting is right there on the grid, and telling someone it does not
   *  exist would send them looking for a sync problem that is not there. */
  | "NOT_TRACKABLE"
  /** Undo was asked to reverse an entry that did not come from a meeting.
   *  Reachable only from a stale client, and reported rather than ignored: a
   *  silent no-op on an undo is the failure a user is least able to explain,
   *  because they pressed the recovery control and nothing changed. */
  | "NOT_A_SWITCH"
  /** The switch is older than the undo window. Distinct from NOT_A_SWITCH
   *  because the answer is different: that one means never, this one means the
   *  moment has passed and the entry is now ordinary recorded time the user can
   *  edit or delete like any other. */
  | "UNDO_EXPIRED"
```

- [ ] **Step 4: Append the implementation**

Extend the imports at the top of `convex/googleTrack.ts` with `mutation` (from
`./_generated/server`), `requireUserId` (from `./auth`), `isTrackable` (from
`./googleEvents`) and `traceError` (from `./errors`), then append:

```ts
async function eventRowOrThrow(
  ctx: MutationCtx,
  userId: string,
  calendarId: string,
  eventId: string
): Promise<Doc<"googleEvents">> {
  const event = await ctx.db
    .query("googleEvents")
    .withIndex("by_user_calendar_event", (q) =>
      q.eq("userId", userId).eq("calendarId", calendarId).eq("eventId", eventId)
    )
    .unique()
  // NOT_FOUND rather than a silent no-op: the client just drew a checkbox for
  // this meeting, so a miss means the mirror and the grid disagree, and the
  // user should be told rather than left ticking a box that does nothing.
  if (event === null) {
    traceError("NOT_FOUND", "That meeting is not on this account.")
  }
  if (!isTrackable(event)) {
    traceError("NOT_TRACKABLE", "That meeting cannot be tracked.")
  }
  return event
}

async function setTrackOnStartImpl(
  ctx: MutationCtx,
  userId: string,
  calendarId: string,
  eventId: string,
  track: boolean
) {
  await eventRowOrThrow(ctx, userId, calendarId, eventId)
  /*
   * The tick only ever governs a FUTURE switch.
   *
   * Unticking a meeting that already produced an entry deletes nothing: that
   * entry is recorded time, and this product does not remove recorded time on
   * the user's behalf anywhere else either. The ghost stays suppressed because
   * `entryId` is untouched.
   */
  await upsertTracking(ctx, userId, calendarId, eventId, { trackOnStart: track })
  return null
}

export const setTrackOnStart = mutation({
  args: { calendarId: v.string(), eventId: v.string(), track: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) =>
    await setTrackOnStartImpl(
      ctx,
      await requireUserId(ctx),
      args.calendarId,
      args.eventId,
      args.track
    ),
})

export const setTrackOnStartForUser = internalMutation({
  args: {
    userId: v.string(),
    calendarId: v.string(),
    eventId: v.string(),
    track: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) =>
    await setTrackOnStartImpl(
      ctx,
      args.userId,
      args.calendarId,
      args.eventId,
      args.track
    ),
})

const trackNowReturns = v.union(
  v.object({ entryId: v.id("timeEntries") }),
  v.null()
)

/**
 * **Track this** — the same materialisation the backfill runs, on demand.
 *
 * The path for a meeting that has already started or already finished, where a
 * tick has nothing left to fire. A meeting still in progress becomes the
 * running entry, dated from its own start; one that has ended becomes a
 * completed entry over its own window. Both are idempotent through `clientKey`,
 * so a double press returns the entry that already exists.
 */
async function trackNowImpl(
  ctx: MutationCtx,
  userId: string,
  calendarId: string,
  eventId: string
) {
  const event = await eventRowOrThrow(ctx, userId, calendarId, eventId)
  const mode = event.endedAt <= Date.now() ? "completed" : "live"
  const result = await materialiseMeeting(ctx, userId, event, mode)
  return result === null ? null : { entryId: result.entryId }
}

export const trackNow = mutation({
  args: { calendarId: v.string(), eventId: v.string() },
  returns: trackNowReturns,
  handler: async (ctx, args) =>
    await trackNowImpl(ctx, await requireUserId(ctx), args.calendarId, args.eventId),
})

export const trackNowForUser = internalMutation({
  args: { userId: v.string(), calendarId: v.string(), eventId: v.string() },
  returns: trackNowReturns,
  handler: async (ctx, args) =>
    await trackNowImpl(ctx, args.userId, args.calendarId, args.eventId),
})

/**
 * How long the way back stays open.
 *
 * Long enough to notice a wrong interruption, short enough that the offer is
 * not still on screen an hour into the call. The client uses the same number to
 * decide whether to OFFER; this one decides whether to ALLOW, so a stale tab
 * cannot reverse a switch from this morning.
 */
export const UNDO_WINDOW_MS = 5 * 60 * 1_000

/**
 * Reverses one switch: delete the meeting entry, reopen what it closed.
 *
 * The switch is the one write in this feature that happens at a moment the user
 * did not choose, so it is the one that gets a way back. Everything it needs is
 * derivable from the entry itself — `clientKey` names the meeting and the
 * tracking row names what was interrupted — so the client passes an entry id
 * and nothing else it could get wrong.
 */
async function undoSwitchImpl(
  ctx: MutationCtx,
  userId: string,
  entryId: Id<"timeEntries">
) {
  const entry = await ctx.db.get(entryId)
  if (entry === null || entry.userId !== userId) {
    traceError("NOT_FOUND", "That entry is not on this account.")
  }
  if (entry.source !== "calendar") {
    traceError("NOT_A_SWITCH", "That entry did not come from a meeting.")
  }
  const key = parseMeetingClientKey(entry.clientKey)
  if (key === null) {
    traceError("NOT_A_SWITCH", "That entry did not come from a meeting.")
  }
  if (Date.now() - entry.startedAt > UNDO_WINDOW_MS) {
    traceError("UNDO_EXPIRED", "That switch is too old to undo.")
  }

  const tracking = await trackingRow(ctx, userId, key.calendarId, key.eventId)
  const interrupted =
    tracking === null || tracking.interruptedEntryId === null
      ? null
      : await ctx.db.get(tracking.interruptedEntryId)

  // A HARD delete, not the soft one `remove` uses. This entry is being un-made
  // rather than removed: it records nothing the user did, and leaving it in the
  // trash would put a meeting they never tracked into their restore list.
  await ctx.db.delete(entry._id)

  if (interrupted !== null && interrupted.userId === userId) {
    await ctx.db.patch(interrupted._id, {
      endedAt: null,
      durationMs: null,
      updatedAt: Date.now(),
    })
  }

  if (tracking !== null) {
    await ctx.db.patch(tracking._id, {
      entryId: null,
      interruptedEntryId: null,
      trackOnStart: false,
      updatedAt: Date.now(),
    })
  }
  return null
}

export const undoSwitch = mutation({
  args: { entryId: v.id("timeEntries") },
  returns: v.null(),
  handler: async (ctx, args) =>
    await undoSwitchImpl(ctx, await requireUserId(ctx), args.entryId),
})

export const undoSwitchForUser = internalMutation({
  args: { userId: v.string(), entryId: v.id("timeEntries") },
  returns: v.null(),
  handler: async (ctx, args) => await undoSwitchImpl(ctx, args.userId, args.entryId),
})
```

- [ ] **Step 5: Run to verify they pass**

```bash
npx vitest run convex/googleTrack.test.ts
```

Expected: PASS.

- [ ] **Step 6: Gates**

```bash
npm run typecheck && npm run lint
```

- [ ] **Step 7: Commit**

```bash
git add convex/googleTrack.ts convex/googleTrack.test.ts && git commit -m "feat(calendar): tick a meeting, track a past one, take it back"
```

---

## Task 4: `googleTick`

**Files:**
- Create: `convex/googleTick.ts`
- Modify: `convex/crons.ts`
- Test: `convex/googleTick.test.ts`

**Interfaces:**
- Consumes: Task 1's `materialiseMeeting`; Task 2's `isDueForSwitch`,
  `isTrackable`, `pickSwitch`.
- Produces:
  ```ts
  export const TICK_USERS_LIMIT: number      // 200
  export const TICK_CANDIDATES_LIMIT: number // 100
  export const dueUsers: internalQuery({}) => Array<string>
  export const switchUser: internalMutation({ userId: string }) => null
  export const tickAll: internalAction({}) => null
  ```

- [ ] **Step 1: Write the failing tests**

Create `convex/googleTick.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { convexTest } from "convex-test"
import schema from "./schema"
import { internal } from "./_generated/api"
import { modules } from "./test.setup"

const USER = "user_alice"
/** Seeded from the real clock: this suite asserts against a lookback measured
 *  from `Date.now()` inside a mutation, and a fixed literal would pass today
 *  and fail tomorrow. */
const NOW = Date.now()
const HOUR = 60 * 60 * 1_000

async function seedMeeting(
  ctx: any,
  over: Record<string, unknown> = {},
  tracking: Record<string, unknown> = {}
) {
  const eventId = (over.eventId as string) ?? "evt_standup"
  await ctx.db.insert("googleEvents", {
    userId: USER,
    calendarId: "primary",
    eventId,
    title: "Team standup",
    startedAt: NOW - 30_000,
    endedAt: NOW + 30 * 60_000,
    isAllDay: false,
    status: "confirmed",
    myResponse: "accepted",
    attendees: [],
    attendeeCount: 0,
    googleUpdatedAt: NOW,
    updatedAt: NOW,
    ...over,
  })
  await ctx.db.insert("googleEventTracking", {
    userId: USER,
    calendarId: "primary",
    eventId,
    trackOnStart: true,
    entryId: null,
    interruptedEntryId: null,
    updatedAt: NOW,
    ...tracking,
  })
}

describe("switchUser", () => {
  it("switches the timer to a ticked meeting that just started", async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      await seedMeeting(ctx)
    })
    const before = await t.mutation(internal.entries.startAs, {
      userId: USER, clientKey: "before", title: "Deep work",
      startedAt: NOW - HOUR,
    })

    await t.mutation(internal.googleTick.switchUser, { userId: USER })

    const entries = await t.run(
      async (ctx) => await ctx.db.query("timeEntries").collect()
    )
    expect(entries).toHaveLength(2)
    const closed = entries.find((e) => e._id === before.entryId)
    const running = entries.find((e) => e.endedAt === null)
    // The record is exact even though the write landed late: both instants come
    // from the event, not from the clock the cron happened to fire on.
    expect(closed.endedAt).toBe(NOW - 30_000)
    expect(running.title).toBe("Team standup")
    expect(running.startedAt).toBe(NOW - 30_000)
  })

  it("does nothing for a meeting that was never ticked", async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      await seedMeeting(ctx, {}, { trackOnStart: false })
    })
    await t.mutation(internal.googleTick.switchUser, { userId: USER })
    const entries = await t.run(
      async (ctx) => await ctx.db.query("timeEntries").collect()
    )
    expect(entries).toHaveLength(0)
  })

  it("does nothing for a meeting that has not started yet", async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      await seedMeeting(ctx, { startedAt: NOW + HOUR })
    })
    await t.mutation(internal.googleTick.switchUser, { userId: USER })
    const entries = await t.run(
      async (ctx) => await ctx.db.query("timeEntries").collect()
    )
    expect(entries).toHaveLength(0)
  })

  it("does not seize the timer for a meeting older than the lookback", async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      await seedMeeting(ctx, { startedAt: NOW - 3 * HOUR })
    })
    await t.mutation(internal.googleTick.switchUser, { userId: USER })
    const entries = await t.run(
      async (ctx) => await ctx.db.query("timeEntries").collect()
    )
    // Falls to backfill instead, where it becomes a completed entry over its
    // own window rather than stealing the present.
    expect(entries).toHaveLength(0)
  })

  it("takes the latest start when two ticked meetings are both due", async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      await seedMeeting(ctx, { eventId: "early", startedAt: NOW - 300_000 })
      await seedMeeting(ctx, {
        eventId: "late", startedAt: NOW - 30_000, title: "Design review",
      })
    })
    await t.mutation(internal.googleTick.switchUser, { userId: USER })
    const entries = await t.run(
      async (ctx) => await ctx.db.query("timeEntries").collect()
    )
    // ONE running entry, always — the product's oldest invariant. The other
    // stays a ghost and falls to backfill.
    expect(entries).toHaveLength(1)
    expect(entries[0].title).toBe("Design review")
  })

  it("is a no-op on a second run in the same minute", async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      await seedMeeting(ctx)
    })
    await t.mutation(internal.googleTick.switchUser, { userId: USER })
    await t.mutation(internal.googleTick.switchUser, { userId: USER })
    const entries = await t.run(
      async (ctx) => await ctx.db.query("timeEntries").collect()
    )
    expect(entries).toHaveLength(1)
  })

  it("skips a meeting that was cancelled after it was ticked", async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      await seedMeeting(ctx, { status: "cancelled" })
    })
    await t.mutation(internal.googleTick.switchUser, { userId: USER })
    const entries = await t.run(
      async (ctx) => await ctx.db.query("timeEntries").collect()
    )
    expect(entries).toHaveLength(0)
  })

  it("switches even when the meeting was declined", async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      await seedMeeting(ctx, { myResponse: "declined" })
    })
    await t.mutation(internal.googleTick.switchUser, { userId: USER })
    const entries = await t.run(
      async (ctx) => await ctx.db.query("timeEntries").collect()
    )
    // The tick already said what the user wanted; an RSVP does not overrule it.
    expect(entries).toHaveLength(1)
  })

  it("survives a ticked meeting whose mirror row has been pruned", async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      await ctx.db.insert("googleEventTracking", {
        userId: USER, calendarId: "primary", eventId: "vanished",
        trackOnStart: true, entryId: null, interruptedEntryId: null,
        updatedAt: NOW,
      })
    })
    await t.mutation(internal.googleTick.switchUser, { userId: USER })
    const entries = await t.run(
      async (ctx) => await ctx.db.query("timeEntries").collect()
    )
    expect(entries).toHaveLength(0)
  })
})

describe("dueUsers", () => {
  it("names each user with a ticked, unmaterialised meeting exactly once", async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      await seedMeeting(ctx, { eventId: "a" })
      await seedMeeting(ctx, { eventId: "b" })
    })
    const users = await t.query(internal.googleTick.dueUsers, {})
    expect(users).toEqual([USER])
  })

  it("is empty when nothing is ticked", async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      await seedMeeting(ctx, {}, { trackOnStart: false })
    })
    const users = await t.query(internal.googleTick.dueUsers, {})
    expect(users).toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify they fail**

```bash
npx vitest run convex/googleTick.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write `convex/googleTick.ts`**

```ts
import { v } from "convex/values"
import { internalAction, internalMutation, internalQuery } from "./_generated/server"
import { internal } from "./_generated/api"
import { materialiseMeeting } from "./googleTrack"
import { isDueForSwitch, isTrackable, pickSwitch } from "./googleEvents"

/*
 * The switch, once a minute.
 *
 * DELIBERATELY A CRON READING THE MIRROR, not a `scheduler.runAt` per meeting.
 * A per-meeting job goes stale the moment the meeting moves in Google, needs
 * cancellation bookkeeping when it is unticked, and leaves orphans behind when
 * a calendar is disconnected. A cron that asks "is a ticked meeting starting?"
 * holds no state, so there is nothing to get out of step — it is self-healing
 * by construction.
 *
 * THE WRITE MAY LAND UP TO SIXTY SECONDS LATE AND THE RECORD IS STILL EXACT,
 * because both instants come from the event rather than from `Date.now()`.
 * What is late is the screen, not the data.
 */

/** A page of users, bounded so one cron minute cannot run unboundedly long. */
export const TICK_USERS_LIMIT = 200

/** Ticked-but-unmaterialised meetings read per user. The set shrinks every time
 *  one is materialised, so it is naturally small; the bound is here because
 *  "naturally small" is not a guarantee. */
export const TICK_CANDIDATES_LIMIT = 100

/**
 * Who has work this minute.
 *
 * Off `by_user_track_entry` at `trackOnStart: true, entryId: null`, so the scan
 * is over ticked-and-pending rows rather than over every user with a Google
 * connection. A user who has ticked nothing costs nothing.
 */
export const dueUsers = internalQuery({
  args: {},
  returns: v.array(v.string()),
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("googleEventTracking")
      .withIndex("by_user_track_entry", (q) =>
        q.eq("trackOnStart", true).eq("entryId", null)
      )
      .take(TICK_USERS_LIMIT)
    if (rows.length === TICK_USERS_LIMIT) {
      // `console.error`, not a throw — the same device `google.ts` uses for a
      // truncated page read. Some users being a minute late is recoverable
      // (the next minute catches them); a cron that throws is not. But this
      // product does not silently truncate, so it is said out loud.
      console.error("googleTick read a full page of pending ticks.", {
        limit: TICK_USERS_LIMIT,
      })
    }
    return [...new Set(rows.map((row) => row.userId))]
  },
})

/**
 * One user's switch, in one transaction.
 *
 * Reads the candidates and writes the switch atomically, which is what removes
 * the race against the user pressing stop at 09:59:58: the tick either sees the
 * running entry and replaces it, or sees nothing running and simply opens the
 * meeting entry. There is no interleaving in which both happen.
 */
export const switchUser = internalMutation({
  args: { userId: v.string() },
  returns: v.null(),
  handler: async (ctx, { userId }) => {
    const now = Date.now()

    const pending = await ctx.db
      .query("googleEventTracking")
      .withIndex("by_user_track_entry", (q) =>
        q.eq("userId", userId).eq("trackOnStart", true).eq("entryId", null)
      )
      .take(TICK_CANDIDATES_LIMIT)
    if (pending.length === 0) return null

    const candidates: Array<{
      eventId: string
      startedAt: number
      calendarId: string
    }> = []

    for (const row of pending) {
      const event = await ctx.db
        .query("googleEvents")
        .withIndex("by_user_calendar_event", (q) =>
          q
            .eq("userId", userId)
            .eq("calendarId", row.calendarId)
            .eq("eventId", row.eventId)
        )
        .unique()
      // A ticked meeting whose mirror row is gone — pruned, or deleted in
      // Google — is not an error. The tick survives in `googleEventTracking`,
      // which is never pruned, so if the event comes back so does the switch.
      if (event === null) continue
      if (!isTrackable(event)) continue
      if (!isDueForSwitch(event.startedAt, now)) continue
      candidates.push({
        eventId: event.eventId,
        startedAt: event.startedAt,
        calendarId: event.calendarId,
      })
    }

    const winner = pickSwitch(candidates)
    if (winner === null) return null

    const event = await ctx.db
      .query("googleEvents")
      .withIndex("by_user_calendar_event", (q) =>
        q
          .eq("userId", userId)
          .eq("calendarId", winner.calendarId)
          .eq("eventId", winner.eventId)
      )
      .unique()
    if (event === null) return null

    await materialiseMeeting(ctx, userId, event, "live")
    return null
  },
})

/**
 * The cron's entry point.
 *
 * One mutation per user rather than one for everybody: a transaction that
 * touched every user's timer would contend with every user's own writes, and an
 * OCC retry would redo all of it. Scheduled rather than awaited in a loop, so
 * one slow user cannot starve the rest of the minute.
 */
export const tickAll = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const users = await ctx.runQuery(internal.googleTick.dueUsers, {})
    for (const userId of users) {
      await ctx.scheduler.runAfter(0, internal.googleTick.switchUser, { userId })
    }
    return null
  },
})
```

- [ ] **Step 4: Register the cron**

In `convex/crons.ts`, before `export default crons`:

```ts
/*
 * A MINUTE, and the number is the whole design of the switch.
 *
 * It is the resolution of "the timer changed when my meeting started". Coarser
 * and the screen lags a switch the user is watching for; finer and the job runs
 * more often than the thing it watches for can happen. The RECORD is exact at
 * any interval — both instants come from the event, not from this clock — so
 * what this number buys is only how fast the screen catches up.
 */
crons.interval(
  "google calendar tick",
  { minutes: 1 },
  internal.googleTick.tickAll,
  {}
)
```

- [ ] **Step 5: Regenerate the API surface**

`internal.googleTick` does not exist until this runs — the tests call it, so
they cannot pass without it.

```bash
npx convex codegen
```

Do **not** `git add convex/_generated/api.d.ts`. Task 5 is regenerating the same
file concurrently; whoever closes the wave commits it once.

- [ ] **Step 6: Run to verify they pass**

```bash
npx vitest run convex/googleTick.test.ts
```

Expected: PASS, 11 tests.

- [ ] **Step 7: Gates**

```bash
npm run typecheck && npm run lint
```

- [ ] **Step 8: Commit**

```bash
git add convex/googleTick.ts convex/googleTick.test.ts convex/crons.ts && git commit -m "feat(calendar): a ticked meeting takes the timer at its own start instant"
```

---

## Task 5: The backfill

**Files:**
- Create: `convex/googleBackfill.ts`
- Modify: `convex/google.ts` (one scheduler call at the end of `syncAccount`)
- Test: `convex/googleBackfill.test.ts`

**Interfaces:**
- Consumes: Task 1's `materialiseMeeting`; Task 2's `isTrackable`,
  `overlapsWindow`.
- Produces:
  ```ts
  export const BACKFILL_WINDOW_MS: number       // 7 * 24 * 60 * 60 * 1_000
  export const BACKFILL_PER_USER_LIMIT: number  // 100
  export const backfillUser: internalMutation({ userId: string }) => null
  ```

- [ ] **Step 1: Write the failing tests**

Create `convex/googleBackfill.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { convexTest } from "convex-test"
import schema from "./schema"
import { internal } from "./_generated/api"
import { modules } from "./test.setup"

const USER = "user_alice"
const NOW = Date.now()
const HOUR = 60 * 60 * 1_000

/** A ticked meeting that ENDED two hours ago. */
async function seedPast(
  ctx: any,
  over: Record<string, unknown> = {},
  tracking: Record<string, unknown> = {}
) {
  const eventId = (over.eventId as string) ?? "evt_past"
  await ctx.db.insert("googleEvents", {
    userId: USER,
    calendarId: "primary",
    eventId,
    title: "Team standup",
    startedAt: NOW - 3 * HOUR,
    endedAt: NOW - 2 * HOUR,
    isAllDay: false,
    status: "confirmed",
    myResponse: "accepted",
    attendees: [],
    attendeeCount: 0,
    googleUpdatedAt: NOW,
    updatedAt: NOW,
    ...over,
  })
  await ctx.db.insert("googleEventTracking", {
    userId: USER,
    calendarId: "primary",
    eventId,
    trackOnStart: true,
    entryId: null,
    interruptedEntryId: null,
    updatedAt: NOW,
    ...tracking,
  })
}

describe("backfillUser", () => {
  it("creates a completed entry over a ticked meeting that already ended", async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      await seedPast(ctx)
    })
    await t.mutation(internal.googleBackfill.backfillUser, { userId: USER })
    const entries = await t.run(
      async (ctx) => await ctx.db.query("timeEntries").collect()
    )
    expect(entries).toHaveLength(1)
    expect(entries[0].startedAt).toBe(NOW - 3 * HOUR)
    expect(entries[0].endedAt).toBe(NOW - 2 * HOUR)
    expect(entries[0].source).toBe("calendar")
  })

  it("does not backfill an unticked meeting", async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      await seedPast(ctx, {}, { trackOnStart: false })
    })
    await t.mutation(internal.googleBackfill.backfillUser, { userId: USER })
    const entries = await t.run(
      async (ctx) => await ctx.db.query("timeEntries").collect()
    )
    expect(entries).toHaveLength(0)
  })

  it("skips a meeting whose window is already covered by tracked time", async () => {
    // The tracker's own record of what happened wins over the calendar's plan
    // for it.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      await seedPast(ctx)
    })
    await t.mutation(internal.entries.createAs, {
      userId: USER, clientKey: "typed", title: "Actually did this",
      startedAt: NOW - 3 * HOUR, endedAt: NOW - 2 * HOUR,
    })
    await t.mutation(internal.googleBackfill.backfillUser, { userId: USER })
    const entries = await t.run(
      async (ctx) => await ctx.db.query("timeEntries").collect()
    )
    expect(entries).toHaveLength(1)
    expect(entries[0].title).toBe("Actually did this")
  })

  it("skips a meeting shadowed by a still-running timer", async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      await seedPast(ctx)
    })
    await t.mutation(internal.entries.startAs, {
      userId: USER, clientKey: "running", title: "Long haul",
      startedAt: NOW - 5 * HOUR,
    })
    await t.mutation(internal.googleBackfill.backfillUser, { userId: USER })
    const entries = await t.run(
      async (ctx) => await ctx.db.query("timeEntries").collect()
    )
    expect(entries).toHaveLength(1)
    expect(entries[0].title).toBe("Long haul")
  })

  it("does not backfill a meeting that has not ended", async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      await seedPast(ctx, { startedAt: NOW - 60_000, endedAt: NOW + HOUR })
    })
    await t.mutation(internal.googleBackfill.backfillUser, { userId: USER })
    const entries = await t.run(
      async (ctx) => await ctx.db.query("timeEntries").collect()
    )
    // That one belongs to the tick, which switches to it live.
    expect(entries).toHaveLength(0)
  })

  it("does not resurrect months of history after a full resync", async () => {
    // A 410 GONE drops the sync token and refetches sixty days. Without the
    // bound the first resync after a ticked meeting would materialise two
    // months of history, all at once, into somebody's invoice.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      await seedPast(ctx, {
        startedAt: NOW - 30 * 24 * HOUR,
        endedAt: NOW - 30 * 24 * HOUR + HOUR,
      })
    })
    await t.mutation(internal.googleBackfill.backfillUser, { userId: USER })
    const entries = await t.run(
      async (ctx) => await ctx.db.query("timeEntries").collect()
    )
    expect(entries).toHaveLength(0)
  })

  it("is a no-op the second time", async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      await seedPast(ctx)
    })
    await t.mutation(internal.googleBackfill.backfillUser, { userId: USER })
    await t.mutation(internal.googleBackfill.backfillUser, { userId: USER })
    const entries = await t.run(
      async (ctx) => await ctx.db.query("timeEntries").collect()
    )
    expect(entries).toHaveLength(1)
  })

  it("skips a cancelled meeting", async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      await seedPast(ctx, { status: "cancelled" })
    })
    await t.mutation(internal.googleBackfill.backfillUser, { userId: USER })
    const entries = await t.run(
      async (ctx) => await ctx.db.query("timeEntries").collect()
    )
    expect(entries).toHaveLength(0)
  })

  it("ignores a deleted entry when testing for coverage", async () => {
    // An entry in the trash is not a record of the hour. Counting it would
    // leave a meeting permanently un-backfillable with nothing on the grid to
    // explain why.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      await seedPast(ctx)
    })
    const typed = await t.mutation(internal.entries.createAs, {
      userId: USER, clientKey: "typed", title: "Deleted",
      startedAt: NOW - 3 * HOUR, endedAt: NOW - 2 * HOUR,
    })
    await t.mutation(internal.entries.removeAs, {
      userId: USER, entryId: typed.entryId,
    })
    await t.mutation(internal.googleBackfill.backfillUser, { userId: USER })
    const live = await t.run(async (ctx) =>
      (await ctx.db.query("timeEntries").collect()).filter(
        (e) => e.deletedAt === null
      )
    )
    expect(live).toHaveLength(1)
    expect(live[0].title).toBe("Team standup")
  })
})
```

- [ ] **Step 2: Run to verify they fail**

```bash
npx vitest run convex/googleBackfill.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write `convex/googleBackfill.ts`**

```ts
import { v } from "convex/values"
import { internalMutation } from "./_generated/server"
import { materialiseMeeting } from "./googleTrack"
import { isTrackable, overlapsWindow } from "./googleEvents"
import type { MutationCtx } from "./_generated/server"

/*
 * The meetings the live switch never got.
 *
 * Two situations produce them and they are really one situation: nothing was
 * listening at the moment the meeting started. A meeting ticked after it had
 * already passed, and a switch missed while the deployment was down or while
 * the meeting was newer than the sync interval.
 *
 * These become COMPLETED entries over their own window rather than running
 * ones. A meeting that ended at eleven must not take the timer at three.
 */

/**
 * Seven days, and the bound exists for one specific accident.
 *
 * A `410 GONE` on a sync token drops the whole window and refetches it — sixty
 * days back — so without a bound the first full resync after a ticked meeting
 * would materialise two months of history as new entries, all at once, into
 * somebody's invoice. Seven days is longer than any outage worth recovering
 * from and shorter than any billing period.
 */
export const BACKFILL_WINDOW_MS = 7 * 24 * 60 * 60 * 1_000

export const BACKFILL_PER_USER_LIMIT = 100

async function backfillUserImpl(ctx: MutationCtx, userId: string) {
  const now = Date.now()

  const pending = await ctx.db
    .query("googleEventTracking")
    .withIndex("by_user_track_entry", (q) =>
      q.eq("userId", userId).eq("trackOnStart", true).eq("entryId", null)
    )
    .take(BACKFILL_PER_USER_LIMIT)
  if (pending.length === 0) return null
  if (pending.length === BACKFILL_PER_USER_LIMIT) {
    // Said out loud, not thrown: the tail simply waits for the next sync, and
    // throwing would lose the meetings this run CAN materialise. Same device
    // `google.ts` uses for a truncated page read.
    console.error("googleBackfill read a full page of pending ticks.", {
      userId,
      limit: BACKFILL_PER_USER_LIMIT,
    })
  }

  for (const row of pending) {
    const event = await ctx.db
      .query("googleEvents")
      .withIndex("by_user_calendar_event", (q) =>
        q
          .eq("userId", userId)
          .eq("calendarId", row.calendarId)
          .eq("eventId", row.eventId)
      )
      .unique()
    if (event === null) continue
    if (!isTrackable(event)) continue

    // Only meetings that have ENDED. One still in progress belongs to the tick,
    // which will switch to it live and make it the running entry.
    if (event.endedAt > now) continue
    if (now - event.endedAt > BACKFILL_WINDOW_MS) continue

    /*
     * THE OVERLAP RULE, and this is the only place it applies.
     *
     * The live switch needs no such test because it CLOSES the running entry
     * and so cannot produce an overlap. Here there is no such guarantee: the
     * user may have tracked the meeting by hand, or worked straight through it
     * on something else, and either way their own record of the hour beats the
     * calendar's plan for it.
     *
     * The scan starts a backfill window before the meeting, which is far enough
     * back to catch a long entry that opened before it and is still open now —
     * `overlapsWindow` is what decides, and it treats a running entry as
     * spanning up to `now`.
     */
    const nearby = await ctx.db
      .query("timeEntries")
      .withIndex("by_user_started", (q) =>
        q
          .eq("userId", userId)
          .gte("startedAt", event.startedAt - BACKFILL_WINDOW_MS)
      )
      .collect()
    const covered = nearby.some(
      (entry) =>
        entry.deletedAt === null &&
        overlapsWindow(entry, event.startedAt, event.endedAt, now)
    )
    if (covered) continue

    await materialiseMeeting(ctx, userId, event, "completed")
  }
  return null
}

export const backfillUser = internalMutation({
  args: { userId: v.string() },
  returns: v.null(),
  handler: async (ctx, { userId }) => await backfillUserImpl(ctx, userId),
})
```

- [ ] **Step 4: Hang it off the sync**

At the very end of `syncAccount`'s handler in `convex/google.ts`, immediately
before it returns:

```ts
    /*
     * The backfill rides the sync's tail rather than having a cron of its own.
     *
     * It can only do anything when the mirror has just changed, which is
     * exactly here — and a separate schedule would race this one for the same
     * rows. Scheduled rather than awaited so that a backfill which throws
     * cannot fail a sync that has already committed its rows and its token.
     */
    await ctx.scheduler.runAfter(0, internal.googleBackfill.backfillUser, {
      userId: connection.userId,
    })
```

- [ ] **Step 5: Regenerate the API surface**

`internal.googleBackfill` does not exist until this runs — both your tests and
the `scheduler.runAfter` call you just added to `google.ts` reference it.

```bash
npx convex codegen
```

Do **not** `git add convex/_generated/api.d.ts`. Task 4 is regenerating the same
file concurrently; whoever closes the wave commits it once.

- [ ] **Step 6: Run to verify they pass**

```bash
npx vitest run convex/googleBackfill.test.ts convex/google.test.ts
```

Expected: PASS, both suites.

- [ ] **Step 7: Gates**

```bash
npm run typecheck && npm run lint
```

- [ ] **Step 8: Commit**

```bash
git add convex/googleBackfill.ts convex/googleBackfill.test.ts convex/google.ts && git commit -m "feat(calendar): a missed switch becomes the hour it was, not the hour it is"
```

---

## Task 6: The checkbox on the block

**Files:**
- Modify: `src/lib/calendar-meetings.ts`
- Modify: `src/components/calendar/calendar-panel.tsx`
- Modify: `src/routes/_authed/timer.tsx`
- Test: `src/lib/calendar-meetings.test.ts`,
  `src/components/calendar/calendar-panel.test.tsx`

**Interfaces:**
- Consumes: `api.googleTrack.setTrackOnStart`, `api.googleTrack.trackNow` from
  Task 3.
- Produces (the names Task 7 relies on):
  ```ts
  // src/lib/calendar-meetings.ts
  export function meetingEvents(
    meetings: Array<Meeting>,
    nowMs: number
  ): Array<EventInput & { extendedProps: MeetingEventProps }>
  // MeetingEventProps gains:
  //   startable: boolean

  // src/components/calendar/calendar-panel.tsx — CalendarPanel props gain:
  //   onSetTrack?: (calendarId: string, eventId: string, track: boolean) => void
  //   onTrackNow?: (calendarId: string, eventId: string) => void
  ```

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/calendar-meetings.test.ts`:

```ts
it("marks a future meeting startable and one already begun not", () => {
  const now = Date.parse("2026-08-20T10:00:00.000Z")
  const [future] = meetingEvents(
    [meeting({ startedAt: now + 60_000, endedAt: now + 3_600_000 })],
    now
  )
  const [past] = meetingEvents(
    [meeting({ startedAt: now - 3_600_000, endedAt: now - 60_000 })],
    now
  )
  // The checkbox is an instruction to a FUTURE switch. On a meeting that has
  // already begun there is nothing left for it to fire, so the popover offers
  // "Track this" instead and the block offers nothing at all.
  expect(future.extendedProps.startable).toBe(true)
  expect(past.extendedProps.startable).toBe(false)
})
```

Append to `src/components/calendar/calendar-panel.test.tsx` (following the
file's existing `renderPanel` / meeting-fixture helpers; add `futureMeeting()`
and `pastMeeting()` beside them if they do not exist, built from the same
fixture the meetings tests already use):

```tsx
it("ticks a meeting without opening its popover", async () => {
  const onSetTrack = vi.fn()
  renderPanel({ meetings: [futureMeeting()], onSetTrack })

  const box = await screen.findByRole("checkbox", { name: /track team standup/i })
  await userEvent.click(box)

  expect(onSetTrack).toHaveBeenCalledWith("primary", "evt_standup", true)
  // The nested-interactive-control problem `selection-checkbox.tsx` already
  // solves for entry rows: without stopPropagation the click reaches
  // FullCalendar's eventClick and the popover opens on top of the box the user
  // just aimed at.
  expect(screen.queryByRole("dialog")).toBeNull()
})

it("draws a ticked meeting's checkbox as checked", async () => {
  renderPanel({ meetings: [futureMeeting({ trackOnStart: true })], onSetTrack: vi.fn() })
  const box = await screen.findByRole("checkbox", { name: /track team standup/i })
  expect((box as HTMLInputElement).checked).toBe(true)
})

it("draws no checkbox on a meeting that has already started", () => {
  renderPanel({ meetings: [pastMeeting()], onSetTrack: vi.fn() })
  expect(screen.queryByRole("checkbox", { name: /track/i })).toBeNull()
})

it("draws no checkbox on a block too short for text", () => {
  // `blockFit` returning titleLines: 0 means the block has no room for content,
  // and a control it cannot show is a control the user cannot hit.
  renderPanel({
    meetings: [futureMeeting({ endedAt: FUTURE_START + 5 * 60_000 })],
    onSetTrack: vi.fn(),
  })
  expect(screen.queryByRole("checkbox", { name: /track/i })).toBeNull()
})
```

- [ ] **Step 2: Run to verify they fail**

```bash
npx vitest run src/lib/calendar-meetings.test.ts src/components/calendar/calendar-panel.test.tsx
```

Expected: FAIL — `meetingEvents` takes one argument; no checkbox in the DOM.

- [ ] **Step 3: Add `startable` to the mapper**

In `src/lib/calendar-meetings.ts`, add to `MeetingEventProps`:

```ts
  /** The meeting has not begun, so a tick still has a switch left to fire.
   *  Computed here rather than in the render hook so the panel's memo does not
   *  re-derive it per block per second. */
  startable: boolean
```

change the signature:

```ts
export function meetingEvents(
  meetings: Array<Meeting>,
  nowMs: number
): Array<EventInput & { extendedProps: MeetingEventProps }> {
```

and the `extendedProps` it pushes:

```ts
      extendedProps: {
        kind: "meeting",
        calendarId: meeting.calendarId,
        eventId: meeting.eventId,
        startedAt: meeting.startedAt,
        endedAt: meeting.endedAt,
        trackOnStart: meeting.trackOnStart,
        startable: meeting.startedAt > nowMs,
      },
```

- [ ] **Step 4: Draw the checkbox**

In `calendar-panel.tsx`, add `onSetTrack` and `onTrackNow` to the component's
props and type. In the meeting branch of `eventContent`, replace the standalone
title `<span>` with a row:

```tsx
              {meetingFit.titleLines === 0 ? null : (
                <div className="flex min-w-0 items-start gap-1">
                  {props.startable && onSetTrack !== undefined ? (
                    <input
                      type="checkbox"
                      aria-label={`Track ${titleOf(info.event)}`}
                      checked={props.trackOnStart}
                      /*
                       * BOTH handlers stop propagation, and both are needed.
                       * FullCalendar binds `eventClick` at the segment, so a
                       * change handler that only stopped its own event would
                       * still let the click through and open the popover on
                       * top of the box the user just aimed at — the same
                       * nested-interactive-control problem
                       * `selection-checkbox.tsx` solves for entry rows.
                       */
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) => {
                        event.stopPropagation()
                        onSetTrack(
                          props.calendarId,
                          props.eventId,
                          event.currentTarget.checked
                        )
                      }}
                      className="mt-0.5 size-3 shrink-0 rounded-[3px] border border-edge-raised bg-ground accent-current focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    />
                  ) : null}
                  <span
                    className={cn(
                      "min-w-0 text-xs font-medium",
                      meetingFit.titleLines === 1 ? "truncate" : "line-clamp-2"
                    )}
                  >
                    {titleOf(info.event)}
                  </span>
                </div>
              )}
```

`blockFit` needs no change, and that is worth stating rather than leaving to be
noticed: the checkbox sits on the title's own line and is `size-3` against a
16px line box, so it costs WIDTH, not height. A block with `titleLines === 0`
renders no row at all — which is the spec's "a block with no room for text has
no room for a control either", obtained for free rather than as a second rule
that could disagree with the first.

Update the call site: `meetingEvents(meetings, nowMs)`, and add `nowMs` to that
memo's dependency array. It is already in scope for the entry branch.

- [ ] **Step 5: Pass the mutations down**

In `src/routes/_authed/timer.tsx`, beside the existing calendar mutations:

```tsx
  const setTrack = useConvexMutation(api.googleTrack.setTrackOnStart)
  const trackNow = useConvexMutation(api.googleTrack.trackNow)
```

and on `<CalendarPanel …>`:

```tsx
        onSetTrack={(calendarId, eventId, track) => {
          void setTrack({ calendarId, eventId, track }).catch((thrown: unknown) => {
            toasts.add({ title: errorMessage(thrown), priority: "high" })
          })
        }}
        onTrackNow={(calendarId, eventId) => {
          void trackNow({ calendarId, eventId }).catch((thrown: unknown) => {
            toasts.add({ title: errorMessage(thrown), priority: "high" })
          })
        }}
```

- [ ] **Step 6: Run to verify they pass**

```bash
npx vitest run src/lib src/components/calendar
```

Expected: PASS.

- [ ] **Step 7: Gates**

```bash
npm run typecheck && npm run lint
```

- [ ] **Step 8: Commit**

```bash
git add src/lib/calendar-meetings.ts src/lib/calendar-meetings.test.ts src/components/calendar/calendar-panel.tsx src/components/calendar/calendar-panel.test.tsx src/routes/_authed/timer.tsx && git commit -m "feat(calendar): the tick, on the block, where the meeting is"
```

---

## Task 7: The tick in the popover

**Files:**
- Modify: `src/components/calendar/calendar-meeting-popover.tsx`
- Modify: `src/components/calendar/calendar-panel.tsx` (pass the three new props
  through to the popover — Task 6 already put them on the panel)
- Test: `src/components/calendar/calendar-meeting-popover.test.tsx`

**Interfaces:**
- Consumes: Task 6's `onSetTrack` / `onTrackNow` signatures.
- Produces: nothing downstream.

- [ ] **Step 1: Write the failing tests**

In `calendar-meeting-popover.test.tsx`, replace the `show()` helper so it
forwards handlers, and add the two constants beside `START`:

```tsx
const LATER = START + 60 * 60 * 1_000
const EARLIER = START - 3 * 60 * 60 * 1_000

function show(
  over: Partial<Meeting> = {},
  handlers: {
    onSetTrack?: (calendarId: string, eventId: string, track: boolean) => void
    onTrackNow?: (calendarId: string, eventId: string) => void
  } = {}
) {
  const anchor = document.createElement("div")
  document.body.appendChild(anchor)
  render(
    <CalendarMeetingPopover
      meeting={meeting(over)}
      anchor={anchor}
      onClose={vi.fn()}
      timeZone="Asia/Manila"
      use12Hour
      nowMs={START}
      {...handlers}
    />
  )
}
```

then append:

```tsx
it("offers a tick on a meeting that has not started", async () => {
  const onSetTrack = vi.fn()
  show({ startedAt: LATER, endedAt: LATER + 1_800_000 }, { onSetTrack })
  const box = screen.getByRole("checkbox", { name: /track this meeting/i })
  await userEvent.click(box)
  expect(onSetTrack).toHaveBeenCalledWith("primary", "evt_1", true)
})

it("offers Track this on a meeting that has already ended", async () => {
  const onTrackNow = vi.fn()
  show({ startedAt: EARLIER, endedAt: EARLIER + 1_800_000 }, { onTrackNow })
  // A tick has nothing left to fire on a meeting that already happened, so the
  // popover offers the same materialisation the backfill runs, on demand.
  expect(screen.queryByRole("checkbox", { name: /track this meeting/i })).toBeNull()
  await userEvent.click(screen.getByRole("button", { name: /track this/i }))
  expect(onTrackNow).toHaveBeenCalledWith("primary", "evt_1")
})

it("offers nothing to track when no handler was given", () => {
  // The popover is rendered in tests and stories without the mutations wired.
  // It must degrade to the read-only Phase 1 shape rather than drawing a
  // control that does nothing.
  show({ startedAt: LATER })
  expect(screen.queryByRole("checkbox")).toBeNull()
  expect(screen.queryByRole("button", { name: /track this/i })).toBeNull()
})

it("is still read-only in every other respect", () => {
  show({ description: "Agenda: everything" }, { onSetTrack: vi.fn() })
  // The tick is the ONE control this popover ever gains. Nothing in here writes
  // to Google and nothing in here edits an entry.
  expect(screen.queryAllByRole("textbox")).toEqual([])
  expect(screen.queryAllByRole("combobox")).toEqual([])
})
```

- [ ] **Step 2: Run to verify they fail**

```bash
npx vitest run src/components/calendar/calendar-meeting-popover.test.tsx
```

Expected: FAIL — no checkbox, no button.

- [ ] **Step 3: Add the control**

Add `nowMs: number`, `onSetTrack?` and `onTrackNow?` to the component's props,
add `ClockIcon` to the `lucide-react` import, and insert a section directly
after the `<header>`:

```tsx
          {onSetTrack === undefined && onTrackNow === undefined ? null : (
            <div className="p-3">
              {meeting.startedAt > nowMs ? (
                /*
                 * THE TICK IS THE CONSENT, and this is its second home.
                 *
                 * The block carries one too, but a fifteen-minute meeting has
                 * no room for a control and a meeting on a crowded column may
                 * be two millimetres wide. This is the path that always works,
                 * which is why the label spells out what will happen rather
                 * than trusting a bare checkbox to imply it.
                 */
                <label className="flex cursor-pointer items-start gap-2 text-xs text-foreground">
                  <input
                    type="checkbox"
                    aria-label="Track this meeting when it starts"
                    checked={meeting.trackOnStart}
                    onChange={(event) =>
                      onSetTrack?.(
                        meeting.calendarId,
                        meeting.eventId,
                        event.currentTarget.checked
                      )
                    }
                    className="mt-0.5 size-3.5 shrink-0 rounded-[3px] border border-edge-raised bg-ground accent-current focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  />
                  <span>
                    Track this when it starts
                    <span className="block text-muted-foreground">
                      Stops whatever is running and starts this instead.
                    </span>
                  </span>
                </label>
              ) : (
                /*
                 * A meeting that has already begun has no future switch left,
                 * so the honest offer is the one the backfill makes: record it
                 * now, over its own window.
                 */
                <button
                  type="button"
                  onClick={() => onTrackNow?.(meeting.calendarId, meeting.eventId)}
                  className="flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-edge-raised text-xs font-medium text-foreground transition-colors hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  <ClockIcon className="size-3.5" aria-hidden />
                  Track this
                </button>
              )}
            </div>
          )}
```

Pass `nowMs={nowMs}`, `onSetTrack={onSetTrack}` and `onTrackNow={onTrackNow}`
from `calendar-panel.tsx` where `<CalendarMeetingPopover>` is rendered.

- [ ] **Step 4: Run to verify they pass**

```bash
npx vitest run src/components/calendar
```

Expected: PASS — the existing popover tests plus the four new ones.

- [ ] **Step 5: Gates**

```bash
npm run typecheck && npm run lint
```

- [ ] **Step 6: Commit**

```bash
git add src/components/calendar/calendar-meeting-popover.tsx src/components/calendar/calendar-meeting-popover.test.tsx src/components/calendar/calendar-panel.tsx && git commit -m "feat(calendar): tick it before, track it after"
```

---

## Task 8: The undo toast

**Files:**
- Create: `src/lib/use-switch-undo.ts`
- Modify: `src/routes/_authed/timer.tsx`
- Test: `src/lib/use-switch-undo.test.ts`

**Interfaces:**
- Consumes: `api.googleTrack.undoSwitch` from Task 3, `toastWithUndo` from
  `src/lib/undo-toast.ts`.
- Produces: nothing downstream.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/use-switch-undo.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { SWITCH_UNDO_MS, switchToAnnounce } from "@/lib/use-switch-undo"

const NOW = Date.parse("2026-08-20T10:00:00.000Z")

function running(over: Record<string, unknown> = {}) {
  return {
    _id: "entry_1",
    title: "Team standup",
    startedAt: NOW - 30_000,
    source: "calendar",
    ...over,
  }
}

describe("switchToAnnounce", () => {
  it("announces a calendar switch that just happened", () => {
    expect(switchToAnnounce(running(), null, NOW)).toEqual({
      entryId: "entry_1",
      title: "Team standup",
    })
  })

  it("says nothing about an entry the user started themselves", () => {
    // The toast exists because the switch happened at a moment the user did not
    // choose. Announcing something they pressed a button for would be noise.
    expect(switchToAnnounce(running({ source: "web" }), null, NOW)).toBeNull()
  })

  it("says nothing when there is no running entry", () => {
    expect(switchToAnnounce(null, null, NOW)).toBeNull()
  })

  it("says nothing about a switch older than the undo window", () => {
    // Long enough to notice a wrong interruption, short enough that the offer
    // is not still on screen an hour into the call. A tab opened at noon must
    // not offer to reverse the nine o'clock standup.
    const stale = running({ startedAt: NOW - SWITCH_UNDO_MS - 1 })
    expect(switchToAnnounce(stale, null, NOW)).toBeNull()
  })

  it("does not announce the same switch twice", () => {
    // The query re-fires on every reactive update — a title edit, a tag, the
    // next sync. Without the seen-id the toast would reappear on each one for
    // as long as the window stayed open.
    expect(switchToAnnounce(running(), "entry_1", NOW)).toBeNull()
  })

  it("announces a second switch that follows the first", () => {
    const next = running({ _id: "entry_2", title: "Design review" })
    expect(switchToAnnounce(next, "entry_1", NOW)).toEqual({
      entryId: "entry_2",
      title: "Design review",
    })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/lib/use-switch-undo.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/lib/use-switch-undo.ts`**

```ts
import { useEffect, useRef } from "react"
import { toastWithUndo } from "@/lib/undo-toast"
import type { ToastManager } from "@/components/ui/toast"

/**
 * Noticing that the timer changed without being asked.
 *
 * The switch is the one write in this feature that happens at a moment the user
 * did not choose. They may have been mid-sentence, or on another tab, or not at
 * the machine at all — so the app has to SAY what it did and offer the way
 * back, rather than leaving them to discover that the running title is not the
 * one they typed.
 *
 * The decision is a pure function so it can be tested against its own table of
 * cases; the hook underneath is only plumbing.
 */

/** Matches `UNDO_WINDOW_MS` in `convex/googleTrack.ts`. Both copies exist on
 *  purpose: this one decides whether to OFFER, that one decides whether to
 *  ALLOW, and a stale tab must not be able to reverse this morning's switch. */
export const SWITCH_UNDO_MS = 5 * 60 * 1_000

export type RunningLike = {
  _id: string
  title: string
  startedAt: number
  source: string
} | null

export type SwitchAnnouncement = { entryId: string; title: string }

export function switchToAnnounce(
  running: RunningLike,
  lastAnnouncedId: string | null,
  nowMs: number
): SwitchAnnouncement | null {
  if (running === null) return null
  if (running.source !== "calendar") return null
  if (nowMs - running.startedAt > SWITCH_UNDO_MS) return null
  if (running._id === lastAnnouncedId) return null
  return { entryId: running._id, title: running.title }
}

export function useSwitchUndo(
  running: RunningLike,
  toasts: ToastManager,
  undo: (args: { entryId: string }) => Promise<unknown>
): void {
  // A ref, not state: announcing must not itself cause a render, or the effect
  // re-runs on the render it caused and the toast stutters.
  const announced = useRef<string | null>(null)

  useEffect(() => {
    const next = switchToAnnounce(running, announced.current, Date.now())
    if (next === null) return
    announced.current = next.entryId
    toastWithUndo(toasts, {
      title: `Switched to ${next.title === "" ? "a meeting" : next.title}`,
      description: "Your calendar started this.",
      undo: () => undo({ entryId: next.entryId }),
    })
  }, [running, toasts, undo])
}
```

- [ ] **Step 4: Wire it into the timer page**

In `src/routes/_authed/timer.tsx`, after the existing `running` query and the
toast manager:

```tsx
  const undoSwitch = useConvexMutation(api.googleTrack.undoSwitch)
  useSwitchUndo(running, toasts, undoSwitch)
```

- [ ] **Step 5: Run to verify it passes**

```bash
npx vitest run src/lib/use-switch-undo.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 6: Run the whole suite**

Stop the dev server first — vitest and vite competing for the same cores
produces phantom timeouts in the calendar suite that vanish when it is not
running. This has cost an afternoon before.

```bash
npm run typecheck && npm run lint && npx vitest run
```

Expected: green.

- [ ] **Step 7: Commit**

```bash
git add src/lib/use-switch-undo.ts src/lib/use-switch-undo.test.ts src/routes/_authed/timer.tsx && git commit -m "feat(calendar): say what the switch did, and offer it back"
```

---

## Manual verification

The tests prove the parts. This proves the feature. Run it once against the real
deployment, with the dev server on port 3100 and `npx convex dev` running.

1. **/settings** — a calendar is shown and has a default project.
2. **/timer**, Calendar view — find a meeting a few minutes out. Tick the box on
   its block. **The popover must not open.**
3. Start a timer on something else.
4. Wait for the meeting's start instant. Within a minute the running entry is
   the meeting — and the entry you started is closed **at the meeting's start**,
   not at the moment the cron fired. Check the minutes in the log; this is the
   assertion the whole design turns on.
5. The undo toast appears. Press **Undo**: the meeting entry is gone, yours is
   running again with no end, and the ghost is back on the grid.
6. Tick a meeting that ended yesterday, then force a sync — or open it and press
   **Track this**. A completed entry appears over its own window.
7. Track an hour by hand across a past ticked meeting's window, then force a
   sync. Nothing new appears: the overlap rule held.
8. Leave a meeting entry running past `runawayThresholdMs` and confirm the
   existing runaway warning fires. No new machinery was added for this and none
   should be needed.

## Self-review

**Spec coverage.** The checkbox → Tasks 6 and 7. `googleTick` → Task 4. Backfill
→ Task 5. **Track this** → Tasks 3 and 7. The undo toast → Tasks 3 and 8. The
"what an entry made from a meeting contains" table → Task 1, whose tests assert
title, absent note, project, billable, source and `clientKey`. Eligibility →
Task 2. The overlap rule → Tasks 2 and 5. The tie-break → Tasks 2 and 4. "A
meeting that produced an entry is not drawn" already shipped in Phase 1
(`calendar-meetings.ts` skips a non-null `entryId`); Task 3's undo test asserts
the ghost returns when `entryId` is cleared. No `timeEntries` schema change:
confirmed — only the TypeScript `source` union widens, and that field is
`v.string()` on the table.

**Failure-mode table.** Every row is covered by a test except two that are
covered by construction and worth naming rather than testing: "meeting moves
after its entry exists" and "meeting cancelled after its entry exists" both do
nothing because nothing in this plan ever reads an event to update an entry —
materialisation is a one-way snapshot.

**Deliberately not in this plan.** Settings gains nothing this phase; the
project picker and **Show** already ship. Phase 1's read path is untouched
except for the one scheduler call in Task 5.

**Error codes, checked against the real union.** The first draft of this plan
threw `"INVALID"` and `"PARTIAL"`, and neither exists: `TraceErrorCode` in
`convex/lib/codes.ts` is a closed union, so both would have been compile errors
in the middle of a task. Resolved rather than left as a note — Task 3 adds
`NOT_TRACKABLE`, `NOT_A_SWITCH` and `UNDO_EXPIRED` in the same commit as the
throws that use them, which is what that file's own standing comment demands.
The two truncation reports in Tasks 4 and 5 are `console.error`, matching what
`google.ts` already does for a full page read: a cron that throws on truncation
loses the work it could have done.
