/// <reference types="vite/client" />
// The Google Calendar write path.
//
// `materialiseMeeting` is the only function in the feature that inserts a
// `timeEntries` row, so every property that makes "one meeting, one entry"
// true is pinned here rather than in the three jobs that call it.
import { convexTest } from "convex-test"
import { describe, expect, it } from "vitest"
import schema from "./schema"
import { internal } from "./_generated/api"
import { meetingClientKey, parseMeetingClientKey } from "./googleTrack"

// convex-test discovers function modules by globbing from the file that calls
// it, so the glob lives here rather than in a shared helper.
const modules = import.meta.glob("./**/*.*s")
const setup = () => convexTest(schema, modules)

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
    const t = setup()
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
    const opened = entries.find((e) => e._id === result!.entryId)

    // No gap and no overlap: one entry ends on the instant the next begins.
    expect(closed?.endedAt).toBe(NOW)
    expect(closed?.durationMs).toBe(45 * 60 * 1_000)
    expect(opened?.startedAt).toBe(NOW)
    expect(opened?.endedAt).toBeNull()
    expect(opened?.title).toBe("Team standup")
    expect(opened?.source).toBe("calendar")
    // The description is never copied into the note. See the spec.
    expect(opened?.note).toBeUndefined()
    expect(result!.interruptedEntryId).toBe(before.entryId)
  })

  it("opens a running entry with no interruption when nothing was running", async () => {
    const t = setup()
    await t.run(async (ctx) => {
      await ctx.db.insert("googleEvents", eventRow())
    })
    const result = await t.mutation(internal.googleTrack.materialiseForTest, {
      userId: USER,
      calendarId: "primary",
      eventId: "evt_standup",
      mode: "live",
    })
    expect(result!.interruptedEntryId).toBeNull()
  })

  it("creates a completed entry over the meeting's own window", async () => {
    const t = setup()
    await t.run(async (ctx) => {
      await ctx.db.insert("googleEvents", eventRow({ endedAt: NOW + HOUR }))
    })
    const result = await t.mutation(internal.googleTrack.materialiseForTest, {
      userId: USER,
      calendarId: "primary",
      eventId: "evt_standup",
      mode: "completed",
    })
    const entry = await t.run(async (ctx) => await ctx.db.get(result!.entryId))
    expect(entry?.startedAt).toBe(NOW)
    expect(entry?.endedAt).toBe(NOW + HOUR)
    expect(entry?.durationMs).toBe(HOUR)
  })

  it("does not touch a running entry when it materialises a completed one", async () => {
    const t = setup()
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
    expect(still?.endedAt).toBeNull()
  })

  it("is a no-op the second time, through clientKey", async () => {
    const t = setup()
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
    expect(second!.entryId).toBe(first!.entryId)
    const entries = await t.run(
      async (ctx) => await ctx.db.query("timeEntries").collect()
    )
    expect(entries).toHaveLength(1)
  })

  it("takes the project and billable flag from the calendar's default", async () => {
    const t = setup()
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
        summary: "Work",
        show: true,
        defaultProjectId: id,
        syncToken: null,
        lastSyncedAt: null,
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
    const entry = await t.run(async (ctx) => await ctx.db.get(result!.entryId))
    expect(entry?.projectId).toBe(projectId)
    expect(entry?.billable).toBe(true)
  })

  it("refuses a meeting longer than the duration ceiling instead of throwing", async () => {
    // `createImpl` applies the 24-hour policy ceiling to typed durations and
    // THROWS when it is exceeded. A backfill batch that throws stops, taking
    // every later meeting in the page with it — so the length is checked here
    // and the meeting is skipped, which is a null return and not an error.
    const t = setup()
    await t.run(async (ctx) => {
      await ctx.db.insert(
        "googleEvents",
        eventRow({ endedAt: NOW + 30 * HOUR })
      )
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
    const t = setup()
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
    expect(tracking[0].entryId).toBe(result!.entryId)
    expect(tracking[0].interruptedEntryId).toBe(before.entryId)
  })
})

