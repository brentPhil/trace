import { useEffect, useRef, useState } from "react"
import { Play, Square, Trash2 } from "lucide-react"
import {
  BillableToggle,
  ProjectPicker,
  TagPicker,
} from "@/components/classifiers/classifier-pickers"
import { ProjectDot } from "@/components/classifiers/project-dot"
import { useAnnounce } from "@/components/a11y/announcer"
import { EntryDuration } from "@/components/timer/entry-duration"
import { isOptimisticId } from "@/lib/optimistic-id"
import { cn } from "@/lib/utils"
import { spokenDuration } from "@shared/duration"
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
 *
 * This began as a bug fix. A design harness rendered the bar against fixtures
 * while the bar reached for live mutations internally, so it fired real writes
 * at the backend carrying fixture ids — and had that page been opened while
 * signed in, its start button would have stopped a real timer. The harness is
 * gone, but the invariant it forced is the more valuable half: making the writes
 * an argument is what makes "render this with no backend" expressible, which is
 * why every test in `timer-bar.test.tsx` can assert on what WOULD have been
 * written without a server anywhere near it.
 */
export type Classification = {
  projectId: Id<"projects"> | null
  tagIds: Array<Id<"tags">>
  billable: boolean
}

export type TimerBarActions = {
  start: (input?: {
    title?: string
    projectId?: Id<"projects">
    tagIds?: Array<Id<"tags">>
    billable?: boolean
  }) => Promise<unknown>
  stop: () => Promise<{
    stoppedEntryIds: Array<Id<"timeEntries">>
    serverNow: number
  }>
  discard: () => Promise<unknown>
  setTitle: (entryId: Id<"timeEntries">, title: string) => Promise<void>
  /** Applies a classifier change to the entry already running. */
  classify: (entryId: Id<"timeEntries">, change: Partial<Classification>) => Promise<void>
  createProject: (name: string) => Promise<{ projectId: Id<"projects"> }>
  createTag: (name: string) => Promise<{ tagId: Id<"tags"> }>
}

/** A previous title and the classification it last carried. Never its note. */
export type TitleSuggestion = {
  title: string
  projectId?: Id<"projects">
  tagIds: Array<Id<"tags">>
  billable: boolean
}

