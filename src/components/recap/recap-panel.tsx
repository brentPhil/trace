import { useEffect, useRef, useState } from "react"
import { Check, ChevronRight, Copy } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { recapDuration } from "@shared/recap"
import { renderMrkdwn, renderPlain } from "@shared/render"
import type { RecapBlock, RecapBullet, RecapDoc } from "@shared/recap"

/**
 * The recap panel.
 *
 * Collapsed by default. The recap is the reason this product exists, but it is
 * a thing you do once at the end of a day — left open it would be a wall of
 * text above the log for the seven hours you are not writing a standup. The
 * collapsed header still carries the one number that creates the useful
 * pressure: how many of today's entries have a note.
 *
 * The panel shows the WHOLE day. The clipboard is capped at eight bullets, and
 * where that bites the panel says so explicitly, in place — the user should
 * never discover what was left out by reading their own message in a channel.
 */
export function RecapPanel({
  doc,
  onSaveFields,
  onFocusEntry,
  className,
}: {
  doc: RecapDoc
  onSaveFields: (fields: { next?: string | null; blocked?: string | null }) => Promise<void>
  /** Drill-down: the log scrolls to and highlights the bullet's source entry. */
  onFocusEntry: (entryId: string) => void
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState<"rich" | "plain" | null>(null)
  const [copyError, setCopyError] = useState<string | null>(null)

  useEffect(() => {
    if (copied === null) return
    const timer = setTimeout(() => setCopied(null), 2_000)
    return () => clearTimeout(timer)
  }, [copied])

  const copy = async (kind: "rich" | "plain") => {
    const text = kind === "rich" ? renderMrkdwn(doc) : renderPlain(doc)
    try {
      await navigator.clipboard.writeText(text)
      setCopied(kind)
      setCopyError(null)
    } catch {
      // Clipboard access can be refused outright (permissions, an insecure
      // origin, an unfocused document). Saying so beats a button that silently
      // does nothing and leaves the user pasting stale content.
      setCopyError("Couldn't reach the clipboard. Select the text below instead.")
    }
  }

  const omitted = doc.blocks.reduce((n, b) => n + b.omittedCount, 0)

  return (
    <section
      aria-label="Daily recap"
      className={cn("border-y border-edge-soft bg-surface/40", className)}
    >
      <h2>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls="recap-body"
          className={cn(
            "flex w-full items-center gap-2 px-4 py-2.5 text-left",
            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          )}
        >
          <ChevronRight
            aria-hidden="true"
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-90",
              "motion-reduce:transition-none"
            )}
          />
          <span className="text-sm font-semibold">Daily recap</span>
          <span className="text-xs text-muted-foreground">{doc.dayLabel}</span>
          <span className="flex-1" />
          {/*
            The same fact the day header states, kept in front of the user at
            the moment it matters most — about to write a standup from notes
            that may not exist yet.
          */}
          <span className="text-xs text-muted-foreground">
            {doc.notedCount} of {doc.entryCount} noted
          </span>
        </button>
      </h2>

      {open ? (
        <div id="recap-body" className="flex flex-col gap-4 px-4 pb-4">
          {doc.entryCount === 0 ? (
            <p className="max-w-prose text-sm text-muted-foreground">
              Nothing tracked today yet. The recap is written from your entries
              and their notes — start a timer and it fills itself in.
            </p>
          ) : (
            <>
              <div className="flex flex-col gap-3">
                {doc.blocks.map((block) => (
                  <Block key={block.projectId ?? "none"} block={block} onFocusEntry={onFocusEntry} />
                ))}
              </div>

              <Field
                label="Next"
                value={doc.next ?? ""}
                placeholder="What you're picking up tomorrow"
                onSave={(next) => onSaveFields({ next })}
              />
              <Field
                label="Blocked"
                value={doc.blocked ?? ""}
                placeholder="Anything in the way"
                // The prefill is drawn verbatim from the last note that mentions
                // an obstacle. Saying where it came from is what keeps it from
                // reading as the app having written something on the user's
                // behalf.
                hint={
                  doc.blockedIsSuggestion
                    ? "Suggested from your last note — edit or clear it."
                    : undefined
                }
                onSave={(blocked) => onSaveFields({ blocked })}
              />

              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" onClick={() => void copy("rich")}>
                  {copied === "rich" ? (
                    <Check className="size-4" />
                  ) : (
                    <Copy className="size-4" />
                  )}
                  {copied === "rich" ? "Copied" : "Copy"}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => void copy("plain")}>
                  {copied === "plain" ? "Copied" : "Copy as plain text"}
                </Button>
                {omitted > 0 ? (
                  <span className="text-xs text-muted-foreground">
                    The copy rolls {omitted} {omitted === 1 ? "bullet" : "bullets"} into
                    a summary line. Everything is listed above.
                  </span>
                ) : null}
              </div>

              {copyError === null ? null : (
                <p role="alert" className="text-xs text-alarm">
                  {copyError}
                </p>
              )}
            </>
          )}
        </div>
      ) : null}
    </section>
  )
}

// ---------------------------------------------------------------------------

