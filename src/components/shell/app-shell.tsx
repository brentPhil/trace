import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/shell/app-sidebar"
import { cn } from "@/lib/utils"
import type { ReactNode } from "react"

/**
 * The dashboard frame: sidebar, timer bar, content.
 *
 * The timer bar is passed in rather than constructed here, so this file stays
 * layout and the running-entry wiring stays in the route that owns the queries.
 *
 * `sidebarDefaultOpen` comes from the request cookie, read in _authed.tsx. It
 * is not optional-with-a-default on purpose: forgetting to thread it through is
 * exactly the bug that produces a 208px layout jump on every load, and a
 * required prop makes that a type error instead of a subtle regression.
 */
export function AppShell({
  children,
  email,
  onSignOut,
  sidebarDefaultOpen,
  timer,
}: {
  children: ReactNode
  email?: string
  onSignOut: () => void
  sidebarDefaultOpen: boolean
  timer: ReactNode
}) {
  return (
    <SidebarProvider defaultOpen={sidebarDefaultOpen}>
      <AppSidebar email={email} onSignOut={onSignOut} />

      <SidebarInset className="min-w-0">
        {/*
          Below `md` the bar is pinned to the BOTTOM of the viewport rather than
          sitting at the top of the document.

          On a phone the start control belongs under the thumb, not behind a
          scroll — and the log is what you scroll, so the one control pressed
          twenty times a day must not scroll away with it. It is in the shell
          now, so that holds on every page rather than only on Today.

          Toggl has publicly declined to fix its mobile web app. This is the
          surface the incumbent abandoned, and it costs one breakpoint.
        */}
        <div
          className={cn(
            "fixed inset-x-0 bottom-0 z-30 flex items-center gap-2",
            "border-t border-edge-soft bg-ground px-3 pt-2",
            "pb-[max(0.5rem,env(safe-area-inset-bottom))]",
            "md:static md:z-auto md:border-t-0 md:bg-transparent",
            "md:gap-3 md:px-4 md:pt-3 md:pb-0"
          )}
        >
          {/* The hamburger. Hidden on desktop, where the rail is always there
              and ⌘B toggles it. */}
          <SidebarTrigger className="shrink-0 md:hidden" />
          <div className="min-w-0 flex-1">{timer}</div>
        </div>

        <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-0 md:px-2">
          {children}
        </div>

        {/*
          Reserves the fixed bar's height so the last row of a log can always be
          scrolled clear of it. Sized generously — the bar grows a second line
          while recording — because a too-small spacer hides the newest entry,
          which is the one being worked on.
        */}
        <div aria-hidden="true" className="h-[6.5rem] shrink-0 md:hidden" />
      </SidebarInset>
    </SidebarProvider>
  )
}
