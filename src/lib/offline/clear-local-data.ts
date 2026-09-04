import { clearRememberedAuth } from "./remembered-auth"
import { clearServiceWorkerCaches } from "./register-sw"
import type { SnapshotStore } from "./query-snapshots"
import type { Outbox } from "./outbox"

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
 * THE WHOLE OUTBOX, NOT ITS STORE. This takes the `Outbox` engine rather than
 * reaching for the `OutboxStore` underneath it — a bare `store.update(() =>
 * EMPTY_SNAPSHOT)` from outside would leave `pendingCount` stale, emit no
 * `changed` event, and strand any settler still waiting on an op the write
 * just erased. `Outbox.clear()` does all three correctly and is the one
 * sanctioned way in.
 *
 * Each clear is caught independently, so one failing store cannot stop the
 * others — and none of them can stop the user leaving. A `console.warn`
 * names what failed: a cleared cache is what stands between "signed out" and
 * a stale, still-cached authed page showing someone else's entries, and that
 * failure otherwise produces nothing at all, on screen or in the console.
 *
 * `snapshots.clear()` RETURNING is not the end of the race with
 * `attachSnapshotWriter`'s debounce timers: this function's caller
 * (`signOutAndLeave`) still awaits a network round trip to `authClient.signOut`
 * before leaving the page, and a timer armed before this call can fire during
 * that wait, after the clear. `SnapshotStore.clear()` seals the store against
 * that — every `write` after a `clear` is a no-op for the rest of that
 * store's lifetime — so this function does not need to, and does not, chase
 * down `attachSnapshotWriter`'s detach function to stop the timers itself.
 */
export async function clearLocalData(
  snapshots: SnapshotStore,
  outbox: Outbox
): Promise<void> {
  clearRememberedAuth()
  await Promise.all([
    snapshots
      .clear()
      .catch((error: unknown) =>
        console.warn("clearLocalData: snapshots.clear() failed", error)
      ),
    outbox
      .clear()
      .catch((error: unknown) =>
        console.warn("clearLocalData: outbox.clear() failed", error)
      ),
    clearServiceWorkerCaches().catch((error: unknown) =>
      console.warn("clearLocalData: clearServiceWorkerCaches() failed", error)
    ),
  ])
}
