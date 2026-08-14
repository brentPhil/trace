import type { Id } from "../../convex/_generated/dataModel"

type EntryId = Id<"timeEntries">

export type SelectionState = "unchecked" | "checked" | "indeterminate"

const unique = (ids: Iterable<EntryId>): Array<EntryId> => [...new Set(ids)]

export function selectionState(
  ids: Iterable<EntryId>,
  selectedIds: ReadonlySet<EntryId>
): SelectionState {
  const represented = unique(ids)
  if (represented.length === 0) return "unchecked"
  const selectedCount = represented.filter((entryId) => selectedIds.has(entryId)).length
  if (selectedCount === 0) return "unchecked"
  if (selectedCount === represented.length) return "checked"
  return "indeterminate"
}

export function toggleSelection(
  selectedIds: ReadonlySet<EntryId>,
  ids: Iterable<EntryId>
): Set<EntryId> {
  const represented = unique(ids)
  const next = new Set(selectedIds)
  const selecting = selectionState(represented, selectedIds) === "unchecked"
  for (const entryId of represented) {
    if (selecting) next.add(entryId)
    else next.delete(entryId)
  }
  return next
}

export function pruneSelection(
  selectedIds: ReadonlySet<EntryId>,
  liveIds: Iterable<EntryId>
): Set<EntryId> {
  const live = new Set(liveIds)
  return new Set([...selectedIds].filter((entryId) => live.has(entryId)))
}