describe("setTrackOnStart", () => {
  it("creates a tracking row the first time and flips it the second", async () => {
    const t = setup()
    await t.run(async (ctx) => {
      await ctx.db.insert("googleEvents", eventRow())
    })

    await t.mutation(internal.googleTrack.setTrackOnStartForUser, {
      userId: USER,
      calendarId: "primary",
      eventId: "evt_standup",
      track: true,
    })
    let rows = await t.run(
      async (ctx) => await ctx.db.query("googleEventTracking").collect()
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].trackOnStart).toBe(true)

    await t.mutation(internal.googleTrack.setTrackOnStartForUser, {
      userId: USER,
      calendarId: "primary",
      eventId: "evt_standup",
      track: false,
    })
    rows = await t.run(
      async (ctx) => await ctx.db.query("googleEventTracking").collect()
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].trackOnStart).toBe(false)
  })

  it("refuses to tick a meeting that is not on this account", async () => {
    const t = setup()
    await expect(
      t.mutation(internal.googleTrack.setTrackOnStartForUser, {
        userId: USER,
        calendarId: "primary",
        eventId: "nope",
        track: true,
      })
    ).rejects.toThrow()
  })

  it("refuses to tick an all-day event", async () => {
    const t = setup()
    await t.run(async (ctx) => {
      await ctx.db.insert("googleEvents", eventRow({ isAllDay: true }))
    })
    await expect(
      t.mutation(internal.googleTrack.setTrackOnStartForUser, {
        userId: USER,
        calendarId: "primary",
        eventId: "evt_standup",
        track: true,
      })
    ).rejects.toThrow()
  })

  it("leaves an already-materialised entry alone when the tick is removed", async () => {
    // Unticking is not undo. It stops a FUTURE switch; the entry that already
    // exists is recorded time, and only the user removes recorded time.
    const t = setup()
    await t.run(async (ctx) => {
      await ctx.db.insert("googleEvents", eventRow())
    })
    const made = await t.mutation(internal.googleTrack.materialiseForTest, {
      userId: USER,
      calendarId: "primary",
      eventId: "evt_standup",
      mode: "live",
    })
    await t.mutation(internal.googleTrack.setTrackOnStartForUser, {
      userId: USER,
      calendarId: "primary",
      eventId: "evt_standup",
      track: false,
    })
    const entry = await t.run(async (ctx) => await ctx.db.get(made!.entryId))
    expect(entry).not.toBeNull()
    expect(entry?.deletedAt).toBeNull()
  })
})

describe("trackNow", () => {
  it("makes a completed entry for a meeting that has already ended", async () => {
    const t = setup()
    await t.run(async (ctx) => {
      await ctx.db.insert(
        "googleEvents",
        eventRow({ startedAt: NOW - 3 * HOUR, endedAt: NOW - 2 * HOUR })
      )
    })
    const result = await t.mutation(internal.googleTrack.trackNowForUser, {
      userId: USER,
      calendarId: "primary",
      eventId: "evt_standup",
    })
    const entry = await t.run(async (ctx) => await ctx.db.get(result!.entryId))
    expect(entry?.endedAt).toBe(NOW - 2 * HOUR)
    expect(entry?.source).toBe("calendar")
  })

  it("returns the existing entry rather than a second one", async () => {
    const t = setup()
    await t.run(async (ctx) => {
      await ctx.db.insert(
        "googleEvents",
        eventRow({ startedAt: NOW - 3 * HOUR, endedAt: NOW - 2 * HOUR })
      )
    })
    const first = await t.mutation(internal.googleTrack.trackNowForUser, {
      userId: USER,
      calendarId: "primary",
      eventId: "evt_standup",
    })
    const second = await t.mutation(internal.googleTrack.trackNowForUser, {
      userId: USER,
      calendarId: "primary",
      eventId: "evt_standup",
    })
    expect(second!.entryId).toBe(first!.entryId)
  })

  it("takes the timer for a meeting that is still in progress", async () => {
    const t = setup()
    await t.run(async (ctx) => {
      await ctx.db.insert(
        "googleEvents",
        eventRow({ startedAt: NOW - 10 * 60_000, endedAt: NOW + 20 * 60_000 })
      )
    })
    const result = await t.mutation(internal.googleTrack.trackNowForUser, {
      userId: USER,
      calendarId: "primary",
      eventId: "evt_standup",
    })
    const entry = await t.run(async (ctx) => await ctx.db.get(result!.entryId))
    // Running, and dated from the meeting's own start — pressing this at 10:10
    // for a meeting that began at 10:00 must not record it as ten minutes long.
    expect(entry?.endedAt).toBeNull()
    expect(entry?.startedAt).toBe(NOW - 10 * 60_000)
  })
})

