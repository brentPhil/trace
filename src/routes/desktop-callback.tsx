import { useEffect, useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { authClient } from "@/lib/auth-client"
import { pageTitle } from "@shared/brand"

/**
 * The webview's half of the handoff: trade the one-time token for a session.
 *
 * `verify` sets the session cookie itself, and the cookie is first-party on
 * this origin because `convex/auth.ts` sets `baseURL` to the site URL and
 * `/api/auth/$` proxies to Convex. That is the whole reason this design works
 * without cross-site cookie handling — a token verified here lands in exactly
 * the jar the app reads.
 *
 * `location.replace` rather than `assign`, so the URL carrying a spent token
 * is not left in the webview's history as a back-button target.
 */
export function DesktopCallback({ token }: { token: string }) {
  const [failure, setFailure] = useState<string | null>(null)

  useEffect(() => {
    if (token === "") {
      setFailure(
        "That sign-in link was incomplete. Start sign-in from the app again."
      )
      return
    }
    let cancelled = false
    authClient.oneTimeToken.verify({ token }).then(({ error }) => {
      if (cancelled) return
      if (error) {
        // The overwhelmingly likely cause is the two-minute expiry, and it is
        // the only one the user can do anything about.
        setFailure(
          "That sign-in link expired. Start sign-in from the app again."
        )
        return
      }
      location.replace("/timer")
    })
    return () => {
      cancelled = true
    }
  }, [token])

  return (
    <main className="flex min-h-svh [align-items:safe_center] justify-center p-6">
      {failure === null ? (
        <p className="text-muted-foreground text-sm">Signing you in…</p>
      ) : (
        <p role="alert" className="max-w-sm text-center text-sm">
          {failure}
        </p>
      )}
    </main>
  )
}

export const Route = createFileRoute("/desktop-callback")({
  head: () => ({ meta: [{ title: pageTitle("Signing in") }] }),
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search.token === "string" ? search.token : "",
  }),
  component: function DesktopCallbackRoute() {
    const { token } = Route.useSearch()
    return <DesktopCallback token={token} />
  },
})
