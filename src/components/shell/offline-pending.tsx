import { LogSkeleton } from "@/components/entries/day-list"

/**
 * What the authed layout shows while a loader waits.
 *
 * Online, a loader waits for a round trip and the skeleton is the honest
 * picture. Offline, a loader waits for a query that has no snapshot — a page
 * never opened on this device — and it will wait forever, so the sentence
 * has to say so rather than let a skeleton promise something that is not
 * coming. Takes `offline` as a prop: components do not read connection
 * state, routes do.
 */
export function OfflinePending({ offline }: { offline: boolean }) {
  if (!offline) return <LogSkeleton />
  return (
    <div role="status" className="px-4 py-8 text-sm text-muted-foreground">
      <p className="font-medium text-foreground">You're offline.</p>
      <p>This page hasn't been opened on this device yet, so there is nothing to show until you're back online.</p>
    </div>
  )
}
