/// <reference types="vite/client" />
// The backfill: meetings the live switch never got.
//
// Every case here is about a number that would otherwise reach an invoice
// wrong — an hour recorded twice, an hour recorded at the wrong time of day, or
// two months of history materialised in one go after a full resync.
import { convexTest } from "convex-test"
import { describe, expect, it } from "vitest"
import schema from "./schema"
import { internal } from "./_generated/api"

const modules = import.meta.glob("./**/*.*s")
const setup = () => convexTest(schema, modules)

const USER = "user_alice"
/** Seeded from the real clock, never a literal. A fixture instant compared
 *  against `Date.now()` inside a mutation passes for a day and then fails on
 *  its own. */
const NOW = Date.now()
const HOUR = 60 * 60 * 1_000

type EventOver = {
  eventId?: string
  startedAt?: number
  endedAt?: number
  status?: string
  isAllDay?: boolean
}

type TrackingOver = {
  trackOnStart?: boolean
}

/** A ticked meeting that ENDED two hours ago. */
async function seedPast(
  t: ReturnType<typeof setup>,
  over: EventOver = {},
  tracking: TrackingOver = {}
) {
  await t.run(async (ctx) => {
    const eventId = over.eventId ?? "evt_past"
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
  })
}

async function allEntries(t: ReturnType<typeof setup>) {
  return await t.run(async (ctx) => await ctx.db.query("timeEntries").collect())
}

describe("backfillUser", () => {
  it("creates a completed entry over a ticked meeting that already ended", async () => {
    const t = setup()
    await seedPast(t)
    await t.mutation(internal.googleBackfill.backfillUser, { userId: USER })
    const entries = await allEntries(t)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.startedAt).toBe(NOW - 3 * HOUR)
    expect(entries[0]!.endedAt).toBe(NOW - 2 * HOUR)
    expect(entries[0]!.source).toBe("calendar")
  })

  it("does not backfill an unticked meeting", async () => {
    const t = setup()
    await seedPast(t, {}, { trackOnStart: false })
    await t.mutation(internal.googleBackfill.backfillUser, { userId: USER })
    expect(await allEntries(t)).toHaveLength(0)
  })

  it("skips a meeting whose window is already covered by tracked time", async () => {
    // The tracker's own record of what happened wins over the calendar's plan
    // for it.
    const t = setup()
    await seedPast(t)
    await t.mutation(internal.entries.createAs, {
      userId: USER,
      clientKey: "typed",
      title: "Actually did this",
      startedAt: NOW - 3 * HOUR,
      endedAt: NOW - 2 * HOUR,
    })
    await t.mutation(internal.googleBackfill.backfillUser, { userId: USER })
    const entries = await allEntries(t)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.title).toBe("Actually did this")
  })

  it("skips a meeting shadowed by a still-running timer", async () => {
    // The case `overlapsWindow` exists for: a running entry spans up to `now`,
    // so a timer started five hours ago covers a meeting that ended two hours
    // ago even though it has no `endedAt` to compare.
    const t = setup()
    await seedPast(t)
    await t.mutation(internal.entries.startAs, {
      userId: USER,
      clientKey: "running",
      title: "Long haul",
      startedAt: NOW - 5 * HOUR,
    })
    await t.mutation(internal.googleBackfill.backfillUser, { userId: USER })
    const entries = await allEntries(t)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.title).toBe("Long haul")
  })

  it("does not backfill a meeting that has not ended", async () => {
    const t = setup()
    await seedPast(t, { startedAt: NOW - 60_000, endedAt: NOW + HOUR })
    await t.mutation(internal.googleBackfill.backfillUser, { userId: USER })
    // That one belongs to the tick, which switches to it live.
    expect(await allEntries(t)).toHaveLength(0)
  })

  it("does not resurrect months of history after a full resync", async () => {
    // A 410 GONE drops the sync token and refetches sixty days. Without the
    // bound the first resync after a ticked meeting would materialise two
    // months of history, all at once, into somebody's invoice.
    const t = setup()
    await seedPast(t, {
      startedAt: NOW - 30 * 24 * HOUR,
      endedAt: NOW - 30 * 24 * HOUR + HOUR,
    })
    await t.mutation(internal.googleBackfill.backfillUser, { userId: USER })
    expect(await allEntries(t)).toHaveLength(0)
  })

  it("is a no-op the second time", async () => {
    const t = setup()
    await seedPast(t)
    await t.mutation(internal.googleBackfill.backfillUser, { userId: USER })
    await t.mutation(internal.googleBackfill.backfillUser, { userId: USER })
    expect(await allEntries(t)).toHaveLength(1)
  })

  it("skips a cancelled meeting", async () => {
    const t = setup()
    await seedPast(t, { status: "cancelled" })
    await t.mutation(internal.googleBackfill.backfillUser, { userId: USER })
    expect(await allEntries(t)).toHaveLength(0)
  })

  it("skips an all-day event", async () => {
    const t = setup()
    await seedPast(t, { isAllDay: true })
    await t.mutation(internal.googleBackfill.backfillUser, { userId: USER })
    expect(await allEntries(t)).toHaveLength(0)
  })

  it("ignores a deleted entry when testing for coverage", async () => {
    // An entry in the trash is not a record of the hour. Counting it would
    // leave a meeting permanently un-backfillable with nothing on the grid to
    // explain why.
    const t = setup()
    await seedPast(t)
    const typed = await t.mutation(internal.entries.createAs, {
      userId: USER,
      clientKey: "typed",
      title: "Deleted",
      startedAt: NOW - 3 * HOUR,
      endedAt: NOW - 2 * HOUR,
    })
    await t.mutation(internal.entries.removeAs, {
      userId: USER,
      entryId: typed.entryId,
    })
    await t.mutation(internal.googleBackfill.backfillUser, { userId: USER })
    const live = (await allEntries(t)).filter((e) => e.deletedAt === null)
    expect(live).toHaveLength(1)
    expect(live[0]!.title).toBe("Team standup")
  })
})
