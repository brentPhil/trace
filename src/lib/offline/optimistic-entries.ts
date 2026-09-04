import { insertAtPosition } from "convex/react"
import { applyTimeEdit, entryTimes } from "@shared/entryTimes"
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
 * `optimisticEntry` only ever touches `getRunning`, a plain reactive query, so
 * that part is simple. The paginated `listPage` the log itself renders from is
 * a different cache shape — `page` arrays inside pagination results rather
 * than a bare array — which is why `patchEverywhere` and friends, below in
 * this same file, walk `getAllQueries(api.entries.listPage)` explicitly
 * instead of relying on this same trick.
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

/**
 * The billable flag the server would land on.
 *
 * `start` and `create` both do `args.billable ?? project?.billableByDefault
 * ?? false` against the real row. Painting `?? false` here instead is a
 * visible lie for the whole offline session — the row sits unbillable, and
 * so does every billable total on the page, until the outbox replays. The
 * project list is already in the cache on every authed surface, so the
 * fallback costs a lookup.
 */
function billableFor(
  store: OptimisticLocalStore,
  projectId: Id<"projects"> | undefined,
  explicit: boolean | undefined
): boolean {
  if (explicit !== undefined) return explicit
  if (projectId === undefined) return false
  const project = store.getQuery(api.projects.list, {})?.find((p) => p._id === projectId)
  return project?.billableByDefault ?? false
}

/**
 * Both the running slot AND the lists, unlike the version this replaced.
 *
 * `listRangeImpl`/`listPageImpl` in convex/entries.ts already return running
 * entries — online, the server's next transition supplies the row within
 * milliseconds and nobody notices `getRunning` alone was ever enough.
 * Offline, nothing else does: the day/week totals (`listRange`-backed) never
 * see time being tracked, and `entries.create`'s manual-add path already does
 * `insertEverywhere`, so the two ways of getting a row on screen would
 * otherwise visibly disagree.
 */
export function optimisticStart(store: OptimisticLocalStore, args: StartArgs): void {
  const entry = optimisticEntry({
    clientKey: args.clientKey,
    title: args.title ?? "",
    // MUST NOT BE RELIED ON. Every real call site supplies `startedAt`
    // (`use-entry-mutations.ts` mints it at the click), and it stays optional
    // here only because `entries.start`'s validator declares it
    // `v.optional` — requiring it would make this function unassignable to
    // `kind()`'s `optimistic` slot, which is typed from that validator.
    //
    // The cost of leaning on it changed when `reapply` started running on
    // every query mount rather than once at boot: a caller that omitted
    // `startedAt` would re-mint the running entry with a FRESH timestamp on
    // each mount, visibly resetting the timer. And because `insertEverywhere`
    // dedups by `_id`, `getRunning` would drift while the log row stayed put,
    // so the bar and the log would disagree. Pass it.
    startedAt: args.startedAt ?? Date.now(),
    billable: billableFor(store, args.projectId, args.billable),
    projectId: args.projectId,
    tagIds: args.tagIds ?? [],
  })
  store.setQuery(api.entries.getRunning, {}, entry)
  insertEverywhere(store, entry)
}

type StopArgs = {
  entryId?: Id<"timeEntries">
  endedAt?: number
}

/**
 * The mirror of `closeEntry` in convex/entries.ts, run locally: the entry
 * leaves the running slot but STAYS in the lists, patched with the times the
 * server will land on, rather than disappearing from the screen until
 * reconnect.
 *
 * `args.entryId` names the timer this stop is for — same convention as
 * `stopImpl` — and falls back to whatever is currently running when the
 * caller did not say, which is the only sensible answer for an op replayed
 * from the journal against a store that already has the id.
 */
/**
 * Undoes `optimisticStart`'s placeholder, for a start op `drop` has decided
 * will now never be sent — a stale start, offline for over a day with no
 * closing stop, being the concrete case.
 *
 * Without this the phantom row `optimisticStart` painted survives the drop:
 * it persists across reloads (the snapshot writer has already saved it), and
 * `RunawayBanner` keeps alarming about a timer the outbox has already given
 * up on.
 */
export function unmintStart(store: OptimisticLocalStore, args: StartArgs): void {
  dropEverywhere(store, optimisticIdFor(args.clientKey) as unknown as Id<"timeEntries">)
}

