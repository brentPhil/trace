import { useCallback, useRef } from "react"
import { useConvexMutation } from "@convex-dev/react-query"
import { useLatest } from "@/hooks/use-latest"
import { newClientKey } from "@/lib/client-key"
import { applyTimeEdit } from "@shared/entryTimes"
import { api } from "../../convex/_generated/api"
import type { OptimisticLocalStore } from "convex/browser"
import type { TimeEdit } from "@shared/entryTimes"
import type { Doc, Id } from "../../convex/_generated/dataModel"

type Entry = Doc<"timeEntries">

/**
 * The log is read through BOTH `listRange` and `listPage` — the week-totals
 * strip still reads a plain range, but the log on Timer (the app's primary
 * surface) now renders from the paginated `listPage`. Both queries' args
 * (fromMs/toMs, or a page's cursor) depend on the caller's timezone and
 * window, so an optimistic update cannot name the query instance it needs to
 * patch. `getAllQueries` hands back every live subscription with its args,
 * which is the only way to keep a row consistent across every range and every
 * page mounted at the same time.
 *
 * Without patching `listPage` too, a save, edit, classify, delete or undo
 * would update the week total (still `listRange`-backed) while the row on
 * screen sat there unchanged until the next server round trip — an
 * asymmetry that is worse than no optimism at all, because the two numbers on
 * screen visibly disagree in the meantime.
 *
 * `getRunning` is patched alongside it, because the running entry appears in
 * BOTH the timer bar and the top of the log. Updating one and not the other is
 * how the same entry ends up showing two different titles on one screen.
 */
function patchEverywhere(
  localStore: OptimisticLocalStore,
  entryId: Id<"timeEntries">,
  patch: (entry: Entry) => Entry
): void {
  const running = localStore.getQuery(api.entries.getRunning, {})
  if (running != null && running._id === entryId) {
    localStore.setQuery(api.entries.getRunning, {}, patch(running))
  }

  for (const { args, value } of localStore.getAllQueries(api.entries.listRange)) {
    if (value === undefined) continue
    const index = value.findIndex((entry) => entry._id === entryId)
    if (index === -1) continue

    const next = [...value]
    next[index] = patch(value[index])
    // Re-sorted because a time edit can move a row past its neighbours, and the
    // list is newest-first. Skipping this would let a row visibly jump when the
    // server response lands and re-sorts it for real.
    next.sort((a, b) => b.startedAt - a.startedAt)
    localStore.setQuery(api.entries.listRange, args, next)
  }

  for (const { args, value } of localStore.getAllQueries(api.entries.listPage)) {
    if (value === undefined) continue
    const index = value.page.findIndex((entry) => entry._id === entryId)
    if (index === -1) continue

    const page = [...value.page]
    page[index] = patch(page[index])
    // Same re-sort as the `listRange` branch above, and for the same reason —
    // a page is itself newest-first.
    page.sort((a, b) => b.startedAt - a.startedAt)
    localStore.setQuery(api.entries.listPage, args, { ...value, page })
  }
}

function dropEverywhere(
  localStore: OptimisticLocalStore,
  entryId: Id<"timeEntries">
): void {
  const running = localStore.getQuery(api.entries.getRunning, {})
  if (running != null && running._id === entryId) {
    localStore.setQuery(api.entries.getRunning, {}, null)
  }

  for (const { args, value } of localStore.getAllQueries(api.entries.listRange)) {
    if (value === undefined) continue
    const next = value.filter((entry) => entry._id !== entryId)
    if (next.length !== value.length) localStore.setQuery(api.entries.listRange, args, next)
  }

  for (const { args, value } of localStore.getAllQueries(api.entries.listPage)) {
    if (value === undefined) continue
    const page = value.page.filter((entry) => entry._id !== entryId)
    if (page.length !== value.page.length) {
      localStore.setQuery(api.entries.listPage, args, { ...value, page })
    }
  }
}

function insertEverywhere(localStore: OptimisticLocalStore, entry: Entry): void {
  for (const { args, value } of localStore.getAllQueries(api.entries.listRange)) {
    if (value === undefined) continue
    if (value.some((row) => row._id === entry._id)) continue
    // Only into ranges that actually contain it. Without the bounds check an
    // undo would flash the row into every mounted range, including ones for
    // days it does not belong to.
    if (entry.startedAt < args.fromMs || entry.startedAt >= args.toMs) continue
    const next = [...value, entry].sort((a, b) => b.startedAt - a.startedAt)
    localStore.setQuery(api.entries.listRange, args, next)
  }

  for (const { args, value } of localStore.getAllQueries(api.entries.listPage)) {
    if (value === undefined) continue
    if (value.page.some((row) => row._id === entry._id)) continue
    if (entry.startedAt < args.fromMs || entry.startedAt >= args.toMs) continue
    const page = [...value.page, entry].sort((a, b) => b.startedAt - a.startedAt)
    localStore.setQuery(api.entries.listPage, args, { ...value, page })
  }
}

/**
 * Every write that edits an entry that already exists.
 *
 * Split from `useEntryMutations` (start/stop/discard) along the same line the
 * tests are: that hook is about the one-running invariant, this one is about
 * not corrupting a row that is already recorded.
 */
export function useEntryEditMutations() {
  const setNoteMutation = useLatest(
    useConvexMutation(api.entries.setNote).withOptimisticUpdate((localStore, args) => {
      const note = args.note.trim()
      patchEverywhere(localStore, args.entryId, (entry) => ({
        ...entry,
        // undefined, not "" — matching the server, so the "N of M noted" count
        // does not flicker by one while the mutation is in flight.
        note: note === "" ? undefined : note,
      }))
    })
  )

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

  const editTimeMutation = useLatest(
    useConvexMutation(api.entries.editTime).withOptimisticUpdate((localStore, args) => {
      const now = Date.now()
      patchEverywhere(localStore, args.entryId, (entry) => {
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

  // No `useLatest`: plain `useMutation` IS memoised, so this one is already
  // stable. Wrapping it would add indirection that says nothing.
  const createMutation = useConvexMutation(api.entries.create)

  const setNote = useCallback(
    async (entryId: Id<"timeEntries">, note: string) => {
      await setNoteMutation({ entryId, note })
    },
    [setNoteMutation]
  )

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

  return { setNote, update, editTime, remove, restore, create }
}
