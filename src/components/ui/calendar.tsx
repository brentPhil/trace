import * as React from "react"
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"
import { DayPicker, getDefaultClassNames } from "react-day-picker"
import type { DayButton } from "react-day-picker"

import { buttonVariants } from "@/components/ui/button"
import { formatDayName } from "@/lib/format-time"
import { weekdayLabels } from "@/lib/month-grid"
import { cn } from "@/lib/utils"

/**
 * shadcn's `calendar` (`base-luma`, react-day-picker-based) brought onto
 * Chroneli's design system — see DESIGN.md. This is a hand-edit of the
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
 *    left, and a lone selected day is closed on both. Meaning is never
 *    colour alone (DESIGN.md, "The Boundary Rule" / never-colour-alone).
 *  - Today gets a dot, not a tint — the same non-hue mark
 *    `time-popover-fields.tsx`'s calendar already uses, so the two date
 *    grids in this app do not disagree about what "today" looks like.
 *
 * The Cold Light Rule holds throughout: nothing here reaches for
 * `--enlarger`. The endpoints' `bg-primary` is `--ink` on `--ground` (see
 * `styles.css`) — the same affirmative, deliberately-not-cold treatment
 * every other selected/primary control in the app uses. Numbers are
 * `tabular-nums` per the Tabular Rule.
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
        button_previous: cn(MONTH_STEPPER, defaultClassNames.button_previous),
        button_next: cn(MONTH_STEPPER, defaultClassNames.button_next),
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
        /* Only rendered under `showWeekNumber`, which is off by default. Muted
           and non-tabular-width-competing with the day cells: the numbers are a
           rail to find a row by, not data to read across. */
        week_number_header: cn(
          "w-8 pb-1 text-center text-[0.6875rem] font-normal text-muted-foreground select-none",
          defaultClassNames.week_number_header
        ),
        week_number: cn(
          "font-mono tabular-nums tracking-[-0.02em] w-8 text-center text-[0.6875rem] text-muted-foreground select-none",
          defaultClassNames.week_number
        ),
        /*
         * NO PADDING ON THE CELL, and that is the whole reason the band reads
         * as a band.
         *
         * The in-range fill is painted by the day BUTTON below, not by this
         * `td`. With `p-0.5` here the button was 32px inside a 35.3px cell, so
         * every pair of neighbouring band days was separated by a 3.9px gutter
         * of untinted popover — a "continuous" selection rendered as a row of
         * detached blocks, horizontally and (4px) between week rows too.
         * Measured in the live DOM, not guessed at.
         *
         * Flush cells make the button's own fill the cell's fill, so the band
         * is continuous by construction rather than by two paddings agreeing.
         * The cost is that a focus ring now has no gutter to sit in, which is
         * what the button's `focus-visible:z-10` answers.
         */
        day: cn("p-0 text-center", defaultClassNames.day),
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
        // The very same labels `time-popover-fields.tsx`'s calendar draws —
        // taken from `month-grid.ts` rather than restated, so the invariant is
        // an import instead of a comment. Unrotated (`weekdayLabels(0)`) is
        // Sunday-first, which is how `Date.prototype.getDay` indexes; stock
        // formats `cccccc` (2-letter, e.g. "Mo").
        formatWeekdayName: (date) => SUNDAY_FIRST_WEEKDAYS[date.getDay()],
        /* react-day-picker's default is `""`, which left the week-number
           column the only headed column in the grid with a blank head — six
           numbers under nothing. The `<th>` already carries an "Week Number"
           accessible name of react-day-picker's own; this is the visible half
           of it, and it is what the reference design draws. */
        formatWeekNumberHeader: () => "W",
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

/**
 * Both month steppers' classes, in one place.
 *
 * These were five identical lines typed twice in adjacent blocks, differing
 * only in which `defaultClassNames` key they merged — which is how the
 * `border-edge-raised` contrast fix had to be typed twice as well.
 *
 * `border-edge-raised` and not `--edge`: no fill of their own, sitting on the
 * `bg-surface-raised` above, where `--edge` measures 2.60:1 and misses SC
 * 1.4.11's 3:1. See src/styles.css.
 */
const MONTH_STEPPER = cn(
  buttonVariants({ variant: "quiet", size: "icon-xs" }),
  "relative after:absolute after:inset-x-0 after:-inset-y-0.5 after:content-['']",
  "border-edge-raised motion-reduce:transition-none",
  "aria-disabled:pointer-events-none aria-disabled:opacity-50"
)

