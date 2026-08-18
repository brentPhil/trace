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
import { mirrorWindow } from "./google"

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
