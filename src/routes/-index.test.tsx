import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { isRedirect } from "@tanstack/react-router"
import {
  LANDING_DESCRIPTION,
  LandingPage,
} from "@/components/landing/landing-page"
import { DESKTOP_RELEASES_URL } from "@/lib/desktop-release"
import { Route } from "@/routes/index"
import type * as RouterModuleType from "@tanstack/react-router"

type RouterModule = typeof RouterModuleType

// Link needs a router instance; these tests are about where links point, not
// about routing. Same stand-in as -desktop-login-screen.test.tsx.
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

afterEach(cleanup)

describe("/ beforeLoad", () => {
  it("sends a signed-in visitor straight to /timer", () => {
    let thrown: unknown
    try {
      Route.options.beforeLoad?.({
        context: { isAuthenticated: true },
      } as never)
    } catch (error) {
      thrown = error
    }
    expect(isRedirect(thrown)).toBe(true)
    expect((thrown as { options: { to?: string } }).options.to).toBe("/timer")
  })

  it("lets a signed-out visitor through", () => {
    expect(() =>
      Route.options.beforeLoad?.({
        context: { isAuthenticated: false },
      } as never)
    ).not.toThrow()
  })
})

describe("LandingPage", () => {
  it("points all three Create account links at /signup and all three Sign in links at /login", () => {
    render(<LandingPage />)
    const create = screen.getAllByRole("link", { name: "Create account" })
    const signIn = screen.getAllByRole("link", { name: "Sign in" })
    expect(create).toHaveLength(3)
    expect(signIn).toHaveLength(3)
    for (const a of create) expect(a.getAttribute("href")).toBe("/signup")
    for (const a of signIn) expect(a.getAttribute("href")).toBe("/login")
  })

  it("links the desktop download to the releases page", () => {
    render(<LandingPage />)
    expect(
      screen
        .getByRole("link", { name: /download for windows or macos/i })
        .getAttribute("href")
    ).toBe(DESKTOP_RELEASES_URL)
  })

  it("has exactly one h1", () => {
    render(<LandingPage />)
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1)
  })

  it("renders all five fragments, every one inert", () => {
    const { container } = render(<LandingPage />)
    const fragments = container.querySelectorAll("[data-landing-fragment]")
    expect(fragments).toHaveLength(5)
    for (const f of fragments) expect(f.hasAttribute("inert")).toBe(true)
  })

  it("scopes offline and Calendar to the web app, and never promises no rounding", () => {
    const { container } = render(<LandingPage />)
    const text = container.textContent
    expect(text).toContain("Works offline in the browser")
    expect(text).toContain("Link a calendar in the web app")
    expect(text).not.toMatch(/never (silently )?rounds/i)
  })
})

describe("/ head", () => {
  it("sets the description meta from LANDING_DESCRIPTION", async () => {
    const meta = await Route.options.head?.({} as never)
    expect(meta?.meta).toContainEqual({
      name: "description",
      content: LANDING_DESCRIPTION,
    })
  })
})
