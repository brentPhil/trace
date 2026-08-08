import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { TimerBar } from "@/components/timer/timer-bar"
import { Announcer } from "@/components/a11y/announcer"
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
 * These tests exist because the component takes its writes and its classifier
 * lists as arguments. That refactor was done to stop the design harness writing
 * to production; being able to render the bar with no backend at all, and to
 * assert on what WOULD have been written, is the second dividend.
 */

const TITLE_DEBOUNCE_MS = 400

function entry(
  over: Partial<Doc<"timeEntries">> & { clientKey: string }
): Doc<"timeEntries"> {
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
  const classify = vi.fn(async () => {})
  const actions: TimerBarActions = {
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => ({ stoppedEntryIds: [], serverNow: Date.now() })),
    discard: vi.fn(async () => {}),
    setTitle,
    classify,
    createProject: vi.fn(async () => ({
      projectId: "jd7proj" as unknown as Id<"projects">,
    })),
    createTag: vi.fn(async () => ({ tagId: "jd7tag" as unknown as Id<"tags"> })),
    ...over,
  }
  return { actions, setTitle, classify }
}

/** The bar with empty classifier lists — no backend behind any of it. */
function Bar({
  running,
  actions,
  onStopped,
  onError,
}: {
  running: Doc<"timeEntries"> | null
  actions: TimerBarActions
  onStopped?: (stopped: Doc<"timeEntries">) => void
  onError?: (thrown: unknown) => void
}) {
  return (
    <TimerBar
      running={running}
      actions={actions}
      projects={[]}
      tags={[]}
      onStopped={onStopped}
      onError={onError}
    />
  )
}

const input = () => screen.getByLabelText<HTMLInputElement>("What are you working on?")

const REAL_ID = "jd7abc123" as unknown as Id<"timeEntries">

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

    const view = render(<Bar running={entry({ clientKey: "k1" })} actions={actions} />)
    fireEvent.change(input(), { target: { value: "fix the parser" } })
    expect(input().value).toBe("fix the parser")

    // The server's document lands: same clientKey, real id, title still "".
    view.rerender(
      <Bar running={entry({ clientKey: "k1", _id: REAL_ID })} actions={actions} />
    )

    expect(input().value).toBe("fix the parser")
  })

  it("does not send the placeholder id to the server", async () => {
    // `v.id("timeEntries")` rejects it, so the write is not merely useless — it
    // is an ArgumentValidationError in the logs and a lost title.
    const { actions, setTitle } = makeActions()
    render(<Bar running={entry({ clientKey: "k1" })} actions={actions} />)

    fireEvent.change(input(), { target: { value: "typed while starting" } })
    await vi.advanceTimersByTimeAsync(TITLE_DEBOUNCE_MS * 3)

    expect(setTitle).not.toHaveBeenCalled()
  })

  it("writes with the real id once the swap has happened", async () => {
    const { actions, setTitle } = makeActions()
    const view = render(<Bar running={entry({ clientKey: "k1" })} actions={actions} />)

    fireEvent.change(input(), { target: { value: "fix the parser" } })
    view.rerender(
      <Bar running={entry({ clientKey: "k1", _id: REAL_ID })} actions={actions} />
    )
    await vi.advanceTimersByTimeAsync(TITLE_DEBOUNCE_MS + 50)

    expect(setTitle).toHaveBeenCalledWith(REAL_ID, "fix the parser")
  })
})

