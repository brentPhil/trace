import { useState } from "react"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import { errorMessage } from "@/lib/error-message"
import { instantOfDayTime } from "@/lib/format-time"
import { parseTimeOfDay, resolveEndAfterStart } from "@shared/timeOfDay"
import { cn } from "@/lib/utils"
import type { DayString } from "@shared/day"

/**
 * "I forgot to start the timer."
 *
 * The single most common reason a tracker gets abandoned, so it is a first-class
 * control rather than something behind a menu. Four fields and nothing else:
 * what, which day, from when, until when.
 *
 * `<input type="date">` is used deliberately — its value is already a
 * YYYY-MM-DD string, which is exactly the DayString the day module takes, so
 * there is no locale parsing between the picker and the domain. It also brings
 * the platform's own keyboard, calendar and screen-reader behaviour for free.
 */
export function ManualEntryDialog({
  today,
  timeZone,
  onCreate,
}: {
  today: DayString
  timeZone: string
  /** Passed in, not reached for — see TimerBarActions on why. */
  onCreate: (input: {
    title?: string
    note?: string
    startedAt: number
    endedAt: number
  }) => Promise<unknown>
}) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState("")
  const [note, setNote] = useState("")
  const [day, setDay] = useState<DayString>(today)
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const reset = () => {
    setTitle("")
    setNote("")
    setDay(today)
    setFrom("")
    setTo("")
    setError(null)
  }

  const submit = async () => {
    if (saving) return
    setError(null)

    const start = parseTimeOfDay(from, 0)
    if (!start.ok) {
      setError("Start time — try 9:15, 0915, or 2pm.")
      return
    }
    const end = parseTimeOfDay(to, start.time.minutes)
    if (!end.ok) {
      setError("End time — try 17:30, 1730, or 5:30pm.")
      return
    }

    const startedAt = instantOfDayTime(day, { ...start.time, dayOffset: 0 }, timeZone)
    // An end earlier in the clock than the start is the overnight case, not a
    // typo: 23:40 to 01:15 is one shift, and refusing it would make people
    // record two entries for one piece of work.
    const endedAt = instantOfDayTime(
      day,
      resolveEndAfterStart(end.time, { minutes: start.time.minutes, dayOffset: 0 }),
      timeZone
    )

    setSaving(true)
    try {
      await onCreate({
        title: title.trim(),
        note: note.trim() === "" ? undefined : note.trim(),
        startedAt,
        endedAt,
      })
      reset()
      setOpen(false)
    } catch (thrown) {
      setError(errorMessage(thrown))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) reset()
      }}
    >
      {/*
        The label collapses to the glyph below `sm`. At 375px the three totals
        beside it need every pixel, and "Add entry" costs a hundred of them —
        enough to push the row from two lines to three. `aria-label` carries the
        name at every width, so nothing is lost but the ink.
      */}
      <Dialog.Trigger
        render={
          <Button variant="ghost" size="sm" aria-label="Add entry">
            <Plus className="size-4" />
            <span className="hidden sm:inline">Add entry</span>
          </Button>
        }
      />

      <Dialog.Popup>
        <div className="flex flex-col gap-1">
          <Dialog.Title>Add an entry</Dialog.Title>
          <Dialog.Description>
            For work you did without the timer running.
          </Dialog.Description>
        </div>

        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <Labelled label="What were you doing?" htmlFor="manual-title">
            <input
              id="manual-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Optional"
              className={fieldClass}
            />
          </Labelled>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="col-span-2">
              <Labelled label="Day" htmlFor="manual-day">
                <input
                  id="manual-day"
                  type="date"
                  value={day}
                  onChange={(event) => setDay(event.target.value)}
                  className={fieldClass}
                />
              </Labelled>
            </div>
            <Labelled label="From" htmlFor="manual-from">
              <input
                id="manual-from"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
                placeholder="9:15"
                inputMode="numeric"
                className={cn(fieldClass, "tabular")}
              />
            </Labelled>
            <Labelled label="To" htmlFor="manual-to">
              <input
                id="manual-to"
                value={to}
                onChange={(event) => setTo(event.target.value)}
                placeholder="17:30"
                inputMode="numeric"
                className={cn(fieldClass, "tabular")}
              />
            </Labelled>
          </div>

          <Labelled label="What did you do?" htmlFor="manual-note">
            <textarea
              id="manual-note"
              value={note}
              rows={2}
              maxLength={2_000}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Optional — this is what the recap is written from."
              className={cn(fieldClass, "resize-none leading-relaxed")}
            />
          </Labelled>

          {error === null ? null : (
            <p role="alert" className="text-xs text-alarm">
              {error}
            </p>
          )}

          <div className="flex items-center justify-end gap-2">
            <Dialog.Close
              render={
                <Button type="button" variant="ghost" size="sm">
                  Cancel
                </Button>
              }
            />
            <Button type="submit" size="sm" disabled={saving}>
              Add entry
            </Button>
          </div>
        </form>
      </Dialog.Popup>
    </Dialog.Root>
  )
}

const fieldClass = cn(
  "w-full rounded-md border border-edge-soft bg-ground px-3 py-2 text-sm",
  "placeholder:text-muted-foreground",
  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
)

function Labelled({
  label,
  htmlFor,
  children,
}: {
  label: string
  htmlFor: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  )
}
