import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { CalendarMeetingPopover } from "@/components/calendar/calendar-meeting-popover"
import type { Meeting } from "@/lib/calendar-meetings"
import type { Id } from "../../../convex/_generated/dataModel"

afterEach(cleanup)

const START = Date.parse("2026-08-17T02:00:00.000Z")
/** A meeting still ahead of `nowMs`, so a tick has a switch left to instruct. */
const LATER = START + 60 * 60 * 1_000
/** A meeting that already happened, where a tick has nothing left to fire. */
const EARLIER = START - 3 * 60 * 60 * 1_000

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

function show(
  over: Partial<Meeting> = {},
  handlers: {
    onSetTrack?: (calendarId: string, eventId: string, track: boolean) => void
    onTrackNow?: (calendarId: string, eventId: string) => void
  } = {}
) {
  const anchor = document.createElement("div")
  document.body.appendChild(anchor)
  render(
    <CalendarMeetingPopover
      meeting={meeting(over)}
      anchor={anchor}
      onClose={vi.fn()}
      timeZone="Asia/Manila"
      use12Hour
      nowMs={START}
      {...handlers}
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

  it("shows an avatar per attendee, named through its label", () => {
    show({
      attendees: [
        { name: "Ana Cruz", email: "ana@example.com", response: "accepted" },
        { email: "bo@example.com", response: "needsAction" },
      ],
      attendeeCount: 2,
    })
    // The name moved off the surface and into the avatar's label; who a circle
    // stands for is still stated, it just waits to be asked.
    expect(screen.getByLabelText("Ana Cruz — Accepted")).toBeTruthy()
    expect(screen.getByText("AC")).toBeTruthy()
    // A non-replier's label carries no response at all — "No response" per
    // person repeats one non-fact down the roster. The count of non-repliers
    // is stated once, in the summary line.
    expect(screen.getByLabelText("bo@example.com")).toBeTruthy()
    expect(screen.getByText("B")).toBeTruthy()

    expect(screen.getByText(/1 accepted/)).toBeTruthy()
    expect(screen.getByText(/1 awaiting reply/)).toBeTruthy()
    expect(screen.queryByText(/No response/)).toBeNull()
  })

  it("rings only the accepted avatar in green", () => {
    show({
      attendees: [
        { name: "Ana", response: "accepted" },
        { name: "Bo", response: "declined" },
      ],
      attendeeCount: 2,
    })
    // The ring is the mark of acceptance and nothing else wears it. The same
    // fact is restated in words by the summary line, so the meaning never
    // rests on colour alone.
    expect(
      screen.getByLabelText("Ana — Accepted").className
    ).toContain("border-[oklch")
    expect(
      screen.getByLabelText("Bo — Declined").className
    ).not.toContain("border-[oklch")
  })

  it("folds a long roster behind a +N chip that opens the rest", () => {
    show({
      attendees: [
        { name: "Ana", response: "accepted" },
        { name: "Bo", response: "needsAction" },
        { name: "Cy", response: "needsAction" },
        { name: "Di", response: "needsAction" },
        { name: "Ed", response: "needsAction" },
        { name: "Fay", response: "needsAction" },
        { name: "Gus", response: "needsAction" },
        { name: "Hal", response: "needsAction" },
      ],
      attendeeCount: 8,
    })
    // Six circles, then the chip; Gus and Hal are behind it, not gone.
    expect(screen.getByLabelText("Fay")).toBeTruthy()
    expect(screen.queryByLabelText("Gus")).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: /\+2/ }))
    // The chip's popup prints avatar AND name per row — it is where somebody
    // goes to find out who exactly is behind the fold.
    expect(screen.getByLabelText("Gus")).toBeTruthy()
    expect(screen.getByText("Gus")).toBeTruthy()
    expect(screen.getByText("Hal")).toBeTruthy()
  })

  it("does not fold exactly one avatar behind a +1", () => {
    show({
      attendees: [
        { name: "Ana", response: "accepted" },
        { name: "Bo", response: "needsAction" },
        { name: "Cy", response: "needsAction" },
        { name: "Di", response: "needsAction" },
        { name: "Ed", response: "needsAction" },
        { name: "Fay", response: "needsAction" },
        { name: "Gus", response: "needsAction" },
      ],
      attendeeCount: 7,
    })
    // A "+1" chip takes the same space as the avatar it hides, saying less.
    expect(screen.getByLabelText("Gus")).toBeTruthy()
    expect(screen.queryByRole("button", { name: /\+1/ })).toBeNull()
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
    // worse than one that says it is truncated: the chip counts the people
    // Google never listed, and opening it says why they cannot be shown.
    fireEvent.click(screen.getByRole("button", { name: /\+50/ }))
    expect(screen.getByText(/and 50 more not listed/)).toBeTruthy()
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
    // both arrive with no name and no email. Both get a "Guest" avatar rather
    // than nothing, so the user knows they exist.
    expect(screen.getByLabelText("Guest — Accepted")).toBeTruthy()
    expect(screen.getByLabelText("Guest — Declined")).toBeTruthy()
  })

  it("offers a tick on a meeting that has not started", () => {
    const onSetTrack = vi.fn()
    show({ startedAt: LATER, endedAt: LATER + 1_800_000 }, { onSetTrack })
    const box = screen.getByRole("checkbox", { name: /track this meeting/i })
    fireEvent.click(box)
    expect(onSetTrack).toHaveBeenCalledWith("primary", "evt_1", true)
  })

  it("offers Track this on a meeting that has already ended", () => {
    const onTrackNow = vi.fn()
    show({ startedAt: EARLIER, endedAt: EARLIER + 1_800_000 }, { onTrackNow })
    // A tick has nothing left to fire on a meeting that already happened, so the
    // popover offers the same materialisation the backfill runs, on demand.
    expect(
      screen.queryByRole("checkbox", { name: /track this meeting/i })
    ).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: /track this/i }))
    expect(onTrackNow).toHaveBeenCalledWith("primary", "evt_1")
  })

  it("offers Track this on a meeting that has already begun", () => {
    // The boundary itself, and the one that matters: `startedAt === nowMs` is a
    // meeting that IS starting, so the future switch a tick instructs is already
    // spent. Anything at or before `nowMs` gets the button, never the box.
    const onSetTrack = vi.fn()
    const onTrackNow = vi.fn()
    show({ startedAt: START, endedAt: START + 1_800_000 }, { onSetTrack, onTrackNow })
    expect(
      screen.queryByRole("checkbox", { name: /track this meeting/i })
    ).toBeNull()
    expect(screen.getByRole("button", { name: /track this/i })).toBeTruthy()
  })

  it("offers nothing to track when no handler was given", () => {
    // The popover is rendered in tests and stories without the mutations wired.
    // It must degrade to the read-only Phase 1 shape rather than drawing a
    // control that does nothing.
    show({ startedAt: LATER })
    expect(screen.queryByRole("checkbox")).toBeNull()
    expect(screen.queryByRole("button", { name: /track this/i })).toBeNull()
    // And the rest of the Phase 1 shape is still there.
    expect(screen.getByText("Sprint planning")).toBeTruthy()
  })

  it("is still read-only in every other respect", () => {
    show({ description: "Agenda: everything" }, { onSetTrack: vi.fn() })
    // The tick is the ONE control this popover ever gains. Nothing in here writes
    // to Google and nothing in here edits an entry.
    expect(screen.queryAllByRole("textbox")).toEqual([])
    expect(screen.queryAllByRole("combobox")).toEqual([])
  })
})
