import { useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useSuspenseQuery } from "@tanstack/react-query"
import { convexQuery } from "@convex-dev/react-query"
import { Button } from "@/components/ui/button"
import { authClient } from "@/lib/auth-client"
import { api } from "../../convex/_generated/api"

export const Route = createFileRoute("/")({
  component: App,
  loader: async ({ context }) => {
    // Prefetches on the server so the values are in the HTML, then the same
    // queries go live over the websocket after hydration. getCurrentUser is the
    // one that proves authenticated SSR: it only resolves to a user if
    // beforeLoad managed to put a token on the server HTTP client.
    await Promise.all([
      context.queryClient.ensureQueryData(convexQuery(api.healthcheck.get, {})),
      context.queryClient.ensureQueryData(
        convexQuery(api.auth.getCurrentUser, {})
      ),
    ])
  },
})

function App() {
  const { data } = useSuspenseQuery(convexQuery(api.healthcheck.get, {}))

  return (
    <div className="flex min-h-svh p-6">
      <div className="flex max-w-md min-w-0 flex-col gap-6 text-sm leading-loose">
        <div>
          <h1 className="font-medium">Convex connected</h1>
          <p>
            Healthcheck says <code>{JSON.stringify(data)}</code>. View source to
            confirm this rendered on the server.
          </p>
        </div>
        <AuthPanel />
      </div>
    </div>
  )
}

// Scaffolding, not product UI. Exists to verify sign-up, session persistence
// and sign-out end to end. Replace it when real auth screens are built.
function AuthPanel() {
  // Read the user through Convex rather than authClient.useSession(), which is
  // client-only and would render a placeholder during SSR.
  const { data: user } = useSuspenseQuery(
    convexQuery(api.auth.getCurrentUser, {})
  )
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)

  const run = async (
    fn: () => Promise<{ error?: { message?: string } | null }>
  ) => {
    setError(null)
    const { error: failure } = await fn()
    if (failure) {
      setError(failure.message ?? "Something went wrong")
    }
  }

  if (user) {
    return (
      <div className="flex flex-col items-start gap-2">
        <p>
          Signed in as <strong>{user.email}</strong>
        </p>
        <Button
          onClick={() =>
            authClient.signOut({
              // Recommended with expectAuth: true, so authenticated queries do
              // not fire before auth is ready again.
              fetchOptions: { onSuccess: () => location.reload() },
            })
          }
        >
          Sign out
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <input
        className="w-full rounded border px-2 py-1"
        type="email"
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <input
        className="w-full rounded border px-2 py-1"
        type="password"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <div className="flex gap-2">
        <Button
          onClick={() =>
            run(() => authClient.signUp.email({ email, password, name: email }))
          }
        >
          Sign up
        </Button>
        <Button
          variant="outline"
          onClick={() =>
            run(() => authClient.signIn.email({ email, password }))
          }
        >
          Sign in
        </Button>
      </div>
      {error && <p className="text-red-500">{error}</p>}
    </div>
  )
}
