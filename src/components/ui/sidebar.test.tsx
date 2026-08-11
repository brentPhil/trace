import { afterEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, render } from "@testing-library/react"
import { Sidebar, SidebarProvider, SidebarRail } from "@/components/ui/sidebar"

afterEach(cleanup)

/*
 * Spec §10 called this "the one thing most likely to be silently broken":
 * `defaultOpen` controls first paint, and Cmd/Ctrl+B is the only way to
 * expand the rail without a mouse below `md`. Neither had a test.
 */
describe("SidebarProvider", () => {
  it("renders collapsed on first paint when defaultOpen is false, and Cmd/Ctrl+B toggles it", () => {
    const { container } = render(
      <SidebarProvider defaultOpen={false}>
        <Sidebar>content</Sidebar>
      </SidebarProvider>
    )
    const sidebar = container.querySelector('[data-slot="sidebar"]')
    expect(sidebar).toHaveAttribute("data-state", "collapsed")

    fireEvent.keyDown(window, { key: "b", metaKey: true })
    expect(sidebar).toHaveAttribute("data-state", "expanded")

    fireEvent.keyDown(window, { key: "b", ctrlKey: true })
    expect(sidebar).toHaveAttribute("data-state", "collapsed")
  })
})

function mountRail(defaultOpen: boolean) {
  const { container } = render(
    <SidebarProvider defaultOpen={defaultOpen}>
      <Sidebar collapsible="icon">
        <SidebarRail />
      </Sidebar>
    </SidebarProvider>
  )
  const rail = container.querySelector('[data-slot="sidebar-rail"]')
  if (rail === null) throw new Error("SidebarRail did not render")
  return { container, rail }
}

/*
 * The rail used to be centred ON the divider — 16px wide, half of it lying
 * over the page. Measured at 256px expanded it occupied x 247→263 against a
 * divider at 255, so the leftmost 8px of every entry row in the log showed an
 * `e-resize` cursor and swallowed the click. Nothing about that is visible,
 * which is why it survived: the only trace is a click that does not land.
 */
describe("SidebarRail", () => {
  /*
   * ASSERTED ON THE CLASS LIST, not on a rect. jsdom has no layout engine and
   * no Tailwind at test time, so every `getBoundingClientRect` here is zeroes
   * and a geometric assertion would pass against any rail at all. What the
   * class list can still carry is the one property this fix is about: no
   * utility that moves the rail OUTWARD, past the sidebar's own edge.
   */
  it("carries nothing that reaches past the sidebar's own edge, in either state", () => {
    for (const defaultOpen of [true, false]) {
      const { rail } = mountRail(defaultOpen)
      const classes = rail.className
        .split(/\s+/)
        // The `offcanvas` overrides are excluded deliberately, and the reason
        // is in sidebar.tsx: that mode puts the whole sidebar off screen, so
        // its rail has no sidebar edge left to sit inside. This product never
        // mounts it.
        .filter((name) => !name.includes("offcanvas"))

      // A negative inset hangs the rail off the sidebar. `-px` is the
      // sidebar's own 1px border — sidebar, not page — and is the only one
      // permitted.
      expect(classes.filter((n) => /(?:^|:)-(?:right|left)-(?!px$)/.test(n))).toEqual([])

      // …and nothing may shift it afterwards either. `-translate-x-1/2` on a
      // 16px rail is precisely how 8px of it ended up over the log.
      expect(classes.filter((n) => n.includes("translate-x"))).toEqual([])

      cleanup()
    }
  })

  /*
   * The other half of the same fix, and the reason it could not simply be
   * deleted: `SidebarTrigger` is `md:hidden` (app-shell.tsx), so on desktop
   * this rail is the only mouse path back from a collapsed sidebar.
   */
  it("still toggles a collapsed sidebar back open, and still shows the divider line", () => {
    const { container, rail } = mountRail(false)
    const sidebar = container.querySelector('[data-slot="sidebar"]')
    expect(sidebar).toHaveAttribute("data-state", "collapsed")

    fireEvent.click(rail)
    expect(sidebar).toHaveAttribute("data-state", "expanded")

    // The 2px hover line is the only thing that makes the rail discoverable at
    // all, so it is part of the affordance rather than decoration on it.
    expect(rail.className).toContain("hover:after:bg-sidebar-border")
  })
})
