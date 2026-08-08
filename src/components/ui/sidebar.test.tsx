import { afterEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, render } from "@testing-library/react"
import { Sidebar, SidebarProvider } from "@/components/ui/sidebar"

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
