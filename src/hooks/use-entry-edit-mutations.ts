import { useCallback } from "react"
import { useOutboxMutation } from "@/lib/offline/outbox-provider"
import { newClientKey } from "@/lib/client-key"
import type { TimeEdit } from "@shared/entryTimes"
import type { Doc, Id } from "../../convex/_generated/dataModel"

type Entry = Doc<"timeEntries">

/**
 * Every write that edits an entry that already exists.
 *
 * Split from `useEntryMutations` (start/stop/discard) along the same line the
 * tests are: that hook is about the one-running invariant, this one is about
 * not corrupting a row that is already recorded.
 */
export function useEntryEditMutations() {
  const updateOp = useOutboxMutation("entries.update")
  const updateManyOp = useOutboxMutation("entries.updateMany")
  const editTimeOp = useOutboxMutation("entries.editTime")
  const removeOp = useOutboxMutation("entries.remove")
  const removeManyOp = useOutboxMutation("entries.removeMany")
  const restoreOp = useOutboxMutation("entries.restore")
  const restoreManyOp = useOutboxMutation("entries.restoreMany")
  const createOp = useOutboxMutation("entries.create")

  const update = useCallback(
    async (args: {
      entryId: Id<"timeEntries">
      title?: string
      note?: string
      projectId?: Id<"projects"> | null
      tagIds?: Array<Id<"tags">>
      billable?: boolean
    }) => {
      await updateOp(args)
    },
    [updateOp]
  )

  const updateMany = useCallback(
    async (args: {
      entryIds: Array<Id<"timeEntries">>
      title?: string
      note?: string
      projectId?: Id<"projects"> | null
      tagIds?: Array<Id<"tags">>
      billable?: boolean
    }) => {
      await updateManyOp(args)
    },
    [updateManyOp]
  )

  /** Returns nothing: the reconciled times are not knowable synchronously,
   *  and every call site discards them. See the `entries.editTime` kind. */
  const editTime = useCallback(
    async (entryId: Id<"timeEntries">, field: TimeEdit["field"], value: number) => {
      await editTimeOp({ entryId, field, value })
    },
    [editTimeOp]
  )

  const remove = useCallback(
    async (entryId: Id<"timeEntries">) => (await removeOp({ entryId })).result,
    [removeOp]
  )

  const removeMany = useCallback(
    async (entryIds: Array<Id<"timeEntries">>) =>
      (await removeManyOp({ entryIds: [...new Set(entryIds)] })).result,
    [removeManyOp]
  )

  /** Undo. The snapshot rides on the op as `local`, so a restore journaled
   *  offline can still put the row back on screen after a reload. */
  const restore = useCallback(
    async (entry: Entry) => (await restoreOp({ entryId: entry._id }, { entry })).result,
    [restoreOp]
  )

  const restoreMany = useCallback(
    async (entries: Array<Entry>) => {
      const unique = [...new Map(entries.map((entry) => [entry._id, entry])).values()]
      return (await restoreManyOp({ entryIds: unique.map((e) => e._id) }, { entries: unique })).result
    },
    [restoreManyOp]
  )

  const create = useCallback(
    async (args: {
      title?: string
      note?: string
      startedAt: number
      endedAt: number
      projectId?: Id<"projects">
      tagIds?: Array<Id<"tags">>
      billable?: boolean
    }) => (await createOp({ clientKey: newClientKey(), ...args })).result,
    [createOp]
  )

  return { update, updateMany, editTime, remove, removeMany, restore, restoreMany, create }
}
