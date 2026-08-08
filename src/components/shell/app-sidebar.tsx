import { Link } from "@tanstack/react-router"
import { Clock, FolderKanban, Settings, Table2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import type { LucideIcon } from "lucide-react"

/**
 * The four destinations, as data.
 *
 * Exported so a test can assert the set without rendering, and so the count is
 * checkable at a glance: four, and adding a fifth should be an argument, not an
 * edit. Toggl's web app has a two-level nav with a dozen entries and the tracker
 * itself is one of them.
 */
export const NAV_ITEMS: Array<{ to: string; label: string; icon: LucideIcon }> = [
  { to: "/timer", label: "Timer", icon: Clock },
  { to: "/reports", label: "Reports", icon: Table2 },
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
    <Sidebar collapsible="icon">
      <SidebarHeader>
        {/* `to={NAV_ITEMS[0].to}`, not a `"/timer"` literal. `/timer` itself
            landed in Task 10 (renaming `/today`) and would typecheck fine now,
            but `NAV_ITEMS` is typed as a group and `/reports` — Task 11's
            rename of `/history` — does not exist in the route tree yet, so
            tightening the array's `to` field to a literal union still fails
            compilation. Routing through the already-`string`-typed NAV_ITEMS
            entry widens the type before it reaches `Link`, same destination
            either way; revisit once `/reports` lands. */}
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
      </SidebarContent>

      <SidebarFooter>
        {email === undefined ? null : (
          <span className="truncate px-2 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
            {email}
          </span>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={onSignOut}
          className="justify-start"
        >
          <span className="group-data-[collapsible=icon]:hidden">Sign out</span>
          <span className="hidden group-data-[collapsible=icon]:inline">⎋</span>
        </Button>
      </SidebarFooter>
    </Sidebar>
  )
}
