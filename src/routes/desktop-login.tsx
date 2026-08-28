import { useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { AuthBackdrop } from "@/components/auth-backdrop"
import { AuthError, AuthShell } from "@/components/auth-shell"
import { AuthForm } from "@/components/auth-form"
import { Button } from "@/components/ui/button"
import { authClient } from "@/lib/auth-client"
import { loopbackCallbackUrl, parsePort } from "@/lib/desktop-handoff"
import { pageTitle } from "@shared/brand"

/**
 * Thrown by `beforeLoad` below for a handshake that cannot be completed.
 *
 * A distinct class rather than a bare `Error`, so `DesktopLoginError` below
 * can tell "this route's own fatal message" apart from anything else that
 * might throw during load (a network failure, a bug) and rethrow those
 * instead of hiding them behind the wrong copy — the same shape
 * `AuthedErrorBoundary` in `_authed.tsx` uses to recognise its own case.
 */
class DesktopHandoffError extends Error {}

/**
 * Shown in place when the token could not be minted. A literal in the same
 * register as `FAILURE_COPY` in `auth-form.tsx`: what failed, and the one
 * thing the person can do about it.
 */
const HANDOFF_FAILURE_COPY =
  "Could not hand your session to the desktop app. Start sign-in from the app again."

/**
 * Where the desktop shell sends your real browser to sign in.
 *
 * NOTHING IS MINTED DURING LOAD, and both halves of that are deliberate.
 *
 * FIRST, IT CANNOT WORK THERE. `beforeLoad` runs on the server. Better Auth
 * resolves its baseURL from `window` when none is configured, and with no
 * `window` it is left holding the bare relative string "/api/auth" — so
 * `oneTimeToken.generate()` throws `TypeError: Failed to parse URL` before it
 * ever reaches the network. That TypeError is not a `DesktopHandoffError`, so
 * the error screen below rethrows it and there is no root `errorComponent` to
 * catch it: every signed-in handoff died on a blank page, and so did the
 * email/password path, because submitting the form re-enters this route
 * authenticated. Even given an absolute URL it would only have traded the
 * crash for a 401 — an SSR-side fetch carries none of the browser's cookies,
 * which are the entire basis on which a token would be issued. Generation
 * belongs where the session lives: in the browser, on a click, with
 * `window.location.origin` to resolve against.
 *
 * SECOND, THE CLICK IS A SECURITY CONTROL, NOT FRICTION. The URL that lands
 * here is authored by whoever opened the browser, and it carries BOTH the
 * loopback port and the `state` nonce. So a zero-click fast path — mint on
 * arrival, redirect to whatever port the query string names — lets any local
 * process bind a port of its own, open the default browser at
 * `/desktop-login?port=<mine>&state=<mine>`, and receive a full session token
 * from an already-signed-in browser with no human involved at any point. That
 * is a silent session export. RFC 8252's loopback redirect is only safe
 * because PKCE binds the response to the client that started the exchange;
 * there is no verifier anywhere in this flow, and a person deliberately
 * pressing a button naming the app is what stands in its place.
 *
 * So the button is load-bearing. "Optimise away the extra click" is the exact
 * regression to write a test against, and
 * `src/routes/-desktop-login-screen.test.tsx` has one.
 *
 * `redirectTo` points back at THIS route, query string and all. `AuthForm`
 * uses it as Google's `callbackURL` and as the assign target after an
 * email/password sign-in, so both paths return here authenticated and land on
 * the confirm screen. That is why this needs no success callback of its own.
 */
export const Route = createFileRoute("/desktop-login")({
  head: () => ({ meta: [{ title: pageTitle("Sign in to the desktop app") }] }),
  /*
   * `port` is accepted as a NUMBER as well as a string, and that is not
   * defensive typing — it is the only shape it ever actually arrives in.
   *
   * TanStack Router JSON-parses search values, so the shell's `?port=52341`
   * reaches this function as the number 52341. A `typeof === "string"` test
   * therefore rejected every real port, `validateSearch` dropped the key, and
   * the router normalised it back out of the URL — turning every sign-in into
   * "this link is missing information from the desktop app" with the shell
   * waiting on a callback that could never come. A live run caught it; nothing
   * in the unit tests could, because they call `parsePort` directly and never
   * cross the router.
   *
   * Validation still belongs to `parsePort`, which takes `unknown` and is
   * strict about the range. This only has to stop discarding it.
   */
  validateSearch: (search: Record<string, unknown>) => ({
    port:
      typeof search.port === "string" || typeof search.port === "number"
        ? search.port
        : undefined,
    state: typeof search.state === "string" ? search.state : undefined,
  }),
  /*
   * All that is left here is the check that needs no browser: is this link
   * even completable? A malformed handshake is not something the user can fix
   * by signing in, so do not show them a form that cannot lead anywhere.
   *
   * The parsed port and state are returned into route context rather than
   * re-derived in the component, so the component receives the values this
   * gate already proved good and does not have to restate a "cannot happen"
   * branch for a null port.
   */
  beforeLoad: ({ search }) => {
    const port = parsePort(search.port)
    const state = search.state
    if (port === null || !state) {
      throw new DesktopHandoffError(
        "This sign-in link is missing information from the desktop app. Start sign-in from the app again."
      )
    }
    return { port, state }
  },
  errorComponent: DesktopHandoffErrorScreen,
  component: DesktopLoginRoute,
})

/**
 * Renders the fatal-handshake message in place of a blank screen or a raw
 * stack trace. Anything that is not this route's own `DesktopHandoffError` is
 * rethrown, the same way `AuthedErrorBoundary` lets a non-auth error escape
 * to whatever boundary sits above it rather than mislabelling it.
 */
function DesktopHandoffErrorScreen({ error }: { error: Error }) {
  if (!(error instanceof DesktopHandoffError)) {
    throw error
  }

  return (
    <main className="relative flex min-h-svh [align-items:safe_center] justify-center p-6">
      <AuthBackdrop />
      <AuthShell
        heading="Can't sign in to the desktop app"
        focusHeading
        className="w-full max-w-sm"
      >
        <p className="text-sm text-muted-foreground">{error.message}</p>
      </AuthShell>
    </main>
  )
}

/**
 * The screen itself, exported apart from the route so it can be rendered in a
 * test without standing up a router — the same split `desktop-callback.tsx`
 * makes for `DesktopCallback`.
 *
 * `isAuthenticated` is a PROP rather than something read here, and that is
 * what makes branching the rendered tree on it safe. The value comes from the
 * root route's `beforeLoad`, which reads the session cookie on the server, so
 * the server and the client agree on it before the first byte — unlike
 * `isDesktopShell()`, which the server cannot see and which therefore may only
 * ever be read inside a click handler (see `auth-form.tsx`).
 */
export function DesktopLogin({
  port,
  state,
  isAuthenticated,
}: {
  port: number
  state: string
  isAuthenticated: boolean
}) {
  const [handingOff, setHandingOff] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  async function handOff() {
    if (handingOff) return
    setFailure(null)
    setHandingOff(true)

    try {
      // Client-only by construction: this runs from a click, so `window`
      // exists, Better Auth resolves an absolute baseURL from the current
      // origin, and the request carries the session cookie that is the whole
      // reason a token can be issued at all. None of those three things are
      // true during SSR — see the route comment above.
      const { data, error } = await authClient.oneTimeToken.generate()
      if (error || !data.token) {
        setFailure(HANDOFF_FAILURE_COPY)
        setHandingOff(false)
        return
      }
      // A full document load, not a router navigation: the target is a local
      // HTTP server, not a route in this app. `replace` rather than `assign`,
      // so the URL that just minted a session token is not left in history as
      // a back-button target.
      window.location.replace(loopbackCallbackUrl(port, data.token, state))
    } catch {
      // A raw network-level throw rather than the normalised `{ error }`
      // shape. Same destination: no failure path here may dead-end on a
      // button that just looks stuck, and none may show a raw error.
      setFailure(HANDOFF_FAILURE_COPY)
      setHandingOff(false)
    }
  }

  if (!isAuthenticated) {
    const back = `/desktop-login?port=${port}&state=${encodeURIComponent(state)}`
    return (
      <main className="relative flex min-h-svh [align-items:safe_center] justify-center p-6">
        <AuthBackdrop />
        <div className="w-full max-w-sm space-y-4">
          <p className="text-center text-sm text-muted-foreground">
            Signing in to the Chroneli desktop app.
          </p>
          <AuthForm mode="signin" redirectTo={back} />
        </div>
      </main>
    )
  }

  return (
    <main className="relative flex min-h-svh [align-items:safe_center] justify-center p-6">
      <AuthBackdrop />
      <AuthShell
        heading="Sign in to the desktop app"
        focusHeading
        className="w-full max-w-sm"
      >
        <p className="text-sm text-muted-foreground">
          The Chroneli desktop app wants to sign in as you. Continue only if you
          just started sign-in from the app.
        </p>
        <Button
          type="button"
          size="lg"
          onClick={handOff}
          disabled={handingOff}
          className="w-full"
        >
          {handingOff ? "Signing in…" : "Continue to the desktop app"}
        </Button>
        <AuthError message={failure} />
      </AuthShell>
    </main>
  )
}

function DesktopLoginRoute() {
  const { port, state, isAuthenticated } = Route.useRouteContext()
  return (
    <DesktopLogin port={port} state={state} isAuthenticated={isAuthenticated} />
  )
}