/** `["Sun", "Mon", …]` — unrotated, so the index is `getDay()`'s. */
const SUNDAY_FIRST_WEEKDAYS = weekdayLabels(0)

/**
 * Matches `time-popover-fields.tsx`'s day label exactly (weekday, no comma,
 * no ordinal suffix) rather than react-day-picker's stock `date-fns` "PPPP"
 * format ("Thursday, August 3rd, 2026") — one app should have one way a day
 * reads to a screen reader. Both go through `formatDayName`.
 *
 * `date` here is a calendar-grid placeholder, not an instant tied to the
 * user's data, so its LOCAL y/m/d fields are the date being named. Passing
 * those three numbers keeps this out of `DayString` — which a `ui/` primitive
 * has no business knowing about — while still sharing the formatter.
 */
function dayButtonLabel(date: Date, modifiers: Record<string, boolean>): string {
  let label = formatDayName(date.getFullYear(), date.getMonth() + 1, date.getDate())
  if (modifiers.today) label += ", today"
  if (modifiers.range_start && modifiers.range_end) {
    // A one-day range carries BOTH flags (see `CalendarDayButton`), and this
    // branch has to come first or it announces as "start of range" with no end
    // anywhere in the grid — which is what /timer's "Today" preset said.
    label += ", selected"
  } else if (modifiers.range_start) {
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
  ...props
}: React.ComponentProps<typeof DayButton>) {
  const ref = React.useRef<HTMLButtonElement>(null)
  React.useEffect(() => {
    if (modifiers.focused) ref.current?.focus()
  }, [modifiers.focused])

  /*
   * A ONE-DAY selection, which react-day-picker marks as `range_start` AND
   * `range_end` at once — see DayPicker's own modifier assignment, where both
   * are `isSameDay(date, from)` / `isSameDay(date, to)` against a range whose
   * two ends are the same day. It is never a bare `selected` with no range
   * flag.
   *
   * Deriving `single` as "selected but none of the three range flags" — as
   * this did — therefore made it UNREACHABLE in `mode="range"`. A one-day pick
   * fell into both endpoint branches at once, and tailwind-merge resolved the
   * conflicting `rounded-l-full rounded-r-none` / `rounded-r-full
   * rounded-l-none` down to the LAST one: a flat-left, semicircular-right half
   * pill. That is what /timer's "Today" and "Yesterday" presets drew, and what
   * /reports' Day period drew, every time.
   */
  const single = modifiers.range_start && modifiers.range_end
  const isStart = modifiers.range_start && !single
  const isEnd = modifiers.range_end && !single
  const endpoint = isStart || isEnd || single
  const inRangeMiddle = modifiers.range_middle && !endpoint

  return (
    <button
      ref={ref}
      type="button"
      // Today is already conveyed by the dot below and by ", today" in the
      // accessible name, which satisfies never-colour-alone on its own. This
      // is the conventional programmatic hook for it, and what an assistive
      // technology's own "today" affordance looks for.
      aria-current={modifiers.today ? "date" : undefined}
      data-range={
        single
          ? "single"
          : isStart
            ? "start"
            : isEnd
              ? "end"
              : inRangeMiddle
                ? "in-range"
                : "none"
      }
      className={cn(
        "font-mono tabular-nums tracking-[-0.02em] relative flex size-8 items-center justify-center rounded-md text-sm",
        "text-foreground transition-colors motion-reduce:transition-none",
        // `z-10` because the cell around this button has no padding any more
        // (see `classNames.day`): without it the 2px ring would be painted
        // over on its right by the next day's own fill, which comes later in
        // DOM order. Focus has to stay a complete rectangle.
        "focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ring",
        "focus-visible:outline-none",
        !endpoint && !inRangeMiddle && "hover:bg-foreground/10",
        // The band: shape (flat, no radius) as well as tint — see the file
        // header on why this is an ink overlay and not `bg-muted`.
        inRangeMiddle && "rounded-none bg-foreground/16",
        endpoint &&
          // Ink on ground — see the file header's Cold Light Rule note.
          "bg-primary font-medium text-primary-foreground",
        /*
         * Endpoints differ from each other in FORM, not only fill — but at
         * `rounded-md`, never `rounded-full`. A 32px cell at `rounded-full`
         * computes to a 33554432px radius, which is a circle: precisely the
         * "rounded-everything" pill DESIGN.md §5 rejects on a control this
         * size, and precisely what the header comment above already claimed
         * this file did not do.
         */
        isStart && "rounded-r-none",
        isEnd && "rounded-l-none",
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
