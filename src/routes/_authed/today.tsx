import { createFileRoute } from "@tanstack/react-router"
import { useSuspenseQuery } from "@tanstack/react-query"
import { convexQuery } from "@convex-dev/react-query"
import { Button } from "@/components/ui/button"
import { signOutAndLeave } from "@/lib/auth-client"
import { api } from "../../../convex/_generated/api"

export const Route = createFileRoute("/_authed/today")({
  head: () => ({ meta: [{ title: "Today — Trace" }] }),
  component: Today,
  loader: async ({ context }) => {
    // The protected variant, which throws for anonymous callers. Reaching this
    // loader means the _authed guard already passed, so a throw here would
    // indicate the server disagrees with the client about the session.
    await context.queryClient.ensureQueryData(
      convexQuery(api.auth.getAuthenticatedUser, {})
    )
  },
})

// Placeholder. This is where the timer and the day's entries will live; it
// exists now as the first real surface behind the auth guard.
function Today() {
  const { data: user } = useSuspenseQuery(
    convexQuery(api.auth.getAuthenticatedUser, {})
  )

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-2xl flex-col gap-8 p-6">
      <header className="flex items-baseline justify-between">
        <span className="text-base font-medium tracking-tight">Trace</span>
        <Button variant="ghost" size="sm" onClick={() => signOutAndLeave()}>
          Sign out
        </Button>
      </header>

      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-medium tracking-tight">Today</h1>
        <p className="text-sm text-muted-foreground">
          Signed in as <span className="text-foreground">{user.email}</span>.
          The timer and today&apos;s entries will live here.
        </p>
      </div>
    </main>
  )
}
