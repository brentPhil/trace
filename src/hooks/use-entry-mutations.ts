import { useCallback } from "react"
import { useConvexMutation } from "@convex-dev/react-query"
import { useLatest } from "@/hooks/use-latest"
import { recordServerNow } from "@/lib/clock"
import { newClientKey } from "@/lib/client-key"
import { optimisticIdFor } from "@/lib/optimistic-id"
import { clearPendingStart, recordPendingStart } from "@/lib/pending-start"
import { api } from "../../convex/_generated/api"
import type { Doc, Id } from "../../convex/_generated/dataModel"

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
function optimisticEntry(args: {
  clientKey: string
  title: string
  startedAt: number
  billable: boolean
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
    tagIds: [],
    billable: args.billable,
    source: "web",
    updatedAt: args.startedAt,
    deletedAt: null,
  }
}

/**
 * Every mutation below is wrapped in `useLatest`.
 *
 * `.withOptimisticUpdate()` returns a new function on every render, so without
 * this the callbacks this hook exports change identity every render — and an
 * effect that debounces one of them re-arms its timer every render instead of
 * every keystroke. See src/hooks/use-latest.ts.
 */
export function useEntryMutations() {
  const startMutation = useLatest(
    useConvexMutation(api.entries.start).withOptimisticUpdate((localStore, args) => {
      localStore.setQuery(
        api.entries.getRunning,
        {},
        optimisticEntry({
          clientKey: args.clientKey,
          title: args.title ?? "",
          startedAt: args.startedAt ?? Date.now(),
          billable: args.billable ?? false,
        })
      )
    })
  )

  const stopMutation = useLatest(
    useConvexMutation(api.entries.stop).withOptimisticUpdate((localStore) => {
      localStore.setQuery(api.entries.getRunning, {}, null)
    })
  )

  const discardMutation = useLatest(
    useConvexMutation(api.entries.discardRunning).withOptimisticUpdate((localStore) => {
      localStore.setQuery(api.entries.getRunning, {}, null)
    })
  )

  const setTitleMutation = useLatest(
    useConvexMutation(api.entries.setTitle).withOptimisticUpdate((localStore, args) => {
      const running = localStore.getQuery(api.entries.getRunning, {})
      if (running != null && running._id === args.entryId) {
        localStore.setQuery(api.entries.getRunning, {}, { ...running, title: args.title })
      }
    })
  )

  /**
   * Starts tracking.
   *
   * The intent is written to localStorage BEFORE the mutation is sent and
   * cleared only once the server confirms. Convex's in-memory retry buffer does
   * not survive a reload, so without this a start lost to a discarded tab is
   * gone with nothing on screen to say so.
   */
  const start = useCallback(
    async (
      input: {
        title?: string
        startedAt?: number
        projectId?: Id<"projects">
        tagIds?: Array<Id<"tags">>
        billable?: boolean
      } = {}
    ) => {
      const clientKey = newClientKey()
      const startedAt = input.startedAt ?? Date.now()
      const title = input.title ?? ""

      recordPendingStart({ clientKey, title, startedAt, recordedAt: Date.now() })

      // No try/catch: the intent must STAY in storage if this throws, so the
      // next load replays it. Clearing happens only on the success path.
      const result = await startMutation({
        clientKey,
        title,
        startedAt,
        projectId: input.projectId,
        tagIds: input.tagIds,
        billable: input.billable,
      })
      recordServerNow(result.serverNow)
      clearPendingStart(clientKey)
      return result
    },
    [startMutation]
  )

  /**
   * Resume: a NEW entry carrying everything the old one classified itself
   * with, except the note.
   *
   * The note describes what happened during that specific interval, so copying
   * it forward would put a false account on a block of time nobody has done
   * yet — and the copy would look exactly like something the user wrote.
   * Toggl's resume and its title-autocomplete inherit different sets from each
   * other, which quietly teaches people to trust neither.
   */
  const resume = useCallback(
    async (entry: Doc<"timeEntries">) =>
      await start({
        title: entry.title,
        projectId: entry.projectId,
        tagIds: entry.tagIds,
        billable: entry.billable,
      }),
    [start]
  )

  /**
   * Re-sends a start that was recorded but never confirmed, reusing its
   * original clientKey.
   *
   * Reusing the key is what makes this safe to call whenever in doubt: if the
   * original did land, the mutation finds it and returns the existing row
   * rather than inserting a second one.
   */
  const replayStart = useCallback(
    async (pending: { clientKey: string; title: string; startedAt: number }) => {
      const result = await startMutation({
        clientKey: pending.clientKey,
        title: pending.title,
        startedAt: pending.startedAt,
      })
      recordServerNow(result.serverNow)
      clearPendingStart(pending.clientKey)
      return result
    },
    [startMutation]
  )

  const stop = useCallback(async () => {
    const result = await stopMutation({})
    recordServerNow(result.serverNow)
    clearPendingStart()
    return result
  }, [stopMutation])

  const discard = useCallback(async () => {
    clearPendingStart()
    return await discardMutation({})
  }, [discardMutation])

  const setTitle = useCallback(
    async (entryId: Id<"timeEntries">, title: string) => {
      await setTitleMutation({ entryId, title })
    },
    [setTitleMutation]
  )

  return { start, resume, replayStart, stop, discard, setTitle }
}
