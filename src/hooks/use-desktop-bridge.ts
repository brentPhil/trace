import { useEffect } from "react"
import { useLatest } from "@/hooks/use-latest"
import { getSkewMs } from "@/lib/clock"
import { isDesktopShell, onTrayCommand, pushTimerState } from "@/lib/desktop-bridge"
import type { Doc } from "../../convex/_generated/dataModel"

/**
 * Keeps the desktop shell's tray in step with the running entry, and lets the
 * tray's Start/Stop go through the exact mutations the timer bar uses.
 *
 * Mounted in `AuthedShell` beside the other hooks that watch `running` — the
 * one mount that survives navigation, so the tray never goes stale because the
 * user changed pages. Everything is a no-op outside the Tauri shell.
 */
export function useDesktopBridge(
  running: Doc<"timeEntries"> | null,
  actions: { start: () => Promise<unknown>; stop: () => Promise<unknown> },
  onError: (thrown: unknown) => void
): void {
  // `useLatest` for the same reason every effect-crossing callback in this
  // codebase uses it: the callers hand in fresh closures per render, and the
  // listener effect below must register exactly once.
  const start = useLatest(actions.start)
  const stop = useLatest(actions.stop)
  const report = useLatest(onError)

  useEffect(() => {
    if (!isDesktopShell()) return
    // A failed push means the shell side is gone or mid-restart; there is
    // nothing useful to tell the user, and the next state change retries.
    void pushTimerState({
      running: running !== null,
      title: running?.title ?? "",
      // Server time converted to THIS DEVICE's clock, because that is the only
      // clock the shell can read — see `ShellTimerState.startedAtMs`. Read at
      // push time rather than stored: `recordServerNow` has already run by the
      // time a running entry reaches us (the start mutation's own return value
      // feeds it), and any later correction arrives with the next push.
      startedAtMs: running === null ? null : running.startedAt - getSkewMs(),
    }).catch(() => {})
  }, [running])

  useEffect(() => {
    if (!isDesktopShell()) return
    let cleanup: (() => void) | null = null
    let cancelled = false
    void onTrayCommand({
      start: () => void start().catch(report),
      stop: () => void stop().catch(report),
    }).then((unlisten) => {
      // The unmount can land while `listen` is still resolving; a listener
      // registered after its cleanup ran would survive forever.
      if (cancelled) unlisten()
      else cleanup = unlisten
    })
    return () => {
      cancelled = true
      cleanup?.()
    }
  }, [start, stop, report])
}
