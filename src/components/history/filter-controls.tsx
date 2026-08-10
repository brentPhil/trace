import { Search } from "lucide-react"
import { NO_PROJECT } from "@shared/entryFilter"
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
        {/* A real, findable state rather than the absence of a choice.
            The sentinel is named in convex/lib/entryFilter.ts, which is where
            the predicate reads it back. */}
        <option value={NO_PROJECT}>No project</option>
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

/** What "on" looks like for every chip that is not about money. */
const CHIP_ACTIVE_NEUTRAL =
  "border-edge-raised bg-surface-raised font-medium text-foreground"

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
  activeClassName = CHIP_ACTIVE_NEUTRAL,
  onClick,
  children,
}: {
  active: boolean
  /**
   * The ONLY thing a chip is allowed to vary, and the only thing that ever
   * differed between the two chips this file used to hold. The hit target, the
   * focus ring, the reduced-motion opt-out and the inactive state are not
   * negotiable per chip — the accessibility fixes above land once or not at
   * all.
   */
  activeClassName?: string
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
          ? activeClassName
          : "border-edge-raised text-muted-foreground hover:text-foreground"
      )}
    >
      {children}
    </button>
  )
}

/**
 * Billable gets a brass ACTIVE state rather than the neutral one above:
 * DESIGN.md reserves brass for money, and this is the one filter that means
 * money. Rendering it as a plain `Chip` — as the pre-extraction code did — was
 * the inconsistency; every other chip on either page (period, no-project,
 * no-note, under-a-minute) stays neutral because none of them are.
 *
 * 3.84:1 on ground, 3.73:1 on surface — measured composited the way a browser
 * does it, in gamma-encoded sRGB. Clears 3:1 in both bands this bar appears
 * in, so it keeps brass.
 */
function BillableChip({ active, onClick }: { active: boolean; onClick: () => void }) {
  return (
    <Chip
      active={active}
      activeClassName="border-brass/60 font-medium text-brass"
      onClick={onClick}
    >
      Billable
    </Chip>
  )
}
