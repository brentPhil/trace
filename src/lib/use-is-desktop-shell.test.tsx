// Tests for `useIsDesktopShell` (desktop-bridge.ts). A separate file from
// desktop-bridge.test.ts rather than a same-named `.tsx` sibling, for a
// concrete reason and not just tidiness: this project's `tsconfig.json`
// silently drops one of a `foo.test.ts` / `foo.test.tsx` pair from its
// resolved file list when both exist side by side, which starved
// typescript-eslint's per-file project lookup of the `.tsx` file and made it
// fail to parse. A distinct basename sidesteps that entirely.
//
// Needs JSX, so it lives under src/lib but ends in `.test.tsx`; vitest's
// "dom" project (see vitest.config.ts) picks it up under jsdom by extension
// alone — no `@vitest-environment` override needed the way the sibling file
// has.
import { act } from "react"
import { hydrateRoot } from "react-dom/client"
import { renderToString } from "react-dom/server"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { DesktopSignIn } from "@/components/auth/desktop-sign-in"
import { useIsDesktopShell } from "@/lib/desktop-bridge"

// DesktopSignIn's own effect reaches for these dynamically (see
// desktop-bridge.ts's `onBrowserLogin`/`beginBrowserLogin`); mocked exactly
// as desktop-bridge.test.ts mocks them, so DesktopSignIn can mount for real
// here without touching an actual Tauri IPC bridge that does not exist in
// jsdom.
const invoke = vi.fn(async () => undefined)
const listen = vi.fn(async () => vi.fn())
vi.mock("@tauri-apps/api/core", () => ({ invoke }))
vi.mock("@tauri-apps/api/event", () => ({ listen }))

// @testing-library/react flips this on for its own `render`; the hydration
// test below drives `hydrateRoot`/`act` directly instead (there is no
// `hydrate` entry point in Testing Library), so it has to flip it on itself
// or React logs "not configured to support act(...)" instead of the
// hydration-mismatch warning the test actually watches for.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/**
 * Stands in for `AuthForm`, which pulls in `authClient` and a TanStack
 * `Link` that both need setup this test has no reason to carry — the gate
 * being tested here does not care what the web branch renders, only that it
 * is THIS branch and not `DesktopSignIn`. Recognisable text is what earns it
 * a place: "Google" is the specific word the real bug made briefly clickable
 * inside the shell.
 */
function FakeAuthForm() {
  return <button type="button">Continue with Google</button>
}

/** The exact shape login.tsx wires together: one hook, one ternary. */
function Gate() {
  const isDesktop = useIsDesktopShell()
  return isDesktop ? <DesktopSignIn /> : <FakeAuthForm />
}

function enterShell() {
  ;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}
}

afterEach(() => {
  cleanup()
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
  vi.clearAllMocks()
})

describe("useIsDesktopShell", () => {
  it("renders the form outside the shell", () => {
    render(<Gate />)
    expect(screen.getByRole("button", { name: /continue with google/i })).toBeTruthy()
  })

  it("renders the browser sign-in, and not the form, inside the shell", async () => {
    enterShell()
    render(<Gate />)
    expect(
      await screen.findByRole("button", { name: /continue in browser/i })
    ).toBeTruthy()
    expect(screen.queryByRole("button", { name: /continue with google/i })).toBeNull()
  })

  /**
   * The property the login.tsx bug was actually about, not just the two
   * "eventually renders the right thing" checks above.
   *
   * `window.__TAURI_INTERNALS__` is set BEFORE `renderToString` runs, and
   * stays set through the hydrate — matching the real Tauri webview, where
   * the global is present continuously from before any JS executes. A real
   * server never has `window` at all, so it always guesses "web"; jsdom
   * cannot remove `window` for a `react-dom/server` pass, so what stands in
   * for that here is `getServerSnapshot` (`alwaysWeb` in desktop-bridge.ts)
   * forcing the same "web" answer regardless of what `window` actually holds
   * at that moment — which is the exact mechanism a real server-with-no-
   * window relies on too, just exercised from the other direction.
   *
   * Given that, hydrating against server HTML that says "web" while the
   * shell global is already live is the one scenario the original bug
   * report described, and this is the closest a vitest+jsdom test can get to
   * reproducing it: a real `renderToString` pass, a real `hydrateRoot` pass
   * over its output, and an assertion that hydration never logs a mismatch
   * on the way to correcting itself.
   */
  it("hydrates against the server's guess without warning, then corrects to the shell", async () => {
    enterShell()

    const serverHtml = renderToString(<Gate />)
    expect(serverHtml).toMatch(/continue with google/i)

    const container = document.createElement("div")
    container.innerHTML = serverHtml
    document.body.appendChild(container)

    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    await act(async () => {
      hydrateRoot(container, <Gate />)
    })
    expect(consoleError).not.toHaveBeenCalled()

    await waitFor(() =>
      expect(container.querySelector("button")?.textContent).toMatch(
        /continue in browser/i
      )
    )

    consoleError.mockRestore()
    container.remove()
  })
})
