import { Trash2, X } from "lucide-react"
import { Button } from "@/components/ui/button"

/**
 * What a non-empty selection can do to itself.
 *
 * Presentational on purpose: it holds no selection state and reaches for no
 * mutation. `EntryLog` owns the set, decides what "delete" means for it, and
 * raises the one Undo toast — the same rule the rows already follow, so there
 * stays exactly one place an entry is written from.
 *
 * COUNT IS UNDERLYING RECORDS, not rows on screen. A collapsed sitting is one
 * row representing many entries, and the delete it triggers destroys all of
 * them; a bar reading "1 record selected" before removing four would be a lie
 * at the only moment the number matters.
 */
export function BulkEntryActions({
  count,
  deleting,
  onDelete,
  onClear,
}: {
  count: number
  /** Delete is in flight. Only Delete goes quiet — see below. */
  deleting: boolean
  onDelete: () => void
  onClear: () => void
}) {
  return (
    <div
      role="toolbar"
      aria-label="Selected entry actions"
      className="flex items-center gap-3 rounded-lg border border-border bg-popover px-3 py-2 shadow-lg"
    >
      <span className="text-sm font-medium">
        {count} {count === 1 ? "record" : "records"} selected
      </span>
      <Button
        variant="destructive"
        size="sm"
        disabled={deleting}
        aria-label="Delete selected records"
        onClick={onDelete}
      >
        <Trash2 /> Delete
      </Button>
      {/* Deliberately NOT disabled while deleting. Clearing is local state and
       * cannot conflict with an in-flight delete, and a request that hangs
       * would otherwise leave the reader pinned to a selection with no way out
       * but a reload. */}
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Clear selection"
        onClick={onClear}
      >
        <X />
      </Button>
    </div>
  )
}
