import * as React from "react"
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"
import { DayPicker, getDefaultClassNames } from "react-day-picker"
import type { DayButton } from "react-day-picker"

import { cn } from "@/lib/utils"

/**
 * shadcn's `calendar` (`base-luma`, react-day-picker-based) brought onto
 * Trace's design system — see DESIGN.md. This is a hand-edit of the
 * registry file, the same move `ui/button.tsx` already made for the same
 * reason: the stock component ships a look this system explicitly rejects,
 * and there is nowhere else to put a system-wide fix for a primitive every
 * future calendar in the app will reuse.
 *
 * Four deviations from stock, all named in DESIGN.md:
 *
 *  - Radius: stock uses `--radius-4xl` for every cell — the exact
 *    "rounded-everything" pill `ui/button.tsx` already rejected on a 32-36px
 *    control. Cells here are `rounded-md`, and FORM (not a uniform rounded
 *    box) is what tells endpoints, the band, and a plain day apart.
 *  - The in-range band: stock tints it `bg-muted`, which is `--surface` —
 *    the same tone as the page one ramp below `--surface-raised`, the
 *    popover's own background here (`ui/popover.tsx`). Tinting a floating
 *    popover's contents with the AMBIENT page tone reads as a hole, not a
 *    selection. An ink-tinted overlay (`bg-foreground/16`) stays inside the
 *    tonal-layering vocabulary without depending on which surface it sits on.
 *  - Endpoints differ from the band, and from EACH OTHER, in shape as well
 *    as fill: the start opens the band to its right, the end opens it to its
 *    left, and a lone selected day is a plain circle. Meaning is never
 *    colour alone (DESIGN.md, "The Boundary Rule" / never-colour-alone).
 *  - Today gets a dot, not a tint — the same non-hue mark
 *    `time-popover-fields.tsx`'s calendar already uses, so the two date
 *    grids in this app do not disagree about what "today" looks like.
 *
 * The Cold Light Rule holds throughout: nothing here reaches for
 * `--enlarger`. The endpoints' `bg-primary` is `--ink` on `--ground` (see
 * `styles.css`) — the same affirmative, deliberately-not-cold treatment
 * every other selected/primary control in the app uses. Numbers are
 * `tabular` per the Tabular Rule.
 *
 * `showOutsideDays` defaults to `false`, not react-day-picker's `true`: a
 * clickable "31" sitting under an August heading, styled to look like a
 * different month, is a date you can select without noticing the calendar
 * jumped — the same reasoning `month-grid.ts` states for why its own grid
 * pads with blanks instead of neighbouring dates.
 */
function Calendar({
  className,
  classNames,
  showOutsideDays = false,
  formatters,
  labels,
  components,
  ...props
}: React.ComponentProps<typeof DayPicker>) {
  const defaultClassNames = getDefaultClassNames()

  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("bg-surface-raised p-0", className)}
      classNames={{
        root: cn("w-fit", defaultClassNames.root),
        months: cn("relative flex flex-col gap-4 md:flex-row", defaultClassNames.months),
        month: cn("flex w-full flex-col gap-3", defaultClassNames.month),
        nav: cn(
          "absolute inset-x-0 top-0 flex w-full items-center justify-between",
          defaultClassNames.nav
        ),
        button_previous: cn(
          "touch-target rounded-md border border-edge p-1 text-muted-foreground",
          "transition-colors hover:text-foreground motion-reduce:transition-none",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          "aria-disabled:pointer-events-none aria-disabled:opacity-50",
          defaultClassNames.button_previous
        ),
        button_next: cn(
          "touch-target rounded-md border border-edge p-1 text-muted-foreground",
          "transition-colors hover:text-foreground motion-reduce:transition-none",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          "aria-disabled:pointer-events-none aria-disabled:opacity-50",
          defaultClassNames.button_next
        ),
        month_caption: cn(
          "flex h-8 items-center justify-center px-8 text-sm font-medium",
          defaultClassNames.month_caption
        ),
        caption_label: cn("select-none", defaultClassNames.caption_label),
        month_grid: cn("w-full border-collapse", defaultClassNames.month_grid),
        weekdays: defaultClassNames.weekdays,
        weekday: cn(
          "w-8 pb-1 text-center text-[0.6875rem] font-normal text-muted-foreground select-none",
          defaultClassNames.weekday
        ),
        week: defaultClassNames.week,
        day: cn("p-0.5 text-center", defaultClassNames.day),
        range_start: defaultClassNames.range_start,
        range_middle: defaultClassNames.range_middle,
        range_end: defaultClassNames.range_end,
        today: defaultClassNames.today,
        outside: cn("text-muted-foreground/60", defaultClassNames.outside),
        disabled: cn("text-muted-foreground opacity-50", defaultClassNames.disabled),
        hidden: cn("invisible", defaultClassNames.hidden),
        ...classNames,
      }}
      formatters={{
        // 3-letter weekday abbreviations ("Sun", "Mon", …) to match
        // `month-grid.ts`'s `weekdayLabels` — two calendars in this app must
        // not disagree about how a weekday header reads. Stock formats
        // `cccccc` (2-letter, e.g. "Mo").
        formatWeekdayName: (date) => WEEKDAY_ABBR[date.getDay()],
        ...formatters,
      }}
      labels={{
        labelDayButton: dayButtonLabel,
        ...labels,
      }}
      components={{
        Chevron: ({ className: chevronClassName, orientation }) =>
          orientation === "left" ? (
            <ChevronLeftIcon aria-hidden="true" className={cn("size-4", chevronClassName)} />
          ) : (
            <ChevronRightIcon aria-hidden="true" className={cn("size-4", chevronClassName)} />
          ),
        DayButton: CalendarDayButton,
        ...components,
      }}
      {...props}
    />
  )
}

