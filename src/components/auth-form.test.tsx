import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { AuthForm } from "@/components/auth-form"
import type * as RouterModuleType from "@tanstack/react-router"
import type { BrowserLoginFailureReason } from "@/lib/desktop-bridge"

type RouterModule = typeof RouterModuleType

type LoginHandlers = {
  token: (token: string) => void
  failed: (reason: BrowserLoginFailureReason) => void
}

/*
 * The whole desktop bridge is mocked, `isDesktopShell` included, because this
 * suite is about what AuthForm DOES with the answer rather than how the answer
 * is derived — `isDesktopShell`'s own `window.__TAURI_INTERNALS__` read is
 * covered in src/lib/desktop-bridge.test.ts and does not need re-proving here.
 *
 * `onBrowserLogin` is typed with the real handlers shape so the tests can read
 * `mock.calls[0][0]` and call `token`/`failed` without an `as`.
 */
const bridge = vi.hoisted(() => ({
  isDesktopShell: vi.fn(() => false),
  beginBrowserLogin: vi.fn(async () => undefined),
  onBrowserLogin: vi.fn(async (_handlers: LoginHandlers) => vi.fn()),
}))
vi.mock("@/lib/desktop-bridge", () => bridge)

const auth = vi.hoisted(() => ({
  social: vi.fn(async () => ({ error: null })),
  signInEmail: vi.fn(async () => ({ error: null })),
  signUpEmail: vi.fn(async () => ({ error: null })),
}))
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    signIn: { social: auth.social, email: auth.signInEmail },
    signUp: { email: auth.signUpEmail },
  },
}))

// Only `Link` is replaced; everything else in the router module is left alone.
// A real `Link` needs a router in context, and the two links on this screen
// ("Forgot password?", "Create one") are not what any test here asserts on —
// they just have to render without dragging a router set-up in behind them.
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<RouterModule>()
  return {
    ...actual,
    Link: ({
      to,
      children,
      // `search` and `params` are router props, not DOM attributes; letting
      // them spread onto the anchor makes React warn about unknown props.
      search: _search,
      params: _params,
      ...props
    }: {
      to: string
      children: React.ReactNode
      search?: unknown
      params?: unknown
    } & React.ComponentProps<"a">) => (
      <a href={to} {...props}>
        {children}
      </a>
    ),
  }
})

const replace = vi.fn()
vi.stubGlobal("location", { ...window.location, replace })

function googleButton() {
  // `/google/i` and not the full label on purpose: the button's text changes to
  // "Opening Google…" while it is pending, and several tests here look at it on
  // both sides of that change.
  return screen.getByRole<HTMLButtonElement>("button", { name: /google/i })
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  // `clearAllMocks` forgets the calls but keeps any `mockReturnValue`, so the
  // shell flag would leak from one test into every test after it.
  bridge.isDesktopShell.mockReset()
  bridge.isDesktopShell.mockReturnValue(false)
})

describe("AuthForm on the plain web", () => {
  it("signs in with Google in the page, and never touches the desktop bridge", async () => {
    render(<AuthForm mode="signin" />)
    fireEvent.click(googleButton())

    await waitFor(() =>
      expect(auth.social).toHaveBeenCalledWith({
        provider: "google",
        callbackURL: "/",
      })
    )
    expect(bridge.beginBrowserLogin).not.toHaveBeenCalled()
  })

  it("registers no shell listeners", () => {
    render(<AuthForm mode="signin" />)
    expect(bridge.onBrowserLogin).not.toHaveBeenCalled()
  })

  it("still shows the email form", () => {
    render(<AuthForm mode="signin" />)
    expect(screen.getByLabelText(/email/i)).toBeTruthy()
  })
})

