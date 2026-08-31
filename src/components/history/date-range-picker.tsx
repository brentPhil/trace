import { useEffect, useState } from "react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Calendar } from "@/components/ui/calendar"
import { Button } from "@/components/ui/button"
import { CalendarRange } from "lucide-react"
import { useAnnounce } from "@/components/a11y/announcer"
import { Chip } from "@/components/history/filter-controls"
import { useIsMobile } from "@/hooks/use-mobile"
import { dateToDay, dayToDate, formatDayRange } from "@/lib/date-range-picker"
import { useForceCloseWhenClosed, usePopoverActionsRef } from "@/lib/popover-force-close"
import { cn } from "@/lib/utils"
import type { DateRange } from "react-day-picker"
import type { DayString } from "@shared/day"

/**
 * shadcn's date range picker: `Popover` + `Calendar mode="range"`, per the
 * pattern shadcn documents — replacing the hand-built two-click grid that
 * used to live in this file (see git history: it re-implemented range
 * selection, hover preview, and roving-tabindex keyboard nav that
 * react-day-picker's `mode="range"` already owns).
 *
 * Pure props in, `{ from, to }` out. This component never touches `period` —
 * the caller (`PeriodControls`) is the one that knows setting a custom range means
 * `period: "custom"`, exactly as it already knows for the segmented control.
 *
 * TWO CALLERS NOW, and what differs between them is deliberately not decided
 * here. /reports names the active period ("This week") through
 * `rangeTriggerLabel`; /timer prints `08/10/2026 - 08/16/2026`, the one date
 * format this product puts on paper. The trigger's WORDS are the caller's
 * vocabulary and arrive as `label` — a second `period`-shaped prop would have
 * meant this file knowing about a period /timer does not have. What is shared
 * is everything that is genuinely hard: the grid, the popover, the force-close,
 * the roving tabindex, and the announcement.
 *
 * `Date` only exists inside this component, for react-day-picker's grid.
 * Every crossing of the props boundary goes through `dayToDate` / `dateToDay`
 * (`@/lib/date-range-picker`) and nowhere else — see that file's comment for
 * why the conversion has to be this narrow.
 */
