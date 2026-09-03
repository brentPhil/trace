import { clearRememberedAuth } from "./remembered-auth"
import { clearServiceWorkerCaches } from "./register-sw"
import type { SnapshotStore } from "./query-snapshots"

/**
 * Everything offline support keeps on the device, gone at sign-out.
 *
 * The outbox is NOT cleared here: sign-out is refused while it holds
 * anything (see the shell), so by the time this runs it is empty.
 */
export async function clearLocalData(snapshots: SnapshotStore): Promise<void> {
  clearRememberedAuth()
  await Promise.all([snapshots.clear().catch(() => undefined), clearServiceWorkerCaches().catch(() => undefined)])
}
