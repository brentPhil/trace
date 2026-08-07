import { createFileRoute } from "@tanstack/react-router"
import { useSuspenseQuery } from "@tanstack/react-query"
import { convexQuery } from "@convex-dev/react-query"
import { AppHeader } from "@/components/app-header"
import { api } from "../../../convex/_generated/api"

export const Route = createFileRoute("/_authed/settings")({
  head: () => ({ meta: [{ title: "Settings — Trace" }] }),
  component: Settings,
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(convexQuery(api.settings.get, {})),
      context.queryClient.ensureQueryData(
        convexQuery(api.auth.getAuthenticatedUser, {})
      ),
    ])
  },
})

function Settings() {
  const { data: user } = useSuspenseQuery(
    convexQuery(api.auth.getAuthenticatedUser, {})
  )

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-4xl flex-col">
      <AppHeader email={user.email} />
      <main className="flex-1 px-4 py-6">
        <h1 className="text-sm font-semibold">Settings</h1>
      </main>
    </div>
  )
}
