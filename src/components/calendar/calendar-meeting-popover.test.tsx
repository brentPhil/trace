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

    // The people who HAVE replied are labelled per row; the ones who have not
    // are counted once in the summary instead. Printing "No response" beside
    // every unanswered invite repeats one word down the column and buries the
    // two answers anyone is actually scanning for.
    expect(screen.getByText(/1 accepted/)).toBeTruthy()
    expect(screen.getByText(/1 awaiting reply/)).toBeTruthy()
    expect(screen.queryByText(/No response/)).toBeNull()
  })

  it("counts every guest in the header, including unlisted ones", () => {
    show({
      attendees: [
        { name: "Ana", response: "accepted" },
        { name: "Bo", response: "declined" },
        { name: "Cy", response: "tentative" },
      ],
      attendeeCount: 3,
    })
    expect(screen.getByText("3 guests")).toBeTruthy()
    // Only the states that actually occur are named — a meeting where nobody
    // declined never mentions declining.
    expect(screen.getByText(/1 accepted · 1 declined · 1 maybe/)).toBeTruthy()
  })

  it("says guest in the singular for a one-person invite", () => {
    show({
      attendees: [{ name: "Ana", response: "accepted" }],
      attendeeCount: 1,
    })
    expect(screen.getByText("1 guest")).toBeTruthy()
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

  it("renders no link at all for a URL that is not http(s)", () => {
    /*
     * Both URLs arrive from a Google event, which means from whoever sent the
     * invite. React neutralises `javascript:` and browsers block a top-level
     * `data:` navigation, so this is defence in depth — but the content is a
     * stranger's and the check is one line. A rejected URL is treated exactly
     * as an absent one: no link, rather than a dead one.
     */
    show({
      conferenceUrl: "javascript:alert(1)",
      htmlLink: "data:text/html,<script>alert(1)</script>",
    })
    expect(screen.queryByRole("link", { name: /Join/i })).toBeNull()
    expect(screen.queryByRole("link", { name: /Google Calendar/i })).toBeNull()
  })

  it("renders no link for a relative URL, which would point at Chroneli itself", () => {
    show({ conferenceUrl: "/settings" })
    expect(screen.queryByRole("link", { name: /Join/i })).toBeNull()
  })

  it("makes a link in the description clickable", () => {
    // The join details live in the invite body, and until this they were text
    // you had to select and copy. This is the Teams block from a real invite.
    const url =
      "https://teams.microsoft.com/meet/247181968887963?p=CVeTEgIPQw3vicMw3N"
    show({ description: `Microsoft Teams meeting
Join:
${url}
ID: 247` })

    const link = screen.getByRole("link", { name: url })
    expect(link.getAttribute("href")).toBe(url)
    expect(link.getAttribute("rel")).toContain("noreferrer")
    // The surrounding prose is still there, unaltered.
    expect(screen.getByText(/Microsoft Teams meeting/)).toBeTruthy()
  })

  it("does not linkify a javascript: url in the description", () => {
    // The description is written by whoever sent the invite. A scheme outside
    // the allowlist stays readable prose rather than becoming a target.
    show({ description: "click javascript:alert(1) please" })
    expect(screen.queryByRole("link", { name: /javascript/ })).toBeNull()
    // Still readable prose — silently deleting text somebody wrote would be
    // worse than declining to make it a target.
    expect(screen.getByText(/javascript:alert/)).toBeTruthy()
  })

  it("has no editable control anywhere in it", () => {
    show({ description: "Agenda: everything" })
    // Read-only by decision. Phase 2 adds exactly one control here — the tick —
    // and nothing else in this popover ever writes.
    expect(screen.queryAllByRole("textbox")).toEqual([])
    expect(screen.queryAllByRole("combobox")).toEqual([])
  })

  it("renders a readable label for attendees with no name and no email", () => {
    show({
      attendees: [
        { response: "accepted" },
        { response: "declined" },
      ],
      attendeeCount: 2,
    })
    // Resource rooms and hidden guests (guests cannot see each other setting)
    // both arrive with no name and no email. Both rows should render "Guest"
    // rather than blank, so the user knows they exist.
    const guests = screen.getAllByText("Guest")
    expect(guests).toHaveLength(2)
  })
})
