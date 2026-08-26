/**
 * The web app's half of the desktop shell conversation.
 *
 * Inert on the plain web on purpose: `@tauri-apps/api` is only imported
 * dynamically after the shell's IPC globals have been seen, so a browser on
 * chroneli.com never loads it and never pays for it.
 */
export type ShellTimerState = {
  running: boolean
  title: string
  /**
   * A DEVICE-CLOCK INSTANT. Not `timeEntries.startedAt`, which is server time.
   *
   * The shell renders the tray clock as `local_now - startedAtMs`, using the
   * machine's own `SystemTime` — it has no idea what the Convex server thinks
   * the time is and no way to find out. The web app, meanwhile, renders every
   * running duration as `Date.now() + getSkewMs() - startedAt` precisely
   * because the two clocks disagree. Hand the raw server `startedAt` over that
   * wire and the tray and the in-page timer show DIFFERENT elapsed times for
   * the same entry, off by the full skew (up to the ±5 minute clamp in
   * `src/lib/clock.ts`, beyond which skew is discarded as a broken clock).
   *
   * So the caller subtracts the skew before pushing: `startedAt - getSkewMs()`
   * makes the shell's `local_now - (startedAt - skew)` identical, term for
   * term, to the web's `local_now + skew - startedAt`.
   *
   * NOT elapsed-at-push-time, which is the other obvious encoding. Elapsed
   * goes stale the moment it is sent, and the tray ticks once a second between
   * pushes, so the shell would need its own base instant anyway — this IS that
   * base, expressed in the only clock the shell can read.
   */
  startedAtMs: number | null
}

export function isDesktopShell(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
}

/** Hands the running-entry state to the shell, which owns the tray from there. */
export async function pushTimerState(state: ShellTimerState): Promise<void> {
  if (!isDesktopShell()) return
  const { invoke } = await import("@tauri-apps/api/core")
  await invoke("timer_state", {
    running: state.running,
    title: state.title,
    startedAtMs: state.startedAtMs,
  })
}

/**
 * Start/Stop clicked in the tray menu. Resolves to the unlisten function so
 * the caller's effect can clean up.
 */
export async function onTrayCommand(handlers: {
  start: () => void
  stop: () => void
}): Promise<() => void> {
  if (!isDesktopShell()) return () => {}
  const { listen } = await import("@tauri-apps/api/event")
  const unlistenStart = await listen("tray-start", () => handlers.start())
  const unlistenStop = await listen("tray-stop", () => handlers.stop())
  return () => {
    unlistenStart()
    unlistenStop()
  }
}
