/**
 * Survives a start across a reload.
 *
 * Convex buffers unsent mutations in memory and replays them on reconnect, but
 * that buffer does NOT survive a page reload — and a discarded tab, an OOM, or
 * a phone backgrounding the browser fire no `beforeunload`. So a user who
 * presses start on a train can watch an optimistic timer tick for two hours and
 * have none of it recorded, with nothing on screen to suggest anything is
 * wrong. That is the single worst failure of the product's headline promise.
 *
 * The fix is small because `clientKey` already makes start idempotent: write
 * the intent to localStorage BEFORE calling the mutation, clear it once the
 * server confirms, and replay it on boot if the server says nothing is running.
 * Replaying a key the server already has returns the original row, so a
 * double-replay is harmless by construction.
 *
 * This is deliberately narrower than a general offline mutation queue (which is
 * fast-follow): it covers only start, because start is the only mutation whose
 * loss is both total and invisible.
 */

const STORAGE_KEY = "trace.pendingStart.v1"

export type PendingStart = {
  clientKey: string
  title: string
  startedAt: number
  /** When the intent was recorded, for staleness. */
  recordedAt: number
}

/** localStorage throws in private mode and in some embedded webviews. */
function storage(): Storage | null {
  try {
    if (typeof window === "undefined") return null
    return window.localStorage
  } catch {
    return null
  }
}

export function recordPendingStart(pending: PendingStart): void {
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(pending))
  } catch {
    // A full or unavailable quota must never stop a timer from starting.
  }
}

export function clearPendingStart(clientKey?: string): void {
  try {
    // Only clear the intent we are confirming. Without this check a slow
    // confirmation for an old start could wipe a newer pending one.
    if (clientKey !== undefined) {
      const current = readPendingStart()
      if (current !== null && current.clientKey !== clientKey) return
    }
    storage()?.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}

export function readPendingStart(): PendingStart | null {
  let raw: string | null = null
  try {
    raw = storage()?.getItem(STORAGE_KEY) ?? null
  } catch {
    return null
  }
  if (raw === null) return null

  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== "object" || parsed === null) return null
    const p = parsed as Partial<PendingStart>
    if (
      typeof p.clientKey !== "string" ||
      typeof p.startedAt !== "number" ||
      typeof p.recordedAt !== "number" ||
      !Number.isFinite(p.startedAt) ||
      !Number.isFinite(p.recordedAt)
    ) {
      return null
    }
    return {
      clientKey: p.clientKey,
      title: typeof p.title === "string" ? p.title : "",
      startedAt: p.startedAt,
      recordedAt: p.recordedAt,
    }
  } catch {
    return null
  }
}

/** Older than this and we do not resurrect it unasked. */
export const PENDING_START_MAX_AGE_MS = 24 * 60 * 60 * 1000

/**
 * Whether a recorded intent should be replayed.
 *
 * Only when the server genuinely has nothing running: if a timer is already
 * running, either this start landed after all or the user has since started
 * something else, and replaying would insert a second entry.
 */
export function shouldReplay(
  pending: PendingStart | null,
  hasRunningEntry: boolean,
  now: number
): pending is PendingStart {
  if (pending === null || hasRunningEntry) return false
  return now - pending.recordedAt <= PENDING_START_MAX_AGE_MS
}
