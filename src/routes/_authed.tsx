import {
  Link,
  Outlet,
  createFileRoute,
  redirect,
  useLocation,
} from "@tanstack/react-router"
import { ConvexError } from "convex/values"
import { buttonVariants } from "@/components/ui/button"
import { AuthShell } from "@/components/auth-shell"
import { cn } from "@/lib/utils"

/**
 * Pathless layout route. Anything nested under `_authed/` requires a session.
 *
 * This is a UX guard, not a security boundary: it decides what renders, and
 * nothing more. A direct call to a Convex function bypasses it entirely, so
 * every protected function must still call `requireUser` in convex/auth.ts.
 */
export const Route = createFileRoute("/_authed")({
  beforeLoad: ({ context, location }) => {
    if (!context.isAuthenticated) {
      throw redirect({
        to: "/login",
        // Where to return to once signed in. Validated on the way back out —
        // see safeRedirect in src/lib/redirect.ts.
        search: { redirect: location.href },
      })
    }
  },
  errorComponent: AuthedErrorBoundary,
  component: () => <Outlet />,
})

/**
 * Catches the case where the client believes it is authenticated but the server
 * disagrees — an expired session, or a Convex token that no longer verifies
 * (see convex/maintenance.ts for how a BETTER_AUTH_SECRET change causes that).
 *
 * Without this, `requireUser` throwing inside a loader puts the user on a raw
 * error screen with no way back. That reads as "the app is broken" mid-session,
 * which is exactly what PRODUCT.md's "never lose time" principle rules out.
 *
 * This renders a route back rather than redirecting automatically: if the
 * server keeps rejecting the session, an automatic redirect would bounce
 * between here and /login indefinitely.
 */
function AuthedErrorBoundary({ error }: { error: Error }) {
  const location = useLocation()

  const isAuthError =
    error instanceof ConvexError &&
    typeof error.data === "object" &&
    error.data !== null &&
    (error.data as { code?: unknown }).code === "UNAUTHENTICATED"

  if (!isAuthError) {
    throw error
  }

  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <AuthShell
        heading="Your session has ended"
        focusHeading
        className="w-full max-w-sm"
      >
        <p className="text-sm text-muted-foreground">
          Sign in again to pick up where you left off.
        </p>
        <div>
          <Link
            to="/login"
            search={{ redirect: location.href }}
            className={cn(buttonVariants())}
          >
            Sign in
          </Link>
        </div>
      </AuthShell>
    </main>
  )
}
