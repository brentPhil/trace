import { useEffect, useMemo, useRef, useState } from "react"
import { CalendarRange, ChevronLeft, ChevronRight } from "lucide-react"
import { useAnnounce } from "@/components/a11y/announcer"
import { Popover } from "@/components/ui/popover"
import { useIsMobile } from "@/hooks/use-mobile"
import {
  formatDayRange,
  previewRange,
  rangeTriggerLabel,
  selectDay,
} from "@/lib/date-range-picker"
import { addMonths, monthGrid, monthLabel, weekdayLabels } from "@/lib/month-grid"
import { forceClosePopover, usePopoverActionsRef } from "@/lib/popover-force-close"
import { cn } from "@/lib/utils"
import { addDays, weekdayOf } from "@shared/day"
import type { RangeSelection } from "@/lib/date-range-picker"
import type { Period } from "@/lib/history-filters"
import type { DayString } from "@shared/day"

/**
 * One trigger, one popover, a calendar you select a RANGE in.
 *
 * Replaces the filter bar's two native `<input type="date">` fields. Those
 * made the range someone else's arithmetic — nothing showed that 3–9 Aug is a
 * week, nothing stopped an end before a start. Here the range is one object
 * you look at, and an inverted one cannot be expressed: clicking a day before
 * the armed start restarts the selection from it rather than producing one.
 *
 * Pure props in, `{ from, to }` out. This component never touches `period` —
 * the caller (`FilterBar`) is the one that knows setting a custom range means
 * `period: "custom"`, exactly as it already knows for the segmented control.
 *
 * The calendar reuses `month-grid.ts` and matches `TimePopoverFields`'
 * markup: a real `<table>` with `<th scope="col">` weekday headers, because a
 * date grid IS tabular. Two different-looking calendars in one app is a
 * defect on its own.
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
  const monthsShown = isMobile ? 1 : 2
  const announce = useAnnounce()
  const actionsRef = usePopoverActionsRef()

  const [open, setOpen] = useState(false)
  const [month, setMonth] = useState<DayString>(() => firstOfMonth(from))
  const [selection, setSelection] = useState<RangeSelection>(null)
  const [hovered, setHovered] = useState<DayString | null>(null)
  const [focusedDay, setFocusedDay] = useState<DayString>(from)

  const dayRefs = useRef(new Map<DayString, HTMLButtonElement>())

  // Re-seed every time it OPENS, not once at mount — the same reason every
  // other popover here does. A tab left open must not offer a stale draft.
  useEffect(() => {
    if (!open) return
    setMonth(firstOfMonth(from))
    setSelection(null)
    setHovered(null)
    setFocusedDay(from)
  }, [open, from])

  // Moves real focus onto the roving-tabindex cell. Runs after every
  // navigation, and once on open — the WAI-ARIA date-picker-dialog pattern
  // moves focus straight to the calendar so a keyboard user is not left
  // needing an extra Tab.
  useEffect(() => {
    if (!open) return
    dayRefs.current.get(focusedDay)?.focus()
  }, [open, focusedDay, month])

  const months = useMemo(() => {
    const list: Array<DayString> = [month]
    if (monthsShown === 2) list.push(addMonths(month, 1))
    return list
  }, [month, monthsShown])

  const displayRange = useMemo(() => {
    if (selection === null) return { from, to }
    return previewRange(selection, hovered ?? selection.anchor)
  }, [selection, hovered, from, to])

  const registerRef = (day: DayString, el: HTMLButtonElement | null) => {
    if (el === null) dayRefs.current.delete(day)
    else dayRefs.current.set(day, el)
  }

  const recenter = (day: DayString, anchor: DayString): DayString => {
    const key = day.slice(0, 7)
    const anchorKey = anchor.slice(0, 7)
    if (monthsShown === 1) return key === anchorKey ? anchor : firstOfMonth(day)
    const secondKey = addMonths(anchor, 1).slice(0, 7)
    if (key === anchorKey || key === secondKey) return anchor
    return key < anchorKey ? firstOfMonth(day) : firstOfMonth(addMonths(day, -1))
  }

  const pick = (day: DayString) => {
    setFocusedDay(day)
    setMonth((m) => recenter(day, m))
    setHovered(null)
    const result = selectDay(selection, day)
    setSelection(result.state)
    if (result.committed !== null) {
      announce(`Range set to ${formatDayRange(result.committed.from, result.committed.to)}.`)
      onChange(result.committed)
      setOpen(false)
      forceClosePopover(actionsRef)
      return
    }
    announce(`Start set to ${formatDayRange(day, day)}. Choose an end date.`)
  }

  const moveFocus = (day: DayString) => {
    setFocusedDay(day)
    setMonth((m) => recenter(day, m))
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, day: DayString) => {
    switch (event.key) {
      case "ArrowLeft":
        event.preventDefault()
        event.stopPropagation()
        moveFocus(addDays(day, -1))
        return
      case "ArrowRight":
        event.preventDefault()
        event.stopPropagation()
        moveFocus(addDays(day, 1))
        return
      case "ArrowUp":
        event.preventDefault()
        event.stopPropagation()
        moveFocus(addDays(day, -7))
        return
      case "ArrowDown":
        event.preventDefault()
        event.stopPropagation()
        moveFocus(addDays(day, 7))
        return
      case "Home": {
        event.preventDefault()
        event.stopPropagation()
        const offset = (weekdayOf(day) - weekStartDay + 7) % 7
        moveFocus(addDays(day, -offset))
        return
      }
      case "End": {
        event.preventDefault()
        event.stopPropagation()
        const offset = (weekdayOf(day) - weekStartDay + 7) % 7
        moveFocus(addDays(day, 6 - offset))
        return
      }
      case "PageUp":
        event.preventDefault()
        event.stopPropagation()
        moveFocus(addMonths(day, -1))
        return
      case "PageDown":
        event.preventDefault()
        event.stopPropagation()
        moveFocus(addMonths(day, 1))
        return
      case "Enter":
      case " ":
        // Handled explicitly rather than left to the native button click a
        // real browser would synthesize: jsdom does not synthesize it, and
        // an explicit handler behaves identically (and only once, thanks to
        // preventDefault below) in both.
        event.preventDefault()
        event.stopPropagation()
        pick(day)
        return
      default:
        return
    }
  }

  const label = rangeTriggerLabel(period, from, to, today, weekStartDay)

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
        className={cn("gap-0 p-3", monthsShown === 2 ? "w-[min(38rem,92vw)]" : "w-[19.75rem]")}
      >
        <div className="flex items-center justify-between pb-2">
          <NavButton
            label="Previous month"
            onClick={() => setMonth((m) => addMonths(m, -1))}
          >
            <ChevronLeft className="size-4" />
          </NavButton>
          <div className="flex flex-1 justify-around px-2 text-sm font-medium">
            {months.map((m) => (
              <span key={m} id={headingId(m)}>
                {monthLabel(m)}
              </span>
            ))}
          </div>
          <NavButton label="Next month" onClick={() => setMonth((m) => addMonths(m, 1))}>
            <ChevronRight className="size-4" />
          </NavButton>
        </div>

        <div className={cn("flex flex-col gap-4", monthsShown === 2 && "flex-row gap-6")}>
          {months.map((m) => (
            <MonthTable
              key={m}
              month={m}
              weekStartDay={weekStartDay}
              today={today}
              range={displayRange}
              focusedDay={focusedDay}
              registerRef={registerRef}
              onPick={pick}
              onHover={setHovered}
              onLeave={() => setHovered(null)}
              onKeyDown={handleKeyDown}
            />
          ))}
        </div>
      </Popover.Popup>
    </Popover.Root>
  )
}

// ---------------------------------------------------------------------------

function firstOfMonth(day: DayString): DayString {
  return `${day.slice(0, 7)}-01`
}

function headingId(month: DayString): string {
  return `date-range-picker-month-${month}`
}

function NavButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn(
        "touch-target rounded-md border border-edge p-1 text-muted-foreground",
        "transition-colors hover:text-foreground motion-reduce:transition-none",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      )}
    >
      {children}
    </button>
  )
}

function MonthTable({
  month,
  weekStartDay,
  today,
  range,
  focusedDay,
  registerRef,
  onPick,
  onHover,
  onLeave,
  onKeyDown,
}: {
  month: DayString
  weekStartDay: number
  today: DayString
  range: { from: DayString; to: DayString } | null
  focusedDay: DayString
  registerRef: (day: DayString, el: HTMLButtonElement | null) => void
  onPick: (day: DayString) => void
  onHover: (day: DayString) => void
  onLeave: () => void
  onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>, day: DayString) => void
}) {
  const weeks = monthGrid(month, weekStartDay)

  return (
    <table
      className="w-full flex-1 border-collapse"
      aria-labelledby={headingId(month)}
      onMouseLeave={onLeave}
    >
      <thead>
        <tr>
          {weekdayLabels(weekStartDay).map((label) => (
            <th
              key={label}
              scope="col"
              className="pb-1 text-center text-[0.6875rem] font-normal text-muted-foreground"
            >
              {label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {weeks.map((week) => (
          <tr key={week.find((d) => d !== null) ?? "pad"}>
            {week.map((day, index) => (
              <td key={day ?? `pad-${index}`} className="p-0.5 text-center">
                {day === null ? null : (
                  <DayCell
                    day={day}
                    today={day === today}
                    isStart={range !== null && day === range.from}
                    isEnd={range !== null && day === range.to}
                    inRange={range !== null && day > range.from && day < range.to}
                    tabbable={day === focusedDay}
                    registerRef={registerRef}
                    onPick={() => onPick(day)}
                    onHover={() => onHover(day)}
                    onKeyDown={(event) => onKeyDown(event, day)}
                  />
                )}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** Formats a day for a screen reader: "Wednesday 12 August 2026". */
const dayNameFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
})

function DayCell({
  day,
  today,
  isStart,
  isEnd,
  inRange,
  tabbable,
  registerRef,
  onPick,
  onHover,
  onKeyDown,
}: {
  day: DayString
  today: boolean
  isStart: boolean
  isEnd: boolean
  inRange: boolean
  tabbable: boolean
  registerRef: (day: DayString, el: HTMLButtonElement | null) => void
  onPick: () => void
  onHover: () => void
  onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => void
}) {
  const [year, month, date] = day.split("-").map(Number)
  // Noon UTC, same trick DayCell in time-popover-fields.tsx uses: the calendar
  // date is already decided, and noon is far enough from either boundary that
  // no zone can shift the rendered weekday off it.
  const dateLabel = dayNameFormatter.format(new Date(Date.UTC(year, month - 1, date, 12)))
  const endpoint = isStart || isEnd
  const single = isStart && isEnd

  const stateSuffix = single
    ? ", selected"
    : isStart
      ? ", start of range"
      : isEnd
        ? ", end of range"
        : ""

  const rangeAttr = single ? "single" : isStart ? "start" : isEnd ? "end" : inRange ? "in-range" : "none"

  return (
    <button
      ref={(el) => registerRef(day, el)}
      type="button"
      tabIndex={tabbable ? 0 : -1}
      aria-pressed={endpoint}
      aria-current={today ? "date" : undefined}
      aria-label={`${dateLabel}${today ? ", today" : ""}${stateSuffix}`}
      data-range={rangeAttr}
      onClick={onPick}
      onMouseEnter={onHover}
      onFocus={onHover}
      onKeyDown={onKeyDown}
      className={cn(
        "tabular relative size-8 rounded-md text-sm text-foreground transition-colors",
        "motion-reduce:transition-none",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        // The popover itself is already `--surface-raised` (see
        // `ui/popover.tsx`), so a band or hover tinted the SAME tone would be
        // invisible against its own container — stepping the ramp only works
        // where there is a step left to take. An ink-tinted overlay stays
        // inside the tonal-layering vocabulary without inventing a colour.
        !endpoint && !inRange && "hover:bg-foreground/10",
        inRange && !endpoint && "rounded-none bg-foreground/16",
        endpoint &&
          // Ink on ground, the same "affirmative, deliberately not enlarger"
          // treatment used everywhere else a selected day is marked — see The
          // Cold Light Rule in DESIGN.md.
          "bg-primary font-medium text-primary-foreground",
        // Endpoints differ from each other in FORM, not only fill: the start
        // opens the band to its right, the end opens it to its left. A
        // single-day range is neither, so it stays a plain circle.
        single && "rounded-full",
        isStart && !single && "rounded-l-full rounded-r-none",
        isEnd && !single && "rounded-r-full rounded-l-none"
      )}
    >
      {date}
      {/* Today's mark is a shape, not a hue — a dot survives colour blindness
          and peripheral vision the way a tinted cell alone would not. */}
      {today ? (
        <span
          aria-hidden="true"
          className={cn(
            "absolute bottom-1 left-1/2 size-1 -translate-x-1/2 rounded-full",
            endpoint ? "bg-primary-foreground" : "bg-foreground"
          )}
        />
      ) : null}
    </button>
  )
}
