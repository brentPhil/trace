import { Chip } from "@/components/history/filter-controls"
import { PRESET_LABELS } from "@/lib/history-filters"
import type { Filters, Preset } from "@/lib/history-filters"

/**
 * The awkward cases, one click each.
 *
 * These are the three questions someone actually asks a tracker's history —
 * "what did I forget to file", "what did I forget to describe", "what did I
 * start by accident" — and each is otherwise a manual scan of a month.
 *
 * They narrow WITHIN a period rather than choosing one, which is why they moved
 * out of `FilterBar` alongside `FilterControls` and into the band with it: the
 * row above picks the period, everything in the band cuts into it.
 */
export function PresetChips({
  filters,
  onChange,
}: {
  filters: Filters
  onChange: (next: (f: Filters) => Filters) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* The labels come from `PRESET_LABELS` rather than being typed here:
          /invoices/new has to name the same three chips when a link carries
          them, and that page decides whether to bill a client. */}
      {(["no-project", "no-note", "under-a-minute"] as const).map((preset) => (
        <PresetChip key={preset} filters={filters} preset={preset} onChange={onChange}>
          {PRESET_LABELS[preset]}
        </PresetChip>
      ))}
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
