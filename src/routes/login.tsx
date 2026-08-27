import { createFileRoute, redirect } from "@tanstack/react-router"
import { AuthBackdrop } from "@/components/auth-backdrop"
import { AuthForm } from "@/components/auth-form"
import { DesktopSignIn } from "@/components/auth/desktop-sign-in"
import { useIsDesktopShell } from "@/lib/desktop-bridge"
import { safeRedirect } from "@/lib/redirect"
import { pageTitle } from "@shared/brand"

export const Route = createFileRoute("/login")({
  /*
   * The server renders this route's DATA but not its MARKUP, and that is a
   * correctness fix rather than a performance choice.
   *
   * Which sign-in belongs here depends on whether the page is inside the Tauri
   * shell, and the server cannot know: the shell loads this same origin over
   * plain HTTPS with nothing to distinguish it. So a server-rendered tree is a
   * guess, it always guesses "web", and in the desktop app that guess paints a
   * wired-up AuthForm — Google button and all — which stays clickable until
   * hydration replaces it. Google refuses OAuth from embedded webviews, which
   * is the entire reason DesktopSignIn exists, so that flash is the feature
   * demonstrating the failure it was built to prevent.
   *
   * `useIsDesktopShell` already makes the swap hydration-SAFE; it cannot make
   * the server's first paint correct, because nothing client-side runs before
   * it. Only declining to paint does.
   *
   * "data-only" and not `false`: `beforeLoad` below must still run on the
   * server, or an already-signed-in visitor would load the login page and be
   * bounced afterwards instead of being redirected before anything renders.
   *
   * The cost is that the login form now paints after hydration rather than in
   * the SSR payload. It is one route, it is the one route whose correct
   * contents are genuinely unknowable server-side, and every other route keeps
   * full SSR.
   */
  ssr: "data-only",
  head: () => ({ meta: [{ title: pageTitle("Sign in") }] }),
  validateSearch: (search: Record<string, unknown>) => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
  }),
  beforeLoad: ({ context, search }) => {
    if (context.isAuthenticated) {
      throw redirect({ href: safeRedirect(search.redirect) })
    }
  },
  component: LoginRoute,
})

function LoginRoute() {
  const search = Route.useSearch()
  // Not `isDesktopShell()` directly: this route is server-rendered, the
  // server has no `window` and always guesses "web", but the Tauri webview
  // already has `window.__TAURI_INTERNALS__` before hydration starts. Calling
  // the raw check here would render a different tree on the client's first
  // pass than the server sent — a hydration mismatch, and in the desktop app
  // specifically, a real wired-up `<AuthForm>` (Google button included)
  // staying painted and clickable until React caught up. `useIsDesktopShell`
  // (see desktop-bridge.ts) is the hydration-safe version of this same read.
  const isDesktop = useIsDesktopShell()

  return (
    <main className="relative flex min-h-svh [align-items:safe_center] justify-center p-6">
      <AuthBackdrop />
      {isDesktop ? (
        <DesktopSignIn />
      ) : (
        <AuthForm
          mode="signin"
          redirectTo={safeRedirect(search.redirect)}
          className="w-full max-w-sm"
        />
      )}
    </main>
  )
}
