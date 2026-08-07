import { useEffect, useRef, useState } from "react"
import { DollarSign, FolderClosed, Play, Square, Tag, Trash2 } from "lucide-react"
import { EntryDuration } from "@/components/timer/entry-duration"
import { isOptimisticId } from "@/lib/optimistic-id"
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
  const runningKey = running?.clientKey ?? null
  const runningTitle = running?.title ?? ""

  /*
   * The draft is tagged with WHICH entry it belongs to and WHETHER the user
   * typed it. Both halves are load-bearing.
   *
   * `draft` is component state and `running` is a reactive query result, so for
   * one render after the query moves, the state still describes the previous
   * value. Without the tags, the persist effect below cannot tell these three
   * cases apart, and it acted on all of them:
   *
   *   1. The user typed something          -> write it
   *   2. State has not caught up yet       -> write nothing
   *   3. The title changed somewhere else  -> ADOPT it, write nothing
   *
   * Case 2 erased titles: on mount the draft is empty while the running entry
   * has a real title, so the effect scheduled setTitle(id, ""). Case 3 reverted
   * them: retitle the running entry from its row in the log and the bar's stale
   * draft would write the old text back 400 ms later.
   *
   * The key is `clientKey`, NOT `_id`. One logical entry changes `_id` exactly
   * once — the optimistic placeholder is replaced by the server's real document
   * mid-flight — so keying on `_id` reads that swap as a different entry and
   * reseeds the draft, discarding anything typed during the round trip.
   * `clientKey` is minted before the mutation is sent and is carried by both
   * the optimistic row and the stored one, so it is stable across the swap.
   */
  const [draft, setDraft] = useState<{
    key: string | null
    text: string
    /** True once the user has typed since the last agreement with the server. */
    dirty: boolean
  }>({ key: null, text: "", dirty: false })

  // Adjusted during render rather than in an effect — React's documented
  // pattern for state derived from props. An effect would paint one frame of
  // the PREVIOUS entry's title in the input before correcting itself.
  if (draft.key !== runningKey) {
    setDraft({ key: runningKey, text: runningTitle, dirty: false })
  }

  // Persist while typing. Debounced and last-write-wins: the timer is already
  // running and the words are already on screen, so this must never block.
  useEffect(() => {
    if (running === null || draft.key !== runningKey) return

    // Nothing local to defend, so the server is simply right. This is what
    // makes an edit from the log row, another tab, or another device appear in
    // the bar instead of being fought by a draft the user never touched.
    if (!draft.dirty) {
      if (draft.text !== runningTitle) {
        setDraft({ key: runningKey, text: runningTitle, dirty: false })
      }
      return
    }

    if (draft.text === runningTitle) return

    // No row exists to write to yet; the start mutation is still in flight and
    // is carrying a title of its own. Once it lands, `runningTitle` changes and
    // this effect re-runs with a real id.
    if (isOptimisticId(running._id)) return

    const entryId = running._id
    const text = draft.text
    const timer = setTimeout(() => {
      void setTitle(entryId, text)
        .then(() => {
          // Only clear `dirty` if this is still the text on screen. Clearing it
          // unconditionally would let a remote change adopt over whatever the
          // user typed while the write was in flight.
          setDraft((current) =>
            current.key === runningKey && current.text === text
              ? { ...current, dirty: false }
              : current
          )
        })
        .catch(() => {
          // Deliberately silent, and `dirty` stays true so the next keystroke
          // retries. A failed title write must not raise anything modal in the
          // middle of typing — the timer is running and the words are already
          // on screen, which is what actually matters.
        })
    }, TITLE_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [draft, running, runningKey, runningTitle, setTitle])

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
        setDraft({ key: null, text: "", dirty: false })
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
          onChange={(event) =>
            setDraft({ key: runningKey, text: event.target.value, dirty: true })
          }
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
