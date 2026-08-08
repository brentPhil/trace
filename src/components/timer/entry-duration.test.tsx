import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render } from "@testing-library/react"
import { EntryDuration } from "./entry-duration"

/**
 * What this file is actually for.
 *
 * `useElapsedMs` cannot use an early return to avoid the clock, because a hook
 * call may not sit behind a condition — so the version that read `useSecond()`
 * and then returned `endedAt - startedAt` registered EVERY completed row as a
 * per-second listener. Nothing was visibly wrong: the rendered text is identical
 * on every tick, so the bug showed up only as work, and three comments in three
 * files asserted the opposite of what the code did.
 *
 * A test asserting the rendered text would therefore have passed against the
 * broken version. These assert the SUBSCRIPTION instead, via the timer the
 * clock store schedules when its first listener arrives, which is the only
 * externally visible trace the subscription leaves.
 */

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const STARTED = 1_700_000_000_000

describe("EntryDuration subscriptions", () => {
  it("subscribes to nothing when the entry is completed", () => {
    vi.useFakeTimers()
    vi.setSystemTime(STARTED + 90_000)

    const view = render(<EntryDuration startedAt={STARTED} endedAt={STARTED + 65_000} />)

    expect(vi.getTimerCount()).toBe(0)
    // And it still renders the right number — the point is that it does so
    // without the clock, not that it stopped working.
    expect(view.container.textContent).toBe("0:01:05")
  })

  it("still subscribes to nothing with a page full of completed entries", () => {
    vi.useFakeTimers()
    vi.setSystemTime(STARTED + 10 * 60_000)

    render(
      <>
        {Array.from({ length: 50 }, (_, i) => (
          <EntryDuration key={i} startedAt={STARTED} endedAt={STARTED + 60_000} />
        ))}
      </>
    )

    // The regression this pins: 50 rows meant 50 listeners and, with the
    // discarded `useMinute()` call, 100.
    expect(vi.getTimerCount()).toBe(0)
  })

  it("subscribes once the entry is running", () => {
    vi.useFakeTimers()
    vi.setSystemTime(STARTED + 5_000)

    render(<EntryDuration startedAt={STARTED} endedAt={null} />)

    // One store, one timer — however many running rows there are.
    expect(vi.getTimerCount()).toBe(1)
  })

  it("keeps one timer for the whole page, not one per running row", () => {
    vi.useFakeTimers()
    vi.setSystemTime(STARTED + 5_000)

    render(
      <>
        {Array.from({ length: 8 }, (_, i) => (
          <EntryDuration key={i} startedAt={STARTED} endedAt={null} />
        ))}
      </>
    )

    expect(vi.getTimerCount()).toBe(1)
  })

  it("tears the timer down when the last running row unmounts", () => {
    vi.useFakeTimers()
    vi.setSystemTime(STARTED + 5_000)

    const view = render(<EntryDuration startedAt={STARTED} endedAt={null} />)
    expect(vi.getTimerCount()).toBe(1)

    view.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  /**
   * The mixed page is the real one: a running timer at the top and a day of
   * finished rows beneath it. Exactly one timer, contributed by the one running
   * row.
   */
  it("runs one timer for a mixed page", () => {
    vi.useFakeTimers()
    vi.setSystemTime(STARTED + 5_000)

    render(
      <>
        <EntryDuration startedAt={STARTED} endedAt={null} />
        {Array.from({ length: 30 }, (_, i) => (
          <EntryDuration key={i} startedAt={STARTED} endedAt={STARTED + 60_000} />
        ))}
      </>
    )

    expect(vi.getTimerCount()).toBe(1)
  })
})