describe("undoSwitch", () => {
  it("deletes the meeting entry and reopens the one it closed", async () => {
    const t = setup()
    await t.run(async (ctx) => {
      await ctx.db.insert("googleEvents", eventRow())
    })
    const before = await t.mutation(internal.entries.startAs, {
      userId: USER,
      clientKey: "before",
      title: "Deep work",
      startedAt: NOW - 45 * 60_000,
    })
    const switched = await t.mutation(internal.googleTrack.materialiseForTest, {
      userId: USER,
      calendarId: "primary",
      eventId: "evt_standup",
      mode: "live",
    })

    await t.mutation(internal.googleTrack.undoSwitchForUser, {
      userId: USER,
      entryId: switched!.entryId,
    })

    const meeting = await t.run(
      async (ctx) => await ctx.db.get(switched!.entryId)
    )
    const reopened = await t.run(async (ctx) => await ctx.db.get(before.entryId))
    expect(meeting).toBeNull()
    expect(reopened?.endedAt).toBeNull()
    expect(reopened?.durationMs).toBeNull()
  })

  it("clears entryId so the ghost comes back, and unticks so it stays back", async () => {
    const t = setup()
    await t.run(async (ctx) => {
      await ctx.db.insert("googleEvents", eventRow())
    })
    const switched = await t.mutation(internal.googleTrack.materialiseForTest, {
      userId: USER,
      calendarId: "primary",
      eventId: "evt_standup",
      mode: "live",
    })
    await t.mutation(internal.googleTrack.undoSwitchForUser, {
      userId: USER,
      entryId: switched!.entryId,
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
    const t = setup()
    await t.run(async (ctx) => {
      await ctx.db.insert("googleEvents", eventRow())
    })
    const switched = await t.mutation(internal.googleTrack.materialiseForTest, {
      userId: USER,
      calendarId: "primary",
      eventId: "evt_standup",
      mode: "live",
    })
    await t.mutation(internal.googleTrack.undoSwitchForUser, {
      userId: USER,
      entryId: switched!.entryId,
    })
    const gone = await t.run(async (ctx) => await ctx.db.get(switched!.entryId))
    expect(gone).toBeNull()
  })

  it("refuses an entry that is not a calendar switch", async () => {
    const t = setup()
    const typed = await t.mutation(internal.entries.startAs, {
      userId: USER,
      clientKey: "typed",
      title: "Deep work",
    })
    await expect(
      t.mutation(internal.googleTrack.undoSwitchForUser, {
        userId: USER,
        entryId: typed.entryId,
      })
    ).rejects.toThrow()
  })

  it("refuses a switch older than the undo window", async () => {
    // The client's toast is long gone by then. The server enforces the same
    // bound so a stale tab cannot reverse this morning's switch.
    const t = setup()
    await t.run(async (ctx) => {
      await ctx.db.insert(
        "googleEvents",
        eventRow({ startedAt: NOW - 2 * HOUR })
      )
    })
    const switched = await t.mutation(internal.googleTrack.materialiseForTest, {
      userId: USER,
      calendarId: "primary",
      eventId: "evt_standup",
      mode: "live",
    })
    await expect(
      t.mutation(internal.googleTrack.undoSwitchForUser, {
        userId: USER,
        entryId: switched!.entryId,
      })
    ).rejects.toThrow()
  })
})