const WEEKDAY_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

/** Formats a day for a screen reader: "Wednesday 12 August 2026". */
const dayNameFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
})

/**
 * Matches `time-popover-fields.tsx`'s day label exactly (weekday, no comma,
 * no ordinal suffix) rather than react-day-picker's stock `date-fns` "PPPP"
 * format ("Thursday, August 3rd, 2026") — one app should have one way a day
 * reads to a screen reader.
 *
 * `date` here is a calendar-grid placeholder, not an instant tied to the
 * user's data — formatting it through a UTC-noon reconstruction of its LOCAL
 * y/m/d fields (the same trick `time-popover-fields.tsx` uses) is what keeps
 * this correct regardless of the browser's zone, without importing
 * `dayToDate`/`dateToDay` into a `ui/` primitive that has no business
 * knowing about `DayString`.
 */
function dayButtonLabel(date: Date, modifiers: Record<string, boolean>): string {
  const noon = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), 12))
  let label = dayNameFormatter.format(noon)
  if (modifiers.today) label += ", today"
  if (modifiers.range_start) {
    label += ", start of range"
  } else if (modifiers.range_end) {
    label += ", end of range"
  } else if (
    // A lone selected day — NOT a band day. `modifiers.selected` is true for
    // every day inside a range (start, middle, and end alike), so the band's
    // middle days must be excluded explicitly or they would misannounce as
    // "selected" one at a time instead of reading as a stretch.
    modifiers.selected &&
    !modifiers.range_middle
  ) {
    label += ", selected"
  }
  return label
}

function CalendarDayButton({
  className,
  day,
  modifiers,
  onKeyDown,
  ...props
}: React.ComponentProps<typeof DayButton>) {
  const ref = React.useRef<HTMLButtonElement>(null)
  React.useEffect(() => {
    if (modifiers.focused) ref.current?.focus()
  }, [modifiers.focused])

  const single =
    modifiers.selected &&
    !modifiers.range_start &&
    !modifiers.range_end &&
    !modifiers.range_middle
  const endpoint = modifiers.range_start || modifiers.range_end || single
  const inRangeMiddle = modifiers.range_middle && !endpoint

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    // react-day-picker's own handler (arrow/Home/End/PageUp/PageDown
    // navigation) runs first.
    onKeyDown?.(event)
    if (event.defaultPrevented) return
    if (event.key === "Enter" || event.key === " ") {
      // A real browser synthesizes a click when Enter/Space fires on a
      // focused native <button> — jsdom does not, so selecting a day by
      // keyboard would silently work only in production and never under
      // test. Triggering the click explicitly makes both agree, and is a
      // no-op layered on top of what a real browser already does.
      event.preventDefault()
      event.currentTarget.click()
    }
  }

  return (
    <button
      ref={ref}
      type="button"
      onKeyDown={handleKeyDown}
      data-range={
        single
          ? "single"
          : modifiers.range_start
            ? "start"
            : modifiers.range_end
              ? "end"
              : inRangeMiddle
                ? "in-range"
                : "none"
      }
      className={cn(
        "tabular relative flex size-8 items-center justify-center rounded-md text-sm",
        "text-foreground transition-colors motion-reduce:transition-none",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        !endpoint && !inRangeMiddle && "hover:bg-foreground/10",
        // The band: shape (flat, no radius) as well as tint — see the file
        // header on why this is an ink overlay and not `bg-muted`.
        inRangeMiddle && "rounded-none bg-foreground/16",
        endpoint &&
          // Ink on ground — see the file header's Cold Light Rule note.
          "bg-primary font-medium text-primary-foreground",
        // Endpoints differ from each other in FORM, not only fill.
        single && "rounded-full",
        modifiers.range_start && !single && "rounded-l-full rounded-r-none",
        modifiers.range_end && !single && "rounded-r-full rounded-l-none",
        className
      )}
      {...props}
    >
      {day.date.getDate()}
      {/* Today's mark is a shape, not a hue. */}
      {modifiers.today ? (
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

export { Calendar, CalendarDayButton }