describe("the draft and the server disagreeing", () => {
  const real = (title: string) => entry({ clientKey: "k1", title, _id: REAL_ID })

  it("never writes an empty draft over a real title on mount", async () => {
    // The original defect: `draft` starts "" while the running entry has a
    // title, and both effects run in the same commit pass, so a setTitle(id, "")
    // was scheduled. Losing the race against the re-render ERASED the title.
    const { actions, setTitle } = makeActions()
    render(<Bar running={real("Checkout form validation")} actions={actions} />)

    await vi.advanceTimersByTimeAsync(TITLE_DEBOUNCE_MS * 3)

    expect(setTitle).not.toHaveBeenCalled()
    expect(input().value).toBe("Checkout form validation")
  })

  it("adopts a title changed elsewhere when the user has not typed", async () => {
    // Retitled from its row in the log, another tab, or another device.
    const { actions, setTitle } = makeActions()
    const view = render(<Bar running={real("Foo")} actions={actions} />)

    view.rerender(<Bar running={real("Bar")} actions={actions} />)
    await vi.advanceTimersByTimeAsync(TITLE_DEBOUNCE_MS * 3)

    expect(input().value).toBe("Bar")
    expect(setTitle).not.toHaveBeenCalled()
  })

  it("does not revert a title changed elsewhere back to a stale draft", async () => {
    // The bug: the effect fired whenever draft.text !== runningTitle, without
    // asking WHICH side moved. Editing the running entry's title in the log
    // made the bar write its stale copy back 400 ms later, visibly undoing it.
    const { actions, setTitle } = makeActions()
    const view = render(<Bar running={real("Foo")} actions={actions} />)

    // The user has NOT touched the bar; the change came from elsewhere.
    view.rerender(<Bar running={real("Bar")} actions={actions} />)
    await vi.advanceTimersByTimeAsync(TITLE_DEBOUNCE_MS * 3)

    expect(setTitle).not.toHaveBeenCalledWith(expect.anything(), "Foo")
  })

  it("keeps what the user is actively typing when a remote change arrives", async () => {
    // The mirror case. Someone typing in the bar is the most recent intent, so
    // their text wins — but it must be THEIR text that gets written.
    const { actions, setTitle } = makeActions()
    const view = render(<Bar running={real("Foo")} actions={actions} />)

    fireEvent.change(input(), { target: { value: "Mine" } })
    view.rerender(<Bar running={real("Remote")} actions={actions} />)

    expect(input().value).toBe("Mine")
    await vi.advanceTimersByTimeAsync(TITLE_DEBOUNCE_MS + 50)
    expect(setTitle).toHaveBeenCalledWith(REAL_ID, "Mine")
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

    const view = render(<Bar running={first} actions={actions} />)
    fireEvent.change(input(), { target: { value: "half typed" } })

    // A new entry starts before the debounce fires.
    view.rerender(<Bar running={second} actions={actions} />)
    await vi.advanceTimersByTimeAsync(TITLE_DEBOUNCE_MS * 3)

    expect(input().value).toBe("Second")
    expect(setTitle).not.toHaveBeenCalledWith("jd7second", "half typed")
  })

  it("clears the draft when the timer stops", async () => {
    const { actions } = makeActions()
    const running = entry({ clientKey: "k1", title: "Done now", _id: REAL_ID })

    const view = render(<Bar running={running} actions={actions} />)
    expect(input().value).toBe("Done now")

    view.rerender(<Bar running={null} actions={actions} />)
    expect(input().value).toBe("")
  })
})

describe("starting and stopping", () => {
  it("starts with the typed title and never blocks on one being present", async () => {
    const { actions } = makeActions()
    render(<Bar running={null} actions={actions} />)

    fireEvent.click(screen.getByLabelText("Start timer"))
    await vi.advanceTimersByTimeAsync(0)

    expect(actions.start).toHaveBeenCalledWith(
      expect.objectContaining({ title: "", billable: false })
    )
  })

  it("carries a staged classification into the start", async () => {
    // "Start the Acme timer" is one gesture in the user's head, not two, so a
    // project picked before anything is running has to survive the start.
    const { actions } = makeActions()
    render(<Bar running={null} actions={actions} />)

    fireEvent.click(screen.getByLabelText("Not billable"))
    fireEvent.click(screen.getByLabelText("Start timer"))
    await vi.advanceTimersByTimeAsync(0)

    expect(actions.start).toHaveBeenCalledWith(
      expect.objectContaining({ billable: true })
    )
  })

  it("classifies the running entry rather than staging it", async () => {
    const { actions, classify } = makeActions()
    render(<Bar running={entry({ clientKey: "k1", _id: REAL_ID })} actions={actions} />)

    fireEvent.click(screen.getByLabelText("Not billable"))
    await vi.advanceTimersByTimeAsync(0)

    expect(classify).toHaveBeenCalledWith(REAL_ID, { billable: true })
  })

  it("does not try to classify an entry that has no row yet", async () => {
    // The optimistic placeholder is not a document id; patching it would be an
    // argument-validation error against a row that does not exist.
    const { actions, classify } = makeActions()
    render(<Bar running={entry({ clientKey: "k1" })} actions={actions} />)

    fireEvent.click(screen.getByLabelText("Not billable"))
    await vi.advanceTimersByTimeAsync(0)

    expect(classify).not.toHaveBeenCalled()
  })

  it("reports the stopped entry with a real end and duration", async () => {
    const serverNow = 1_800_000_000_000
    const { actions } = makeActions({
      stop: vi.fn(async () => ({ stoppedEntryIds: [REAL_ID], serverNow })),
    })
    const onStopped = vi.fn()
    const running = entry({
      clientKey: "k1",
      title: "Work",
      startedAt: serverNow - 90_000,
      _id: REAL_ID,
    })

    render(<Bar running={running} actions={actions} onStopped={onStopped} />)
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
      <Bar
        running={entry({ clientKey: "k1", _id: REAL_ID })}
        actions={actions}
        onStopped={onStopped}
      />
    )

    fireEvent.click(screen.getByLabelText("Stop timer"))
    await vi.advanceTimersByTimeAsync(0)

    expect(onStopped).not.toHaveBeenCalled()
  })
})

