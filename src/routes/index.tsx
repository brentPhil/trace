import { Link, createFileRoute, redirect } from "@tanstack/react-router"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { APP_NAME } from "@shared/brand"

export const Route = createFileRoute("/")({
  /**
   * Signed in means straight to the app.
   *
   * This is the one place worth doing it, rather than changing where `/login`
   * sends people. Sign-in, sign-up, an old bookmark and a typed bare domain all
   * arrive here, and `safeRedirect` falls back to `/` whenever a `?redirect=`
   * is absent or rejected — so fixing the login route alone would still leave
   * four ways to land on a page whose only content is a link to the real one.
   *
   * `beforeLoad` rather than the component: redirecting from render means the
   * interstitial is painted first and then replaced, which is the flash this
   * removes.
   */
  beforeLoad: ({ context }) => {
    if (context.isAuthenticated) throw redirect({ to: "/timer" })
  },
  component: App,
})

/**
 * The signed-OUT landing page, and only that.
 *
 * There is no signed-in branch here any more: `beforeLoad` above sends an
 * authenticated visitor to `/timer` before this renders, so a branch for them
 * would be unreachable code that still had to be kept working. Someone whose
 * session is not recognised sees this page, and "Sign in" is the way back —
 * which is the same escape hatch the old branch's Sign out button provided.
 */
function App() {
  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <span className="text-base font-medium tracking-tight">{APP_NAME}</span>

        <p className="text-sm text-muted-foreground">
          Track what you worked on, and what you got done.
        </p>
        <div className="flex gap-3">
          {/* Real anchors styled as buttons: these navigate, so <a> is the
              correct element. Base UI's Button takes `render`, not
              `asChild`, and neither is needed here. */}
          <Link
            to="/login"
            search={{ redirect: undefined }}
            className={cn(buttonVariants())}
          >
            Sign in
          </Link>
          <Link
            to="/signup"
            search={{ redirect: undefined }}
            className={cn(buttonVariants({ variant: "outline" }))}
          >
            Create account
          </Link>
        </div>
      </div>
    </main>
  )
}
