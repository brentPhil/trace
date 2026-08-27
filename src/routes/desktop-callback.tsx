import { useEffect, useRef, useState } from "react"
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
// A named wrapper rather than inlining the call at the ref's type position:
// `authClient.oneTimeToken.verify` is typed through better-auth's dynamically
// generated client, and `ReturnType<typeof authClient.oneTimeToken.verify>`
// on its own does not resolve to a concrete shape. Wrapping the call in an
// ordinary function lets TypeScript resolve ITS return type concretely, which
// `ReturnType<typeof verifyOneTimeToken>` below can then reuse.
function verifyOneTimeToken(token: string) {
  return authClient.oneTimeToken.verify({ token })
}

export function DesktopCallback({ token }: { token: string }) {
  const [failure, setFailure] = useState<string | null>(null)
  // Holds the in-flight (or settled) `verify` call for the token currently
  // being spent, keyed by token so a genuinely new token — a fresh navigation
  // into this route — still gets its own call.
  const attempt = useRef<{
    token: string
    promise: ReturnType<typeof verifyOneTimeToken>
  } | null>(null)

  useEffect(() => {
    if (token === "") {
      setFailure(
        "That sign-in link was incomplete. Start sign-in from the app again."
      )
      return
    }

    // Guards StrictMode's deliberate double-invoke (mount -> cleanup ->
    // mount). Unlike `use-ensure-settings.ts`'s guard around an idempotent
    // mutation — where a duplicate call just wastes a round trip — `verify`
    // is NOT idempotent: the token is single-use. Calling it a second time
    // doesn't just waste a request, it spends an already-consumed token and
    // tells the user their link expired when the first, real call actually
    // succeeded. So the guard reuses the SAME promise across invocations
    // rather than skipping the second one outright: skipping it would mean
    // the second invocation — the one StrictMode actually leaves mounted —
    // never learns how the one real call turned out, and the "Signing you
    // in…" spinner never clears. Every invocation for this token attaches
    // its own `cancelled`-guarded handler below to whichever promise is on
    // file, so the call happens exactly once but whoever is still mounted
    // when it settles still gets to act on it.
    if (attempt.current?.token !== token) {
      attempt.current = { token, promise: verifyOneTimeToken(token) }
    }

    let cancelled = false
    attempt.current.promise
      .then(({ error }) => {
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
      .catch(() => {
        // A raw network-level throw, not the normalized `{ error }` shape
        // better-fetch usually gives us. Without this the user is left on
        // "Signing you in…" forever with nothing but a console rejection —
        // no failure path here may dead-end, so route it into the same
        // alert state.
        if (cancelled) return
        setFailure(
          "Something went wrong signing you in. Start sign-in from the app again."
        )
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