describe("title autocomplete", () => {
  const suggestions = [
    {
      title: "Checkout form validation",
      projectId: "jd7proj" as unknown as Id<"projects">,
      tagIds: ["jd7tag" as unknown as Id<"tags">],
      billable: true,
    },
  ]

  function WithSuggestions({ actions }: { actions: TimerBarActions }) {
    return (
      <TimerBar
        running={null}
        actions={actions}
        projects={[]}
        tags={[]}
        suggestions={suggestions}
      />
    )
  }

  it("inherits project, tags and billable — the same set Resume does", async () => {
    const { actions } = makeActions()
    render(<WithSuggestions actions={actions} />)

    fireEvent.change(input(), { target: { value: "check" } })
    fireEvent.mouseDown(screen.getByRole("option", { name: /Checkout form/ }))
    fireEvent.click(screen.getByLabelText("Start timer"))
    await vi.advanceTimersByTimeAsync(0)

    expect(actions.start).toHaveBeenCalledWith({
      title: "Checkout form validation",
      projectId: "jd7proj",
      tagIds: ["jd7tag"],
      billable: true,
    })
  })

  it("Enter with nothing highlighted starts, rather than taking a suggestion", async () => {
    // The list being open must never turn the primary gesture into something
    // else. That is how people end up tracking the wrong thing.
    const { actions } = makeActions()
    render(<WithSuggestions actions={actions} />)

    fireEvent.change(input(), { target: { value: "check" } })
    expect(screen.getByRole("option", { name: /Checkout form/ })).toBeTruthy()

    fireEvent.keyDown(input(), { key: "Enter" })
    await vi.advanceTimersByTimeAsync(0)

    expect(actions.start).toHaveBeenCalledWith(
      expect.objectContaining({ title: "check" })
    )
  })

  it("offers nothing once a timer is running", async () => {
    // While running, the field IS the live title of that entry. A dropdown that
    // could swap its project and tags mid-clock is a foot-gun.
    const { actions } = makeActions()
    render(
      <TimerBar
        running={entry({ clientKey: "k1", _id: REAL_ID })}
        actions={actions}
        projects={[]}
        tags={[]}
        suggestions={suggestions}
      />
    )

    fireEvent.change(input(), { target: { value: "check" } })
    expect(screen.queryByRole("option")).toBeNull()
  })
})

/*
 * Every write in here was fired with a bare `void`, so a rejection was an
 * unhandled promise and the user saw nothing at all. For stop and discard that
 * is worse than silence: both carry an optimistic update that clears the
 * running entry, so the timer vanished and then reappeared on rollback with no
 * explanation offered for either movement.
 */
describe("a failed write is reported rather than swallowed", () => {
  const boom = () => Promise.reject(new Error("network"))

  it("reports a start that rejected", async () => {
    const onError = vi.fn()
    const { actions } = makeActions({ start: vi.fn(boom) })
    render(<Bar running={null} actions={actions} onError={onError} />)

    fireEvent.click(screen.getByLabelText("Start timer"))
    await vi.advanceTimersByTimeAsync(0)

    expect(onError).toHaveBeenCalledTimes(1)
  })

  it("reports a stop that rejected", async () => {
    const onError = vi.fn()
    const { actions } = makeActions({ stop: vi.fn(boom) })
    render(
      <Bar
        running={entry({ clientKey: "k1", _id: REAL_ID })}
        actions={actions}
        onError={onError}
      />
    )

    fireEvent.click(screen.getByLabelText("Stop timer"))
    await vi.advanceTimersByTimeAsync(0)

    expect(onError).toHaveBeenCalledTimes(1)
  })

  it("reports a discard that rejected", async () => {
    const onError = vi.fn()
    const { actions } = makeActions({ discard: vi.fn(boom) })
    render(
      <Bar
        running={entry({ clientKey: "k1", _id: REAL_ID })}
        actions={actions}
        onError={onError}
      />
    )

    fireEvent.click(screen.getByRole("button", { name: /Discard/ }))
    await vi.advanceTimersByTimeAsync(0)

    expect(onError).toHaveBeenCalledTimes(1)
  })

  /**
   * The announcement used to be made BEFORE the write was sent, so a discard
   * that failed told a screen-reader user the timer was discarded while it was
   * still running. Nothing in the visual UI says otherwise either — the row
   * simply stays. This asserts the write is what triggers the claim.
   */
  it("does not claim the timer was discarded until the write lands", async () => {
    // Held on an object rather than in a `let`: control-flow analysis cannot
    // see the assignment inside a promise executor, so a bare variable narrows
    // to `never` at the call below.
    const deferred = { settle: () => {} }
    const discard = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          deferred.settle = resolve
        })
    )
    const { actions } = makeActions({ discard })
    // Wrapped in the real Announcer: `useAnnounce` falls back to a no-op
    // without a provider, so an unwrapped render would make both assertions
    // below pass no matter what the component did.
    render(
      <Announcer>
        <Bar running={entry({ clientKey: "k1", _id: REAL_ID })} actions={actions} />
      </Announcer>
    )

    fireEvent.click(screen.getByRole("button", { name: /Discard/ }))
    await vi.advanceTimersByTimeAsync(0)

    expect(discard).toHaveBeenCalledTimes(1)
    // In flight: the claim has not been made yet.
    expect(screen.queryByText(/Timer discarded/)).toBeNull()

    deferred.settle()
    await vi.advanceTimersByTimeAsync(0)
    expect(screen.getByText(/Timer discarded/)).toBeTruthy()
  })
})
