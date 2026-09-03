/**
 * What the authed layout shows while a loader waits.
 *
 * This is `_authed`'s single `pendingComponent`, so it covers every route
 * under it — Today, Reports, Settings, Invoices — not just the log. It used
 * to render `LogSkeleton` for the online branch, which is a day-list shape:
 * correct for Today, but a day-list skeleton painted under Settings or
 * Reports promises rows that page does not have. A neutral `role="status"`
 * placeholder is honest for all of them, at the cost of the log's own
 * skeleton shape while `/timer` first loads — a trade worth it for not
 * lying to every other route.
 *
 * Offline, a loader waits for a query that has no snapshot — a page never
 * opened on this device — and it will wait forever, so the sentence has to
 * say so rather than imply the load is merely slow. Takes `offline` as a
 * prop: components do not read connection state, routes do.
 */
export function OfflinePending({ offline }: { offline: boolean }) {
  if (!offline) {
    return (
      <div role="status" className="px-4 py-8 text-sm text-muted-foreground">
        Loading…
      </div>
    )
  }
  return (
    <div role="status" className="px-4 py-8 text-sm text-muted-foreground">
      <p className="font-medium text-foreground">You're offline.</p>
      <p>This page hasn't been opened on this device yet, so there is nothing to show until you're back online.</p>
    </div>
  )
}
