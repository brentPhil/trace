"use client"

import * as React from "react"
import {
  DayPicker,
  getDefaultClassNames,
  type DayButton,
  type Locale,
} from "react-day-picker"

import { cn } from "@/lib/utils"
import { formatDayName } from "@/lib/format-time"
import { weekdayLabels } from "@/lib/month-grid"
import { Button, buttonVariants } from "@/components/ui/button"
import { ChevronLeftIcon, ChevronRightIcon, ChevronDownIcon } from "lucide-react"

function Calendar({
  className,
  classNames,
  /*
   * FALSE, against react-day-picker's default and against the registry's.
   *
   * This is the one behavioural override left in this file after the reset to
   * shadcn's defaults, and it is not a look: a clickable "31" sitting under an
   * August heading is a date you can select without noticing the calendar
   * jumped a month. `month-grid.ts` pads with blanks for the same reason.
   */
  showOutsideDays = false,
  captionLayout = "label",
  buttonVariant = "ghost",
  locale,
  formatters,
  labels,
  components,
  ...props
}: React.ComponentProps<typeof DayPicker> & {
  buttonVariant?: React.ComponentProps<typeof Button>["variant"]
}) {
  const defaultClassNames = getDefaultClassNames()

  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn(
        "group/calendar bg-background p-3 [--cell-radius:var(--radius-4xl)] [--cell-size:--spacing(8)] in-data-[slot=card-content]:bg-transparent in-data-[slot=popover-content]:bg-transparent",
        String.raw`rtl:**:[.rdp-button\_next>svg]:rotate-180`,
        String.raw`rtl:**:[.rdp-button\_previous>svg]:rotate-180`,
        className
      )}
      captionLayout={captionLayout}
      locale={locale}
      /*
       * LABELS, NOT STYLING, which is why these two blocks survived the reset
       * to the registry's defaults. Everything visual in this file is
       * shadcn's; what a day announces to a screen reader is the product's.
       */
      formatters={{
        formatMonthDropdown: (date) =>
          date.toLocaleString(locale?.code, { month: "short" }),
        // The very same labels `time-popover-fields.tsx`'s calendar draws —
        // taken from `month-grid.ts` rather than restated, so the invariant is
        // an import instead of a comment. Unrotated (`weekdayLabels(0)`) is
        // Sunday-first, which is how `Date.prototype.getDay` indexes; stock
        // formats two letters ("Mo").
        formatWeekdayName: (date) => SUNDAY_FIRST_WEEKDAYS[date.getDay()],
        // Stock is `""`, which leaves the week-number column the only headed
        // column in the grid with a blank head — six numbers under nothing.
        formatWeekNumberHeader: () => "W",
        ...formatters,
      }}
      labels={{
        labelDayButton: dayButtonLabel,
        ...labels,
      }}
      classNames={{
        root: cn("w-fit", defaultClassNames.root),
        months: cn(
          "relative flex flex-col gap-4 md:flex-row",
          defaultClassNames.months
        ),
        month: cn("flex w-full flex-col gap-4", defaultClassNames.month),
        nav: cn(
          "absolute inset-x-0 top-0 flex w-full items-center justify-between gap-1",
          defaultClassNames.nav
        ),
        button_previous: cn(
          buttonVariants({ variant: buttonVariant }),
          "size-(--cell-size) p-0 select-none aria-disabled:opacity-50",
          defaultClassNames.button_previous
        ),
        button_next: cn(
          buttonVariants({ variant: buttonVariant }),
          "size-(--cell-size) p-0 select-none aria-disabled:opacity-50",
          defaultClassNames.button_next
        ),
        month_caption: cn(
          "flex h-(--cell-size) w-full items-center justify-center px-(--cell-size)",
          defaultClassNames.month_caption
        ),
        dropdowns: cn(
          "flex h-(--cell-size) w-full items-center justify-center gap-1.5 text-sm font-medium",
          defaultClassNames.dropdowns
        ),
        dropdown_root: cn(
          "relative rounded-(--cell-radius)",
          defaultClassNames.dropdown_root
        ),
        dropdown: cn(
          "absolute inset-0 bg-popover opacity-0",
          defaultClassNames.dropdown
        ),
        caption_label: cn(
          "font-medium select-none",
          captionLayout === "label"
            ? "text-sm"
            : "flex items-center gap-1 rounded-(--cell-radius) text-sm [&>svg]:size-3.5 [&>svg]:text-muted-foreground",
          defaultClassNames.caption_label
        ),
        month_grid: cn("w-full border-collapse", defaultClassNames.month_grid),
        weekdays: cn("flex", defaultClassNames.weekdays),
        weekday: cn(
          "flex-1 rounded-(--cell-radius) text-[0.8rem] font-normal text-muted-foreground select-none",
          defaultClassNames.weekday
        ),
        week: cn("mt-2 flex w-full", defaultClassNames.week),
        week_number_header: cn(
          "w-(--cell-size) select-none",
          defaultClassNames.week_number_header
        ),
        week_number: cn(
          "text-[0.8rem] text-muted-foreground select-none",
          defaultClassNames.week_number
        ),
        day: cn(
          "group/day relative aspect-square h-full w-full rounded-(--cell-radius) p-0 text-center select-none [&:last-child[data-selected=true]_button]:rounded-r-(--cell-radius)",
          props.showWeekNumber
            ? "[&:nth-child(2)[data-selected=true]_button]:rounded-l-(--cell-radius)"
            : "[&:first-child[data-selected=true]_button]:rounded-l-(--cell-radius)",
          defaultClassNames.day
        ),
        range_start: cn(
          "relative isolate z-0 rounded-l-(--cell-radius) bg-muted after:absolute after:inset-y-0 after:right-0 after:w-4 after:bg-muted",
          defaultClassNames.range_start
        ),
        range_middle: cn("rounded-none", defaultClassNames.range_middle),
        range_end: cn(
          "relative isolate z-0 rounded-r-(--cell-radius) bg-muted after:absolute after:inset-y-0 after:left-0 after:w-4 after:bg-muted",
          defaultClassNames.range_end
        ),
        today: cn(
          "rounded-(--cell-radius) bg-muted text-foreground data-[selected=true]:rounded-none",
          defaultClassNames.today
        ),
        outside: cn(
          "text-muted-foreground aria-selected:text-muted-foreground",
          defaultClassNames.outside
        ),
        disabled: cn(
          "text-muted-foreground opacity-50",
          defaultClassNames.disabled
        ),
        hidden: cn("invisible", defaultClassNames.hidden),
        ...classNames,
      }}
      components={{
        Root: ({ className, rootRef, ...props }) => {
          return (
            <div
              data-slot="calendar"
              ref={rootRef}
              className={cn(className)}
              {...props}
            />
          )
        },
        Chevron: ({ className, orientation, ...props }) => {
          if (orientation === "left") {
            return (
              <ChevronLeftIcon className={cn("size-4", className)} {...props} />
            )
          }

          if (orientation === "right") {
            return (
              <ChevronRightIcon className={cn("size-4", className)} {...props} />
            )
          }

          return (
            <ChevronDownIcon className={cn("size-4", className)} {...props} />
          )
        },
        DayButton: ({ ...props }) => (
          <CalendarDayButton locale={locale} {...props} />
        ),
        WeekNumber: ({ children, ...props }) => {
          return (
            <td {...props}>
              <div className="flex size-(--cell-size) items-center justify-center text-center">
                {children}
              </div>
            </td>
          )
        },
        ...components,
      }}
      {...props}
    />
  )
}

