/// <reference types="vite/client" />
// The Google Calendar mirror.
//
// The tables are tested before anything writes to them because two of their
// shapes are load-bearing and silent when wrong: `googleEvents` holds ONLY
// Google's facts and is replaced wholesale by every sync, while
// `googleEventTracking` holds the user's tick and is never pruned. A field on
// the wrong side of that line is lost on the next poll, with no error anywhere.
import { convexTest } from "convex-test"
import { describe, expect, it, vi } from "vitest"
import schema from "./schema"
import { api, internal } from "./_generated/api"
import { mirrorWindow, TOKEN_FAILURE_LIMIT } from "./google"
import { traceErrorCode } from "./lib/codes"

// `syncAccount` fetches its access token through Better Auth's full stack —
// component tables, encrypted-token storage, a real OAuth refresh call — none
// of which this suite seeds. Stubbing `createAuth` here is what lets the
// `gone`-restart test below exercise the loop without also standing up a
// fake Google account inside the Better Auth component.
//
// Only `createAuth` is replaced — `requireUserId` and everything else stay
// real via `importOriginal`. The public connection surface (`connection`,
// `connect`, `disconnect`) calls `requireUserId`, and a full-module mock would
// silently turn it into `undefined`, not a stub that behaves like auth.
vi.mock("./auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./auth")>()
  return {
    ...actual,
    createAuth: () => ({
      api: {
        getAccessToken: async () => ({ accessToken: "fake-access-token" }),
      },
    }),
  }
})

const modules = import.meta.glob("./**/*.*s")
const setup = () => convexTest(schema, modules)

const ALICE = "user_alice"

async function expectCode(
  promise: Promise<unknown>,
  code: string
): Promise<void> {
  try {
    await promise
  } catch (error) {
    expect(traceErrorCode(error) ?? String(error)).toBe(code)
    return
  }
  throw new Error(`expected rejection with code ${code}, but it resolved`)
}

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

