import { clearRememberedAuth } from "./remembered-auth"
import { clearServiceWorkerCaches } from "./register-sw"
import { EMPTY_SNAPSHOT } from "./op-types"
import type { SnapshotStore } from "./query-snapshots"
import type { OutboxStore } from "./op-types"

/**
 * Everything offline support keeps on the device, gone at sign-out.
 *
 * THE OUTBOX GOES TOO, and that is the uncomfortable half. Sign-out is only
 * refused while offline (see `pendingSignOutWarning` in offline-copy.ts for
 * why refusing on a non-empty queue was a trap), so this can run with ops
 * still queued — and leaving them would mean the next person to sign in on
 * this machine replays the previous user's writes under their own session.
 * Losing the queue is bad; that is worse. `pendingSignOutWarning` is what
 * makes the loss a choice rather than a surprise.
 *
 * Each clear is caught independently, so one failing store cannot stop the
 * others — and none of them can stop the user leaving. A `console.warn`
 * names what failed: a cleared cache is what stands between "signed out" and
 * a stale, still-cached authed page showing someone else's entries, and that
 * failure otherwise produces nothing at all, on screen or in the console.
 */
export async function clearLocalData(
  snapshots: SnapshotStore,
  outbox: OutboxStore
): Promise<void> {
  clearRememberedAuth()
  await Promise.all([
    snapshots
      .clear()
      .catch((error: unknown) =>
        console.warn("clearLocalData: snapshots.clear() failed", error)
      ),
    outbox
      .update(() => EMPTY_SNAPSHOT)
      .catch((error: unknown) =>
        console.warn("clearLocalData: outbox.update() failed", error)
      ),
    clearServiceWorkerCaches().catch((error: unknown) =>
      console.warn("clearLocalData: clearServiceWorkerCaches() failed", error)
    ),
  ])
}
