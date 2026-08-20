// The Google → mirror mapping.
//
// A mapping is cheaper to pin down as a function than through a sync, and this
// one has four cases that are invisible to a typecheck and expensive in
// production: a tombstone with no times, an all-day event with no clock, an
// offset that is not the user's zone, and an attendee list long enough to blow
// the document limit.
import { describe, expect, it } from "vitest"
import {
  isDrawable,
  isDueForSwitch,
  isTrackable,
  mapGoogleEvent,
  overlapsWindow,
  pickSwitch,
  SWITCH_LOOKBACK_MS,
} from "./googleEvents"
import { MAX_ATTENDEES, MAX_DESCRIPTION_LENGTH } from "./schema"

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

  it("narrows an unrecognised status to 'confirmed', never passing it through raw", () => {
    // schema.ts documents this column as "confirmed" | "tentative" only. The
    // validator is v.string(), so nothing but this narrowing keeps some other
    // string Google sends (a future status, a typo) out of the mirror.
    const item = mapGoogleEvent(raw({ status: "needsAction" }), CAL)
    if (item?.kind !== "upsert") throw new Error("expected upsert")
    expect(item.row.status).toBe("confirmed")
  })

  it("truncates a description to MAX_DESCRIPTION_LENGTH", () => {
    const description = "x".repeat(MAX_DESCRIPTION_LENGTH + 500)
    const item = mapGoogleEvent(raw({ description }), CAL)
    if (item?.kind !== "upsert") throw new Error("expected upsert")
    expect(item.row.description).toHaveLength(MAX_DESCRIPTION_LENGTH)
  })

  it("falls back googleUpdatedAt to the start instant when 'updated' is missing or unparseable", () => {
    const item = mapGoogleEvent(raw({ updated: "not-a-date" }), CAL)
    if (item?.kind !== "upsert") throw new Error("expected upsert")
    expect(item.row.googleUpdatedAt).toBe(item.row.startedAt)
  })

  it("reads the RSVP off a self attendee past MAX_ATTENDEES", () => {
    // The highest-risk case in this file: the self attendee is read off EVERY
    // element, not the capped slice. A large invite with the current user
    // seated late in the array must not silently report "none".
    const attendees: Array<Record<string, unknown>> = Array.from(
      { length: MAX_ATTENDEES + 20 },
      (_, i) => ({ email: `a${i}@example.com`, responseStatus: "needsAction" })
    )
    attendees[60] = {
      email: "me@example.com",
      self: true,
      responseStatus: "tentative",
    }
    const item = mapGoogleEvent(raw({ attendees }), CAL)
    if (item?.kind !== "upsert") throw new Error("expected upsert")
    expect(item.row.myResponse).toBe("tentative")
    expect(item.row.attendees).toHaveLength(MAX_ATTENDEES)
  })
})

describe("isDrawable", () => {
  it("excludes an all-day event", () => {
    expect(isDrawable({ isAllDay: true })).toBe(false)
    expect(isDrawable({ isAllDay: false })).toBe(true)
  })
})

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
    expect(picked?.eventId).toBe("b")
  })

  it("breaks a tie on eventId, so the outcome is deterministic", () => {
    // One running entry, always — the product's oldest invariant. Which of two
    // simultaneous meetings wins matters less than that it is the same one on
    // every retry of the same minute.
    const picked = pickSwitch([
      { eventId: "zulu", startedAt: 100 },
      { eventId: "alpha", startedAt: 100 },
    ])
    expect(picked?.eventId).toBe("alpha")
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
      overlapsWindow(
        { startedAt: start + 60_000, endedAt: end - 60_000 },
        start,
        end,
        now
      )
    ).toBe(true)
  })

  it("is true for an entry that straddles the start", () => {
    expect(
      overlapsWindow(
        { startedAt: start - 60_000, endedAt: start + 60_000 },
        start,
        end,
        now
      )
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
      overlapsWindow(
        { startedAt: start - 60 * 60 * 1_000, endedAt: null },
        start,
        end,
        now
      )
    ).toBe(true)
  })

  it("is false for a running entry that started after the window closed", () => {
    expect(
      overlapsWindow({ startedAt: end + 60_000, endedAt: null }, start, end, now)
    ).toBe(false)
  })
})
