import { useCallback } from "react"
import { useOutboxMutation } from "@/lib/offline/outbox-provider"
import { recordServerNow } from "@/lib/clock"
import { newClientKey } from "@/lib/client-key"
import type { Doc, Id } from "../../convex/_generated/dataModel"

export function useEntryMutations() {
  const startOp = useOutboxMutation("entries.start")
  const stopOp = useOutboxMutation("entries.stop")
  const discardOp = useOutboxMutation("entries.discardRunning")
  const setTitleOp = useOutboxMutation("entries.setTitle")

  /**
   * Starts tracking. Journaled before anything else happens — the outbox is
   * what `pending-start` used to be, for every write rather than this one.
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
      const { result, settled } = await startOp({
        clientKey: newClientKey(),
        title: input.title ?? "",
        startedAt: input.startedAt ?? Date.now(),
        projectId: input.projectId,
        tagIds: input.tagIds,
        billable: input.billable,
      })
      void settled.then((r) => recordServerNow(r.serverNow)).catch(() => undefined)
      return result
    },
    [startOp]
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
   * `endedAt` is recorded NOW: a stop replayed hours later must close the
   * entry at the moment the user pressed it, not at the moment it synced.
   *
   * `entryId` is what makes that safe — see `stopImpl` in convex/entries.ts.
   * It may be an `optimistic:` placeholder when the start has not landed yet,
   * which is exactly what the outbox rewrites once that start resolves.
   */
  const stop = useCallback(
    async (entryId?: Id<"timeEntries">) => {
      const { result, settled } = await stopOp({ entryId, endedAt: Date.now() })
      void settled.then((r) => recordServerNow(r.serverNow)).catch(() => undefined)
      // `entries.stop` always defines `immediate` — `entries.editTime` is the
      // only kind whose result is genuinely absent — so this is never undefined.
      return result!
    },
    [stopOp]
  )

  const discard = useCallback(
    async (entryId?: Id<"timeEntries">) => (await discardOp({ entryId })).result,
    [discardOp]
  )

  const setTitle = useCallback(
    async (entryId: Id<"timeEntries">, title: string) => {
      await setTitleOp({ entryId, title })
    },
    [setTitleOp]
  )

  return { start, resume, stop, discard, setTitle }
}
