import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { CalendarMeetingPopover } from "@/components/calendar/calendar-meeting-popover"
import type { Meeting } from "@/lib/calendar-meetings"
import type { Id } from "../../../convex/_generated/dataModel"

afterEach(cleanup)

const START = Date.parse("2026-08-17T02:00:00.000Z")

function meeting(over: Partial<Meeting> = {}): Meeting {
  return {
    _id: "ge_1" as Id<"googleEvents">,
    _creationTime: START,
    userId: "user_alice",
    calendarId: "primary",
    eventId: "evt_1",
    title: "Sprint planning",
    startedAt: START,
    endedAt: START + 3_600_000,
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

function show(over: Partial<Meeting> = {}) {
  const anchor = document.createElement("div")
  document.body.appendChild(anchor)
  render(
    <CalendarMeetingPopover
      meeting={meeting(over)}
      anchor={anchor}
      onClose={vi.fn()}
      timeZone="Asia/Manila"
      use12Hour
    />
  )
}

describe("CalendarMeetingPopover", () => {
  it("shows the title and the time range in the app's own format", () => {
    show()
    expect(screen.getByText("Sprint planning")).toBeTruthy()
    // 02:00 UTC is 10:00 in Asia/Manila. Through `formatTimeRange`, so a meeting
    // is spelled exactly like an entry.
    expect(screen.getByText(/10:00 AM – 11:00 AM/)).toBeTruthy()
  })

  it("names an untitled meeting rather than rendering a blank heading", () => {
    show({ title: "" })
    expect(screen.getByText("Untitled")).toBeTruthy()
  })

  it("lists attendees with their response", () => {
    show({
      attendees: [
        { name: "Ana", email: "ana@example.com", response: "accepted" },
        { email: "bo@example.com", response: "needsAction" },
      ],
      attendeeCount: 2,
    })
    expect(screen.getByText("Ana")).toBeTruthy()
    expect(screen.getByText("bo@example.com")).toBeTruthy()
    expect(screen.getByText(/Accepted/)).toBeTruthy()
    expect(screen.getByText(/No response/)).toBeTruthy()
  })

  it("says how many attendees were not listed", () => {
    show({
      attendees: [{ email: "a@example.com", response: "accepted" }],
      attendeeCount: 51,
    })
    // Honesty about a capped list. A truncated roster that looks complete is
    // worse than one that says it is truncated.
    expect(screen.getByText(/50 more/)).toBeTruthy()
  })

  it("renders the conference link and the link out to Google", () => {
    show({
      conferenceUrl: "https://meet.google.com/abc-defg",
      htmlLink: "https://calendar.google.com/event?eid=x",
    })
    expect(
      screen.getByRole("link", { name: /Join/i }).getAttribute("href")
    ).toBe("https://meet.google.com/abc-defg")
    expect(
      screen.getByRole("link", { name: /Google Calendar/i }).getAttribute("href")
    ).toBe("https://calendar.google.com/event?eid=x")
  })

  it("omits the conference row when there is no link", () => {
    show()
    expect(screen.queryByRole("link", { name: /Join/i })).toBeNull()
  })

  it("has no editable control anywhere in it", () => {
    show({ description: "Agenda: everything" })
    // Read-only by decision. Phase 2 adds exactly one control here — the tick —
    // and nothing else in this popover ever writes.
    expect(screen.queryAllByRole("textbox")).toEqual([])
    expect(screen.queryAllByRole("combobox")).toEqual([])
  })
})