export function DateRangePicker({
  from,
  to,
  today,
  weekStartDay,
  label,
  spokenLabel,
  months,
  showWeekNumber = false,
  presets,
  onChange,
}: {
  /**
   * The selected range, or `null` on BOTH ends for "nothing bounded is
   * selected" — /timer's "All dates". Nullable on both rather than one
   * `range: {from,to} | null` prop only because every existing caller passes
   * them separately; the two are read together everywhere below.
   */
  from: DayString | null
  to: DayString | null
  today: DayString
  weekStartDay: number
  /** What the trigger says. The caller's vocabulary — see the note above. */
  label: string
  /** What a screen reader hears instead, when the visible label is digits.
   *  Defaults to `label`, which is right whenever the label is already prose. */
  spokenLabel?: string
  /** Forced month count. Omitted, it is 2 on a desktop and 1 on a phone. */
  months?: 1 | 2
  /**
   * Week numbers down the side, as /timer's reference design carries.
   *
   * OFF by default, and not the ISO number `calendar-label.ts` refuses: this is
   * react-day-picker's own count, which follows `weekStartsOn` — so on a
   * Sunday-start calendar it numbers the weeks the user's grid actually draws
   * rather than the Monday-based weeks ISO 8601 defines and this app does not
   * necessarily use.
   */
  showWeekNumber?: boolean
  /**
   * A rail of one-click ranges down the left, all three fields or none.
   *
   * Grouped into one prop because they are useless apart: a list with no
   * handler is decoration, and a handler with no list has nothing to fire. The
   * chips are the same `Chip` /reports' Day/Week/Month row and the preset chips
   * are built from, so a preset reads the same everywhere in the product.
   */
  presets?: {
    items: ReadonlyArray<{
      value: string
      label: string
      /**
       * A word set beside the label, for the one thing a preset can be
       * besides selected: /reports badges its opening range "Default", so
       * someone who has stepped away can see which one they came from.
       *
       * Optional per ITEM rather than a `defaultValue` on the rail, because
       * "which one is the default" and "which one is pressed" are different
       * facts and only the caller knows the first. It is a plain string, so
       * the picker never has to know what a caller might want to say.
       */
      badge?: string
    }>
    active: string | null
    onSelect: (value: string) => void
  }
  onChange: (range: { from: DayString; to: DayString }) => void
}) {
  const isMobile = useIsMobile()
  const numberOfMonths = months ?? (isMobile ? 1 : 2)
  const announce = useAnnounce()
  const actionsRef = usePopoverActionsRef()

  const [open, setOpen] = useState(false)
  // Driven off `open`, so it covers EVERY way this popover can close — Escape,
  // an outside click, the Close button, and the range-picked path below —
  // rather than only the one a caller remembers to call a helper from. It also
  // cancels itself if the popover re-opens inside its window, which the
  // fire-and-forget version it replaces could not: that one fired Base UI's
  // `forceUnmount` against a live, open popup. See src/lib/popover-force-close.ts.
  useForceCloseWhenClosed(open, actionsRef)

  const [draft, setDraft] = useState<DateRange | undefined>(() =>
    draftOf(from, to)
  )

  // Re-seed every time it OPENS, not once at mount — the same reason every
  // other popover here does. A tab left open must not offer a stale draft.
  useEffect(() => {
    if (!open) return
    setDraft(draftOf(from, to))
  }, [open, from, to])

  const handleSelect = (range: DateRange | undefined, triggerDate: Date) => {
    /*
     * react-day-picker's own `min={1}` + `resetOnSelect` combination (needed
     * below to force the two-click contract — see the `Calendar` props)
     * has a gap: clicking the SAME day twice, to pick just that one day,
     * collapses the selection to `undefined` instead of completing it as
     * `{ from: day, to: day }`.
     *
     * `min={1}` exists so the FIRST click of a pair never completes a range
     * on its own — without it, `addToRange` would set `to` equal to `from`
     * immediately, and the second click would extend an already-"complete"
     * one-day range instead of arming a fresh `from` (see the comment on
     * `min` below). react-day-picker applies that identical "don't complete
     * yet" rule to the SECOND click when it lands back on the day already
     * armed as `from` — but that click is exactly the "just this one day"
     * gesture, the one case completing immediately is correct for. Rather
     * than relax `min` (and reopen the very bug it prevents), this
     * intercepts only that one transition — a pending `from` with no `to`
     * yet, re-clicked — and completes it by hand.
     */
    const collapsedToSingleDay =
      range === undefined &&
      draft?.from !== undefined &&
      draft.to === undefined &&
      dateToDay(draft.from) === dateToDay(triggerDate)
    const next = collapsedToSingleDay ? { from: triggerDate, to: triggerDate } : range

    setDraft(next)
    if (next?.from === undefined || next.to === undefined) return
    const committed = { from: dateToDay(next.from), to: dateToDay(next.to) }
    announce(`Range set to ${formatDayRange(committed.from, committed.to)}.`)
    onChange(committed)
    setOpen(false)
  }

  // PeriodControls listens for arrow keys at the document level to step
  // Day/Week/Month (see `2b25007`). react-day-picker owns arrow/Home/End/
  // PageUp/PageDown navigation inside the open grid, and the two must not
  // fight over the same keys — so the popup swallows every key its own grid
  // already handled before it can bubble to that document listener.
  const stopGridNavigationKeys = (event: React.KeyboardEvent) => {
    if (GRID_NAVIGATION_KEYS.has(event.key)) event.stopPropagation()
  }

  // A fresh key each time the popover transitions to open forces
  // react-day-picker to remount (and its `autoFocus` to fire again), moving
  // real focus onto the grid the way the WAI-ARIA date-picker-dialog pattern
  // expects — without remounting mid-selection while it stays open.
  const calendarKey = open ? `open-${from}-${to}` : "closed"

  return (
    <Popover open={open} onOpenChange={setOpen} actionsRef={actionsRef}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label={`Date range — ${spokenLabel ?? label}`}
            className={cn(
              "relative after:absolute after:inset-x-0 after:-inset-y-0.5 after:content-['']",
              "font-mono tabular-nums tracking-[-0.02em] gap-1.5 border-input bg-background px-2 font-normal"
            )}
          >
            <CalendarRange aria-hidden="true" className="size-3.5 text-muted-foreground" />
            {label}
          </Button>
        }
      />

      <PopoverContent
        align="start"
        className={cn(
          "gap-0 p-3",
          /*
           * OFF `PopoverContent`'S OWN `max-h-[min(22rem,60svh)]
           * overflow-hidden`, which is sized for a short menu list and
           * silently amputates a calendar.
           *
           * A one-month grid with a preset rail measures ~305px and a
           * two-month one is no shorter, so `60svh` cuts the last week row off
           * — with `overflow-hidden` there is not even a scrollbar to say so —
           * on any viewport under about 510px tall. Measured in the live DOM:
           * at a 512px-tall window the popup came back exactly 307px high with
           * its content clipped. `overflow-auto` keeps the rounded corners
           * clipping the way the menu case wants while letting a genuinely
           * cramped viewport scroll instead of lie.
           */
          "max-h-[min(34rem,88svh)] overflow-auto",
          // Content-sized once a rail is beside the grid: a fixed width would
          // have to guess at the widest preset label in whichever language.
          presets !== undefined
            ? "w-auto max-w-[92vw]"
            : numberOfMonths === 2
              ? "w-[min(38rem,92vw)]"
              : "w-[19.75rem]"
        )}
        onKeyDown={stopGridNavigationKeys}
      >
        <div className="flex items-start gap-3">
          {presets === undefined ? null : (
            <div
              // A rail, not a row: it runs down the left of the grid, which is
              // where the reference design puts it and where it stays out of
              // the way of the two-click gesture on the right.
              className="flex flex-col items-start gap-1 self-stretch border-r border-border pr-3"
            >
              {presets.items.map((preset) => (
                <Chip
                  key={preset.value}
                  active={presets.active === preset.value}
                  onClick={() => {
                    announce(`Range set to ${preset.label}.`)
                    presets.onSelect(preset.value)
                    setOpen(false)
                  }}
                >
                  {preset.label}
                  {preset.badge === undefined ? null : (
                    <>
                      {/* THE BADGE, SAID RATHER THAN SHOWN, and only once:
                          the visible tag is hidden from the accessibility
                          tree and this carries the whole phrase.

                          A bare `,` between two visible spans would be all a
                          reader got — an accessible name is built by
                          concatenating each node's TRIMMED text, so a
                          separator span holding ", " arrives as
                          "This quarter,Default" with the space gone (`trim`
                          eats a no-break space too). Keeping the comma and
                          the word in ONE node is what makes the space
                          internal, and therefore survive.

                          It is in the name at all because which preset the
                          page OPENS on is the entire point of the badge: a
                          reader without it learns which chip is pressed but
                          never which one is home. */}
                      <span className="sr-only">, {preset.badge}</span>
                      <span
                        aria-hidden="true"
                        className={cn(
                          "ml-1.5 rounded-md border border-border px-1",
                          "text-[0.625rem] text-muted-foreground"
                        )}
                      >
                        {preset.badge}
                      </span>
                    </>
                  )}
                </Chip>
              ))}
            </div>
          )}

          <Calendar
            key={calendarKey}
            mode="range"
            numberOfMonths={numberOfMonths}
            showWeekNumber={showWeekNumber}
            weekStartsOn={weekStartDay as 0 | 1 | 2 | 3 | 4 | 5 | 6}
            today={dayToDate(today)}
            defaultMonth={dayToDate(from ?? today)}
            selected={draft}
            onSelect={handleSelect}
            // Below 2, react-day-picker would complete a range on the very
            // first click (`{ from: day, to: day }` immediately) — this forces
            // the second click PeriodControls' own tests, and the trigger label
            // logic above, both assume happens before anything commits.
            min={1}
            // Without this, react-day-picker treats a click as EXTENDING the
            // already-complete range it was seeded with (`from`/`to` are
            // always both set on these props) rather than starting a fresh
            // pick — so the very first click after opening would silently
            // move `to` instead of arming a new `from`. `resetOnSelect` is
            // what makes clicking anywhere start a new two-click selection.
            resetOnSelect
            autoFocus
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}

/** The grid's own copy of the selection — `undefined` when nothing is bounded,
 *  so an unbounded "All dates" does not paint today as though it were picked. */
function draftOf(
  from: DayString | null,
  to: DayString | null
): DateRange | undefined {
  if (from === null || to === null) return undefined
  return { from: dayToDate(from), to: dayToDate(to) }
}

const GRID_NAVIGATION_KEYS = new Set([
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
  "PageUp",
  "PageDown",
])
