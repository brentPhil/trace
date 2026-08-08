import { useEffect } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { Chip, FilterControls } from "@/components/history/filter-controls"
import { DateRangePicker } from "@/components/history/date-range-picker"
import { periodFilters, stepPeriod } from "@/lib/history-filters"
import { cn } from "@/lib/utils"
import type { Filters, Preset } from "@/lib/history-filters"
import type { Doc } from "../../../convex/_generated/dataModel"

/**
 * The history filters.
 *
 * Four of them, in the order a person narrows a search: when, then what, then
 * which client, then the awkward-cases chips. Every one is a plain form control
 * — this is the screen where someone is hunting for a specific hour they know
 * exists, and a clever custom widget is a thing to learn rather than use.
 */
export function FilterBar({
  filters,
  projects,
  today,
  weekStartDay,
  onChange,
}: {
  filters: Filters
  projects: Array<Doc<"projects">>
  today: string
  weekStartDay: number
  onChange: (next: Filters | ((current: Filters) => Filters)) => void
}) {
  /*
   * Arrow keys step the period.
   *
   * Bound at the document so they work wherever the eye is — but suppressed
   * while focus is in a text field, a select, or anything contenteditable,
   * where `←` and `→` mean "move the caret". Stealing them there would make
   * the search box unusable, which is the control most likely to have focus.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
      const target = event.target
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
      ) {
        return
      }
      event.preventDefault()
      onChange((current) => stepPeriod(current, event.key === "ArrowLeft" ? -1 : 1))
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onChange])

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-0.5">
          <IconButton
            label="Previous period"
            onClick={() => onChange((f) => stepPeriod(f, -1))}
          >
            <ChevronLeft className="size-4" />
          </IconButton>
          <IconButton label="Next period" onClick={() => onChange((f) => stepPeriod(f, 1))}>
            <ChevronRight className="size-4" />
          </IconButton>
        </div>

        <div className="flex items-center gap-1">
          {(["day", "week", "month"] as const).map((period) => (
            <Chip
              key={period}
              active={filters.period === period}
              onClick={() =>
                onChange((f) => periodFilters(period, today, weekStartDay, f))
              }
            >
              {period === "day" ? "Day" : period === "week" ? "Week" : "Month"}
            </Chip>
          ))}
        </div>

        <DateRangePicker
          from={filters.from}
          to={filters.to}
          period={filters.period}
          today={today}
          weekStartDay={weekStartDay}
          onChange={(range) => onChange((f) => ({ ...f, period: "custom", ...range }))}
        />
      </div>

      <FilterControls filters={filters} projects={projects} onChange={onChange} />

      {/*
        The awkward cases, one click each. These are the three questions
        someone actually asks a tracker's history — "what did I forget to
        file", "what did I forget to describe", "what did I start by
        accident" — and each is otherwise a manual scan of a month.
      */}
      <div className="flex flex-wrap items-center gap-2">
        <PresetChip filters={filters} preset="no-project" onChange={onChange}>
          No project
        </PresetChip>
        <PresetChip filters={filters} preset="no-note" onChange={onChange}>
          No note
        </PresetChip>
        <PresetChip filters={filters} preset="under-a-minute" onChange={onChange}>
          Under a minute
        </PresetChip>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

function PresetChip({
  filters,
  preset,
  onChange,
  children,
}: {
  filters: Filters
  preset: Preset
  onChange: (next: (f: Filters) => Filters) => void
  children: React.ReactNode
}) {
  const active = filters.presets.includes(preset)
  return (
    <Chip
      active={active}
      onClick={() =>
        onChange((f) => ({
          ...f,
          presets: active
            ? f.presets.filter((p) => p !== preset)
            : [...f.presets, preset],
        }))
      }
    >
      {children}
    </Chip>
  )
}

function IconButton({
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
        "rounded-md border border-edge p-1.5 text-muted-foreground transition-colors",
        "hover:text-foreground motion-reduce:transition-none",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      )}
    >
      {children}
    </button>
  )
}
