import { createFileRoute } from "@tanstack/react-router"
import { useSuspenseQuery } from "@tanstack/react-query"
import { convexQuery } from "@convex-dev/react-query"
import { AppHeader } from "@/components/app-header"
import { api } from "../../../convex/_generated/api"

export const Route = createFileRoute("/_authed/history")({
  head: () => ({ meta: [{ title: "History — Trace" }] }),
  component: History,
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(
      convexQuery(api.auth.getAuthenticatedUser, {})
    )
  },
})

function History() {
  const { data: user } = useSuspenseQuery(
    convexQuery(api.auth.getAuthenticatedUser, {})
  )

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-4xl flex-col">
      <AppHeader email={user.email} />
      <main className="flex-1 px-4 py-6">
        <h1 className="text-sm font-semibold">History</h1>
      </main>
    </div>
  )
}
