import { useEffect, useRef, useState } from "react"
import { DollarSign, FolderClosed, Play, Square, Tag, Trash2 } from "lucide-react"
import { EntryDuration } from "@/components/timer/entry-duration"
import { cn } from "@/lib/utils"
import type { Doc, Id } from "../../../convex/_generated/dataModel"

const TITLE_DEBOUNCE_MS = 400

/**
 * The timer bar.
 *
 * Layout follows the shape every tracker has converged on, because it is right:
 * one wide text field for what you are doing, the classifiers collapsed to
 * icons on the right, then the elapsed time, then one round control that both
 * starts and stops. Nothing competes with the text field, which is where the
 * hands go.
 *
 * Two rules shape the rest:
 *
 *   Start is never blocked. No title, project or tag is required, and the
 *   control is never disabled. Anything that can refuse a start is a reason
 *   someone stops tracking.
 *
 *   Running is never carried by colour alone. Cold light marks it (The Cold
 *   Light Rule), and so do the icon changing from play to stop, the boundary
 *   brightening, and the word "Recording" for a screen reader.
 */
/**
 * What the bar is allowed to do.
 *
 * Passed in rather than reached for with a hook, matching `EntryRowActions`.
 * The bar is rendered against fixtures in the design harness, and a component
 * that reaches for live mutations internally cannot be rendered inertly — it
 * fired real writes at the backend with fixture ids, and had the harness been
 * viewed while signed in, its start button would have stopped a real timer.
 * Making the writes an argument is what makes "render this without a backend"
 * expressible at all.
 */
export type TimerBarActions = {
  start: (input?: { title?: string }) => Promise<unknown>
  stop: () => Promise<{
    stoppedEntryIds: Array<Id<"timeEntries">>
    serverNow: number
  }>
  discard: () => Promise<unknown>
  setTitle: (entryId: Id<"timeEntries">, title: string) => Promise<void>
}

