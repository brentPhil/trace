import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { SidebarProvider } from "@/components/ui/sidebar"
import { AppSidebar, NAV_ITEMS } from "./app-sidebar"
import { renderWithRouter } from "@/test-utils/router"

afterEach(cleanup)

function mount(path: string, onSignOut = vi.fn()) {
  render(
    renderWithRouter(
      <SidebarProvider defaultOpen>
        <AppSidebar email="a@b.com" onSignOut={onSignOut} />
      </SidebarProvider>,
      { path }
    )
  )
  return onSignOut
}

describe("AppSidebar", () => {
  it("lists exactly the four destinations", () => {
    expect(NAV_ITEMS.map((item) => item.label)).toEqual([
      "Timer",
      "Reports",
      "Projects",
      "Settings",
    ])
  })

  /**
   * `aria-current` is what a screen reader announces. The visual treatment is
   * a separate concern and must never be the only carrier — the header this
   * replaces was explicit about that and the rule does not change.
   */
  it("marks the current page with aria-current", async () => {
    mount("/reports")
    await waitFor(() =>
      expect(screen.getByRole("link", { name: "Reports" })).toHaveAttribute(
        "aria-current",
        "page"
      )
    )
    expect(screen.getByRole("link", { name: "Timer" })).not.toHaveAttribute(
      "aria-current"
    )
  })

  /**
   * `findByText`/`findByRole` (not `getByText`/`getByRole`), because
   * `RouterProvider` renders nothing on its first, synchronous pass — TanStack
   * Router's `Transitioner` resolves the initial match in a `useLayoutEffect`
   * that calls the async `router.load()`, so content appears only after a
   * tick. The "aria-current" test above already accounts for this with
   * `waitFor`; these two need the same accommodation.
   */
  it("shows the signed-in email", async () => {
    mount("/timer")
    expect(await screen.findByText("a@b.com")).toBeTruthy()
  })

  it("calls onSignOut rather than signing out itself", async () => {
    const onSignOut = mount("/timer")
    fireEvent.click(await screen.findByRole("button", { name: /sign out/i }))
    expect(onSignOut).toHaveBeenCalledTimes(1)
  })
})