function Block({
  block,
  onFocusEntry,
}: {
  block: RecapBlock
  onFocusEntry: (entryId: string) => void
}) {
  const shown = block.bullets.length - block.omittedCount

  return (
    <div
      data-project-color={block.projectColor ?? undefined}
      className="flex flex-col gap-1"
    >
      <div className="flex items-baseline gap-2">
        {block.projectColor === null ? null : (
          <span
            aria-hidden="true"
            className="size-1.5 shrink-0 rounded-full bg-[var(--project-color)]"
          />
        )}
        <span className="text-sm font-semibold">{block.projectName}</span>
        <span className="text-xs text-muted-foreground">·</span>
        <span className="text-xs tabular text-muted-foreground">
          {recapDuration(block.durationMs)}
        </span>
      </div>

      <ul className="flex flex-col">
        {block.bullets.map((bullet, index) => (
          <Bullet
            key={`${bullet.kind}-${index}`}
            bullet={bullet}
            // Not hidden — shown with a marker. The panel's job is to state
            // exactly what the clipboard leaves out, in place.
            omitted={index >= shown}
            onFocusEntry={onFocusEntry}
          />
        ))}
      </ul>
    </div>
  )
}

function Bullet({
  bullet,
  omitted,
  onFocusEntry,
}: {
  bullet: RecapBullet
  omitted: boolean
  onFocusEntry: (entryId: string) => void
}) {
  return (
    <li className="flex">
      <button
        type="button"
        onClick={() => {
          // Every bullet accounts for at least one entry by construction —
          // `assembleRecap` never emits an empty one.
          const first = bullet.entryIds.at(0)
          if (first !== undefined) onFocusEntry(first)
        }}
        title={
          bullet.entryIds.length === 1
            ? "Show this entry"
            : `Show the first of ${bullet.entryIds.length} entries`
        }
        className={cn(
          "group flex w-full items-baseline gap-2 rounded-sm py-0.5 pr-2 pl-1 text-left",
          "hover:bg-surface focus-visible:ring-2 focus-visible:ring-ring",
          "focus-visible:outline-none"
        )}
      >
        <span aria-hidden="true" className="shrink-0 text-xs text-muted-foreground">
          •
        </span>
        <span
          className={cn(
            "min-w-0 flex-1 text-sm",
            // Absence styled as absence: an entry with no note contributes its
            // bare title, and the panel is the one place that may say so. The
            // COPIED text never does — that would advertise the user's own
            // hygiene to their client.
            bullet.kind !== "noted" && "text-muted-foreground italic"
          )}
        >
          {bullet.text}
        </span>
        {omitted ? (
          <span className="shrink-0 rounded-sm border border-edge-soft px-1 text-[0.65rem] text-muted-foreground">
            not copied
          </span>
        ) : null}
        <span className="shrink-0 text-xs tabular text-muted-foreground">
          {recapDuration(bullet.durationMs)}
        </span>
      </button>
    </li>
  )
}

// ---------------------------------------------------------------------------

/**
 * `Next` and `Blocked`.
 *
 * Saved on blur rather than behind a button, matching every other edit in the
 * product. Escape reverts, so a prefill can be rejected with one key.
 */
function Field({
  label,
  value,
  placeholder,
  hint,
  onSave,
}: {
  label: string
  value: string
  placeholder: string
  hint?: string
  onSave: (value: string | null) => Promise<void>
}) {
  const [draft, setDraft] = useState(value)
  const [error, setError] = useState<string | null>(null)
  const committed = useRef(value)

  // Adopt a change from the server only when the user has not diverged from
  // what was last committed — the same rule the timer bar's draft follows.
  if (committed.current !== value && draft === committed.current) {
    committed.current = value
    setDraft(value)
  }

  /**
   * `committed` moves only once the write has LANDED.
   *
   * Setting it up front looked harmless and was not: on a failed save the ref
   * already held the new text, so the adopt branch above saw the draft matching
   * it and quietly replaced both with the server's old value. The user's
   * sentence disappeared with no error and no trace — and for the cleared case
   * it reappeared as the prefill, which reads as the app overruling them.
   */
  const commit = () => {
    const trimmed = draft.trim()
    if (trimmed === committed.current.trim()) return

    const previous = committed.current
    void onSave(trimmed === "" ? null : trimmed)
      .then(() => {
        committed.current = trimmed
        setError(null)
      })
      .catch(() => {
        committed.current = previous
        setError("That didn't save. It is still here — try again.")
      })
  }

  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-muted-foreground">
        {label}
        <input
          value={draft}
          placeholder={placeholder}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              // Blur ONLY — `onBlur` is what commits. Calling `commit()` here
              // as well sent the mutation twice on every Enter: `committed`
              // does not move until the write resolves (deliberately, see
              // above), so the guard inside `commit` has not yet been armed
              // when the blur handler runs a moment later.
              event.currentTarget.blur()
            } else if (event.key === "Escape") {
              event.preventDefault()
              event.stopPropagation()
              setDraft(committed.current)
            }
          }}
          className={cn(
            "mt-1 w-full rounded-md border border-edge-soft bg-ground px-2 py-1.5",
            "text-sm font-normal text-foreground placeholder:text-muted-foreground",
            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          )}
        />
      </label>
      {error !== null ? (
        <p role="alert" className="text-[0.7rem] text-alarm">
          {error}
        </p>
      ) : hint === undefined ? null : (
        <p className="text-[0.7rem] text-muted-foreground">{hint}</p>
      )}
    </div>
  )
}
