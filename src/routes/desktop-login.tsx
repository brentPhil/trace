import { createFileRoute, redirect } from "@tanstack/react-router"
import { AuthBackdrop } from "@/components/auth-backdrop"
import { AuthForm } from "@/components/auth-form"
import { AuthShell } from "@/components/auth-shell"
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
 * Where the desktop shell sends your real browser to sign in.
 *
 * THE `beforeLoad` INVERSION IS THE POINT. `/login` throws a redirect INTO the
 * app when you are already authenticated; this route must do the opposite,
 * because an already-signed-in browser is the common case here rather than the
 * exceptional one. Bouncing it to /timer would leave the shell waiting on a
 * callback that never arrives until it timed out, with nothing on screen in
 * either place to say why.
 *
 * So: authenticated means "mint the token and hand it back", and the form is
 * shown only when there is no session to hand over.
 *
 * `redirectTo` points back at THIS route, query string and all. `AuthForm`
 * uses it as Google's `callbackURL` and as the assign target after an
 * email/password sign-in, so both paths return here authenticated and fall
 * into the branch above. That is why this needs no success callback of its own.
 */
export const Route = createFileRoute("/desktop-login")({
  head: () => ({ meta: [{ title: pageTitle("Sign in to the desktop app") }] }),
  validateSearch: (search: Record<string, unknown>) => ({
    port: typeof search.port === "string" ? search.port : undefined,
    state: typeof search.state === "string" ? search.state : undefined,
  }),
  beforeLoad: async ({ context, search }) => {
    const port = parsePort(search.port)
    const state = search.state
    // A malformed handshake is not something the user can fix by signing in,
    // so do not show them a form that cannot lead anywhere.
    if (port === null || !state) {
      throw new DesktopHandoffError(
        "This sign-in link is missing information from the desktop app. Start sign-in from the app again."
      )
    }
    if (!context.isAuthenticated) return

    const { data, error } = await authClient.oneTimeToken.generate()
    if (error || !data.token) {
      throw new DesktopHandoffError(
        "Could not hand your session to the desktop app. Start sign-in from the app again."
      )
    }
    // A full document load, not a router navigation: the target is a local
    // HTTP server, not a route in this app.
    throw redirect({ href: loopbackCallbackUrl(port, data.token, state) })
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

function DesktopLoginRoute() {
  const search = Route.useSearch()
  const back = `/desktop-login?port=${search.port ?? ""}&state=${search.state ?? ""}`

  return (
    <main className="relative flex min-h-svh [align-items:safe_center] justify-center p-6">
      <AuthBackdrop />
      <div className="w-full max-w-sm space-y-4">
        <p className="text-muted-foreground text-center text-sm">
          Signing in to the Chroneli desktop app.
        </p>
        <AuthForm mode="signin" redirectTo={back} />
      </div>
    </main>
  )
}
