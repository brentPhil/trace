import { useEffect, useState } from "react"
import { CalendarRange } from "lucide-react"
import { useAnnounce } from "@/components/a11y/announcer"
import { Calendar } from "@/components/ui/calendar"
import { Popover } from "@/components/ui/popover"
import { useIsMobile } from "@/hooks/use-mobile"
import { dateToDay, dayToDate, formatDayRange, rangeTriggerLabel } from "@/lib/date-range-picker"
import { forceClosePopover, usePopoverActionsRef } from "@/lib/popover-force-close"
import { cn } from "@/lib/utils"
import type { DateRange } from "react-day-picker"
import type { Period } from "@/lib/history-filters"
import type { DayString } from "@shared/day"

/**
 * shadcn's date range picker: `Popover` + `Calendar mode="range"`, per the
 * pattern shadcn documents — replacing the hand-built two-click grid that
 * used to live in this file (see git history: it re-implemented range
 * selection, hover preview, and roving-tabindex keyboard nav that
 * react-day-picker's `mode="range"` already owns).
 *
 * Pure props in, `{ from, to }` out. This component never touches `period` —
 * the caller (`FilterBar`) is the one that knows setting a custom range means
 * `period: "custom"`, exactly as it already knows for the segmented control.
 *
 * `Date` only exists inside this component, for react-day-picker's grid.
 * Every crossing of the props boundary goes through `dayToDate` / `dateToDay`
 * (`@/lib/date-range-picker`) and nowhere else — see that file's comment for
 * why the conversion has to be this narrow.
 */
export function DateRangePicker({
  from,
  to,
  period,
  today,
  weekStartDay,
  onChange,
}: {
  from: DayString
  to: DayString
  period: Period
  today: DayString
  weekStartDay: number
  onChange: (range: { from: DayString; to: DayString }) => void
}) {
  const isMobile = useIsMobile()
  const numberOfMonths = isMobile ? 1 : 2
  const announce = useAnnounce()
  const actionsRef = usePopoverActionsRef()

  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<DateRange | undefined>(() => ({
    from: dayToDate(from),
    to: dayToDate(to),
  }))

  // Re-seed every time it OPENS, not once at mount — the same reason every
  // other popover here does. A tab left open must not offer a stale draft.
  useEffect(() => {
    if (!open) return
    setDraft({ from: dayToDate(from), to: dayToDate(to) })
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
    forceClosePopover(actionsRef)
  }

  // FilterBar listens for arrow keys at the document level to step
  // Day/Week/Month (see `2b25007`). react-day-picker owns arrow/Home/End/
  // PageUp/PageDown navigation inside the open grid, and the two must not
  // fight over the same keys — so the popup swallows every key its own grid
  // already handled before it can bubble to that document listener.
  const stopGridNavigationKeys = (event: React.KeyboardEvent) => {
    if (GRID_NAVIGATION_KEYS.has(event.key)) event.stopPropagation()
  }

  const label = rangeTriggerLabel(period, from, to, today, weekStartDay)

  // A fresh key each time the popover transitions to open forces
  // react-day-picker to remount (and its `autoFocus` to fire again), moving
  // real focus onto the grid the way the WAI-ARIA date-picker-dialog pattern
  // expects — without remounting mid-selection while it stays open.
  const calendarKey = open ? `open-${from}-${to}` : "closed"

  return (
    <Popover.Root open={open} onOpenChange={setOpen} actionsRef={actionsRef}>
      <Popover.Trigger
        render={
          <button
            type="button"
            aria-label={`Date range — ${label}`}
            className={cn(
              "touch-target tabular flex items-center gap-1.5 rounded-md border border-edge",
              "bg-ground px-2 py-1.5 text-sm",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            )}
          >
            <CalendarRange aria-hidden="true" className="size-3.5 text-muted-foreground" />
            {label}
          </button>
        }
      />

      <Popover.Popup
        align="start"
        className={cn("gap-0 p-3", numberOfMonths === 2 ? "w-[min(38rem,92vw)]" : "w-[19.75rem]")}
        onKeyDown={stopGridNavigationKeys}
      >
        <Calendar
          key={calendarKey}
          mode="range"
          numberOfMonths={numberOfMonths}
          weekStartsOn={weekStartDay as 0 | 1 | 2 | 3 | 4 | 5 | 6}
          today={dayToDate(today)}
          defaultMonth={dayToDate(from)}
          selected={draft}
          onSelect={handleSelect}
          // Below 2, react-day-picker would complete a range on the very
          // first click (`{ from: day, to: day }` immediately) — this forces
          // the second click FilterBar's own tests, and the trigger label
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
      </Popover.Popup>
    </Popover.Root>
  )
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
