import { useSyncExternalStore } from "react"

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

/** Always used as `getServerSnapshot` below — never `getSnapshot` — so it is
 *  pulled out rather than inlined: an inline `() => false` reads as an
 *  arbitrary placeholder, where this name says what it actually is. */
function alwaysWeb(): boolean {
  return false
}

/** `useSyncExternalStore` re-subscribes whenever this identity changes; a
 *  module-level function that never changes keeps that from happening for a
 *  subscription that would do nothing differently anyway. */
function subscribeToNothing(): () => void {
  // Whether this process is inside the Tauri shell is decided once, before
  // any React code runs, and never changes for the life of the tab — there is
  // no event to listen for, so there is nothing to unsubscribe either.
  return () => {}
}

/**
 * `isDesktopShell()`, read the one place it is safe to call during render.
 *
 * The direct call this replaced (`isDesktopShell()` inline in JSX) broke on
 * `/login`: that route is server-rendered, the server has no `window` and so
 * always guesses "web", but the real Tauri webview already has
 * `__TAURI_INTERNALS__` on `window` before hydration even starts. The
 * server's guess and the client's first render disagreed — a hydration
 * mismatch — and worse, whatever the server guessed (a real, fully wired
 * `<AuthForm>`, Google button included) stays painted and clickable in the
 * desktop app until React notices and swaps it out. Google refuses OAuth from
 * exactly the embedded webview this button would be sitting in.
 *
 * `useSyncExternalStore`'s three-argument form exists for precisely this
 * shape — a value that is real and synchronous on the client but unknowable
 * on the server. `getServerSnapshot` (`alwaysWeb`) is what SSR renders AND,
 * critically, what React uses for the client's FIRST render too, during
 * hydration — so that first client render is guaranteed to match the
 * server's HTML instead of merely happening to. Only after hydration commits
 * does React re-read `getSnapshot` (the real `isDesktopShell`) and, if it
 * disagrees, force a corrective re-render — as part of its own store-
 * consistency check, not through an app-level `useEffect` + `setState` round
 * trip the way a `mounted` flag would need. That is one fewer render cycle
 * between "the wrong, interactive tree is on screen" and "the right one is",
 * which is the whole reason this is the safer of the two idiomatic options
 * here.
 *
 * What this does NOT do: make the mismatch impossible to see at all. The
 * very first bytes the browser paints are the server's HTML, guess and all —
 * nothing client-side can change what already left the server before any JS
 * ran. The guarantee is about what happens next: no console warning, and the
 * shortest path React has back to the truth once it can see it.
 */
export function useIsDesktopShell(): boolean {
  return useSyncExternalStore(subscribeToNothing, isDesktopShell, alwaysWeb)
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

/**
 * Asks the shell to open the user's real browser to sign in.
 *
 * Rejections are deliberately NOT swallowed here, unlike `pushTimerState`
 * above: failing to open a browser is the end of the road for the user and
 * they need to be told. The empty catch on the timer push is defensible only
 * because the next state change retries it; nothing retries this.
 */
export async function beginBrowserLogin(): Promise<void> {
  if (!isDesktopShell()) return
  const { invoke } = await import("@tauri-apps/api/core")
  await invoke("begin_browser_login")
}

/**
 * The finite set of reasons Rust's browser-login listener can fail with.
 *
 * Named here, next to the IPC boundary that actually produces them, so a
 * caller's copy table can be typed `Record<BrowserLoginFailureReason, string>`
 * and get a compile error the day this list grows and the copy does not.
 *
 * `onBrowserLogin` below deliberately does NOT use this type for `failed`'s
 * parameter — the string arriving over `listen("browser-login-failed", …)`
 * is whatever Rust actually sends, unchecked, and typing it as this union
 * would just be asserting away the one case that matters: a value Rust adds
 * that this list has not caught up with yet. That case is a caller's problem
 * to guard against at runtime, not something this type can rule out.
 */
export type BrowserLoginFailureReason = "timed_out" | "state_mismatch" | "listener_died"

/** The shell's answer to `beginBrowserLogin`, whichever way it went. */
export async function onBrowserLogin(handlers: {
  token: (token: string) => void
  failed: (reason: string) => void
}): Promise<() => void> {
  if (!isDesktopShell()) return () => {}
  const { listen } = await import("@tauri-apps/api/event")
  const unlistenToken = await listen<{ token: string }>(
    "browser-login-token",
    (event) => handlers.token(event.payload.token)
  )
  const unlistenFailed = await listen<{ reason: string }>(
    "browser-login-failed",
    (event) => handlers.failed(event.payload.reason)
  )
  return () => {
    unlistenToken()
    unlistenFailed()
  }
}
