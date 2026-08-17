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
