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
  const editTime = vi.fn(async () => {})
  const createCompleted = vi.fn(async () => {})
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
    editTime,
    createCompleted,
    ...over,
  }
  return { actions, setTitle, classify, editTime, createCompleted }
}

const LONDON = "Europe/London"

/** The bar with empty classifier lists — no backend behind any of it. */
function Bar({
  running,
  actions,
  onError,
}: {
  running: Doc<"timeEntries"> | null
  actions: TimerBarActions
  onError?: (thrown: unknown) => void
}) {
  return (
    <TimerBar
      running={running}
      actions={actions}
      projects={[]}
      tags={[]}
      timeZone={LONDON}
      use12Hour
      weekStartDay={1}
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

  it("announces the stopped entry with its real duration", async () => {
    const serverNow = 1_800_000_000_000
    const { actions } = makeActions({
      stop: vi.fn(async () => ({ stoppedEntryIds: [REAL_ID], serverNow })),
    })
    const running = entry({
      clientKey: "k1",
      title: "Work",
      startedAt: serverNow - 90_000,
      _id: REAL_ID,
    })

    // Wrapped in the real Announcer: `useAnnounce` falls back to a no-op
    // without a provider, so an unwrapped render would make this assertion
    // pass no matter what the component did.
    render(
      <Announcer>
        <Bar running={running} actions={actions} />
      </Announcer>
    )
    fireEvent.click(screen.getByLabelText("Stop timer"))
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(0)

    expect(screen.getByText(/Stopped Work\. 1 minute recorded\./)).toBeTruthy()
  })

  it("does not announce a stop when another tab already stopped it", async () => {
    // An empty stoppedEntryIds means there was nothing to do. Announcing a
    // stop for an entry the user did not just finish is a non-sequitur.
    const { actions } = makeActions()
    render(
      <Announcer>
        <Bar running={entry({ clientKey: "k1", _id: REAL_ID })} actions={actions} />
      </Announcer>
    )

    fireEvent.click(screen.getByLabelText("Stop timer"))
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(0)

    expect(screen.queryByText(/Stopped/)).toBeNull()
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
        timeZone={LONDON}
        use12Hour
        weekStartDay={1}
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
        timeZone={LONDON}
        use12Hour
        weekStartDay={1}
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

/*
 * The duration's popover.
 *
 * Toggl's gesture: click the elapsed time to open START/STOP fields and a
 * calendar. Running, it edits the entry already on screen — the same body
 * `EntryTimePopover` renders for a log row, reached through the same
 * component so there is only one calendar to get right. Idle, nothing exists
 * to edit yet, so the same fields instead stage a brand-new completed entry
 * that is not written until the popover's own confirm button is pressed.
 */
describe("the duration's popover", () => {
  // 7 August 2026, 21:00 London (BST, so 20:00Z).
  const startedAt = Date.parse("2026-08-07T20:00:00Z")

  it("opens on the running entry, seeded with its start time", () => {
    const { actions } = makeActions()
    render(
      <Bar running={entry({ clientKey: "k1", _id: REAL_ID, startedAt })} actions={actions} />
    )

    fireEvent.click(screen.getByRole("button", { name: /edit start time/i }))

    expect(screen.getByLabelText<HTMLInputElement>("Start time").value).toBe(
      "9:00 PM"
    )
  })

  it("commits an edited start through the action prop, as an instant", () => {
    const { actions, editTime } = makeActions()
    render(
      <Bar running={entry({ clientKey: "k1", _id: REAL_ID, startedAt })} actions={actions} />
    )

    fireEvent.click(screen.getByRole("button", { name: /edit start time/i }))
    const field = screen.getByLabelText("Start time")
    fireEvent.change(field, { target: { value: "8:30 PM" } })
    fireEvent.keyDown(field, { key: "Enter" })

    expect(editTime).toHaveBeenCalledWith(
      REAL_ID,
      "start",
      Date.parse("2026-08-07T19:30:00Z")
    )
  })

  it("offers no stop field while the timer is running", () => {
    // Typing an end time is a stop, and stopping belongs to the Stop button.
    const { actions } = makeActions()
    render(
      <Bar running={entry({ clientKey: "k1", _id: REAL_ID, startedAt })} actions={actions} />
    )

    fireEvent.click(screen.getByRole("button", { name: /edit start time/i }))

    expect(screen.getByLabelText("Start time")).toBeTruthy()
    expect(screen.queryByLabelText("End time")).toBeNull()
  })

  it("creates a completed entry from Start and Stop while idle, defaulting both to now", async () => {
    const fixedNow = Date.parse("2026-08-07T20:00:00Z") // 9:00 PM London
    vi.setSystemTime(fixedNow)
    const { actions, createCompleted } = makeActions()
    render(<Bar running={null} actions={actions} />)

    fireEvent.click(screen.getByRole("button", { name: /add a completed entry/i }))
    expect(screen.getByLabelText<HTMLInputElement>("Start time").value).toBe(
      "9:00 PM"
    )
    expect(screen.getByLabelText<HTMLInputElement>("End time").value).toBe(
      "9:00 PM"
    )

    // Both fields default to the same instant; a real stop is typed before
    // confirming, same as the row's popover requires a real value per field.
    fireEvent.change(screen.getByLabelText("End time"), {
      target: { value: "9:05 PM" },
    })
    fireEvent.click(screen.getByRole("button", { name: /create entry/i }))
    await vi.advanceTimersByTimeAsync(0)

    expect(createCompleted).toHaveBeenCalledWith({
      startedAt: fixedNow,
      endedAt: fixedNow + 5 * 60_000,
    })
  })

  it("closes the popover after a successful create, so a second click cannot duplicate it", async () => {
    // The bug: `onCreateCompleted` resolved, `saving` went back to `false`,
    // but the popup itself never left the DOM — inviting exactly the
    // accidental duplicate this confirm button exists to avoid.
    const fixedNow = Date.parse("2026-08-07T20:00:00Z")
    vi.setSystemTime(fixedNow)
    const { actions } = makeActions()
    render(<Bar running={null} actions={actions} />)

    fireEvent.click(screen.getByRole("button", { name: /add a completed entry/i }))
    fireEvent.change(screen.getByLabelText("End time"), {
      target: { value: "9:05 PM" },
    })
    fireEvent.click(screen.getByRole("button", { name: /create entry/i }))
    await vi.advanceTimersByTimeAsync(0)

    expect(screen.queryByLabelText("Start time")).toBeNull()
  })

  it("gives the trigger an accessible name describing the action, not just the digits", () => {
    const { actions: runningActions } = makeActions()
    const view = render(
      <Bar
        running={entry({ clientKey: "k1", _id: REAL_ID, startedAt })}
        actions={runningActions}
      />
    )
    expect(screen.queryByRole("button", { name: "0:00:00" })).toBeNull()
    expect(screen.getByRole("button", { name: /edit start time/i })).toBeTruthy()

    view.unmount()

    const { actions: idleActions } = makeActions()
    render(<Bar running={null} actions={idleActions} />)
    expect(screen.queryByRole("button", { name: "0:00:00" })).toBeNull()
    expect(
      screen.getByRole("button", { name: /add a completed entry/i })
    ).toBeTruthy()
  })
})

/*
 * Staging a start instant, the same pattern `staged` classification already
 * uses: while idle there is no row for the popover to write into, so a START
 * (and/or a day) typed there is held in the bar until Play resolves it.
 */
describe("staging a start from the idle popover", () => {
  // 7 August 2026, 9:00 PM London (BST, so 20:00Z).
  const fixedNow = Date.parse("2026-08-07T20:00:00Z")

  const openPopoverAndSetStart = (value: string) => {
    fireEvent.click(screen.getByRole("button", { name: /add a completed entry/i }))
    fireEvent.change(screen.getByLabelText("Start time"), { target: { value } })
  }

  it("carries a staged start into Play, rather than Date.now()", async () => {
    vi.setSystemTime(fixedNow)
    const { actions } = makeActions()
    render(<Bar running={null} actions={actions} />)

    openPopoverAndSetStart("4:06 AM")
    fireEvent.click(screen.getByLabelText("Start timer"))
    await vi.advanceTimersByTimeAsync(0)

    expect(actions.start).toHaveBeenCalledWith(
      expect.objectContaining({ startedAt: Date.parse("2026-08-07T03:06:00Z") })
    )
  })

  it("still starts at now when nothing was staged", async () => {
    vi.setSystemTime(fixedNow)
    const { actions } = makeActions()
    render(<Bar running={null} actions={actions} />)

    fireEvent.click(screen.getByLabelText("Start timer"))
    await vi.advanceTimersByTimeAsync(0)

    const call = actions.start as ReturnType<typeof vi.fn>
    expect(call.mock.calls[0][0].startedAt).toBeUndefined()
  })

  it("shows the staged start on the bar, and clearing it returns to now", async () => {
    vi.setSystemTime(fixedNow)
    const { actions } = makeActions()
    render(<Bar running={null} actions={actions} />)

    openPopoverAndSetStart("4:06 AM")
    expect(screen.getByText(/4:06 AM/)).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: /use now/i }))
    expect(screen.queryByText(/4:06 AM/)).toBeNull()

    fireEvent.click(screen.getByLabelText("Start timer"))
    await vi.advanceTimersByTimeAsync(0)

    const call = actions.start as ReturnType<typeof vi.fn>
    expect(call.mock.calls[0][0].startedAt).toBeUndefined()
  })

  it("clears the staged start once a timer actually starts", async () => {
    vi.setSystemTime(fixedNow)
    const { actions } = makeActions()
    render(<Bar running={null} actions={actions} />)

    openPopoverAndSetStart("4:06 AM")
    fireEvent.click(screen.getByLabelText("Start timer"))
    await vi.advanceTimersByTimeAsync(0)

    expect(screen.queryByText(/4:06 AM/)).toBeNull()
  })

  it("uses only the staged START when a STOP is also set, and never creates a completed entry", async () => {
    // Play means "begin running". A stop typed in the same popover is the
    // completed-entry intent one button away ("Create entry"); honouring
    // both would silently pick one of two conflicting readings of one click.
    vi.setSystemTime(fixedNow)
    const { actions } = makeActions()
    render(<Bar running={null} actions={actions} />)

    openPopoverAndSetStart("4:06 AM")
    fireEvent.change(screen.getByLabelText("End time"), { target: { value: "4:30 AM" } })

    fireEvent.click(screen.getByLabelText("Start timer"))
    await vi.advanceTimersByTimeAsync(0)

    expect(actions.start).toHaveBeenCalledWith(
      expect.objectContaining({ startedAt: Date.parse("2026-08-07T03:06:00Z") })
    )
    expect(actions.createCompleted).not.toHaveBeenCalled()
  })

  it("drops a staged start once the day it was set on has passed", async () => {
    vi.setSystemTime(fixedNow)
    const { actions } = makeActions()
    render(<Bar running={null} actions={actions} />)

    openPopoverAndSetStart("4:06 AM")
    expect(screen.getByText(/4:06 AM/)).toBeTruthy()

    // Past midnight London: still the 7th's 4:06 AM target, but a new day has
    // begun since it was SET — a tab left open overnight.
    vi.setSystemTime(Date.parse("2026-08-08T04:00:00Z")) // 5:00 AM BST, Aug 8
    // Force a re-render so the staleness check re-evaluates without another
    // interaction with the popover itself.
    fireEvent.change(input(), { target: { value: "x" } })

    expect(screen.queryByText(/4:06 AM/)).toBeNull()

    fireEvent.click(screen.getByLabelText("Start timer"))
    await vi.advanceTimersByTimeAsync(0)

    const call = actions.start as ReturnType<typeof vi.fn>
    expect(call.mock.calls[0][0].startedAt).toBeUndefined()
  })
})
