import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { DesktopLogin } from "@/routes/desktop-login"
import { loopbackCallbackUrl } from "@/lib/desktop-handoff"
import type * as RouterModuleType from "@tanstack/react-router"

type RouterModule = typeof RouterModuleType

/*
 * `-desktop-login-screen.test.tsx`, NOT `-desktop-login.test.tsx`. The
 * validateSearch tests next door are a `.ts` file — they need no DOM, so they
 * belong to vitest's `unit` project — and TypeScript drops a wildcard-included
 * `.tsx` when a `.ts` of the same base name sits beside it. The collision is
 * silent in both directions: `tsc` simply never sees the file, and eslint then
 * fails it with "not found in any of the provided projects".
 */

/*
 * The whole auth client is mocked. `oneTimeToken.generate` is what these tests
 * are about; the three sign-in methods are here only because the unauthenticated
 * branch renders the real `AuthForm`, which imports them.
 */
type GenerateResult = {
  data: { token: string } | null
  error: { message: string } | null
}

const auth = vi.hoisted(() => ({
  generate: vi.fn(async (): Promise<GenerateResult> => ({
    data: { token: "tok" },
    error: null,
  })),
  social: vi.fn(async () => ({ error: null })),
  signInEmail: vi.fn(async () => ({ error: null })),
  signUpEmail: vi.fn(async () => ({ error: null })),
}))
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    oneTimeToken: { generate: auth.generate },
    signIn: { social: auth.social, email: auth.signInEmail },
    signUp: { email: auth.signUpEmail },
  },
}))

// Only `Link` is replaced — `AuthForm`'s two links need a router in context and
// are not what anything here asserts on. `createFileRoute`, which this route
// module calls at import time, comes through from the real module untouched.
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<RouterModule>()
  return {
    ...actual,
    Link: ({
      to,
      children,
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

const PORT = 52341
const STATE = "nonce-abc"

function continueButton() {
  return screen.getByRole<HTMLButtonElement>("button", {
    name: /continue to the desktop app|signing in/i,
  })
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  auth.generate.mockReset()
  auth.generate.mockResolvedValue({ data: { token: "tok" }, error: null })
})

describe("DesktopLogin with a session already in the browser", () => {
  /**
   * THE SECURITY REGRESSION TEST. Read the route's own comment for the whole
   * argument; the short version is that the URL landing here is authored by
   * whoever opened the browser and names BOTH the loopback port and the state
   * nonce. Mint on arrival and any local process can bind a port, open the
   * default browser at `/desktop-login?port=<mine>&state=<mine>`, and be handed
   * a live session token with no human involved — a silent session export, and
   * one RFC 8252 would normally have PKCE to prevent. There is no verifier in
   * this flow, so the deliberate click IS the mitigation.
   *
   * If somebody ever "optimises away the extra click", this is the test that
   * must fail.
   */
  it("does not mint a token on mount — the click is the only thing that exports a session", async () => {
    render(<DesktopLogin port={PORT} state={STATE} isAuthenticated />)

    expect(screen.getByRole("heading").textContent).toMatch(
      /sign in to the desktop app/i
    )
    expect(continueButton().textContent).toMatch(/continue to the desktop app/i)
    // Nothing async is in flight to wait for, which is the point; a flush is
    // taken anyway so an effect-based regression cannot hide behind the tick.
    await Promise.resolve()
    expect(auth.generate).not.toHaveBeenCalled()
    expect(replace).not.toHaveBeenCalled()
  })

  it("mints once on the click and hands the token to the loopback URL", async () => {
    render(<DesktopLogin port={PORT} state={STATE} isAuthenticated />)
    fireEvent.click(continueButton())

    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith(
        loopbackCallbackUrl(PORT, "tok", STATE)
      )
    )
    expect(auth.generate).toHaveBeenCalledTimes(1)
  })

  it("disables the button while the handoff is in flight", async () => {
    let release: (value: GenerateResult) => void = () => {}
    auth.generate.mockReturnValueOnce(
      new Promise<GenerateResult>((resolve) => {
        release = resolve
      })
    )
    render(<DesktopLogin port={PORT} state={STATE} isAuthenticated />)
    fireEvent.click(continueButton())

    await waitFor(() => expect(continueButton().disabled).toBe(true))
    release({ data: { token: "tok" }, error: null })
    await waitFor(() => expect(replace).toHaveBeenCalled())
    expect(auth.generate).toHaveBeenCalledTimes(1)
  })

  it("explains a refused token in place, and goes nowhere", async () => {
    auth.generate.mockResolvedValueOnce({
      data: null,
      error: { message: "no" },
    })
    render(<DesktopLogin port={PORT} state={STATE} isAuthenticated />)
    fireEvent.click(continueButton())

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(
        /could not hand your session to the desktop app/i
      )
    )
    expect(replace).not.toHaveBeenCalled()
    // Still usable: the failure is retryable and the button is the only way to
    // retry it.
    expect(continueButton().disabled).toBe(false)
  })

  it("shows the same copy for a raw throw rather than a stack trace", async () => {
    auth.generate.mockRejectedValueOnce(new Error("network down"))
    render(<DesktopLogin port={PORT} state={STATE} isAuthenticated />)
    fireEvent.click(continueButton())

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(
        /could not hand your session to the desktop app/i
      )
    )
    expect(screen.getByRole("alert").textContent).not.toMatch(/network down/i)
    expect(replace).not.toHaveBeenCalled()
  })
})

describe("DesktopLogin with no session", () => {
  it("shows the sign-in form and mints nothing", async () => {
    render(<DesktopLogin port={PORT} state={STATE} isAuthenticated={false} />)

    expect(screen.getByLabelText(/email/i)).toBeTruthy()
    expect(screen.getByRole("button", { name: /^sign in$/i })).toBeTruthy()
    await Promise.resolve()
    expect(auth.generate).not.toHaveBeenCalled()
    expect(replace).not.toHaveBeenCalled()
  })
})
