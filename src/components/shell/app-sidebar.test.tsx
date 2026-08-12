import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { SidebarProvider } from "@/components/ui/sidebar"
import { AppSidebar, NAV_ITEMS } from "./app-sidebar"
import { renderWithRouter } from "@/test-utils/router"

afterEach(cleanup)

function mount(
  path: string,
  {
    email = "a@b.com",
    name,
    onSignOut = vi.fn(),
  }: { email?: string; name?: string; onSignOut?: () => void } = {}
) {
  render(
    renderWithRouter(
      <SidebarProvider defaultOpen>
        <AppSidebar email={email} name={name} onSignOut={onSignOut} />
      </SidebarProvider>,
      { path }
    )
  )
  return onSignOut
}

describe("AppSidebar", () => {
  it("lists exactly the five destinations, in the order of the work", () => {
    expect(NAV_ITEMS.map((item) => item.label)).toEqual([
      "Timer",
      "Reports",
      "Invoices",
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
   * `waitFor`; these need the same accommodation.
   */
  it("names the profile trigger after the signed-in account", async () => {
    mount("/timer")
    expect(await screen.findByRole("button", { name: /a@b\.com/ })).toBeTruthy()
  })

  /**
   * THE ACCESSIBLE NAME IS THE VISIBLE TEXT, in both rail states. The footer
   * this replaces swapped its label for a "⎋" glyph with `hidden`/`inline` and
   * needed an `aria-label` to repair the collapsed name; the trigger now sends
   * the same text `sr-only` instead, so there is no second string to keep in
   * sync. A display name, when there is one, is what the trigger says — the
   * email is then the subtitle rather than the headline.
   */
  it("prefers a display name over the email on the trigger", async () => {
    mount("/timer", { name: "Brent Ortega" })
    expect(await screen.findByRole("button", { name: /Brent Ortega/ })).toBeTruthy()
  })

  it("opens a profile popover holding the account's identity and Sign out", async () => {
    mount("/timer", { name: "Brent Ortega" })
    fireEvent.click(await screen.findByRole("button", { name: /Brent Ortega/ }))

    const signOut = await screen.findByRole("button", { name: "Sign out" })
    expect(signOut).toBeTruthy()
    // The identity is the popover's reason to exist, so it has to be IN the
    // popover and not merely on the trigger that opened it.
    const popup = signOut.closest('[role="dialog"]')
    expect(popup?.textContent).toContain("a@b.com")
  })

  it("calls onSignOut rather than signing out itself", async () => {
    const onSignOut = mount("/timer")
    fireEvent.click(await screen.findByRole("button", { name: /a@b\.com/ }))
    fireEvent.click(await screen.findByRole("button", { name: "Sign out" }))
    expect(onSignOut).toHaveBeenCalledTimes(1)
  })

  /**
   * Both spans inside the home link are `aria-hidden`, so `aria-label` is its
   * ONLY accessible name — nothing visible would catch a regression here.
   */
  it("names the home link after the product", async () => {
    mount("/timer")
    expect(await screen.findByRole("link", { name: "Chroneli" })).toBeTruthy()
  })
})
