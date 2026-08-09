import { Search } from "lucide-react"
import { cn } from "@/lib/utils"
import type { QuickFilters } from "@/lib/history-filters"
import type { Doc } from "../../../convex/_generated/dataModel"

/**
 * The three filters every filterable list offers: text, project, billable.
 *
 * Reports wraps these in a date range and preset chips it alone needs; Timer
 * has no bounded range to build either on top of, so this is its entire bar.
 * Pulled out once so there is one rendering of these three controls rather
 * than two that could drift — the same reasoning `matches` in
 * `history-filters.ts` exists for.
 *
 * Generic over `T` so either page's filter state works: Reports threads its
 * full `Filters` through unchanged, Timer threads its narrower `QuickFilters`.
 */
export function FilterControls<T extends QuickFilters>({
  filters,
  projects,
  onChange,
}: {
  filters: T
  projects: Array<Doc<"projects">>
  onChange: (next: (current: T) => T) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="relative flex min-w-[12rem] max-w-sm flex-1 items-center">
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
            "w-full rounded-md border border-edge bg-ground py-1.5 pr-2 pl-7",
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
          "rounded-md border border-edge bg-ground px-2 py-1.5 text-sm",
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

      <BillableChip
        active={filters.billableOnly}
        onClick={() => onChange((f) => ({ ...f, billableOnly: !f.billableOnly }))}
      />
    </div>
  )
}

/**
 * State carried by weight and a border, never hue alone — and `aria-pressed`
 * is what actually says "on" to anyone reading neither.
 *
 * `border-edge-raised`, not `border-edge`, in BOTH states. A chip carries no
 * fill of its own when inactive, and on /timer it sits inside a `bg-surface`
 * band where `--edge` measures 2.90:1 — under SC 1.4.11's 3:1. The active
 * state is worse, not better: a `bg-surface-raised` fill puts `--edge` at
 * 2.60:1 on the inside and 2.90:1 on the outside, failing on both. See
 * styles.css for the token and styles.contrast.test.ts for the numbers.
 */
export function Chip({
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
        "touch-target rounded-full border px-2.5 py-1 text-xs transition-colors",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        "motion-reduce:transition-none",
        active
          ? "border-edge-raised bg-surface-raised font-medium text-foreground"
          : "border-edge-raised text-muted-foreground hover:text-foreground"
      )}
    >
      {children}
    </button>
  )
}

/**
 * Billable gets its own chip rather than the generic one above it: DESIGN.md
 * reserves brass for money, and this is the one filter that means money.
 * Using the neutral `Chip` here — as the pre-extraction code did — was the
 * inconsistency; every other chip on either page (period, no-project, no-note,
 * under-a-minute) stays neutral because none of them are.
 */
function BillableChip({ active, onClick }: { active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "touch-target rounded-full border px-2.5 py-1 text-xs transition-colors",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        "motion-reduce:transition-none",
        active
          ? // 3.84:1 on ground, 3.73:1 on surface — measured composited the
            // way a browser does it, in gamma-encoded sRGB. Clears 3:1 in
            // both bands this bar appears in, so it keeps brass.
            "border-brass/60 font-medium text-brass"
          : // Fill-less, and on /timer this bar sits on `bg-surface`. See
            // `Chip` above.
            "border-edge-raised text-muted-foreground hover:text-foreground"
      )}
    >
      Billable
    </button>
  )
}
