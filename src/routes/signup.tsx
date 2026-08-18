import { createFileRoute, redirect } from "@tanstack/react-router"
import { AuthBackdrop } from "@/components/auth-backdrop"
import { AuthForm } from "@/components/auth-form"
import { safeRedirect } from "@/lib/redirect"
import { pageTitle } from "@shared/brand"

export const Route = createFileRoute("/signup")({
  head: () => ({ meta: [{ title: pageTitle("Create your account") }] }),
  validateSearch: (search: Record<string, unknown>) => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
  }),
  beforeLoad: ({ context, search }) => {
    if (context.isAuthenticated) {
      throw redirect({ href: safeRedirect(search.redirect) })
    }
  },
  component: SignupRoute,
})

function SignupRoute() {
  const search = Route.useSearch()

  return (
    <main className="relative flex min-h-svh [align-items:safe_center] justify-center p-6">
      <AuthBackdrop />
      <AuthForm
        mode="signup"
        redirectTo={safeRedirect(search.redirect)}
        className="w-full max-w-sm"
      />
    </main>
  )
}