export function TimerBar({
  running,
  actions,
  onStopped,
}: {
  running: Doc<"timeEntries"> | null
  actions: TimerBarActions
  /**
   * Called with the entry as it was the instant it stopped — closed, with a
   * real duration — so the note sheet can name it without reading a query that
   * has not caught up yet. The single most valuable moment to ask what someone
   * just did is the moment they say they have stopped doing it.
   */
  onStopped?: (entry: Doc<"timeEntries">) => void
}) {
  const { start, stop, discard, setTitle } = actions
  const [pending, setPending] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const isRunning = running !== null
  const runningId = running?._id ?? null
  const runningTitle = running?.title ?? ""

  /*
   * The draft carries the id of the entry it belongs to.
   *
   * It has to, because `draft` is component state and `running` is a query
   * result: for one render after a new entry appears, the state still holds the
   * previous one's text. An untagged draft cannot tell "the user has typed
   * something" apart from "state has not caught up yet", and the persist effect
   * below acted on both.
   *
   * That was not theoretical. On first mount the draft is empty while the
   * running entry has a real title, so the effect scheduled setTitle(id, "").
   * The re-render normally cancels it inside the 400 ms debounce — but it is a
   * race, and losing it ERASES the title of the entry the user is tracking.
   * Tagging makes the two cases distinguishable and the write impossible.
   */
  const [draft, setDraft] = useState<{ id: string | null; text: string }>({
    id: null,
    text: "",
  })

  // Adjusted during render rather than in an effect — React's documented
  // pattern for state derived from props. An effect would paint one frame of
  // the PREVIOUS entry's title in the input before correcting itself.
  if (draft.id !== runningId) {
    setDraft({ id: runningId, text: runningTitle })
  }

  // Persist while typing. Debounced and last-write-wins: the timer is already
  // running and the words are already on screen, so this must never block.
  useEffect(() => {
    // `draft.id !== runningId` is the guard that makes the stale-state case
    // unreachable, including the reverse one: the outgoing entry's text must
    // never be written onto the incoming entry during a handoff.
    if (runningId === null || draft.id !== runningId) return
    if (draft.text === runningTitle) return

    const text = draft.text
    const id = setTimeout(() => void setTitle(runningId, text), TITLE_DEBOUNCE_MS)
    return () => clearTimeout(id)
  }, [draft, runningId, runningTitle, setTitle])

  async function onToggle() {
    // A double press must not create two entries. clientKey makes a genuine
    // network retry idempotent; this handles the cheaper local case.
    if (pending) return
    setPending(true)
    try {
      // `running !== null` rather than `isRunning`, so the narrowing survives
      // into the branch and `stopped` is a document rather than a maybe.
      if (running !== null) {
        const stopped = running
        const result = await stop()
        // Tagged null, so the render-phase adjustment above does not
        // immediately re-seed it from an entry that is on its way out.
        setDraft({ id: null, text: "" })
        // Only when something actually stopped. A second tab having already
        // stopped it returns an empty list, and raising a note sheet for an
        // entry the user did not just finish would be a non-sequitur.
        if (result.stoppedEntryIds.length > 0) {
          onStopped?.({
            ...stopped,
            endedAt: result.serverNow,
            durationMs: Math.max(1, result.serverNow - stopped.startedAt),
          })
        }
      } else {
        await start({ title: draft.text.trim() })
        inputRef.current?.focus()
      }
    } finally {
      setPending(false)
    }
  }

  return (
    <section
      aria-label="Timer"
      className={cn(
        "flex flex-col rounded-md border bg-surface",
        isRunning ? "border-enlarger/50" : "border-edge-soft"
      )}
    >
      <div className="flex items-center gap-2 px-4 py-3">
        <label htmlFor="timer-title" className="sr-only">
          What are you working on?
        </label>
        <input
          id="timer-title"
          ref={inputRef}
          value={draft.text}
          onChange={(event) => setDraft({ id: runningId, text: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              void onToggle()
            }
          }}
          placeholder="What are you working on?"
          autoComplete="off"
          // Borderless inside an already-bordered bar: the section IS the
          // control's boundary, so The Boundary Rule is satisfied once. A
          // second border here would read as a form field inside a card.
          // `pr-2` because the classifier icons are hidden below `sm`, and
          // without them the text runs straight into the elapsed time with no
          // gap at all — the title and the clock read as one string.
          className={cn(
            "min-w-0 flex-1 bg-transparent pr-2 text-lg outline-none",
            "placeholder:text-muted-foreground focus-visible:ring-0"
          )}
        />

        {/*
          Classifiers. Disabled until projects and tags exist, but present now
          so the bar's geometry does not shift when they arrive.
        */}
        <div className="hidden items-center gap-0.5 sm:flex">
          <ClassifierButton icon={FolderClosed} label="Project" />
          <ClassifierButton icon={Tag} label="Tags" />
          <ClassifierButton
            icon={DollarSign}
            label="Billable"
            active={running?.billable ?? false}
          />
        </div>

        <EntryDuration
          startedAt={running?.startedAt ?? Date.now()}
          endedAt={isRunning ? null : 0}
          className={cn(
            "shrink-0 px-2 text-lg font-medium",
            isRunning ? "text-enlarger" : "text-muted-foreground"
          )}
        />

        <button
          type="button"
          onClick={() => void onToggle()}
          aria-label={isRunning ? "Stop timer" : "Start timer"}
          className={cn(
            "flex size-[42px] shrink-0 items-center justify-center rounded-full",
            "transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/30 focus-visible:outline-none",
            isRunning
              ? // Cold light, and only here: something IS running.
                "bg-enlarger text-ground hover:bg-enlarger/90"
              : // Deliberately NOT cold light. On a page where nothing is
                // running, the affirmative action is a high-contrast neutral.
                "bg-primary text-primary-foreground hover:bg-primary/90"
          )}
        >
          {isRunning ? (
            <Square className="size-4 fill-current" />
          ) : (
            <Play className="size-4 fill-current" />
          )}
        </button>
      </div>

      {isRunning ? (
        <div className="flex items-center justify-between gap-3 border-t border-edge-soft px-4 py-1.5">
          <span className="flex items-center gap-2 text-xs">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-enlarger" />
            <span className="text-enlarger">Recording</span>
          </span>
          {/*
            Discard is a different verb from delete and gets its own control:
            killing a timer started by accident and destroying recorded history
            carry different risk. Toggl conflates them behind one menu item.
          */}
          <button
            type="button"
            onClick={() => void discard()}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-destructive"
          >
            <Trash2 className="size-3.5" />
            Discard
          </button>
        </div>
      ) : null}
    </section>
  )
}

function ClassifierButton({
  icon: Icon,
  label,
  active = false,
}: {
  icon: typeof Tag
  label: string
  active?: boolean
}) {
  return (
    <button
      type="button"
      disabled
      aria-label={label}
      title={`${label} — coming soon`}
      className={cn(
        "rounded-md p-2 transition-colors disabled:cursor-default",
        active ? "text-brass" : "text-muted-foreground/50"
      )}
    >
      <Icon className="size-4" />
    </button>
  )
}
