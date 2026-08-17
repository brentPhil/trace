import { useEffect, useState } from "react"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import { errorMessage } from "@/lib/error-message"
import { instantOfDayTime, localMinutesOf } from "@/lib/format-time"
import { resolveInterval, timeFieldHelp } from "@shared/timeOfDay"
import { cn } from "@/lib/utils"
import { dayOf } from "@shared/day"
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
  timeZone,
  onCreate,
}: {
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
  const [day, setDay] = useState<DayString>(() => dayOf(Date.now(), timeZone))
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const reset = () => {
    setTitle("")
    setNote("")
    setDay(dayOf(Date.now(), timeZone))
    setFrom("")
    setTo("")
    setError(null)
  }

  /*
   * Re-read the day every time the dialog OPENS, from the wall clock.
   *
   * This is a page people leave open, and the tab that has been sitting there
   * since yesterday evening must not offer yesterday when it is used at 09:00
   * this morning — an entry meant for today would land on a day that has very
   * likely already been reported, and go missing from the total the user is
   * looking at while they add it.
   *
   * THE CLOCK, NOT A PROP. This used to be `today: DayString`, which /timer
   * kept current by recomputing it every second (`useSecond`). The dialog now
   * mounts in the shell, above the outlet, and the shell has no clock — so a
   * prop would freeze at page load and reintroduce the exact bug this effect
   * exists to prevent. Reading `Date.now()` here removes the hazard by
   * construction rather than by whoever mounts the dialog remembering to tick.
   */
  useEffect(() => {
    if (open) setDay(dayOf(Date.now(), timeZone))
  }, [open, timeZone])

  const submit = async () => {
    if (saving) return
    setError(null)

    /*
     * The wall clock, not midnight.
     *
     * `parseTimeOfDay`'s second argument disambiguates a bare `1`-`11` by
     * whichever reading is nearer on the clock face, and resolves a bare `12`.
     * A literal `0` is not "no context" — it is the specific claim that it is
     * currently midnight, so every bare hour resolved to AM and `12` to
     * `00:00`. Logging this afternoon's 2-to-4 from the terse form the parser
     * exists to support produced a 2 AM entry.
     *
     * The day this entry is filed under is deliberately NOT the reference. It
     * carries no time of day, and the rule is about what a person typing right
     * now most likely means — which is why the parser documents it as the
     * user's current local time.
     *
     * `resolveInterval` owns the rest: the start is pinned to the day the
     * calendar says, and the end is read against that start rather than
     * against the clock — which is what makes "9" then "5" an eight-hour day
     * rather than a twenty-hour one, while still reading 23:40 to 01:15 as the
     * one overnight shift it is. All three components that take a pair of
     * typed times used to spell that out for themselves.
     */
    const interval = resolveInterval(from, to, localMinutesOf(Date.now(), timeZone))
    if (!interval.ok) {
      setError(timeFieldHelp(interval.field))
      return
    }

    const startedAt = instantOfDayTime(day, interval.start, timeZone)
    const endedAt = instantOfDayTime(day, interval.end, timeZone)

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
        Icon only, at every width. It sits beside Play now — the most important
        control in the app — and a label there would either crowd Play or push
        the title field, which the bar's own doc comment says must never give.
        `aria-label` carries the name, so nothing is lost but the ink.

        A 36px ghost SQUARE, deliberately not a second 42px filled circle:
        two round controls of similar weight side by side is how the one button
        that must never be mis-clicked gets mis-clicked.
      */}
      <Dialog.Trigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label="Add entry"
            className="size-9 shrink-0 rounded-md"
          >
            <Plus className="size-4" />
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
                className={cn(fieldClass, "font-mono tabular-nums tracking-[-0.02em]")}
              />
            </Labelled>
            <Labelled label="To" htmlFor="manual-to">
              <input
                id="manual-to"
                value={to}
                onChange={(event) => setTo(event.target.value)}
                placeholder="17:30"
                inputMode="numeric"
                className={cn(fieldClass, "font-mono tabular-nums tracking-[-0.02em]")}
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
              placeholder="Optional — Reports searches note text to find this later."
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
  "w-full rounded-md border border-edge bg-ground px-3 py-2 text-sm",
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
