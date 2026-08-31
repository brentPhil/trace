import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { EntryTimePopover } from "@/components/entries/entry-time-popover"
import type * as PopoverForceCloseModule from "@/lib/popover-force-close"
import type { Entry } from "@/lib/group-entries"

type PopoverForceClose = typeof PopoverForceCloseModule

/*
 * One shared actions ref, swapped in for the hook the component calls.
 *
 * Base UI populates `actionsRef` through `useImperativeHandle` inside
 * `Popover`, so a ref that comes back non-null is proof the prop actually
 * reached it. Without this, DELETING `actionsRef={actionsRef}` — and with it
 * every force-close guarantee — was invisible to the whole suite: nothing else
 * in jsdom observes that prop.
 */
type Actions = { unmount: () => void; close: () => void }

const { sharedActionsRef } = vi.hoisted(() => {
  const ref: { current: Actions | null } = { current: null }
  return { sharedActionsRef: ref }
})

vi.mock("@/lib/popover-force-close", async (importOriginal) => {
  const actual = await importOriginal<PopoverForceClose>()
  return { ...actual, usePopoverActionsRef: () => sharedActionsRef }
})

/*
 * The times control.
 *
 * It carries the one edit that can move a row off the day it is rendered on, so
 * the assertions that matter are about which day it reports and how it treats a
 * month it cannot fully show.
 */

beforeEach(() => {
  sharedActionsRef.current = null
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

  it("re-picking the day already selected writes nothing", () => {
    // It used to fire a real `editTime("day", …)`. Before `instantMovedToDay`
    // learned to keep seconds that moved the entry by up to 59.999s and
    // dragged its end along via the anchored duration; it also raised a
    // "Moved to Today" toast offering Undo for a move that never happened. On
    // a running entry it moved the live start.
    const { onCommitDay } = open()

    const selected = screen.getByRole("button", { pressed: true })
    expect(selected.textContent).toBe("7")
    fireEvent.click(selected)

    expect(onCommitDay).not.toHaveBeenCalled()
  })

  it("closes on a day pick either way", () => {
    // The no-op guard above must not turn re-picking into a dead click.
    open()
    fireEvent.click(screen.getByRole("button", { pressed: true }))
    expect(screen.queryByLabelText("Start time")).toBeNull()
  })

  /*
   * NOT TESTED HERE, deliberately: the `.catch` backstop on `onCommitDay`.
   * An attempt at it passed against the unfixed bare `void onCommitDay(day)`
   * too — vitest installs its own `unhandledRejection` handling, so a dropped
   * promise is not observable from inside a test — and a test that cannot go
   * red is worse than none. The behaviour that MATTERS, a rejected day change
   * reaching the user, is pinned where it is actually reportable:
   * `timer-bar.test.tsx` > "reports a day change that rejected".
   */

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

  it("hands its actions ref to Popover", () => {
    // The force-close safety net is only reachable through this prop, and
    // nothing else in jsdom can tell whether it was passed — see the mock at
    // the top of this file for why that mattered.
    open()
    expect(typeof sharedActionsRef.current?.unmount).toBe("function")
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
