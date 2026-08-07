import { useEffect } from "react"
import { ChevronLeft, ChevronRight, Search } from "lucide-react"
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

        <div className="flex items-center gap-1.5">
          <DateInput
            label="From"
            value={filters.from}
            onChange={(from) => onChange((f) => ({ ...f, period: "custom", from }))}
          />
          <span aria-hidden="true" className="text-muted-foreground">
            –
          </span>
          <DateInput
            label="To"
            value={filters.to}
            onChange={(to) => onChange((f) => ({ ...f, period: "custom", to }))}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="relative flex min-w-[12rem] flex-1 items-center">
          <Search
            aria-hidden="true"
            className="absolute left-2 size-3.5 text-muted-foreground"
          />
          <span className="sr-only">Search titles, notes and projects</span>
          <input
            value={filters.text}
            onChange={(event) => {
              const text = event.target.value
              onChange((f) => ({ ...f, text }))
            }}
            placeholder="Search titles, notes and projects"
            className={cn(
              "w-full rounded-md border border-edge-soft bg-ground py-1.5 pr-2 pl-7",
              "text-sm placeholder:text-muted-foreground",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            )}
          />
        </label>

        <select
          value={filters.projectId ?? "all"}
          aria-label="Project"
          onChange={(event) => {
            const value = event.target.value
            onChange((f) => ({ ...f, projectId: value === "all" ? null : value }))
          }}
          className={cn(
            "rounded-md border border-edge-soft bg-ground px-2 py-1.5 text-sm",
            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          )}
        >
          <option value="all">All projects</option>
          {/* "" is the sentinel for "no project" — a real, findable state
              rather than the absence of a choice. */}
          <option value="">No project</option>
          {projects.map((project) => (
            <option key={project._id} value={project._id}>
              {project.name}
              {project.archived ? " (archived)" : ""}
            </option>
          ))}
        </select>

        <Chip
          active={filters.billableOnly}
          onClick={() => onChange((f) => ({ ...f, billableOnly: !f.billableOnly }))}
        >
          Billable
        </Chip>
      </div>

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

function DateInput({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label>
      <span className="sr-only">{label}</span>
      <input
        type="date"
        value={value}
        // The native picker emits "" mid-edit, and an empty bound would make
        // the range meaningless — so a half-typed date is ignored rather than
        // applied.
        onChange={(event) => {
          if (event.target.value !== "") onChange(event.target.value)
        }}
        className={cn(
          "rounded-md border border-edge-soft bg-ground px-2 py-1 text-sm tabular",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        )}
      />
    </label>
  )
}

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

/**
 * State carried by weight and a border, never hue alone — and `aria-pressed`
 * is what actually says "on" to anyone reading neither.
 */
function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "rounded-full border px-2.5 py-1 text-xs transition-colors",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        "motion-reduce:transition-none",
        active
          ? "border-edge bg-surface-raised font-medium text-foreground"
          : "border-edge-soft text-muted-foreground hover:text-foreground"
      )}
    >
      {children}
    </button>
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
        "rounded-md border border-edge-soft p-1.5 text-muted-foreground transition-colors",
        "hover:text-foreground motion-reduce:transition-none",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      )}
    >
      {children}
    </button>
  )
}
