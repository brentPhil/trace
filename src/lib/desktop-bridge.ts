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