export function optimisticStop(store: OptimisticLocalStore, args: StopArgs = {}): void {
  const running = store.getQuery(api.entries.getRunning, {})
  const entryId = args.entryId ?? running?._id
  store.setQuery(api.entries.getRunning, {}, null)
  if (entryId === undefined) return

  // MUST NOT BE RELIED ON, for the same reason as `optimisticStart`'s
  // `startedAt` default above — see there. `use-entry-mutations.ts` records
  // `endedAt` at the moment the user presses stop precisely so a stop replayed
  // hours later still closes the entry then; falling through to this default
  // would close it whenever `reapply` happened to run instead.
  const endedAt = args.endedAt ?? Date.now()
  patchEverywhere(store, entryId, (entry) => {
    const safeEnd = Math.max(endedAt, entry.startedAt + 1)
    const result = entryTimes(entry.startedAt, safeEnd)
    return result.ok
      ? { ...entry, endedAt: result.times.endedAt, durationMs: result.times.durationMs }
      : entry
  })
}

type DiscardArgs = {
  entryId?: Id<"timeEntries">
}

/**
 * NOT `optimisticStop` reused: a discard deletes, so the row must leave the
 * lists (`dropEverywhere`) rather than be patched with an end time it will
 * never actually have on screen.
 */
export function optimisticDiscard(store: OptimisticLocalStore, args: DiscardArgs = {}): void {
  const running = store.getQuery(api.entries.getRunning, {})
  const entryId = args.entryId ?? running?._id
  if (entryId === undefined) {
    store.setQuery(api.entries.getRunning, {}, null)
    return
  }
  dropEverywhere(store, entryId)
}

/**
 * The lists too, not only the running slot.
 *
 * A running entry is a row in the log — `listRangeImpl`/`listPageImpl` filter
 * on `deletedAt` alone and neither excludes running entries — so retitling
 * `getRunning` by itself is precisely the "two different titles on one screen"
 * case `patchEverywhere`'s docblock above describes. Online the server's next
 * transition hides it; offline nothing does, and `attachSnapshotWriter`
 * persists the disagreement across a reload.
 *
 * `patchEverywhere` already patches `getRunning` when the id matches, so it
 * subsumes the explicit running write this used to do on its own.
 */
export function optimisticSetTitle(
  store: OptimisticLocalStore,
  args: { entryId: Id<"timeEntries">; title: string }
): void {
  patchEverywhere(store, args.entryId, (entry) => ({ ...entry, title: args.title }))
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

/**
 * `patchEverywhere` per id, so a sitting's members move together in the same
 * commit rather than one row at a time. Shares `applyUpdateFields` with
 * `optimisticUpdate` above rather than repeating the patch body — kept
 * identical deliberately, because two spellings of "what this write does
 * locally" is how the log and the server start disagreeing about a note.
 */
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
  // A `day` edit is the only one that can move a row off the range it is
  // rendered in, so it is the only one that needs the evicting writer.
  const write = args.field === "day" ? moveEverywhere : patchEverywhere
  write(store, args.entryId, (entry) => {
    // The SAME pure function the mutation runs. This is the payoff for
    // keeping the reconciliation rule out of Convex: the optimistic result
    // and the authoritative one cannot disagree, so the row never settles
    // to a different set of times a moment after the user let go.
    const result = applyTimeEdit(
      { startedAt: entry.startedAt, endedAt: entry.endedAt, durationMs: entry.durationMs },
      { field: args.field, value: args.value },
      now
    )
    // A refusal is left for the server to report. Painting a rejected edit
    // and then snapping it back would be worse than a brief nothing.
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
    billable: billableFor(store, args.projectId, args.billable),
    projectId: args.projectId,
    tagIds: args.tagIds ?? [],
  })
  const note = args.note?.trim()
  insertEverywhere(store, {
    ...base,
    note: note === undefined || note === "" ? undefined : note,
    endedAt: args.endedAt,
    durationMs: args.endedAt - args.startedAt,
    // `optimisticEntry` says "web" because it was written for `start`.
    // `entries.create` writes "manual", and this row has to match the one it
    // will be replaced by.
    source: "manual",
  })
}

/** Undoes `optimisticCreate`'s placeholder, for the same reason
 *  `unmintStart` undoes `optimisticStart`'s — see there. */
export function unmintCreate(store: OptimisticLocalStore, args: CreateArgs): void {
  dropEverywhere(store, optimisticIdFor(args.clientKey) as unknown as Id<"timeEntries">)
}
