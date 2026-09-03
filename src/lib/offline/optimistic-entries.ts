import { insertAtPosition } from "convex/react"
import { applyTimeEdit } from "@shared/entryTimes"
import { optimisticIdFor } from "@/lib/optimistic-id"
import { api } from "../../../convex/_generated/api"
import type { OptimisticLocalStore } from "convex/browser"
import type { TimeEdit } from "@shared/entryTimes"
import type { Doc, Id } from "../../../convex/_generated/dataModel"
import type { OpLocal } from "./op-types"

export type Entry = Doc<"timeEntries">

/**
 * Optimistic updates come from Convex's own `withOptimisticUpdate`, not from
 * TanStack Query's.
 *
 * Verified end-to-end rather than assumed: ConvexQueryClient subscribes to each
 * watch and pushes `watch.localQueryResult()` — which already includes
 * optimistic state — into `queryClient.setQueryData`. So a Convex optimistic
 * update propagates into the TanStack cache that `convexQuery` reads from, and
 * there is exactly one optimistic mechanism in the app rather than two that
 * could disagree.
 *
 * This hook only ever touches `getRunning`, a plain reactive query, so that
 * part is simple. The paginated `listPage` the log itself renders from is a
 * different cache shape — `page` arrays inside pagination results rather than
 * a bare array — which is why `use-entry-edit-mutations.ts`'s `patchEverywhere`
 * and friends walk `getAllQueries(api.entries.listPage)` explicitly instead of
 * relying on this same trick.
 */