describe("upsertCalendars", () => {
  const NOW = Date.parse("2026-08-17T09:00:00.000Z")

  function event(userId: string, calendarId: string, eventId: string, startIso: string) {
    const startedAt = Date.parse(startIso)
    return {
      userId,
      calendarId,
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
    }
  }

  function calendarRow(userId: string, googleId: string) {
    return {
      userId,
      googleId,
      summary: googleId,
      show: true,
      syncToken: null,
      lastSyncedAt: null,
      updatedAt: NOW,
    }
  }

  it("gives a calendar Google reports for the first time show: false", async () => {
    // A shared team calendar or a subscribed holiday feed must not appear on
    // the grid the moment Google mentions it — the user has to opt in.
    const t = setup()
    await t.mutation(internal.google.upsertCalendars, {
      userId: ALICE,
      calendars: [{ googleId: "cal_new", summary: "Team Calendar" }],
      nowMs: NOW,
    })

    const rows = await t.query(internal.google.allCalendarsForTest, { userId: ALICE })
    expect(rows).toHaveLength(1)
    expect(rows[0].show).toBe(false)
    expect(rows[0].summary).toBe("Team Calendar")
  })

  it("keeps show and defaultProjectId across a re-sync, refreshing only the summary", async () => {
    const t = setup()
    const projectId = await t.run((ctx) =>
      ctx.db.insert("projects", {
        userId: ALICE,
        name: "Client Work",
        color: "blue",
        archived: false,
        billableByDefault: true,
        updatedAt: NOW,
        deletedAt: null,
      })
    )
    await t.run(async (ctx) => {
      await ctx.db.insert("googleCalendars", {
        userId: ALICE,
        googleId: "cal_1",
        summary: "Old Name",
        show: true,
        defaultProjectId: projectId,
        syncToken: null,
        lastSyncedAt: null,
        updatedAt: NOW,
      })
    })

    await t.mutation(internal.google.upsertCalendars, {
      userId: ALICE,
      calendars: [{ googleId: "cal_1", summary: "New Name" }],
      nowMs: NOW + 1,
    })

    const rows = await t.query(internal.google.allCalendarsForTest, { userId: ALICE })
    expect(rows).toHaveLength(1)
    // The user's own choices on the row must outlive a sync that only
    // reconciles Google's facts against ours.
    expect(rows[0].show).toBe(true)
    expect(rows[0].defaultProjectId).toBe(projectId)
    expect(rows[0].summary).toBe("New Name")
  })

  it("deletes a calendar Google no longer reports, along with its mirrored events", async () => {
    const t = setup()
    await t.run(async (ctx) => {
      await ctx.db.insert("googleCalendars", calendarRow(ALICE, "cal_keep"))
      await ctx.db.insert("googleCalendars", calendarRow(ALICE, "cal_gone"))
      await ctx.db.insert(
        "googleEvents",
        event(ALICE, "cal_keep", "evt_keep_1", "2026-08-17T10:00:00.000Z")
      )
      await ctx.db.insert(
        "googleEvents",
        event(ALICE, "cal_gone", "evt_gone_1", "2026-08-17T10:00:00.000Z")
      )
      await ctx.db.insert(
        "googleEvents",
        event(ALICE, "cal_gone", "evt_gone_2", "2026-08-17T11:00:00.000Z")
      )
    })

    await t.mutation(internal.google.upsertCalendars, {
      userId: ALICE,
      calendars: [{ googleId: "cal_keep", summary: "cal_keep" }],
      nowMs: NOW,
    })

    const calendars = await t.query(internal.google.allCalendarsForTest, { userId: ALICE })
    expect(calendars.map((c) => c.googleId)).toEqual(["cal_keep"])

    const events = await t.query(internal.google.allEventsForTest, { userId: ALICE })
    expect(events.map((e) => e.eventId)).toEqual(["evt_keep_1"])
  })

  it("does not touch the surviving calendar's events during orphan cleanup", async () => {
    // This is the property a wrong index range would break: reading events
    // across all calendars instead of just the orphan's own would delete rows
    // a still-reported calendar owns.
    const t = setup()
    await t.run(async (ctx) => {
      await ctx.db.insert("googleCalendars", calendarRow(ALICE, "cal_keep"))
      await ctx.db.insert("googleCalendars", calendarRow(ALICE, "cal_gone"))
      await ctx.db.insert(
        "googleEvents",
        event(ALICE, "cal_keep", "evt_keep_1", "2026-08-17T10:00:00.000Z")
      )
      await ctx.db.insert(
        "googleEvents",
        event(ALICE, "cal_keep", "evt_keep_2", "2026-08-17T11:00:00.000Z")
      )
      await ctx.db.insert(
        "googleEvents",
        event(ALICE, "cal_gone", "evt_gone_1", "2026-08-17T10:00:00.000Z")
      )
    })

    await t.mutation(internal.google.upsertCalendars, {
      userId: ALICE,
      calendars: [{ googleId: "cal_keep", summary: "cal_keep" }],
      nowMs: NOW,
    })

    const events = await t.query(internal.google.allEventsForTest, { userId: ALICE })
    expect(events.map((e) => e.eventId).sort()).toEqual(["evt_keep_1", "evt_keep_2"])
  })

  it("does not touch another user's calendars or events", async () => {
    const t = setup()
    await t.run(async (ctx) => {
      await ctx.db.insert("googleCalendars", calendarRow("user_bob", "cal_bob"))
      await ctx.db.insert(
        "googleEvents",
        event("user_bob", "cal_bob", "evt_bob_1", "2026-08-17T10:00:00.000Z")
      )
    })

    await t.mutation(internal.google.upsertCalendars, {
      userId: ALICE,
      calendars: [{ googleId: "cal_alice", summary: "cal_alice" }],
      nowMs: NOW,
    })

    const bobCalendars = await t.query(internal.google.allCalendarsForTest, {
      userId: "user_bob",
    })
    expect(bobCalendars.map((c) => c.googleId)).toEqual(["cal_bob"])

    const bobEvents = await t.query(internal.google.allEventsForTest, {
      userId: "user_bob",
    })
    expect(bobEvents.map((e) => e.eventId)).toEqual(["evt_bob_1"])
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

  it("keeps a row exactly at fromMs and deletes one exactly at toMs", async () => {
    // The window is half-open [fromMs, toMs), the convention the rest of this
    // product uses: `.lt("startedAt", fromMs)` does not touch fromMs itself,
    // and `.gte("startedAt", toMs)` catches toMs itself. A row sitting on
    // either boundary pins which side of the inequality is which.
    const t = setup()
    const { fromMs, toMs } = mirrorWindow(NOW)
    await t.run(async (ctx) => {
      for (const [eventId, startedAt] of [
        ["at_from", fromMs],
        ["at_to", toMs],
      ] as const) {
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

    await t.mutation(internal.google.pruneEvents, { userId: ALICE, fromMs, toMs })

    const rows = await t.query(internal.google.allEventsForTest, { userId: ALICE })
    expect(rows.map((row) => row.eventId)).toEqual(["at_from"])
  })
})

describe("syncAccount", () => {
  const NOW = Date.parse("2026-08-17T09:00:00.000Z")

  it("markConnection records the reauth flag and the error text", async () => {
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

  it("refetches the window in the same run after a `gone` response", async () => {
    // Defect 1: a `do/while`'s `continue` jumps straight to the condition
    // check, so a `gone` branch that just set `pageToken = null` would exit
    // the loop instead of restarting it, and the calendar would fetch zero
    // pages until the next cron tick. This proves the restart happens
    // WITHIN one `syncAccount` call: the syncToken-bearing first request is
    // answered 410, and a second, syncToken-less request follows before the
    // action returns.
    const t = setup()
    await t.run(async (ctx) => {
      await ctx.db.insert("googleConnections", {
        userId: ALICE,
        status: "ok",
        // Not stale, so syncAccount skips fetchCalendarList and the mocked
        // fetch below only ever has to answer events.list.
        calendarsRefreshedAt: NOW,
        lastSyncedAt: null,
        lastErrorAt: null,
        updatedAt: NOW,
      })
      await ctx.db.insert("googleCalendars", {
        userId: ALICE,
        googleId: "primary",
        summary: "Alice",
        show: true,
        syncToken: "stale-token",
        lastSyncedAt: null,
        updatedAt: NOW,
      })
    })

    const calls: Array<string> = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(url)
        if (calls.length === 1) {
          return new Response(null, { status: 410 })
        }
        return new Response(JSON.stringify({ items: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      })
    )

    try {
      await t.action(internal.google.syncAccount, { userId: ALICE })
    } finally {
      vi.unstubAllGlobals()
    }

    expect(calls).toHaveLength(2)
    expect(calls[0]).toContain("syncToken=stale-token")
    expect(calls[1]).not.toContain("syncToken")
    expect(calls[1]).toContain("timeMin")

    const rows = await t.query(internal.google.allCalendarsForTest, {
      userId: ALICE,
    })
    // The window fetch's empty page carried no nextSyncToken (the mock
    // response omits it), so the calendar's syncToken stays cleared — proof
    // the second fetch actually ran and its outcome was applied.
    expect(rows[0].syncToken).toBeNull()
  })
})

describe("markConnection's token-failure counter", () => {
  // A single `getAccessToken` failure cannot tell a revoked grant from a
  // network blip reaching Google's token endpoint — Better Auth collapses
  // both into the identical error shape (see TOKEN_FAILURE_LIMIT's comment
  // in convex/google.ts). These tests are what proves counting consecutive
  // failures, rather than flagging on the first one, actually behaves.
  const NOW = Date.parse("2026-08-17T09:00:00.000Z")

  const seedConnection = async (t: ReturnType<typeof setup>) => {
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
  }

  it("a single token failure leaves status ok and records the error, so the next run retries", async () => {
    const t = setup()
    await seedConnection(t)

    await t.mutation(internal.google.markConnection, {
      userId: ALICE,
      nowMs: NOW,
      error: "Could not get an access token: fetch failed",
      tokenFailed: true,
    })

    const rows = await t.query(internal.google.allConnectionsForTest, {
      userId: ALICE,
    })
    expect(rows[0].status).toBe("ok")
    expect(rows[0].tokenFailures).toBe(1)
    expect(rows[0].lastError).toContain("fetch failed")
  })

  it("failures below the limit keep status ok and accumulate", async () => {
    const t = setup()
    await seedConnection(t)

    for (let i = 0; i < TOKEN_FAILURE_LIMIT - 1; i++) {
      await t.mutation(internal.google.markConnection, {
        userId: ALICE,
        nowMs: NOW,
        error: "Could not get an access token: fetch failed",
        tokenFailed: true,
      })
    }

    const rows = await t.query(internal.google.allConnectionsForTest, {
      userId: ALICE,
    })
    expect(rows[0].status).toBe("ok")
    expect(rows[0].tokenFailures).toBe(TOKEN_FAILURE_LIMIT - 1)
  })

  it("reaching TOKEN_FAILURE_LIMIT consecutive failures flips status to reauth", async () => {
    const t = setup()
    await seedConnection(t)

    for (let i = 0; i < TOKEN_FAILURE_LIMIT; i++) {
      await t.mutation(internal.google.markConnection, {
        userId: ALICE,
        nowMs: NOW,
        error: "Could not get an access token: fetch failed",
        tokenFailed: true,
      })
    }

    const rows = await t.query(internal.google.allConnectionsForTest, {
      userId: ALICE,
    })
    expect(rows[0].status).toBe("reauth")
    expect(rows[0].tokenFailures).toBe(TOKEN_FAILURE_LIMIT)
  })

  it("a successful run resets the count, so two failures, a success, then two more failures do not trip the limit", async () => {
    // The test that proves the counter is CONSECUTIVE rather than cumulative.
    // Without the reset, 2 + 2 = 4 failures would exceed a limit of 3 even
    // though none of them were consecutive.
    const t = setup()
    await seedConnection(t)

    for (let i = 0; i < 2; i++) {
      await t.mutation(internal.google.markConnection, {
        userId: ALICE,
        nowMs: NOW,
        error: "Could not get an access token: fetch failed",
        tokenFailed: true,
      })
    }

    await t.mutation(internal.google.markConnection, {
      userId: ALICE,
      status: "ok",
      nowMs: NOW,
      calendarsRefreshed: true,
    })

    for (let i = 0; i < 2; i++) {
      await t.mutation(internal.google.markConnection, {
        userId: ALICE,
        nowMs: NOW,
        error: "Could not get an access token: fetch failed",
        tokenFailed: true,
      })
    }

    const rows = await t.query(internal.google.allConnectionsForTest, {
      userId: ALICE,
    })
    expect(rows[0].status).toBe("ok")
    expect(rows[0].tokenFailures).toBe(2)
  })
})

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
