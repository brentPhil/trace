import { useCallback, useRef } from "react"
import { useConvexMutation } from "@convex-dev/react-query"
import { useLatest } from "@/hooks/use-latest"
import { newClientKey } from "@/lib/client-key"
import { applyTimeEdit } from "@shared/entryTimes"
import {
  dropEverywhere,
  insertEverywhere,
  moveEverywhere,
  patchEverywhere,
} from "@/lib/offline/optimistic-entries"
import { api } from "../../convex/_generated/api"
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
  const updateMutation = useLatest(
    useConvexMutation(api.entries.update).withOptimisticUpdate((localStore, args) => {
      patchEverywhere(localStore, args.entryId, (entry) => ({
        ...entry,
        ...(args.title !== undefined ? { title: args.title } : {}),
        ...(args.note !== undefined
          ? { note: args.note.trim() === "" ? undefined : args.note.trim() }
          : {}),
        ...(args.billable !== undefined ? { billable: args.billable } : {}),
        ...(args.projectId !== undefined
          ? { projectId: args.projectId ?? undefined }
          : {}),
        ...(args.tagIds !== undefined ? { tagIds: args.tagIds } : {}),
      }))
    })
  )

  const updateManyMutation = useLatest(
    useConvexMutation(api.entries.updateMany).withOptimisticUpdate((localStore, args) => {
      // `patchEverywhere` per id, so a sitting's members move together in the
      // same commit rather than one row at a time. The patch body is the same
      // one `update` applies — kept identical deliberately, because two
      // spellings of "what this write does locally" is how the log and the
      // server start disagreeing about a note.
      for (const entryId of args.entryIds) {
        patchEverywhere(localStore, entryId, (entry) => ({
          ...entry,
          ...(args.title !== undefined ? { title: args.title } : {}),
          ...(args.note !== undefined
            ? { note: args.note.trim() === "" ? undefined : args.note.trim() }
            : {}),
          ...(args.billable !== undefined ? { billable: args.billable } : {}),
          ...(args.projectId !== undefined
            ? { projectId: args.projectId ?? undefined }
            : {}),
          ...(args.tagIds !== undefined ? { tagIds: args.tagIds } : {}),
        }))
      }
    })
  )

  const editTimeMutation = useLatest(
    useConvexMutation(api.entries.editTime).withOptimisticUpdate((localStore, args) => {
      const now = Date.now()
      // A `day` edit is the only one that can move a row off the range it is
      // rendered in, so it is the only one that needs the evicting writer.
      const write = args.field === "day" ? moveEverywhere : patchEverywhere
      write(localStore, args.entryId, (entry) => {
        // The SAME pure function the mutation runs. This is the payoff for
        // keeping the reconciliation rule out of Convex: the optimistic result
        // and the authoritative one cannot disagree, so the row never settles
        // to a different set of times a moment after the user let go.
        const result = applyTimeEdit(
          {
            startedAt: entry.startedAt,
            endedAt: entry.endedAt,
            durationMs: entry.durationMs,
          },
          { field: args.field, value: args.value },
          now
        )
        // A refusal is left for the server to report. Painting a rejected edit
        // and then snapping it back would be worse than a brief nothing.
        return result.ok ? { ...entry, ...result.times } : entry
      })
    })
  )

  const removeMutation = useLatest(
    useConvexMutation(api.entries.remove).withOptimisticUpdate((localStore, args) => {
      dropEverywhere(localStore, args.entryId)
    })
  )

  const removeManyMutation = useLatest(
    useConvexMutation(api.entries.removeMany).withOptimisticUpdate((localStore, args) => {
      for (const entryId of new Set(args.entryIds)) dropEverywhere(localStore, entryId)
    })
  )

  // An optimistic update only receives the mutation's own args, and `restore`
  // sends nothing but an id — there is no row left in the cache to read, that
  // being what "deleted" means. The snapshot is parked here for the update to
  // find. Configuring the mutation per-call instead would rebuild it on every
  // undo and lose Convex's own rollback bookkeeping.
  const pendingRestore = useRef(new Map<string, Entry>())

  const restoreMutation = useLatest(
    useConvexMutation(api.entries.restore).withOptimisticUpdate((localStore, args) => {
      const entry = pendingRestore.current.get(args.entryId)
      if (entry !== undefined) insertEverywhere(localStore, entry)
    })
  )

  const restoreManyMutation = useLatest(
    useConvexMutation(api.entries.restoreMany).withOptimisticUpdate((localStore, args) => {
      for (const entryId of new Set(args.entryIds)) {
        const entry = pendingRestore.current.get(entryId)
        if (entry !== undefined) insertEverywhere(localStore, entry)
      }
    })
  )

  // No `useLatest`: plain `useMutation` IS memoised, so this one is already
  // stable. Wrapping it would add indirection that says nothing.
  const createMutation = useConvexMutation(api.entries.create)

  const update = useCallback(
    async (args: {
      entryId: Id<"timeEntries">
      title?: string
      note?: string
      projectId?: Id<"projects"> | null
      tagIds?: Array<Id<"tags">>
      billable?: boolean
    }) => {
      await updateMutation(args)
    },
    [updateMutation]
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
      await updateManyMutation(args)
    },
    [updateManyMutation]
  )

  const editTime = useCallback(
    async (entryId: Id<"timeEntries">, field: TimeEdit["field"], value: number) => {
      return await editTimeMutation({ entryId, field, value })
    },
    [editTimeMutation]
  )

  const remove = useCallback(
    async (entryId: Id<"timeEntries">) => await removeMutation({ entryId }),
    [removeMutation]
  )

  const removeMany = useCallback(
    async (entryIds: Array<Id<"timeEntries">>) =>
      await removeManyMutation({ entryIds: [...new Set(entryIds)] }),
    [removeManyMutation]
  )

  /**
   * Undo.
   *
   * Takes the whole snapshot rather than just an id so the row can be put back
   * on screen in the same frame the user clicks. The toast is holding the
   * snapshot anyway — it needs the title to say what it deleted.
   */
  const restore = useCallback(
    async (entry: Entry) => {
      pendingRestore.current.set(entry._id, entry)
      try {
        return await restoreMutation({ entryId: entry._id })
      } finally {
        pendingRestore.current.delete(entry._id)
      }
    },
    [restoreMutation]
  )

  const restoreMany = useCallback(
    async (entries: Array<Entry>) => {
      const uniqueEntries = [...new Map(entries.map((entry) => [entry._id, entry])).values()]
      for (const entry of uniqueEntries) pendingRestore.current.set(entry._id, entry)
      try {
        return await restoreManyMutation({
          entryIds: uniqueEntries.map((entry) => entry._id),
        })
      } finally {
        for (const entry of uniqueEntries) pendingRestore.current.delete(entry._id)
      }
    },
    [restoreManyMutation]
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
    }) => {
      // Minted here rather than in the form, so a resubmit after a failure
      // reuses nothing and a retry of THIS call is deduplicated by the server.
      return await createMutation({ clientKey: newClientKey(), ...args })
    },
    [createMutation]
  )

  return { update, updateMany, editTime, remove, removeMany, restore, restoreMany, create }
}
