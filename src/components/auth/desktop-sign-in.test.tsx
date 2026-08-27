import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { DesktopSignIn } from "@/components/auth/desktop-sign-in"
import type { BrowserLoginFailureReason } from "@/lib/desktop-bridge"

type LoginHandlers = {
  token: (token: string) => void
  failed: (reason: BrowserLoginFailureReason) => void
}

const bridge = vi.hoisted(() => ({
  beginBrowserLogin: vi.fn(async () => undefined),
  // Typed as the real handlers shape (rather than `unknown`, as a looser mock
  // might use) so the tests below can read `mock.calls[0][0]` straight off
  // without an `as` — a type assertion here would just be re-asserting what
  // the mock already promised to accept.
  onBrowserLogin: vi.fn(async (_handlers: LoginHandlers) => vi.fn()),
}))
vi.mock("@/lib/desktop-bridge", () => bridge)

const replace = vi.fn()
vi.stubGlobal("location", { ...window.location, replace })

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("DesktopSignIn", () => {
  it("opens the browser and shows that it is waiting", async () => {
    render(<DesktopSignIn />)
    fireEvent.click(screen.getByRole("button", { name: /continue in browser/i }))
    expect(bridge.beginBrowserLogin).toHaveBeenCalledTimes(1)
    expect(await screen.findByText(/waiting for your browser/i)).toBeTruthy()
  })

  it("enters the app when the token arrives", async () => {
    render(<DesktopSignIn />)
    const handlers = bridge.onBrowserLogin.mock.calls[0][0]
    handlers.token("tok")
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith("/desktop-callback?token=tok")
    )
  })

  it("says so when the wait times out, and offers another go", async () => {
    render(<DesktopSignIn />)
    fireEvent.click(screen.getByRole("button", { name: /continue in browser/i }))
    const handlers = bridge.onBrowserLogin.mock.calls[0][0]
    handlers.failed("timed_out")
    expect((await screen.findByRole("alert")).textContent).toMatch(/timed out/i)
    const retry = screen.getByRole("button", { name: /continue in browser/i })
    expect((retry as HTMLButtonElement).disabled).toBe(false)
  })

  it("reports a failure to open the browser at all", async () => {
    // `errorMessage` deliberately hides a bare Error's raw text from the user
    // (see src/lib/error-message.ts) — it isn't a TraceError, so the only
    // promise this test can hold implementation to is its documented generic
    // fallback, not the "no port" string itself.
    bridge.beginBrowserLogin.mockRejectedValueOnce(new Error("no port"))
    render(<DesktopSignIn />)
    fireEvent.click(screen.getByRole("button", { name: /continue in browser/i }))
    expect((await screen.findByRole("alert")).textContent).toMatch(/try again/i)
    const retry = screen.getByRole("button", { name: /continue in browser/i })
    expect((retry as HTMLButtonElement).disabled).toBe(false)
  })
})
