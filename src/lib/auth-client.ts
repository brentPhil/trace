import { createAuthClient } from "better-auth/react"
import { convexClient } from "@convex-dev/better-auth/client/plugins"

export const authClient = createAuthClient({
  plugins: [convexClient()],
})

/**
 * Sign out and leave via a document load rather than a client-side navigation.
 *
 * The Convex client is built with `expectAuth: true`, and Convex's guidance is
 * to reload on sign-out: without it, authenticated queries can fire against a
 * session that no longer exists. A full load also guarantees the root
 * `beforeLoad` re-runs, so no stale token survives on the server HTTP client.
 *
 * Use this everywhere instead of calling `authClient.signOut` directly, so the
 * behaviour cannot drift between screens.
 */
export async function signOutAndLeave(to = "/") {
  await authClient.signOut({
    fetchOptions: { onSuccess: () => window.location.assign(to) },
  })
}
