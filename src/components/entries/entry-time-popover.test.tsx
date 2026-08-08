import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { EntryTimePopover } from "@/components/entries/entry-time-popover"
import type { Entry } from "@/lib/group-entries"

/*
 * The times control.
 *
 * It carries the one edit that can move a row off the day it is rendered on, so
 * the assertions that matter are about which day it reports and how it treats a
 * month it cannot fully show.
 */

beforeEach(() => {
  class NoopResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
    NoopResizeObserver
  Element.prototype.scrollIntoView = function scrollIntoView() {}
})

afterEach(cleanup)

const LONDON = "Europe/London"

const startField = () => screen.getByLabelText("Start time")
const endField = () => screen.getByLabelText("End time")

/** 7 August 2026, 21:00–22:21 London (BST, so 20:00Z). */
const entry = {
  _id: "e1",
  startedAt: Date.parse("2026-08-07T20:00:00Z"),
  endedAt: Date.parse("2026-08-07T21:21:00Z"),
  durationMs: 81 * 60_000,
} as unknown as Entry

const running = {
  _id: "e2",
  startedAt: Date.parse("2026-08-07T20:00:00Z"),
  endedAt: null,
  durationMs: null,
} as unknown as Entry

function open(
  props: Partial<React.ComponentProps<typeof EntryTimePopover>> = {}
) {
  const onCommitTime = vi.fn(async () => {})
  const onCommitDay = vi.fn(async () => {})
  render(
    <EntryTimePopover
      entry={entry}
      timeZone={LONDON}
      use12Hour
      weekStartDay={1}
      onCommitTime={onCommitTime}
      onCommitDay={onCommitDay}
      {...props}
    />
  )
  fireEvent.click(screen.getByRole("button", { name: /edit times/i }))
  return { onCommitTime, onCommitDay }
}

describe("EntryTimePopover", () => {
  it("seeds both fields from the entry, in the user's zone", () => {
    open()
    expect((startField() as HTMLInputElement).value).toBe("9:00 PM")
    expect((endField() as HTMLInputElement).value).toBe("10:21 PM")
  })

  it("shows the month the entry is on, with its day selected", () => {
    open()
    expect(screen.getByText("August 2026")).toBeTruthy()
    const selected = screen.getByRole("button", { pressed: true })
    expect(selected.textContent).toBe("7")
  })

  it("orders the weekday headings from the configured week start", () => {
    open({ weekStartDay: 0 })
    const headings = screen
      .getAllByRole("columnheader")
      .map((h) => h.textContent)
    expect(headings[0]).toBe("Sun")

    cleanup()
    open({ weekStartDay: 1 })
    expect(screen.getAllByRole("columnheader")[0].textContent).toBe("Mon")
  })

  it("reports the picked DAY, not an instant", () => {
    // The parent needs the date to resolve against the entry's own local time
    // and the stored zone. Handing up a number computed here would put that
    // resolution in the component that knows least about it.
    const { onCommitDay } = open()

    fireEvent.click(screen.getByRole("button", { name: /12 August 2026/i }))

    expect(onCommitDay).toHaveBeenCalledWith("2026-08-12")
  })

  it("commits a typed start time as an instant", () => {
    const { onCommitTime } = open()

    const field = screen.getByLabelText("Start time")
    fireEvent.change(field, { target: { value: "8:30 PM" } })
    fireEvent.keyDown(field, { key: "Enter" })

    expect(onCommitTime).toHaveBeenCalledWith(
      "start",
      Date.parse("2026-08-07T19:30:00Z")
    )
  })

  it("accepts the terse forms the inline fields accepted", () => {
    // 0915 and 2pm are why the old fields were pleasant. A calendar must not
    // cost that.
    const { onCommitTime } = open()

    const field = screen.getByLabelText("Start time")
    fireEvent.change(field, { target: { value: "0915" } })
    fireEvent.keyDown(field, { key: "Enter" })

    expect(onCommitTime).toHaveBeenCalledWith(
      "start",
      Date.parse("2026-08-07T08:15:00Z")
    )
  })

  it("reads an end EARLIER than the start as the next morning", () => {
    // 21:00 to 01:15 is one overnight shift, not a typo. Refusing it would make
    // people record two entries for one piece of work.
    const { onCommitTime } = open()

    const field = screen.getByLabelText("End time")
    fireEvent.change(field, { target: { value: "1:15 AM" } })
    fireEvent.keyDown(field, { key: "Enter" })

    expect(onCommitTime).toHaveBeenCalledWith(
      "end",
      Date.parse("2026-08-08T00:15:00Z")
    )
  })

  it("does not commit an unparseable time, and says so", () => {
    const { onCommitTime } = open()

    const field = screen.getByLabelText("Start time")
    fireEvent.change(field, { target: { value: "half nine" } })
    fireEvent.keyDown(field, { key: "Enter" })

    expect(onCommitTime).not.toHaveBeenCalled()
    expect(screen.getByRole("alert").textContent).toMatch(/9:15/)
  })

  it("pages months without moving the entry", () => {
    const { onCommitDay } = open()

    fireEvent.click(screen.getByRole("button", { name: /previous month/i }))
    expect(screen.getByText("July 2026")).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: /next month/i }))
    fireEvent.click(screen.getByRole("button", { name: /next month/i }))
    expect(screen.getByText("September 2026")).toBeTruthy()

    expect(onCommitDay).not.toHaveBeenCalled()
  })

  it("offers no end field while the entry is running", () => {
    // Typing an end time is a stop, and stopping belongs to the button that
    // says Stop.
    open({ entry: running })

    expect(screen.getByLabelText("Start time")).toBeTruthy()
    expect(screen.queryByLabelText("End time")).toBeNull()
    expect(screen.getByText("…")).toBeTruthy()
  })
})
