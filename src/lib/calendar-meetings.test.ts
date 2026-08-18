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
