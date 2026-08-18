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
import {
  mirrorWindow,
  TOKEN_FAILURE_LIMIT,
  MEETINGS_PER_CALENDAR_LIMIT,
  HIDE_DRAIN_PAGE,
  FULL_RESYNC_TTL_MS,
} from "./google"
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
      lastPage: true,
      windowFetch: true,
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
      lastPage: true,
      windowFetch: true,
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
      lastPage: true,
      windowFetch: true,
      nowMs: NOW,
    })
    await t.mutation(internal.google.applySyncPage, {
      userId: ALICE,
      calendarId: "primary",
      items: [{ id: "evt_1", status: "cancelled" }],
      nextSyncToken: null,
      lastPage: true,
      windowFetch: true,
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
      lastPage: true,
      windowFetch: true,
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
      lastPage: true,
      windowFetch: true,
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
        //
        // Date.now(), NOT the `NOW` fixture, and that is the whole point:
        // `syncAccount` is an action, so it reads the REAL clock, and staleness
        // is `Date.now() - calendarsRefreshedAt > CALENDAR_LIST_TTL_MS`. Seeding
        // a fixed instant made this test a time bomb — it passed while the wall
        // clock was within a day of the fixture and then began failing on its
        // own, with the calendar-list fetch silently consuming the first stubbed
        // response. A test whose result depends on the date it is run is worse
        // than no test: it spends someone's afternoon on a defect that is not there.
        calendarsRefreshedAt: Date.now(),
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
        // Freshly full-synced, so `FULL_RESYNC_TTL_MS` does not force a window
        // fetch and the stored token is actually SENT — which is what this
        // test needs, since a 410 can only be provoked by a request carrying
        // one. `Date.now()` rather than the `NOW` fixture for the reason the
        // `calendarsRefreshedAt` comment above gives: an action reads the real
        // clock, and a fixed instant makes this a time bomb.
        fullSyncedAt: Date.now(),
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

  /*
   * THE PERIODIC FULL REFETCH — `FULL_RESYNC_TTL_MS`.
   *
   * Without it, `mirrorWindow` was recomputed every run and only ever reached
   * Google on the `syncToken === null` branch, so an event skipped by
   * `mapGoogleEvent` (an unparseable start, say) was skipped FOREVER: Google
   * never mentions it again on a delta, and only a 410 cleared the token.
   */
  async function seedForFullResync(
    t: ReturnType<typeof setup>,
    fullSyncedAt: number | undefined
  ) {
    await t.run(async (ctx) => {
      await ctx.db.insert("googleConnections", {
        userId: ALICE,
        status: "ok",
        calendarsRefreshedAt: Date.now(),
        lastSyncedAt: null,
        lastErrorAt: null,
        updatedAt: NOW,
      })
      await ctx.db.insert("googleCalendars", {
        userId: ALICE,
        googleId: "primary",
        summary: "Alice",
        show: true,
        syncToken: "delta-token",
        ...(fullSyncedAt === undefined ? {} : { fullSyncedAt }),
        lastSyncedAt: null,
        updatedAt: NOW,
      })
    })
  }

  /** One 200 with an empty page and a fresh token, recording every URL. */
  function stubOnePage(calls: Array<string>) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(url)
        return new Response(
          JSON.stringify({ items: [], nextSyncToken: "fresh-token" }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      })
    )
  }

  it("keeps sending the stored token while the full-resync TTL holds", async () => {
    const t = setup()
    await seedForFullResync(t, Date.now())
    const calls: Array<string> = []
    stubOnePage(calls)
    try {
      await t.action(internal.google.syncAccount, { userId: ALICE })
    } finally {
      vi.unstubAllGlobals()
    }
    expect(calls[0]).toContain("syncToken=delta-token")
  })

  it("forces a window fetch once the full-resync TTL has expired", async () => {
    const t = setup()
    // One millisecond past the TTL, so the assertion is about the boundary
    // rather than about an arbitrary age.
    await seedForFullResync(t, Date.now() - FULL_RESYNC_TTL_MS - 1)
    const calls: Array<string> = []
    stubOnePage(calls)
    try {
      await t.action(internal.google.syncAccount, { userId: ALICE })
    } finally {
      vi.unstubAllGlobals()
    }
    expect(calls).toHaveLength(1)
    expect(calls[0]).not.toContain("syncToken")
    expect(calls[0]).toContain("timeMin")

    const rows = await t.query(internal.google.allCalendarsForTest, {
      userId: ALICE,
    })
    // Stamped, so the NEXT run goes back to deltas — the TTL costs one full
    // fetch per calendar per period, not one per run.
    expect(rows[0].fullSyncedAt).toBeGreaterThan(0)
    expect(rows[0].syncToken).toBe("fresh-token")
  })

  it("forces a window fetch for a calendar row written before the field existed", async () => {
    const t = setup()
    await seedForFullResync(t, undefined)
    const calls: Array<string> = []
    stubOnePage(calls)
    try {
      await t.action(internal.google.syncAccount, { userId: ALICE })
    } finally {
      vi.unstubAllGlobals()
    }
    expect(calls[0]).not.toContain("syncToken")
  })

  it("clears the token when a run is truncated at MAX_PAGES", async () => {
    /*
     * A delta run that hits the page bound keeps the old token, so the next
     * run asks the same question, gets the same oversized answer, and stops in
     * the same place — every 15 minutes, forever, with nothing in the logs.
     * Clearing it makes the next run a window fetch, which re-states the whole
     * window instead of resuming a stream already ahead of us.
     */
    const t = setup()
    await seedForFullResync(t, Date.now())
    const calls: Array<string> = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(url)
        // Never the last page: `nextPageToken` is always present, so the loop
        // can only end at MAX_PAGES.
        return new Response(
          JSON.stringify({ items: [], nextPageToken: `p${calls.length}` }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      })
    )
    const errors = vi.spyOn(console, "error").mockImplementation(() => {})
    let logged: Array<Array<unknown>> = []
    try {
      await t.action(internal.google.syncAccount, { userId: ALICE })
    } finally {
      vi.unstubAllGlobals()
      // Copied out BEFORE restoring: `mockRestore` resets the mock as well as
      // putting `console.error` back, so the recorded calls are gone by the
      // time an assertion could read them off the spy.
      logged = errors.mock.calls
      errors.mockRestore()
    }

    expect(logged).toContainEqual([
      "google sync truncated at MAX_PAGES.",
      expect.objectContaining({ calendarId: "primary" }),
    ])
    const rows = await t.query(internal.google.allCalendarsForTest, {
      userId: ALICE,
    })
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

/*
 * "Last synced" HAS TO MEAN "DATA LAST ARRIVED".
 *
 * `lastSyncedAt` used to be stamped on any `status === "ok"` — which both the
 * transient-error handler and the below-limit token-failure path pass, because
 * they want the account picked up again next run rather than because anything
 * synced. A connection 5xx-ing every fifteen minutes therefore showed a
 * freshly-updated time in Settings while the mirror rotted.
 */
describe("markConnection's lastSyncedAt", () => {
  const NOW = Date.parse("2026-08-17T09:00:00.000Z")
  const EARLIER = NOW - 3 * 86_400_000

  const seedSynced = async (t: ReturnType<typeof setup>) => {
    await t.run(async (ctx) => {
      await ctx.db.insert("googleConnections", {
        userId: ALICE,
        status: "ok",
        calendarsRefreshedAt: EARLIER,
        lastSyncedAt: EARLIER,
        lastErrorAt: null,
        updatedAt: EARLIER,
      })
    })
  }

  const connectionRow = async (t: ReturnType<typeof setup>) =>
    (await t.query(internal.google.allConnectionsForTest, { userId: ALICE }))[0]

  it("does not move on a transient failure that keeps the status ok", async () => {
    const t = setup()
    await seedSynced(t)
    await t.mutation(internal.google.markConnection, {
      userId: ALICE,
      status: "ok",
      nowMs: NOW,
      error: "events.list failed (503)",
    })
    const row = await connectionRow(t)
    expect(row.lastSyncedAt).toBe(EARLIER)
    // …and the failure is now readable, which is what replaces the signal the
    // moving timestamp used to (wrongly) provide.
    expect(row.lastError).toContain("503")
  })

  it("does not move on a token failure below the limit", async () => {
    const t = setup()
    await seedSynced(t)
    await t.mutation(internal.google.markConnection, {
      userId: ALICE,
      nowMs: NOW,
      error: "Could not get an access token: fetch failed",
      tokenFailed: true,
    })
    expect((await connectionRow(t)).lastSyncedAt).toBe(EARLIER)
  })

  it("moves, and clears the recorded error, on a run that genuinely synced", async () => {
    const t = setup()
    await seedSynced(t)
    await t.mutation(internal.google.markConnection, {
      userId: ALICE,
      status: "ok",
      nowMs: EARLIER,
      error: "events.list failed (503)",
    })
    await t.mutation(internal.google.markConnection, {
      userId: ALICE,
      status: "ok",
      nowMs: NOW,
      synced: true,
    })
    const row = await connectionRow(t)
    expect(row.lastSyncedAt).toBe(NOW)
    // An error that outlives the failure it describes is the same lie the
    // other way round: Settings would keep saying syncing was broken.
    expect(row.lastError).toBeUndefined()
    expect(row.lastErrorAt).toBeNull()
  })
})

describe("the connection query's error fields", () => {
  const NOW = Date.parse("2026-08-17T09:00:00.000Z")

  it("returns the recorded failure, so Settings can say syncing is failing", async () => {
    const t = setup()
    await t.run(async (ctx) => {
      await ctx.db.insert("googleConnections", {
        userId: ALICE,
        status: "ok",
        calendarsRefreshedAt: NOW,
        lastSyncedAt: NOW,
        lastErrorAt: NOW,
        lastError: "events.list failed (429)",
        updatedAt: NOW,
      })
    })
    const status = await t.query(internal.google.connectionForUser, {
      userId: ALICE,
    })
    expect(status.lastError).toBe("events.list failed (429)")
    expect(status.lastErrorAt).toBe(NOW)
  })

  it("normalises a never-failed connection to null rather than an absent key", async () => {
    const t = setup()
    await t.run(async (ctx) => {
      await ctx.db.insert("googleConnections", {
        userId: ALICE,
        status: "ok",
        calendarsRefreshedAt: NOW,
        lastSyncedAt: NOW,
        lastErrorAt: null,
        updatedAt: NOW,
      })
    })
    const status = await t.query(internal.google.connectionForUser, {
      userId: ALICE,
    })
    expect(status.lastError).toBeNull()
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
      lastError: null,
      lastErrorAt: null,
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

  it("calendar drain reschedules rather than orphaning when over the bound", async () => {
    // Prove that disconnectImpl drains calendars with the same guard as events
    // and tracking: if the page came back full, reschedule and return rather than
    // deleting the connection row while stale calendars survive.
    const t = setup()
    const NOW = Date.parse("2026-08-17T09:00:00.000Z")

    // Seed more calendars than the drain page size. The exact count depends on
    // the bound; we use a number we know exceeds it.
    const CALENDAR_COUNT = 520

    await t.run(async (ctx) => {
      await ctx.db.insert("googleConnections", {
        userId: ALICE,
        status: "ok",
        calendarsRefreshedAt: NOW,
        lastSyncedAt: NOW,
        lastErrorAt: null,
        updatedAt: NOW,
      })

      // Seed more calendars than one drain page can hold
      for (let i = 0; i < CALENDAR_COUNT; i++) {
        await ctx.db.insert("googleCalendars", {
          userId: ALICE,
          googleId: `cal_${i}`,
          summary: `Calendar ${i}`,
          show: true,
          syncToken: null,
          lastSyncedAt: null,
          updatedAt: NOW,
        })
      }
    })

    // Start the disconnect
    await t.mutation(internal.google.disconnectForUser, { userId: ALICE })

    // The connection row must still exist because the drain is not finished
    const connections = await t.query(internal.google.allConnectionsForTest, {
      userId: ALICE,
    })
    expect(connections).toHaveLength(1)
    expect(connections[0].status).toBe("ok")

    // The first page of calendars must be gone
    const calendars = await t.query(internal.google.allCalendarsForTest, {
      userId: ALICE,
    })
    expect(calendars.length).toBeGreaterThan(0)
    expect(calendars.length).toBeLessThan(CALENDAR_COUNT)
  })
})

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

  // Regression for the truncate-before-filter defect: the OLD implementation
  // read up to MEETINGS_PER_CALENDAR_LIMIT rows through a single WHOLE-ACCOUNT
  // index range (`by_user_started`), ordered by `startedAt`, and only
  // afterward discarded hidden-calendar rows and all-day rows. So enough
  // discardable rows sorting earlier in the range than a real timed meeting
  // could exhaust that shared cap before the real meeting was ever read.
  //
  // This seeds exactly that: MEETINGS_PER_CALENDAR_LIMIT filler rows — half on
  // a HIDDEN calendar, half ALL-DAY rows on the SHOWN calendar — all sorting
  // before two real timed meetings on the shown calendar. Against the old
  // shape this exhausts the cap on filler and returns zero real meetings.
  // Against the fixed per-calendar-indexed read, the hidden calendar costs
  // nothing (it's never read at all) and the filler only competes against the
  // real meetings within the ONE shown calendar's own page, which is nowhere
  // near its own cap.
  it("still returns real meetings after hidden and all-day rows that would exhaust the old whole-account cap", async () => {
    const t = setup()
    const fromMs = Date.parse("2026-08-17T00:00:00.000Z")
    const toMs = Date.parse("2026-08-18T00:00:00.000Z")

    await t.run(async (ctx) => {
      await ctx.db.insert("googleCalendars", {
        userId: ALICE,
        googleId: "primary",
        summary: "Brent",
        show: true,
        syncToken: null,
        lastSyncedAt: null,
        updatedAt: fromMs,
      })
      await ctx.db.insert("googleCalendars", {
        userId: ALICE,
        googleId: "holidays",
        summary: "Holidays",
        show: false,
        syncToken: null,
        lastSyncedAt: null,
        updatedAt: fromMs,
      })

      for (let i = 0; i < MEETINGS_PER_CALENDAR_LIMIT; i++) {
        // One minute apart, all well before the real meetings seeded below —
        // this is what makes them sort first in `by_user_started` order.
        const startedAt = fromMs + i * 60_000
        const onHidden = i % 2 === 0
        await ctx.db.insert("googleEvents", {
          userId: ALICE,
          calendarId: onHidden ? "holidays" : "primary",
          eventId: `filler_${i}`,
          title: `filler ${i}`,
          startedAt,
          endedAt: startedAt + 1_800_000,
          // On the hidden calendar the row is timed (discarded for being
          // hidden); on the shown calendar it is all-day (discarded for
          // having no clock). Both are the discardable kinds the old code
          // let eat the shared budget.
          isAllDay: !onHidden,
          status: "confirmed",
          myResponse: "accepted",
          attendees: [],
          attendeeCount: 0,
          googleUpdatedAt: startedAt,
          updatedAt: startedAt,
        })
      }

      for (const eventId of ["standup", "one_on_one"]) {
        const startedAt = fromMs + (MEETINGS_PER_CALENDAR_LIMIT + 10) * 60_000
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

    const meetings = await t.query(internal.google.listMeetingsForUser, {
      userId: ALICE,
      fromMs,
      toMs,
    })
    expect(meetings.map((m) => m.eventId).sort()).toEqual([
      "one_on_one",
      "standup",
    ])
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

  it("resumes draining past one page rather than orphaning the remainder", async () => {
    // Regression for the non-resumable hide: the OLD code did a single
    // `.take(1_000)` with no check for a full page, so a calendar with more
    // than 1,000 mirrored rows (the mirror window is 60 days back / 90
    // forward, and heavy recurring expansion can reach that) kept its
    // remainder forever. Seed more than HIDE_DRAIN_PAGE rows on one calendar
    // so the first page alone cannot finish the job.
    const t = setup()
    const NOW = Date.parse("2026-08-17T09:00:00.000Z")
    const EVENT_COUNT = HIDE_DRAIN_PAGE + 20

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
      for (let i = 0; i < EVENT_COUNT; i++) {
        const startedAt = NOW + i * 60_000
        await ctx.db.insert("googleEvents", {
          userId: ALICE,
          calendarId: "primary",
          eventId: `evt_${i}`,
          title: `evt ${i}`,
          startedAt,
          endedAt: startedAt + 900_000,
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

    await t.mutation(internal.google.setCalendarShowForUser, {
      userId: ALICE,
      calendarId: "primary",
      show: false,
    })

    // Right after the mutation returns, the first bounded page is gone but the
    // remainder beyond HIDE_DRAIN_PAGE has NOT been touched yet — proving a
    // continuation is doing the rest of the work rather than one oversized
    // delete finishing it inline. (`allEventsForTest` itself is capped at 100
    // rows, well under what's left, so a non-empty page here already shows
    // rows survived the first pass.)
    const afterFirstPage = await t.query(internal.google.allEventsForTest, {
      userId: ALICE,
    })
    expect(afterFirstPage.length).toBeGreaterThan(0)

    // Drive the scheduled `dropCalendarEvents` continuation(s) to completion.
    vi.useFakeTimers()
    try {
      await t.finishAllScheduledFunctions(vi.runAllTimers)
    } finally {
      vi.useRealTimers()
    }

    expect(
      await t.query(internal.google.allEventsForTest, { userId: ALICE })
    ).toEqual([])
  })
})
