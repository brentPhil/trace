import { describe, expect, it } from "vitest"
import { meetingEvents } from "@/lib/calendar-meetings"
import type { Meeting } from "@/lib/calendar-meetings"
import type { Id } from "../../convex/_generated/dataModel"

const START = Date.parse("2026-08-17T02:00:00.000Z")

/** A minute before the fixture starts, so the default `meeting()` is one the
 *  user could still tick. The cases that do not care about `startable` pass it
 *  anyway, because the clock is part of the mapping now. */
const NOW = START - 60_000

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
    const [event] = meetingEvents([meeting()], NOW)
    expect(event.title).toBe("Standup")
    expect((event.start as Date).getTime()).toBe(START)
    expect((event.end as Date).getTime()).toBe(START + 900_000)
    expect(event.extendedProps.kind).toBe("meeting")
  })

  it("drops a meeting whose entry already exists", () => {
    // The grid must never draw the same hour twice: once a meeting has become a
    // real entry, the entry is the thing on screen.
    const tracked = meeting({ entryId: "te_1" as Id<"timeEntries"> })
    expect(meetingEvents([tracked], NOW)).toEqual([])
  })

  it("drops an all-day meeting", () => {
    expect(meetingEvents([meeting({ isAllDay: true })], NOW)).toEqual([])
  })

  it("floors a zero-length meeting to one minute so it is still drawn", () => {
    const [event] = meetingEvents([meeting({ endedAt: START })], NOW)
    expect((event.end as Date).getTime()).toBe(START + 60_000)
  })

  it("gives every event an id distinct from an entry's", () => {
    // FullCalendar keys on `id`. A meeting and an entry sharing one would make
    // the grid drop whichever it saw second.
    const [event] = meetingEvents([meeting()], NOW)
    expect(event.id).toBe("meeting:primary:evt_1")
  })

  it("carries trackOnStart through for the checkbox", () => {
    const [event] = meetingEvents([meeting({ trackOnStart: true })], NOW)
    expect(event.extendedProps.trackOnStart).toBe(true)
  })

  it("marks a future meeting startable and one already begun not", () => {
    const [future] = meetingEvents(
      [meeting({ startedAt: NOW + 60_000, endedAt: NOW + 3_600_000 })],
      NOW
    )
    const [past] = meetingEvents(
      [meeting({ startedAt: NOW - 3_600_000, endedAt: NOW - 60_000 })],
      NOW
    )
    // The checkbox is an instruction to a FUTURE switch. On a meeting that has
    // already begun there is nothing left for it to fire, so the popover offers
    // "Track this" instead and the block offers nothing at all.
    expect(future.extendedProps.startable).toBe(true)
    expect(past.extendedProps.startable).toBe(false)
  })

  it("puts the boundary at the start instant itself", () => {
    // `startedAt === nowMs` is the moment the switch would have fired, so there
    // is nothing left for a tick to instruct. `>`, not `>=`.
    const [begun] = meetingEvents([meeting({ startedAt: NOW })], NOW)
    expect(begun.extendedProps.startable).toBe(false)
  })
})