export function optimisticEntry(args: {
  clientKey: string
  title: string
  startedAt: number
  billable: boolean
  projectId?: Id<"projects">
  tagIds: Array<Id<"tags">>
}): Doc<"timeEntries"> {
  return {
    // Derived from the clientKey, NOT crypto.randomUUID(). Convex re-runs every
    // pending optimistic update on every server transition, so a random id here
    // mints a different one each time — the placeholder would not even be
    // stable within the in-flight window, and anything keyed on it would see a
    // fresh "entry" whenever an unrelated subscription updated.
    _id: optimisticIdFor(args.clientKey) as unknown as Id<"timeEntries">,
    _creationTime: args.startedAt,
    userId: "",
    clientKey: args.clientKey,
    title: args.title,
    startedAt: args.startedAt,
    endedAt: null,
    durationMs: null,
    projectId: args.projectId,
    tagIds: args.tagIds,
    billable: args.billable,
    source: "web",
    updatedAt: args.startedAt,
    deletedAt: null,
  }
}

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
export function patchEverywhere(
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

export function dropEverywhere(
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

/**
 * The re-dating case, which `patchEverywhere` cannot express.
 *
 * That function rewrites a row wherever it finds it. Re-dating moves a row
 * BETWEEN ranges — off the day it was on and onto the day it went to — so the
 * entry has to be evicted from the ranges and pages it has left and inserted
 * into the ones it has entered, including ones that never held it. Patching in
 * place would leave it visible on the old day until the server replied.
 *
 * Which is exactly a drop followed by an insert, so it is written as one. That
 * is not only shorter: `insertEverywhere` already carries the pagination
 * reasoning `listPage` needs — one `usePaginatedQuery` subscription is many
 * cached pages sharing a range, so a naive per-page insert duplicates the row.
 * Re-deriving that here would have been a second place to get it wrong, and the
 * first version of this function got it wrong by simply not handling `listPage`
 * at all — which broke precisely on Reports, the surface most likely to be
 * re-dating anything.
 *
 * The row is located once, from anywhere it is loaded, because a range it is
 * moving INTO has no copy to patch from.
 */
export function moveEverywhere(
  localStore: OptimisticLocalStore,
  entryId: Id<"timeEntries">,
  patch: (entry: Entry) => Entry
): void {
  const running = localStore.getQuery(api.entries.getRunning, {})

  let current: Entry | undefined =
    running != null && running._id === entryId ? running : undefined
  if (current === undefined) {
    for (const { value } of localStore.getAllQueries(api.entries.listRange)) {
      const found = value?.find((entry) => entry._id === entryId)
      if (found !== undefined) {
        current = found
        break
      }
    }
  }
  if (current === undefined) {
    for (const { value } of localStore.getAllQueries(api.entries.listPage)) {
      const found = value?.page.find((entry) => entry._id === entryId)
      if (found !== undefined) {
        current = found
        break
      }
    }
  }
  // Nothing loaded to move. The server's response will bring the truth.
  if (current === undefined) return

  const moved = patch(current)

  dropEverywhere(localStore, entryId)
  // AFTER the drop, which clears the running slot on the way past. The entry is
  // re-dated, not stopped — it is still the running one.
  if (running != null && running._id === entryId) {
    localStore.setQuery(api.entries.getRunning, {}, moved)
  }
  insertEverywhere(localStore, moved)
}

export function insertEverywhere(localStore: OptimisticLocalStore, entry: Entry): void {
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

  // listPage is paginated: every page loaded by ONE `usePaginatedQuery`
  // subscription shares the same fromMs/toMs and differs only by
  // `paginationOpts.cursor`. `getAllQueries` hands back one entry per page, so
  // a naive per-page loop (as `listRange`'s above does) inserts a copy into
  // EVERY loaded page — duplicate rows, since `usePaginatedQuery` concatenates
  // pages with no dedup.
  //
  // `insertAtPosition` (from convex/react) is Convex's helper for exactly
  // this: it groups pages by `paginationOpts.id` and inserts into exactly one
  // page by sort key. It has no notion of the fromMs/toMs range filter,
  // though, so calling it unconditionally would still insert into a
  // subscription whose range does not contain the entry (e.g. a Reports
  // query scoped to last month receiving today's restored row). Restrict it
  // to the distinct {fromMs, toMs} pairs that actually contain the entry —
  // the same bounds check the `listRange` branch above uses.
  const pageQueries = localStore.getAllQueries(api.entries.listPage)
  const seenRanges = new Set<string>()
  for (const { args } of pageQueries) {
    const rangeKey = `${args.fromMs}:${args.toMs}`
    if (seenRanges.has(rangeKey)) continue
    seenRanges.add(rangeKey)
    if (entry.startedAt < args.fromMs || entry.startedAt >= args.toMs) continue

    const alreadyPresent = pageQueries.some(
      ({ args: otherArgs, value }) =>
        otherArgs.fromMs === args.fromMs &&
        otherArgs.toMs === args.toMs &&
        value !== undefined &&
        value.page.some((row) => row._id === entry._id)
    )
    if (alreadyPresent) continue

    insertAtPosition({
      paginatedQuery: api.entries.listPage,
      argsToMatch: { fromMs: args.fromMs, toMs: args.toMs },
      sortOrder: "desc",
      sortKeyFromItem: (row) => row.startedAt,
      localQueryStore: localStore,
      item: entry,
    })
  }
}

type StartArgs = {
  clientKey: string
  title?: string
  startedAt?: number
  projectId?: Id<"projects">
  tagIds?: Array<Id<"tags">>
  billable?: boolean
}

export function optimisticStart(store: OptimisticLocalStore, args: StartArgs): void {
  store.setQuery(
    api.entries.getRunning,
    {},
    optimisticEntry({
      clientKey: args.clientKey,
      title: args.title ?? "",
      startedAt: args.startedAt ?? Date.now(),
      billable: args.billable ?? false,
      projectId: args.projectId,
      tagIds: args.tagIds ?? [],
    })
  )
}

export function optimisticStop(store: OptimisticLocalStore): void {
  store.setQuery(api.entries.getRunning, {}, null)
}

export const optimisticDiscard = optimisticStop

export function optimisticSetTitle(
  store: OptimisticLocalStore,
  args: { entryId: Id<"timeEntries">; title: string }
): void {
  const running = store.getQuery(api.entries.getRunning, {})
  if (running != null && running._id === args.entryId) {
    store.setQuery(api.entries.getRunning, {}, { ...running, title: args.title })
  }
}

type UpdateFields = {
  title?: string
  note?: string
  projectId?: Id<"projects"> | null
  tagIds?: Array<Id<"tags">>
  billable?: boolean
}

function applyUpdateFields(entry: Entry, args: UpdateFields): Entry {
  return {
    ...entry,
    ...(args.title !== undefined ? { title: args.title } : {}),
    ...(args.note !== undefined
      ? { note: args.note.trim() === "" ? undefined : args.note.trim() }
      : {}),
    ...(args.billable !== undefined ? { billable: args.billable } : {}),
    ...(args.projectId !== undefined ? { projectId: args.projectId ?? undefined } : {}),
    ...(args.tagIds !== undefined ? { tagIds: args.tagIds } : {}),
  }
}

export function optimisticUpdate(
  store: OptimisticLocalStore,
  args: UpdateFields & { entryId: Id<"timeEntries"> }
): void {
  patchEverywhere(store, args.entryId, (entry) => applyUpdateFields(entry, args))
}

export function optimisticUpdateMany(
  store: OptimisticLocalStore,
  args: UpdateFields & { entryIds: Array<Id<"timeEntries">> }
): void {
  for (const entryId of args.entryIds) {
    patchEverywhere(store, entryId, (entry) => applyUpdateFields(entry, args))
  }
}

export function optimisticEditTime(
  store: OptimisticLocalStore,
  args: { entryId: Id<"timeEntries">; field: TimeEdit["field"]; value: number }
): void {
  const now = Date.now()
  const write = args.field === "day" ? moveEverywhere : patchEverywhere
  write(store, args.entryId, (entry) => {
    const result = applyTimeEdit(
      { startedAt: entry.startedAt, endedAt: entry.endedAt, durationMs: entry.durationMs },
      { field: args.field, value: args.value },
      now
    )
    return result.ok ? { ...entry, ...result.times } : entry
  })
}

export function optimisticRemove(
  store: OptimisticLocalStore,
  args: { entryId: Id<"timeEntries"> }
): void {
  dropEverywhere(store, args.entryId)
}

export function optimisticRemoveMany(
  store: OptimisticLocalStore,
  args: { entryIds: Array<Id<"timeEntries">> }
): void {
  for (const entryId of new Set(args.entryIds)) dropEverywhere(store, entryId)
}

/** `local.entry` is the snapshot the undo toast held; the args carry only an id. */
export function optimisticRestore(
  store: OptimisticLocalStore,
  _args: { entryId: Id<"timeEntries"> },
  local: OpLocal | undefined
): void {
  const entry = local?.entry as Entry | undefined
  if (entry !== undefined) insertEverywhere(store, entry)
}

export function optimisticRestoreMany(
  store: OptimisticLocalStore,
  _args: { entryIds: Array<Id<"timeEntries">> },
  local: OpLocal | undefined
): void {
  const entries = (local?.entries as Entry[] | undefined) ?? []
  for (const entry of entries) insertEverywhere(store, entry)
}

type CreateArgs = {
  clientKey: string
  title?: string
  note?: string
  startedAt: number
  endedAt: number
  projectId?: Id<"projects">
  tagIds?: Array<Id<"tags">>
  billable?: boolean
}

/** A completed entry, on screen before the server has it. New: `create` had no
 *  optimistic update before the outbox, and offline it needs one. */
export function optimisticCreate(store: OptimisticLocalStore, args: CreateArgs): void {
  const base = optimisticEntry({
    clientKey: args.clientKey,
    title: args.title ?? "",
    startedAt: args.startedAt,
    billable: args.billable ?? false,
    projectId: args.projectId,
    tagIds: args.tagIds ?? [],
  })
  const note = args.note?.trim()
  insertEverywhere(store, {
    ...base,
    note: note === undefined || note === "" ? undefined : note,
    endedAt: args.endedAt,
    durationMs: args.endedAt - args.startedAt,
  })
}
