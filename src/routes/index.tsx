import { Link, createFileRoute } from "@tanstack/react-router"
import { useSuspenseQuery } from "@tanstack/react-query"
import { convexQuery } from "@convex-dev/react-query"
import { Button, buttonVariants } from "@/components/ui/button"
import { signOutAndLeave } from "@/lib/auth-client"
import { cn } from "@/lib/utils"
import { api } from "../../convex/_generated/api"

export const Route = createFileRoute("/")({
  component: App,
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(
      convexQuery(api.auth.getCurrentUser, {})
    )
  },
})

function App() {
  const { data: user } = useSuspenseQuery(
    convexQuery(api.auth.getCurrentUser, {})
  )

  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <span className="text-base font-medium tracking-tight">Trace</span>

        {user ? (
          <>
            <p className="text-sm text-muted-foreground">
              Signed in as <span className="text-foreground">{user.email}</span>
              .
            </p>
            <div className="flex gap-3">
              <Link to="/today" className={cn(buttonVariants())}>
                Go to today
              </Link>
              <Button variant="outline" onClick={() => signOutAndLeave()}>
                Sign out
              </Button>
            </div>
          </>
        ) : (
          <>
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
          </>
        )}
      </div>
    </main>
  )
}
