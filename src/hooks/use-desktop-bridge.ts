import { useEffect } from "react"
import { useLatest } from "@/hooks/use-latest"
import { getSkewMs } from "@/lib/clock"
import { isDesktopShell, onTrayCommand, pushTimerState } from "@/lib/desktop-bridge"
import type { Doc } from "../../convex/_generated/dataModel"

/** So the log below happens once per page load, not once per failed push. */
let pushFailureLogged = false

/**
 * A failed push stays non-fatal for the user and stops being invisible to us.
 *
 * The original here was a bare `.catch(() => {})` with a comment arguing that
 * there is nothing useful to tell the user and the next state change retries.
 * That reasoning is exactly right for the case it imagined — the shell is
 * mid-restart, one push is lost, the next one lands — and exactly wrong for a
 * PERMANENT rejection, which retries forever and never succeeds. And that is
 * what actually happened: a Tauri ACL misconfiguration rejected every
 * `invoke("timer_state", …)` for the entire life of this branch. The tray never
 * once heard about a timer. There was no console output, no toast, no failed
 * test — the empty catch ate the only evidence — so the feature shipped
 * completely inert through six code reviews.
 *
 * A toast is still wrong: the user cannot act on it, and a stale tray does not
 * stop them tracking time. A console error in development is the smallest thing
 * that would have caught this, so that is what this is — and ONCE, not once per
 * push, because the failing case is a push that fails every time and a tray
 * timer pushes on every start and stop for as long as the app is open. One line
 * says everything a second thousand would.
 *
 * Deliberately never reset. Whether the cause is permanent or a shell that came
 * back a moment later, the developer only needs telling that pushes can fail
 * here at all; from there the console has the rejection to read.
 */
function reportPushFailure(thrown: unknown): void {
  if (!import.meta.env.DEV || pushFailureLogged) return
  pushFailureLogged = true
  console.error(
    "Desktop bridge: pushing timer state to the shell failed, so the tray is now stale. Check the Tauri capability in src-tauri/capabilities/ and the command name in src/lib/desktop-bridge.ts.",
    thrown
  )
}

/**
 * Keeps the desktop shell's tray in step with the running entry, and lets the
 * tray's Start/Stop go through the exact mutations the timer bar uses.
 *
 * Mounted in `AuthedShell` beside the other hooks that watch `running` — the
 * one mount that survives navigation, so the tray never goes stale because the
 * user changed pages. Everything is a no-op outside the Tauri shell.
 *
 * Takes no `onError`: `actions.start`/`actions.stop` are the outbox-wrapped
 * mutations, optimistic by construction now — they resolve as soon as the
 * write is journaled, so a refusal is the outbox's own `dropped` event to
 * report, not this bridge's.
 */
export function useDesktopBridge(
  running: Doc<"timeEntries"> | null,
  actions: { start: () => Promise<unknown>; stop: () => Promise<unknown> }
): void {
  // `useLatest` for the same reason every effect-crossing callback in this
  // codebase uses it: the callers hand in fresh closures per render, and the
  // listener effect below must register exactly once.
  const start = useLatest(actions.start)
  const stop = useLatest(actions.stop)

  useEffect(() => {
    if (!isDesktopShell()) return
    void pushTimerState({
      running: running !== null,
      title: running?.title ?? "",
      // Server time converted to THIS DEVICE's clock, because that is the only
      // clock the shell can read — see `ShellTimerState.startedAtMs`. Read at
      // push time rather than stored: `recordServerNow` has already run by the
      // time a running entry reaches us (the start mutation's own return value
      // feeds it), and any later correction arrives with the next push.
      startedAtMs: running === null ? null : running.startedAt - getSkewMs(),
    }).catch(reportPushFailure)
  }, [running])

  /**
   * Tells the shell the timer is gone when this hook goes away.
   *
   * Sign-out unmounts `AuthedShell`. Without this the last thing the shell ever
   * heard was "running", so the tray keeps drawing and ticking an entry the page
   * no longer knows about — and the listener effect below has already cleaned
   * up, so the tray's Stop emits `tray-stop` into a page with nothing listening
   * and does nothing at all, silently. A phantom timer with a dead Stop button.
   *
   * Mount-scoped (`[]`) ON PURPOSE, and not folded into the push effect above.
   * That effect's deps are `[running]`, so a cleanup living there would fire on
   * every single change of the running entry — pushing idle in between, which is
   * a visible tray flicker at best and, since the pushes are async, a lost state
   * at worst if the idle push landed after the one that replaced it.
   */
  useEffect(() => {
    // The guard belongs in the cleanup rather than out here: `isDesktopShell()`
    // is a cheap property read either way, and this keeps the mount path from
    // calling it a second time for a decision it does not make.
    return () => {
      if (!isDesktopShell()) return
      void pushTimerState({
        running: false,
        title: "",
        startedAtMs: null,
      }).catch(reportPushFailure)
    }
  }, [])

  useEffect(() => {
    if (!isDesktopShell()) return
    let cleanup: (() => void) | null = null
    let cancelled = false
    void onTrayCommand({
      start: () => void start(),
      stop: () => void stop(),
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
  }, [start, stop])
}
