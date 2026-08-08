import { Link } from "@tanstack/react-router"
import { Button } from "@/components/ui/button"
import { signOutAndLeave } from "@/lib/auth-client"
import { cn } from "@/lib/utils"

/**
 * The one navigation surface.
 *
 * Four destinations and no more. A time tracker that grows a sidebar has
 * started organising itself rather than the user's day — Toggl's web app has a
 * two-level nav with a dozen entries, and the tracker itself is one of them.
 *
 * "Today" is deliberately first and deliberately named for the day rather than
 * "Timer": the product's claim is that you can see what you did, not that it
 * has a stopwatch in it.
 */
export function AppHeader({ email }: { email?: string }) {
  return (
    // `flex-wrap` and `min-w-0` on the nav, because neither was here and the
    // header could not fit 375px: four nav labels plus the wordmark plus Sign
    // out come to roughly 410px of intrinsic content, and a flex item defaults
    // to `min-width: auto` so the nav could not shrink to let it. The 375px
    // audit that fixed the timer bar measured the design harness, which never
    // rendered this component — so this surface had never been looked at narrow.
    <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3">
      <div className="flex min-w-0 flex-1 items-baseline gap-5">
        <Link to="/today" className="shrink-0 text-base font-medium tracking-tight">
          Trace
        </Link>
        <nav className="flex min-w-0 items-baseline gap-4 overflow-x-auto text-sm">
          <NavLink to="/today">Today</NavLink>
          <NavLink to="/history">History</NavLink>
          <NavLink to="/projects">Projects</NavLink>
          <NavLink to="/settings">Settings</NavLink>
        </nav>

      </div>

      <span className="flex shrink-0 items-baseline gap-3 text-xs text-muted-foreground">
        {email === undefined ? null : (
          <span className="hidden truncate md:inline">{email}</span>
        )}
        <Button variant="ghost" size="sm" onClick={() => signOutAndLeave()}>
          Sign out
        </Button>
      </span>
    </header>
  )
}

/**
 * The active link is marked with weight and an underline, never colour alone.
 * `aria-current` is what a screen reader reads; the underline is what everyone
 * else does.
 */
function NavLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      activeProps={{
        "aria-current": "page",
        className: "font-medium text-foreground underline underline-offset-4",
      }}
      inactiveProps={{ className: "text-muted-foreground hover:text-foreground" }}
      className={cn(
        "rounded-sm transition-colors",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      )}
    >
      {children}
    </Link>
  )
}
