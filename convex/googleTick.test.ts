/// <reference types="vite/client" />
// The one-minute switch.
//
// Everything here is about WHEN the timer changes hands and WHAT the record
// says afterwards. The two are independent on purpose: the cron may fire up to
// a minute late, but both instants on the entries it writes come from the
// event, so a late write and a punctual one produce byte-identical rows.
import { convexTest } from "convex-test"
import { describe, expect, it } from "vitest"
import schema from "./schema"
import { internal } from "./_generated/api"

// convex-test discovers function modules by globbing from the file that calls
// it, so the glob lives here rather than in a shared helper.
const modules = import.meta.glob("./**/*.*s")
const setup = () => convexTest(schema, modules)
type Harness = ReturnType<typeof setup>

const USER = "user_alice"
/** Seeded from the real clock: this suite asserts against a lookback measured
 *  from `Date.now()` inside a mutation, and a fixed literal would pass today
 *  and fail tomorrow. */
const NOW = Date.now()
const HOUR = 60 * 60 * 1_000

/** A ticked meeting: the mirror row `googleSync` would have written, plus the
 *  tracking row the checkbox would have written beside it. */
async function seedMeeting(
  t: Harness,
  over: Partial<{
    eventId: string
    title: string
    startedAt: number
    endedAt: number
    isAllDay: boolean
    status: string
    myResponse: string
  }> = {},
  tracking: Partial<{ trackOnStart: boolean }> = {}
) {
  const eventId = over.eventId ?? "evt_standup"
  await t.run(async (ctx) => {
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
  })
}

const allEntries = async (t: Harness) =>
  await t.run(async (ctx) => await ctx.db.query("timeEntries").collect())

describe("switchUser", () => {
  it("switches the timer to a ticked meeting that just started", async () => {
    const t = setup()
    await seedMeeting(t)
    const before = await t.mutation(internal.entries.startAs, {
      userId: USER,
      clientKey: "before",
      title: "Deep work",
      startedAt: NOW - HOUR,
    })

    await t.mutation(internal.googleTick.switchUser, { userId: USER })

    const entries = await allEntries(t)
    expect(entries).toHaveLength(2)
    const closed = entries.find((e) => e._id === before.entryId)
    const running = entries.find((e) => e.endedAt === null)
    // The record is exact even though the write landed late: both instants come
    // from the event, not from the clock the cron happened to fire on.
    expect(closed!.endedAt).toBe(NOW - 30_000)
    expect(running!.title).toBe("Team standup")
    expect(running!.startedAt).toBe(NOW - 30_000)
  })

  it("does nothing for a meeting that was never ticked", async () => {
    const t = setup()
    await seedMeeting(t, {}, { trackOnStart: false })
    await t.mutation(internal.googleTick.switchUser, { userId: USER })
    expect(await allEntries(t)).toHaveLength(0)
  })

  it("does nothing for a meeting that has not started yet", async () => {
    const t = setup()
    await seedMeeting(t, { startedAt: NOW + HOUR })
    await t.mutation(internal.googleTick.switchUser, { userId: USER })
    expect(await allEntries(t)).toHaveLength(0)
  })

  it("does not seize the timer for a meeting older than the lookback", async () => {
    const t = setup()
    await seedMeeting(t, { startedAt: NOW - 3 * HOUR })
    await t.mutation(internal.googleTick.switchUser, { userId: USER })
    // Falls to backfill instead, where it becomes a completed entry over its
    // own window rather than stealing the present.
    expect(await allEntries(t)).toHaveLength(0)
  })

  it("takes the latest start when two ticked meetings are both due", async () => {
    const t = setup()
    await seedMeeting(t, { eventId: "early", startedAt: NOW - 300_000 })
    await seedMeeting(t, {
      eventId: "late",
      startedAt: NOW - 30_000,
      title: "Design review",
    })
    await t.mutation(internal.googleTick.switchUser, { userId: USER })
    const entries = await allEntries(t)
    // ONE running entry, always — the product's oldest invariant. The other
    // stays a ghost and falls to backfill.
    expect(entries).toHaveLength(1)
    expect(entries[0].title).toBe("Design review")
  })

  it("is a no-op on a second run in the same minute", async () => {
    const t = setup()
    await seedMeeting(t)
    await t.mutation(internal.googleTick.switchUser, { userId: USER })
    await t.mutation(internal.googleTick.switchUser, { userId: USER })
    expect(await allEntries(t)).toHaveLength(1)
  })

  it("skips a meeting that was cancelled after it was ticked", async () => {
    const t = setup()
    await seedMeeting(t, { status: "cancelled" })
    await t.mutation(internal.googleTick.switchUser, { userId: USER })
    expect(await allEntries(t)).toHaveLength(0)
  })

  it("switches even when the meeting was declined", async () => {
    const t = setup()
    await seedMeeting(t, { myResponse: "declined" })
    await t.mutation(internal.googleTick.switchUser, { userId: USER })
    // The tick already said what the user wanted; an RSVP does not overrule it.
    expect(await allEntries(t)).toHaveLength(1)
  })

  it("survives a ticked meeting whose mirror row has been pruned", async () => {
    const t = setup()
    await t.run(async (ctx) => {
      await ctx.db.insert("googleEventTracking", {
        userId: USER,
        calendarId: "primary",
        eventId: "vanished",
        trackOnStart: true,
        entryId: null,
        interruptedEntryId: null,
        updatedAt: NOW,
      })
    })
    await t.mutation(internal.googleTick.switchUser, { userId: USER })
    expect(await allEntries(t)).toHaveLength(0)
  })
})

describe("dueUsers", () => {
  it("names each user with a ticked, unmaterialised meeting exactly once", async () => {
    const t = setup()
    await seedMeeting(t, { eventId: "a" })
    await seedMeeting(t, { eventId: "b" })
    const users = await t.query(internal.googleTick.dueUsers, {})
    expect(users).toEqual([USER])
  })

  it("is empty when nothing is ticked", async () => {
    const t = setup()
    await seedMeeting(t, {}, { trackOnStart: false })
    const users = await t.query(internal.googleTick.dueUsers, {})
    expect(users).toEqual([])
  })

  it("drops a user whose ticked meetings have all become entries", async () => {
    /*
     * The other half of the key, and the half that decides whether this query
     * stays cheap. A materialised row keeps `trackOnStart: true` forever —
     * `upsertTracking` only sets `entryId` — so `entryId: null` is the ONLY
     * thing that takes a row off the work list.
     *
     * `googleEventTracking` is never pruned, so without this a user who ticked
     * one meeting last March would be woken every sixty seconds for the rest of
     * the account's life.
     */
    const t = setup()
    await seedMeeting(t, {}, { trackOnStart: true })
    await t.mutation(internal.googleTick.switchUser, { userId: USER })

    const rows = await t.run(
      async (ctx) => await ctx.db.query("googleEventTracking").collect()
    )
    expect(rows[0]!.entryId).not.toBeNull()
    expect(rows[0]!.trackOnStart).toBe(true)

    const users = await t.query(internal.googleTick.dueUsers, {})
    expect(users).toEqual([])
  })
})
