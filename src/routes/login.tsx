import { createFileRoute, redirect } from "@tanstack/react-router"
import { AuthForm } from "@/components/auth-form"
import { safeRedirect } from "@/lib/redirect"

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "Sign in — Trace" }] }),
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

  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <AuthForm
        mode="signin"
        redirectTo={safeRedirect(search.redirect)}
        className="w-full max-w-sm"
      />
    </main>
  )
}
