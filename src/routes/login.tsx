import { createFileRoute, redirect } from "@tanstack/react-router"
import { AuthBackdrop } from "@/components/auth-backdrop"
import { AuthForm } from "@/components/auth-form"
import { DesktopSignIn } from "@/components/auth/desktop-sign-in"
import { useIsDesktopShell } from "@/lib/desktop-bridge"
import { safeRedirect } from "@/lib/redirect"
import { pageTitle } from "@shared/brand"

export const Route = createFileRoute("/login")({
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
