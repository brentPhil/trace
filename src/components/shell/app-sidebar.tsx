import { Link } from "@tanstack/react-router"
import { Clock, FileText, FolderKanban, Settings, Table2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar"
import type { LucideIcon } from "lucide-react"

/**
 * The five destinations, as data.
 *
 * Exported so a test can assert the set without rendering, and so the count is
 * checkable at a glance: five, and adding a sixth should be an argument, not an
 * edit. Toggl's web app has a two-level nav with a dozen entries and the tracker
 * itself is one of them.
 *
 * THE ARGUMENT FOR THE FIFTH, since this list stood at four and said so. An
 * invoice is not a view of a report. /reports answers "where did this period
 * go" and every control on it narrows a range; an invoice is a document that
 * outlives the range it was raised from, is numbered, is sent, and is later
 * looked up by its number rather than by its dates. Filing it as a mode of
 * Reports would mean the only way back to last quarter's invoice is
 * reconstructing the filter that produced it. It goes BETWEEN Reports and
 * Projects because that is the order of the work: track, review, bill, and the
 * two settings-shaped destinations stay at the end.
 */
export const NAV_ITEMS: Array<{
  to: "/timer" | "/reports" | "/invoices" | "/projects" | "/settings"
  label: string
  icon: LucideIcon
}> = [
  { to: "/timer", label: "Timer", icon: Clock },
  { to: "/reports", label: "Reports", icon: Table2 },
  { to: "/invoices", label: "Invoices", icon: FileText },
  { to: "/projects", label: "Projects", icon: FolderKanban },
  { to: "/settings", label: "Settings", icon: Settings },
]

/**
 * Pure. Takes the email it displays and the sign-out it calls, so it holds no
 * query and no mutation — the same rule every other component here follows.
 */
export function AppSidebar({
  email,
  onSignOut,
}: {
  email?: string
  onSignOut: () => void
}) {
  return (
    /*
      `border-edge-soft`, not the `--edge` the vendored sidebar defaults to.
      The rail is already separated from the page by a step of the neutral ramp
      (`--sidebar` is Surface, the page is Ground), and The Tonal Depth Rule
      says to step the ramp OR add an edge — not both. An `--edge` line here is
      heavier than every other divider in the product, so the one hairline the
      eye reads first was the one that belonged to no content.
    */
    <Sidebar collapsible="icon" className="border-edge-soft">
      {/* The only way to re-expand a collapsed rail with a mouse on desktop —
          without it ⌘B/Ctrl+B is the sole path back, and that is a shortcut
          people hit by accident reaching for bold. */}
      <SidebarRail />

      <SidebarHeader>
        {/* `to={NAV_ITEMS[0].to}`, not a `"/timer"` literal, so the header
            link always points at whatever the first nav destination is. */}
        <Link
          to={NAV_ITEMS[0].to}
          className="flex items-center gap-2 px-2 py-1.5 text-base font-medium tracking-tight"
        >
          {/* The wordmark collapses to its initial on the icon rail. */}
          <span className="group-data-[collapsible=icon]:hidden">Trace</span>
          <span className="hidden group-data-[collapsible=icon]:inline">T</span>
        </Link>
      </SidebarHeader>

      <SidebarContent>
        {/* The deleted AppHeader provided the `navigation` landmark; nothing
            replaced it when the nav moved into the rail. */}
        <nav aria-label="Main">
          <SidebarMenu>
            {NAV_ITEMS.map((item) => (
              <SidebarMenuItem key={item.to}>
                {/* `tooltip` is what makes the collapsed rail usable; it is
                    rendered only when the sidebar is collapsed.

                    The vendored SidebarMenuButton is Base UI, not Radix — it
                    composes via `render` (Base UI's useRender convention), not
                    `asChild`. `render` takes the element to clone its own props
                    onto, so the rendered DOM node stays the real `<a>` from
                    TanStack `Link`. */}
                <SidebarMenuButton
                  tooltip={item.label}
                  render={
                    <Link
                      to={item.to}
                      activeProps={{ "aria-current": "page", "data-active": true }}
                    >
                      <item.icon />
                      <span>{item.label}</span>
                    </Link>
                  }
                />
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </nav>
      </SidebarContent>

      <SidebarFooter>
        {email === undefined ? null : (
          <span className="truncate px-2 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
            {email}
          </span>
        )}
        {/*
          `aria-label` is set explicitly rather than left to the visible text,
          because jsdom applies no CSS: both spans below are always in the
          accessible name in a test, even though only one is ever on screen in
          a browser. Collapsed on a real browser, the accessible name would
          otherwise be the bare "⎋" glyph.
        */}
        <Button
          variant="ghost"
          size="sm"
          onClick={onSignOut}
          aria-label="Sign out"
          className="justify-start"
        >
          <span className="group-data-[collapsible=icon]:hidden">Sign out</span>
          <span className="hidden group-data-[collapsible=icon]:inline">⎋</span>
        </Button>
      </SidebarFooter>
    </Sidebar>
  )
}