describe("AuthForm inside the desktop shell", () => {
  /*
   * The form is NOT replaced in the shell. Email and password are typed in the
   * webview exactly as they are on the web — only OAuth is refused there — and
   * a screen that hid the credential fields would be taking something away for
   * no reason.
   */
  it("still shows the email form", () => {
    bridge.isDesktopShell.mockReturnValue(true)
    render(<AuthForm mode="signin" />)
    expect(screen.getByLabelText(/email/i)).toBeTruthy()
    expect(screen.getByLabelText("Password")).toBeTruthy()
  })

  it("hands the Google click to the browser instead of the webview", async () => {
    bridge.isDesktopShell.mockReturnValue(true)
    render(<AuthForm mode="signin" />)
    fireEvent.click(googleButton())

    await waitFor(() =>
      expect(bridge.beginBrowserLogin).toHaveBeenCalledTimes(1)
    )
    // The one that would fail with `disallowed_useragent` in a WKWebView.
    expect(auth.social).not.toHaveBeenCalled()
    expect(await screen.findByText(/waiting for your browser/i)).toBeTruthy()
    expect(googleButton().disabled).toBe(true)
  })

  /**
   * The ordering the whole handoff depends on.
   *
   * The Rust command resolves when the browser LAUNCHES, not when it comes
   * back, and Tauri does not replay events to a listener that registers late.
   * Register on click — invoke first, listen after — and a token that arrives
   * in the gap is dropped, with the app left waiting forever for a sign-in
   * that already succeeded. Listening on mount closes the gap by construction,
   * and this asserts the shape rather than the comment.
   */
  it("is already listening before the browser can be opened", () => {
    bridge.isDesktopShell.mockReturnValue(true)
    render(<AuthForm mode="signin" />)
    expect(bridge.onBrowserLogin).toHaveBeenCalledTimes(1)
    expect(bridge.beginBrowserLogin).not.toHaveBeenCalled()
  })

  it("enters the app when the browser posts a token back", async () => {
    bridge.isDesktopShell.mockReturnValue(true)
    render(<AuthForm mode="signin" />)
    const handlers = bridge.onBrowserLogin.mock.calls[0][0]

    handlers.token("tok en/1")
    await waitFor(() =>
      // Encoded, because a Better Auth one-time token is not guaranteed to be
      // URL-safe and a bare `/` or `&` would truncate the search param.
      expect(replace).toHaveBeenCalledWith(
        "/desktop-callback?token=tok%20en%2F1"
      )
    )
  })

  it("says what went wrong when the wait fails, and offers another go", async () => {
    bridge.isDesktopShell.mockReturnValue(true)
    render(<AuthForm mode="signin" />)
    fireEvent.click(googleButton())
    const handlers = bridge.onBrowserLogin.mock.calls[0][0]

    handlers.failed("timed_out")
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/timed out/i)
    )
    expect(googleButton().disabled).toBe(false)
    // Matched on the second clause, not on "waiting for your browser": the
    // timeout copy contains that phrase too, and a looser pattern would find
    // the error message and call the waiting line gone when it was not.
    expect(screen.queryByText(/come back once you have signed in/i)).toBeNull()
  })

  it("falls back to generic copy for a reason it does not know", async () => {
    bridge.isDesktopShell.mockReturnValue(true)
    render(<AuthForm mode="signin" />)
    fireEvent.click(googleButton())
    const handlers = bridge.onBrowserLogin.mock.calls[0][0]

    // Rust is free to grow this list ahead of the copy table; the string comes
    // over IPC unchecked, so this is a real runtime case and not a formality.
    handlers.failed("something_new" as BrowserLoginFailureReason)
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/did not finish/i)
    )
  })

  it("reports a browser that would not open at all", async () => {
    bridge.isDesktopShell.mockReturnValue(true)
    // The raw text is deliberately not shown — "no port" names an internal —
    // but the copy must still be ABOUT THIS SCREEN. This used to assert on
    // `errorMessage`'s generic fallback, "That didn't save. Try again.", which
    // is written for a time field and is nonsense under a sign-in button; the
    // test encoded the wrong copy as correct, so nothing flagged it. Matching
    // on "open your browser" is what keeps a stray `errorMessage(thrown)` from
    // creeping back in: a bare /try again/ would pass for either.
    bridge.beginBrowserLogin.mockRejectedValueOnce(new Error("no port"))
    render(<AuthForm mode="signin" />)
    fireEvent.click(googleButton())

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(
        /could not open your browser to sign in\. try again\./i
      )
    )
    expect(screen.getByRole("alert").textContent).not.toMatch(/didn't save/i)
    expect(googleButton().disabled).toBe(false)
  })

  it("unlistens on unmount", async () => {
    bridge.isDesktopShell.mockReturnValue(true)
    const unlisten = vi.fn()
    bridge.onBrowserLogin.mockResolvedValueOnce(unlisten)
    const { unmount } = render(<AuthForm mode="signin" />)
    await waitFor(() => expect(bridge.onBrowserLogin).toHaveBeenCalled())

    unmount()
    await waitFor(() => expect(unlisten).toHaveBeenCalled())
  })
})
