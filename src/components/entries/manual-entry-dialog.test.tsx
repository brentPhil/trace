import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { ManualEntryDialog } from "@/components/entries/manual-entry-dialog"

/*
 * "I forgot to start the timer" is the most common repair action in a tracker,
 * and it is fully keyboard-driven only because `parseTimeOfDay` accepts a bare
 * hour. Which hour it picks is the whole risk: the two readings are twelve
 * apart, and nothing in this dialog echoes the parse back before it commits.
 */

const LONDON = "Europe/London"

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function openDialog() {
  const onCreate = vi.fn(async () => {})
  render(<ManualEntryDialog timeZone={LONDON} onCreate={onCreate} />)
  fireEvent.click(screen.getByLabelText("Add entry"))
  return { onCreate }
}

const submit = () =>
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", { name: "Add entry" })
  )

describe("ManualEntryDialog", () => {
  it("resolves a bare hour against the wall clock, not against midnight", async () => {
    // `parseTimeOfDay`'s second argument disambiguates 1-11 by whichever
    // reading is nearer on the clock face. A literal 0 is not "no context" —
    // it is the specific claim that it is currently midnight, so every bare
    // hour resolved to AM. Logging this afternoon's 3-to-4 from the terse form
    // the parser exists to support recorded a 3 AM entry.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(Date.parse("2026-08-07T14:00:00Z")) // 3:00 PM BST
    const { onCreate } = openDialog()

    fireEvent.change(screen.getByLabelText("From"), { target: { value: "3" } })
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "4" } })
    submit()
    await vi.advanceTimersByTimeAsync(0)

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        startedAt: Date.parse("2026-08-07T14:00:00Z"), // 3 PM, not 3 AM
        endedAt: Date.parse("2026-08-07T15:00:00Z"),
      })
    )
  })

  it("still reads an explicit 24-hour time exactly as written", async () => {
    // The nearest-reading rule must only ever break a tie the user left open.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(Date.parse("2026-08-07T14:00:00Z"))
    const { onCreate } = openDialog()

    fireEvent.change(screen.getByLabelText("From"), { target: { value: "0915" } })
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "17:30" } })
    submit()
    await vi.advanceTimersByTimeAsync(0)

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        startedAt: Date.parse("2026-08-07T08:15:00Z"),
        endedAt: Date.parse("2026-08-07T16:30:00Z"),
      })
    )
  })

  it("seeds the day from the clock at open, not from a prop fixed at mount", async () => {
    /*
     * The regression this guards.
     *
     * The dialog used to take `today` as a prop. /timer recomputed it every
     * second through `useSecond`, so it was always current there — but the
     * dialog now mounts in the shell (`_authed.tsx`), which has no clock at
     * all. A prop would freeze at page load, and a tab opened yesterday
     * evening would offer yesterday at 09:00 this morning: precisely the
     * failure the re-seed-on-open effect was written to prevent, reintroduced
     * by moving the mount point.
     *
     * So the dialog reads the wall clock itself. This test mounts it, moves the
     * clock across midnight WITHOUT re-rendering, and opens it.
     */
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date("2026-08-10T23:50:00Z"))

      render(<ManualEntryDialog timeZone="UTC" onCreate={vi.fn()} />)

      vi.setSystemTime(new Date("2026-08-11T00:10:00Z"))

      fireEvent.click(screen.getByLabelText("Add entry"))

      // `getByLabelText`, not `findByLabelText`: this suite's `@testing-library/dom`
      // has no `jest` global to detect (this project imports `vi` explicitly rather
      // than running with `test.globals`), so its fake-timer detection never fires —
      // `findBy*`/`waitFor` would poll the now-mocked `setInterval`, which never
      // ticks, and hang until Vitest's own real-time test timeout. `fireEvent`
      // already flushes the open-effect synchronously via `act()`, exactly as the
      // sibling tests above rely on when they read a field right after clicking.
      const day = screen.getByLabelText("Day")
      expect((day as HTMLInputElement).value).toBe("2026-08-11")
    } finally {
      vi.useRealTimers()
    }
  })
})
