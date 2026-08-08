/**
 * The wall clock, as one module-level store.
 *
 * Two rules, and everything else follows from them.
 *
 * NEVER ACCUMULATE. Elapsed time is recomputed from the current instant on
 * every tick; there is no counter, so there is nothing to drift. A tick that
 * arrives four minutes late (a throttled background tab) or nine hours late (a
 * sleeping laptop) still paints the correct number, because the number was
 * never a sum of intervals. This is the whole of "never lose time" — reload,
 * crash, sleep, and cross-device handoff all become non-events rather than
 * cases to handle.
 *
 * ONE SUBSCRIBER PER SCREEN. A single store means one timer for the whole page,
 * and only a component rendering a RUNNING duration subscribes to it, so a
 * ticking clock never re-renders the entry list. The qualifier matters: a
 * completed row must not subscribe, and arranging that takes more than an early
 * return — see `useElapsedMs`.
 */

type Listener = () => void

const listeners = new Set<Listener>()
let timeout: ReturnType<typeof setTimeout> | null = null
let snapshot = currentSecond()

function currentSecond(): number {
  return Math.floor(Date.now() / 1000)
}

function emit(): void {
  const next = currentSecond()
  // getSnapshot must be referentially stable between real changes, or
  // useSyncExternalStore re-renders forever.
  if (next === snapshot) return
  snapshot = next
  for (const listener of listeners) listener()
}

/**
 * Schedules the next tick at the next wall-clock second boundary, never
 * "1000ms from now".
 *
 * setInterval accumulates its own lateness and its own throttling. This cannot,
 * because every tick is scheduled from the clock rather than from the previous
 * tick. Aligning to the wall clock rather than to any one entry's start also
 * means every duration on screen flips in the same frame instead of staggering.
 */
function schedule(): void {
  if (timeout !== null) clearTimeout(timeout)
  timeout = setTimeout(
    () => {
      emit()
      schedule()
    },
    Math.max(50, 1000 - (Date.now() % 1000))
  )
}

/** Paint the truth now, then re-anchor. For anything that means time jumped. */
function resync(): void {
  emit()
  schedule()
}

function onVisibilityChange(): void {
  if (document.visibilityState === "visible") resync()
}

export function subscribeToClock(listener: Listener): () => void {
  listeners.add(listener)
  if (listeners.size === 1) {
    schedule()
    // Background throttling, bfcache restore, wake from sleep, reconnect.
    document.addEventListener("visibilitychange", onVisibilityChange)
    window.addEventListener("pageshow", resync)
    window.addEventListener("focus", resync)
    window.addEventListener("online", resync)
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size > 0) return
    if (timeout !== null) {
      clearTimeout(timeout)
      timeout = null
    }
    document.removeEventListener("visibilitychange", onVisibilityChange)
    window.removeEventListener("pageshow", resync)
    window.removeEventListener("focus", resync)
    window.removeEventListener("online", resync)
  }
}

export function getClockSnapshot(): number {
  return snapshot
}

/**
 * `null` on the server.
 *
 * A constant is trivially stable, which is what useSyncExternalStore requires
 * of a server snapshot. Returning `Date.now()` here instead would be a value
 * that can change between the two calls React makes in one pass — the reason
 * the obvious implementation needs a caching trick. Callers read the clock
 * directly for the server render and are corrected on mount, one frame later.
 */
export function getClockServerSnapshot(): null {
  return null
}

// ---------------------------------------------------------------------------
// Clock skew
// ---------------------------------------------------------------------------

let skewMs = 0

/**
 * Records the difference between this device's clock and the server's.
 *
 * Fed from a MUTATION's return value, never a query's. `Date.now()` inside a
 * Convex query resolves to the transaction's timestamp and creates no
 * subscription to the passage of time, so a query-sourced `serverNow` would be
 * fixed at its first evaluation and grow staler by the hour — and a running
 * timer computed against it would silently clamp to 0:00:00 while still
 * running. A mutation genuinely re-evaluates on every call.
 */
export function recordServerNow(serverNow: number): void {
  const observed = serverNow - Date.now()
  // A skew beyond a few minutes is a broken clock, not drift. Applying it would
  // put a running timer hours out; ignoring it leaves the display merely
  // device-accurate, which is the better failure.
  skewMs = Math.abs(observed) > 5 * 60_000 ? 0 : observed
}

export function getSkewMs(): number {
  return skewMs
}

/** Test seam. */
export function resetClockSkew(): void {
  skewMs = 0
}