export function TimerBar({
  running,
  actions,
  projects,
  tags,
  suggestions = [],
  onStopped,
  onError,
}: {
  running: Doc<"timeEntries"> | null
  actions: TimerBarActions
  projects: Array<Doc<"projects">>
  tags: Array<Doc<"tags">>
  /**
   * The whole recent set, filtered in this component rather than re-queried per
   * keystroke — a prefix argument would tear down and rebuild the subscription
   * on every character typed.
   */
  suggestions?: Array<TitleSuggestion>
  /**
   * Called with the entry as it was the instant it stopped — closed, with a
   * real duration — so the note sheet can name it without reading a query that
   * has not caught up yet. The single most valuable moment to ask what someone
   * just did is the moment they say they have stopped doing it.
   */
  onStopped?: (entry: Doc<"timeEntries">) => void
  /**
   * Called when a start, stop or discard REJECTS.
   *
   * A prop rather than a toast raised in here, for the same reason the writes
   * are props: the bar should not reach for the app's toast manager, and it has
   * to stay renderable in a test with no provider above it.
   *
   * Optional, but its absence is a real gap wherever the bar is used for real —
   * a start that silently did not happen is the worst outcome this product has,
   * since the user walks away believing time is being recorded.
   */
  onError?: (thrown: unknown) => void
}) {
  const { start, stop, discard, setTitle, classify } = actions
  const [pending, setPending] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const announce = useAnnounce()

  /*
   * Classification before a timer exists.
   *
   * You can pick a project and tags with nothing running — and must be able to,
   * because "start the Acme timer" is one gesture in the user's head, not two.
   * Until `start` lands there is no row to write them to, so they are held here
   * and handed to the mutation.
   *
   * Once something IS running, `running` is the truth and this is unused: a
   * second copy of the classification living beside the query is precisely the
   * stale-state trap the draft above exists to document.
   */
  const [staged, setStaged] = useState<Classification>({
    projectId: null,
    tagIds: [],
    billable: false,
  })

  const [projectOpen, setProjectOpen] = useState(false)
  const [tagsOpen, setTagsOpen] = useState(false)

  const classification: Classification =
    running === null
      ? staged
      : {
          projectId: running.projectId ?? null,
          tagIds: running.tagIds,
          billable: running.billable,
        }

  /** Applies a classifier change to whichever of the two is currently real. */
  const applyClassification = (change: Partial<Classification>) => {
    if (running === null) {
      setStaged((current) => ({ ...current, ...change }))
      return
    }
    // A row that does not exist yet cannot be patched; the start mutation is
    // carrying the staged values and will land in a moment.
    if (isOptimisticId(running._id)) return
    void classify(running._id, change).catch(() => {
      // Same reasoning as the title write: never interrupt a running timer to
      // report that a tag did not stick.
    })
  }

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

  /*
   * Title autocomplete.
   *
   * Offered only when nothing is running. Once a timer is going, the field is
   * the live title of that entry, and a dropdown that could replace its project
   * and tags while the clock runs is a foot-gun, not a convenience.
   *
   * Never shown for an exact match: if what you have typed already IS the
   * suggestion, the list is one row saying what you can see, and Enter would
   * silently mean "take the suggestion" instead of "start".
   */
  const [suggestOpen, setSuggestOpen] = useState(false)
  const [suggestIndex, setSuggestIndex] = useState(-1)

  const matches =
    running !== null || draft.text.trim() === ""
      ? []
      : suggestions
          .filter((s) => {
            const needle = draft.text.trim().toLowerCase()
            const title = s.title.toLowerCase()
            return title.includes(needle) && title !== needle
          })
          .slice(0, 5)

  const showSuggestions = suggestOpen && matches.length > 0

  /**
   * Takes a suggestion: title, project, tags and billable — never the note.
   *
   * EXACTLY the set `resume` inherits. Toggl's two paths differ from each other
   * on tags, so a user who notices cannot trust either and a user who does not
   * silently loses them.
   */
  const takeSuggestion = (s: TitleSuggestion) => {
    setDraft({ key: runningKey, text: s.title, dirty: true })
    setStaged({
      projectId: s.projectId ?? null,
      tagIds: s.tagIds,
      billable: s.billable,
    })
    setSuggestOpen(false)
    setSuggestIndex(-1)
    inputRef.current?.focus()
  }

  /**
   * `@` opens the project picker, `#` opens tags — both only at a word
   * boundary, so an address or a channel name typed mid-sentence does not
   * hijack the field. The character stays in the input and is stripped when a
   * choice is made, so dismissing the picker leaves what was typed intact.
   */
  const maybeOpenPicker = (text: string) => {
    const last = text.slice(-1)
    if (last !== "@" && last !== "#") return
    const before = text.slice(-2, -1)
    if (before !== "" && !/\s/.test(before)) return
    if (last === "@") setProjectOpen(true)
    else setTagsOpen(true)
  }

  /** Removes the trailing trigger character once the picker has been used. */
  const stripTrigger = () => {
    setDraft((current) =>
      /[@#]$/.test(current.text)
        ? { ...current, text: current.text.replace(/\s*[@#]$/, ""), dirty: true }
        : current
    )
  }

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
          const elapsed = Math.max(1, result.serverNow - stopped.startedAt)
          announce(
            `Stopped ${stopped.title.trim() === "" ? "the timer" : stopped.title.trim()}. ${spokenDuration(elapsed)} recorded.`
          )
          onStopped?.({
            ...stopped,
            endedAt: result.serverNow,
            durationMs: elapsed,
          })
        }
      } else {
        await start({
          title: draft.text.trim(),
          projectId: staged.projectId ?? undefined,
          tagIds: staged.tagIds,
          billable: staged.billable,
        })
        // Cleared only after the mutation resolves. Clearing optimistically
        // would lose the classification if the start failed and the user
        // pressed the button again.
        setStaged({ projectId: null, tagIds: [], billable: false })
        setSuggestOpen(false)
        announce(
          draft.text.trim() === ""
            ? "Timer started."
            : `Timer started: ${draft.text.trim()}.`
        )
        inputRef.current?.focus()
      }
    } catch (thrown) {
      // Previously only `finally`, so a rejected start or stop was an unhandled
      // promise rejection and the user saw nothing at all. Both call sites are
      // `void onToggle()`, so this is the only place the failure can surface.
      //
      // Announced as well as reported, because the button's icon does not move
      // on failure — for anyone not watching it, silence is indistinguishable
      // from success.
      announce(
        running !== null
          ? "The timer did not stop. It is still running."
          : "The timer did not start. Nothing is being recorded."
      )
      onError?.(thrown)
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
      {/*
        Wraps below `sm`, where the classifier cluster gets its own line.
        Single-row at 375px, the project name plus three controls plus the
        elapsed time plus a 42px button left the title field zero width and
        pushed the start button off the edge — the two things on this bar that
        must never be crowded out.
      */}
      <div className="relative flex flex-wrap items-center gap-2 px-3 py-2.5 sm:px-4 sm:py-3">
        <label htmlFor="timer-title" className="sr-only">
          What are you working on?
        </label>
        <input
          id="timer-title"
          ref={inputRef}
          value={draft.text}
          role="combobox"
          aria-expanded={showSuggestions}
          aria-controls="timer-suggestions"
          aria-activedescendant={
            showSuggestions && suggestIndex >= 0
              ? `timer-suggestion-${suggestIndex}`
              : undefined
          }
          onChange={(event) => {
            const text = event.target.value
            setDraft({ key: runningKey, text, dirty: true })
            setSuggestOpen(true)
            setSuggestIndex(-1)
            maybeOpenPicker(text)
          }}
          onFocus={() => setSuggestOpen(true)}
          // A blur that lands INSIDE the suggestion list would close it before
          // the click registers, so the close is deferred a frame.
          onBlur={() => window.setTimeout(() => setSuggestOpen(false), 120)}
          onKeyDown={(event) => {
            if (showSuggestions && event.key === "ArrowDown") {
              event.preventDefault()
              setSuggestIndex((i) => (i + 1) % matches.length)
              return
            }
            if (showSuggestions && event.key === "ArrowUp") {
              event.preventDefault()
              setSuggestIndex((i) => (i - 1 + matches.length) % matches.length)
              return
            }
            if (event.key === "Escape" && showSuggestions) {
              event.preventDefault()
              // Dismisses the list without touching what was typed. Escape here
              // must not also mean "clear the field".
              setSuggestOpen(false)
              setSuggestIndex(-1)
              return
            }
            if (event.key === "Enter") {
              event.preventDefault()
              const chosen = showSuggestions ? matches[suggestIndex] : undefined
              // Enter with nothing highlighted STARTS. The suggestion list
              // being open must never turn the primary gesture into something
              // else — that is how people end up tracking the wrong thing.
              if (chosen !== undefined) takeSuggestion(chosen)
              else void onToggle()
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
            // A floor on the width: `flex-1` alone lets a long elapsed time and
            // a wide control cluster squeeze this to nothing, and the field the
            // whole product is built around must never be the thing that gives.
            "min-w-[7rem] flex-1 bg-transparent pr-2 text-base outline-none sm:text-lg",
            "placeholder:text-muted-foreground focus-visible:ring-0"
          )}
        />

        <div
          className={cn(
            "flex shrink-0 items-center gap-0.5",
            // Own line below `sm`, ordered after the button so it wraps down
            // rather than pushing the input along.
            "order-last w-full border-t border-edge-soft/60 pt-2",
            "sm:order-none sm:w-auto sm:border-t-0 sm:pt-0"
          )}
        >
          <ProjectPicker
            projects={projects}
            value={classification.projectId}
            onCreate={actions.createProject}
            open={projectOpen}
            onOpenChange={(next) => {
              setProjectOpen(next)
              if (!next) inputRef.current?.focus()
            }}
            onChange={(projectId) => {
              applyClassification({ projectId })
              stripTrigger()
            }}
          />
          <TagPicker
            tags={tags}
            value={classification.tagIds}
            onCreate={actions.createTag}
            open={tagsOpen}
            onOpenChange={(next) => {
              setTagsOpen(next)
              if (!next) inputRef.current?.focus()
            }}
            onChange={(tagIds) => {
              applyClassification({ tagIds })
              stripTrigger()
            }}
          />
          <BillableToggle
            value={classification.billable}
            onChange={(billable) => applyClassification({ billable })}
          />
        </div>

        <EntryDuration
          startedAt={running?.startedAt ?? Date.now()}
          endedAt={isRunning ? null : 0}
          className={cn(
            "shrink-0 px-1 text-base font-medium sm:px-2 sm:text-lg",
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

        {showSuggestions ? (
          <ul
            id="timer-suggestions"
            role="listbox"
            aria-label="Previous entries"
            className={cn(
              "absolute top-full right-4 left-4 z-40 mt-1 overflow-hidden rounded-lg",
              "border border-edge-soft bg-surface-raised py-1 shadow-xl"
            )}
          >
            {matches.map((s, index) => (
              // `role="none"`: a listbox must own its options directly, and a
              // plain <li> keeps its implicit `listitem` role and sits between
              // the two in the accessibility tree.
              <li role="none" key={`${s.title}-${index}`}>
                <button
                  type="button"
                  id={`timer-suggestion-${index}`}
                  role="option"
                  aria-selected={index === suggestIndex}
                  data-active={index === suggestIndex}
                  onMouseEnter={() => setSuggestIndex(index)}
                  // `onMouseDown` rather than `onClick`: the input's blur fires
                  // first otherwise and the list is gone before the click lands.
                  onMouseDown={(event) => {
                    event.preventDefault()
                    takeSuggestion(s)
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm",
                    "data-[active=true]:bg-surface focus-visible:outline-none"
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{s.title}</span>
                  {s.projectId === undefined ? null : (
                    <ProjectDot
                      project={projects.find((p) => p._id === s.projectId) ?? null}
                      className="shrink-0"
                    />
                  )}
                  {s.billable ? (
                    <span aria-hidden="true" className="shrink-0 text-xs text-brass">
                      $
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
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
            onClick={() => {
              void discard()
                .then(() => {
                  // Announced AFTER the write lands, not before. Announcing
                  // first told a screen-reader user the timer was discarded
                  // while it was in fact still running, if the write failed.
                  announce("Timer discarded. Nothing was recorded.")
                  // This whole row unmounts on success, taking the focused
                  // button with it — focus falls to <body> and the next Tab
                  // restarts from the top of the document. Hand it to the title
                  // field, which is where someone who just discarded a timer is
                  // going next anyway.
                  inputRef.current?.focus()
                })
                .catch((thrown: unknown) => {
                  announce("The timer was not discarded. It is still running.")
                  onError?.(thrown)
                })
            }}
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

