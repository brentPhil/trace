import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { TimerBar } from "@/components/timer/timer-bar"
import { optimisticIdFor } from "@/lib/optimistic-id"
import type { TimerBarActions } from "@/components/timer/timer-bar"
import type { Doc, Id } from "../../../convex/_generated/dataModel"

/*
 * The timer bar's draft is the trickiest state in the client: it is seeded from
 * a reactive query, written back to it, and has to survive the running entry
 * changing identity underneath it. Three distinct bugs have lived here, each
 * one losing text the user had typed, and none of them were visible by reading
 * the component.
 *
 * These tests exist because the component takes its writes as arguments. That
 * refactor was done to stop the design harness writing to production; being
 * able to assert on what would have been written is the second dividend.
 */

const TITLE_DEBOUNCE_MS = 400

function entry(over: Partial<Doc<"timeEntries">> & { clientKey: string }): Doc<"timeEntries"> {
  return {
    _id: over._id ?? (optimisticIdFor(over.clientKey) as unknown as Id<"timeEntries">),
    _creationTime: 0,
    userId: "u",
    title: "",
    startedAt: Date.now() - 60_000,
    endedAt: null,
    durationMs: null,
    tagIds: [],
    billable: false,
    source: "web",
    updatedAt: 0,
    deletedAt: null,
    ...over,
  }
}

function makeActions(over: Partial<TimerBarActions> = {}) {
  const setTitle = vi.fn(async () => {})
  const actions: TimerBarActions = {
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => ({ stoppedEntryIds: [], serverNow: Date.now() })),
    discard: vi.fn(async () => {}),
    setTitle,
    ...over,
  }
  return { actions, setTitle }
}

const input = () => screen.getByLabelText<HTMLInputElement>("What are you working on?")

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe("the draft survives the optimistic id being replaced", () => {
  it("keeps text typed during the start round trip", async () => {
    // The bug: `_id` was the draft's identity tag, but one logical entry
    // changes `_id` exactly once when the server's row replaces the optimistic
    // placeholder. That swap read as "a different entry", reseeded the draft
    // from the server title, and the text vanished mid-keystroke.
    const { actions } = makeActions()
    const optimistic = entry({ clientKey: "k1", title: "" })

    const view = render(<TimerBar running={optimistic} actions={actions} />)
    fireEvent.change(input(), { target: { value: "fix the parser" } })
    expect(input().value).toBe("fix the parser")

    // The server's document lands: same clientKey, real id, title still "".
    const real = entry({
      clientKey: "k1",
      title: "",
      _id: "jd7abc123" as unknown as Id<"timeEntries">,
    })
    view.rerender(<TimerBar running={real} actions={actions} />)

    expect(input().value).toBe("fix the parser")
  })

  it("does not send the placeholder id to the server", async () => {
    // `v.id("timeEntries")` rejects it, so the write is not merely useless — it
    // is an ArgumentValidationError in the logs and a lost title.
    const { actions, setTitle } = makeActions()
    render(<TimerBar running={entry({ clientKey: "k1", title: "" })} actions={actions} />)

    fireEvent.change(input(), { target: { value: "typed while starting" } })
    await vi.advanceTimersByTimeAsync(TITLE_DEBOUNCE_MS * 3)

    expect(setTitle).not.toHaveBeenCalled()
  })

  it("writes with the real id once the swap has happened", async () => {
    const { actions, setTitle } = makeActions()
    const view = render(
      <TimerBar running={entry({ clientKey: "k1", title: "" })} actions={actions} />
    )

    fireEvent.change(input(), { target: { value: "fix the parser" } })
    view.rerender(
      <TimerBar
        running={entry({
          clientKey: "k1",
          title: "",
          _id: "jd7abc123" as unknown as Id<"timeEntries">,
        })}
        actions={actions}
      />
    )
    await vi.advanceTimersByTimeAsync(TITLE_DEBOUNCE_MS + 50)

    expect(setTitle).toHaveBeenCalledWith("jd7abc123", "fix the parser")
  })
})

