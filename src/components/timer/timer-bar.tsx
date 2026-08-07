import { useEffect, useRef, useState } from "react"
import { DollarSign, FolderClosed, Play, Square, Tag, Trash2 } from "lucide-react"
import { EntryDuration } from "@/components/timer/entry-duration"
import { useEntryMutations } from "@/hooks/use-entry-mutations"
import { cn } from "@/lib/utils"
import type { Doc } from "../../../convex/_generated/dataModel"

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
export function TimerBar({ running }: { running: Doc<"timeEntries"> | null }) {
  const { start, stop, discard, setTitle } = useEntryMutations()
  const [draft, setDraft] = useState("")
  const [pending, setPending] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const isRunning = running !== null
  const runningId = running?._id ?? null
  const runningTitle = running?.title ?? ""

  // Adopt the server's title when a different entry starts running, but never
  // clobber what the user is typing into the entry already running.
  const adoptedFor = useRef<string | null>(null)
  useEffect(() => {
    if (runningId === adoptedFor.current) return
    adoptedFor.current = runningId
    setDraft(runningTitle)
  }, [runningId, runningTitle])

  // Persist while typing. Debounced and last-write-wins: the timer is already
  // running and the words are already on screen, so this must never block.
  useEffect(() => {
    if (runningId === null || draft === runningTitle) return
    const id = setTimeout(() => void setTitle(runningId, draft), TITLE_DEBOUNCE_MS)
    return () => clearTimeout(id)
  }, [draft, runningId, runningTitle, setTitle])

  async function onToggle() {
    // A double press must not create two entries. clientKey makes a genuine
    // network retry idempotent; this handles the cheaper local case.
    if (pending) return
    setPending(true)
    try {
      if (isRunning) {
        await stop()
        setDraft("")
        adoptedFor.current = null
      } else {
        await start({ title: draft.trim() })
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
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
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
          className={cn(
            "min-w-0 flex-1 bg-transparent text-lg outline-none",
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