function CalendarDayButton({
  className,
  day,
  modifiers,
  locale,
  ...props
}: React.ComponentProps<typeof DayButton> & { locale?: Partial<Locale> }) {
  const defaultClassNames = getDefaultClassNames()

  const ref = React.useRef<HTMLButtonElement>(null)
  React.useEffect(() => {
    if (modifiers.focused) ref.current?.focus()
  }, [modifiers.focused])

  return (
    <Button
      // `ref`, which the registry file declares, wires to an effect, and then
      // never attaches — so `ref.current` is forever null and the focus that
      // effect exists to move never happens. That breaks arrow-key navigation
      // outright: react-day-picker only advances its roving tabindex from the
      // day that actually holds DOM focus, so every arrow press was a no-op.
      // One attribute, no styling.
      ref={ref}
      // Today is already conveyed by the accessible name (", today"), which
      // satisfies never-colour-alone on its own. This is the conventional
      // PROGRAMMATIC hook for it, and what an assistive technology own
      // "jump to today" affordance looks for. An ARIA attribute, not a style.
      aria-current={modifiers.today ? "date" : undefined}
      variant="ghost"
      size="icon"
      data-day={day.date.toLocaleDateString(locale?.code)}
      data-selected-single={
        modifiers.selected &&
        !modifiers.range_start &&
        !modifiers.range_end &&
        !modifiers.range_middle
      }
      data-range-start={modifiers.range_start}
      data-range-end={modifiers.range_end}
      data-range-middle={modifiers.range_middle}
      className={cn(
        "relative isolate z-10 flex aspect-square size-auto w-full min-w-(--cell-size) flex-col gap-1 border-0 leading-none font-normal group-data-[focused=true]/day:relative group-data-[focused=true]/day:z-10 group-data-[focused=true]/day:border-ring group-data-[focused=true]/day:ring-[3px] group-data-[focused=true]/day:ring-ring/50 data-[range-end=true]:rounded-(--cell-radius) data-[range-end=true]:rounded-r-(--cell-radius) data-[range-end=true]:bg-primary data-[range-end=true]:text-primary-foreground data-[range-middle=true]:rounded-none data-[range-middle=true]:bg-muted data-[range-middle=true]:text-foreground data-[range-start=true]:rounded-(--cell-radius) data-[range-start=true]:rounded-l-(--cell-radius) data-[range-start=true]:bg-primary data-[range-start=true]:text-primary-foreground data-[selected-single=true]:bg-primary data-[selected-single=true]:text-primary-foreground dark:hover:text-foreground [&>span]:text-xs [&>span]:opacity-70",
        defaultClassNames.day,
        className
      )}
      {...props}
    />
  )
}

/** `["Sun", "Mon", …]` — unrotated, so the index is `getDay()`'s. */
const SUNDAY_FIRST_WEEKDAYS = weekdayLabels(0)

/**
 * Matches `time-popover-fields.tsx`'s day label exactly (weekday, no comma,
 * no ordinal suffix) rather than react-day-picker's stock "PPPP" format
 * ("Thursday, August 3rd, 2026") — one app should have one way a day reads to
 * a screen reader. Both go through `formatDayName`.
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
    // A one-day range carries BOTH flags, and this branch has to come first or
    // it announces as "start of range" with no end anywhere in the grid.
    label += ", selected"
  } else if (modifiers.range_start) {
    label += ", start of range"
  } else if (modifiers.range_end) {
    label += ", end of range"
  } else if (modifiers.selected && !modifiers.range_middle) {
    // A lone selected day — NOT a band day. `modifiers.selected` is true for
    // every day inside a range, so the middle days must be excluded or they
    // misannounce as "selected" one at a time instead of reading as a stretch.
    label += ", selected"
  }
  return label
}

export { Calendar, CalendarDayButton }
