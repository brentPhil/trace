import { Search } from "lucide-react"
import { NO_PROJECT_FILTER } from "@shared/entryFilter"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { NO_PROJECT_LABEL } from "@/lib/report-series"
import type { QuickFilters } from "@/lib/history-filters"
import type { Doc } from "../../../convex/_generated/dataModel"

/**
 * The three filters a filterable list offers: text, project, billable.
 *
 * ONE PAGE DRAWS THIS NOW. /timer used to as well — the same three controls in
 * a Surface band — and it does not any more: a text search over a log whose
 * range was all of history could only ever describe the pages already
 * paginated in, and `FilteredLogStatus` existed to keep saying so. /timer has a
 * date range instead, and a search over history is what /reports is for.
 *
 * Still separate from the band and still generic over `T`, because the split is
 * what let the two pages compose these controls differently in the first place
 * — and `QuickFilters` is still the honest lower bound on what this reads: the
 * three fields it touches, not a whole `Filters` with a period in it.
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
            the predicate reads it back; the text is the SAME label the
            export pipeline prints (report-series.ts), so a reader never sees
            "No project" here and something else on the document. */}
        <option value={NO_PROJECT_FILTER}>{NO_PROJECT_LABEL}</option>
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
    <Button
      type="button"
      variant="quiet"
      size="chip"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        // WCAG 2.2 SC 2.5.8, 24x24: a chip's own box is ~22px and the band it
        // sits in is measured, so the target grows through a pseudo-element
        // rather than through padding. Exactly -2px vertically: 22 + 2 + 2.
        "relative after:absolute after:inset-x-0 after:-inset-y-0.5 after:content-['']",
        "border-edge-raised motion-reduce:transition-none",
        active ? activeClassName : null
      )}
    >
      {children}
    </Button>
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