describe("the draft and the server disagreeing", () => {
  const real = (title: string) =>
    entry({ clientKey: "k1", title, _id: "jd7abc123" as unknown as Id<"timeEntries"> })

  it("never writes an empty draft over a real title on mount", async () => {
    // The original defect: `draft` starts "" while the running entry has a
    // title, and both effects run in the same commit pass, so a setTitle(id, "")
    // was scheduled. Losing the race against the re-render ERASED the title.
    const { actions, setTitle } = makeActions()
    render(<TimerBar running={real("Checkout form validation")} actions={actions} />)

    await vi.advanceTimersByTimeAsync(TITLE_DEBOUNCE_MS * 3)

    expect(setTitle).not.toHaveBeenCalled()
    expect(input().value).toBe("Checkout form validation")
  })

  it("adopts a title changed elsewhere when the user has not typed", async () => {
    // Retitled from its row in the log, another tab, or another device.
    const { actions, setTitle } = makeActions()
    const view = render(<TimerBar running={real("Foo")} actions={actions} />)

    view.rerender(<TimerBar running={real("Bar")} actions={actions} />)
    await vi.advanceTimersByTimeAsync(TITLE_DEBOUNCE_MS * 3)

    expect(input().value).toBe("Bar")
    expect(setTitle).not.toHaveBeenCalled()
  })

  it("does not revert a title changed elsewhere back to a stale draft", async () => {
    // The bug: the effect fired whenever draft.text !== runningTitle, without
    // asking WHICH side moved. Editing the running entry's title in the log
    // made the bar write its stale copy back 400 ms later, visibly undoing it.
    const { actions, setTitle } = makeActions()
    const view = render(<TimerBar running={real("Foo")} actions={actions} />)

    // The user has NOT touched the bar; the change came from elsewhere.
    view.rerender(<TimerBar running={real("Bar")} actions={actions} />)
    await vi.advanceTimersByTimeAsync(TITLE_DEBOUNCE_MS * 3)

    expect(setTitle).not.toHaveBeenCalledWith(expect.anything(), "Foo")
  })

  it("keeps what the user is actively typing when a remote change arrives", async () => {
    // The mirror case. Someone typing in the bar is the most recent intent, so
    // their text wins — but it must be THEIR text that gets written.
    const { actions, setTitle } = makeActions()
    const view = render(<TimerBar running={real("Foo")} actions={actions} />)

    fireEvent.change(input(), { target: { value: "Mine" } })
    view.rerender(<TimerBar running={real("Remote")} actions={actions} />)

    expect(input().value).toBe("Mine")
    await vi.advanceTimersByTimeAsync(TITLE_DEBOUNCE_MS + 50)
    expect(setTitle).toHaveBeenCalledWith("jd7abc123", "Mine")
  })
})

describe("handoff between entries", () => {
  it("does not carry one entry's text onto the next", async () => {
    const { actions, setTitle } = makeActions()
    const first = entry({
      clientKey: "k1",
      title: "First",
      _id: "jd7first" as unknown as Id<"timeEntries">,
    })
    const second = entry({
      clientKey: "k2",
      title: "Second",
      _id: "jd7second" as unknown as Id<"timeEntries">,
    })

    const view = render(<TimerBar running={first} actions={actions} />)
    fireEvent.change(input(), { target: { value: "half typed" } })

    // A new entry starts before the debounce fires.
    view.rerender(<TimerBar running={second} actions={actions} />)
    await vi.advanceTimersByTimeAsync(TITLE_DEBOUNCE_MS * 3)

    expect(input().value).toBe("Second")
    expect(setTitle).not.toHaveBeenCalledWith("jd7second", "half typed")
  })

  it("clears the draft when the timer stops", async () => {
    const { actions } = makeActions()
    const running = entry({
      clientKey: "k1",
      title: "Done now",
      _id: "jd7abc123" as unknown as Id<"timeEntries">,
    })

    const view = render(<TimerBar running={running} actions={actions} />)
    expect(input().value).toBe("Done now")

    view.rerender(<TimerBar running={null} actions={actions} />)
    expect(input().value).toBe("")
  })
})

describe("starting and stopping", () => {
  it("starts with the typed title and never blocks on one being present", async () => {
    const { actions } = makeActions()
    render(<TimerBar running={null} actions={actions} />)

    fireEvent.click(screen.getByLabelText("Start timer"))
    await vi.advanceTimersByTimeAsync(0)
    expect(actions.start).toHaveBeenCalledWith({ title: "" })
  })

  it("reports the stopped entry with a real end and duration", async () => {
    const serverNow = 1_800_000_000_000
    const { actions } = makeActions({
      stop: vi.fn(async () => ({
        stoppedEntryIds: ["jd7abc123" as unknown as Id<"timeEntries">],
        serverNow,
      })),
    })
    const onStopped = vi.fn()
    const running = entry({
      clientKey: "k1",
      title: "Work",
      startedAt: serverNow - 90_000,
      _id: "jd7abc123" as unknown as Id<"timeEntries">,
    })

    render(<TimerBar running={running} actions={actions} onStopped={onStopped} />)
    fireEvent.click(screen.getByLabelText("Stop timer"))
    await vi.advanceTimersByTimeAsync(0)

    expect(onStopped).toHaveBeenCalledWith(
      expect.objectContaining({ endedAt: serverNow, durationMs: 90_000 })
    )
  })

  it("does not raise the note sheet when another tab already stopped it", async () => {
    // An empty stoppedEntryIds means there was nothing to do. Asking for a note
    // about an entry the user did not just finish is a non-sequitur.
    const { actions } = makeActions()
    const onStopped = vi.fn()
    render(
      <TimerBar
        running={entry({
          clientKey: "k1",
          _id: "jd7abc123" as unknown as Id<"timeEntries">,
        })}
        actions={actions}
        onStopped={onStopped}
      />
    )

    fireEvent.click(screen.getByLabelText("Stop timer"))
    await vi.advanceTimersByTimeAsync(0)

    expect(onStopped).not.toHaveBeenCalled()
  })
})
