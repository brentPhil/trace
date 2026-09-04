import { createAuthClient } from "better-auth/react"
import { convexClient } from "@convex-dev/better-auth/client/plugins"
import { oneTimeTokenClient } from "better-auth/client/plugins"

export const authClient = createAuthClient({
  plugins: [convexClient(), oneTimeTokenClient()],
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
 *
 * `before` runs first and cannot prevent sign-out: it is what clears the
 * device (see `clearLocalData`) ahead of the request, and a failure to clear
 * a cache must not leave the user unable to leave. The real cleanup already
 * catches both of its own inner calls, so this `.catch` is belt-and-braces —
 * a `before` a future caller passes that does NOT catch its own rejection
 * still must not strand the user signed in.
 *
 * The default is a no-op for callers with no local state to clear — screens
 * outside the authed shell, which never had a `SnapshotStore` to hand it.
 */
export async function signOutAndLeave(
  before: () => Promise<void> = async () => undefined,
  to = "/"
) {
  await before().catch(() => undefined)
  await authClient.signOut({
    fetchOptions: { onSuccess: () => window.location.assign(to) },
  })
}
