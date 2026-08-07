import { useState } from "react"
import { Link, createFileRoute } from "@tanstack/react-router"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { AUTH_ERROR_ID, AuthError, AuthShell } from "@/components/auth-shell"
import { authClient } from "@/lib/auth-client"
import { cn } from "@/lib/utils"

const MIN_PASSWORD_LENGTH = 8

export const Route = createFileRoute("/reset-password")({
  head: () => ({ meta: [{ title: "Choose a new password — Trace" }] }),
  // Better Auth validates the token server-side first, then redirects here
  // with ?token=... on success or ?error=INVALID_TOKEN on failure.
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search.token === "string" ? search.token : undefined,
    error: typeof search.error === "string" ? search.error : undefined,
  }),
  component: ResetPasswordRoute,
})

function ResetPasswordRoute() {
  const { token, error } = Route.useSearch()

  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      {!token || error ? (
        <InvalidLink className="w-full max-w-sm" />
      ) : (
        <ResetPasswordForm token={token} className="w-full max-w-sm" />
      )}
    </main>
  )
}

function InvalidLink({ className }: { className?: string }) {
  return (
    <AuthShell
      heading="That link has expired"
      focusHeading
      className={className}
    >
      <p className="text-sm text-muted-foreground">
        Password reset links are valid for one hour and can only be used once.
        Request a new one and we&apos;ll send another.
      </p>
      <div>
        <Link to="/forgot-password" className={cn(buttonVariants())}>
          Request a new link
        </Link>
      </div>
    </AuthShell>
  )
}

function ResetPasswordForm({
  token,
  className,
}: {
  token: string
  className?: string
}) {
  const [pending, setPending] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    setError(null)

    const form = new FormData(event.currentTarget)
    const newPassword = String(form.get("password") ?? "")
    const confirm = String(form.get("confirm") ?? "")

    // Checked here rather than only by the server, so the user finds out
    // before spending their single-use token on a mismatch.
    if (newPassword !== confirm) {
      setError("Those passwords don't match.")
      return
    }

    setPending(true)
    const result = await authClient.resetPassword({ newPassword, token })
    setPending(false)

    if (result.error) {
      setError(result.error.message ?? "Something went wrong. Try again.")
      return
    }

    setDone(true)
  }

  if (done) {
    return (
      <AuthShell heading="Password updated" focusHeading className={className}>
        <p className="text-sm text-muted-foreground">
          You can now sign in with your new password. Every other device has
          been signed out.
        </p>
        <div>
          <Link
            to="/login"
            search={{ redirect: undefined }}
            className={cn(buttonVariants())}
          >
            Sign in
          </Link>
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell heading="Choose a new password" className={className}>
      <form onSubmit={handleSubmit}>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="password">New password</FieldLabel>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              autoFocus
              required
              minLength={MIN_PASSWORD_LENGTH}
              disabled={pending}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? AUTH_ERROR_ID : undefined}
            />
            <FieldDescription>
              At least {MIN_PASSWORD_LENGTH} characters.
            </FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="confirm">Confirm new password</FieldLabel>
            <Input
              id="confirm"
              name="confirm"
              type="password"
              autoComplete="new-password"
              required
              minLength={MIN_PASSWORD_LENGTH}
              disabled={pending}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? AUTH_ERROR_ID : undefined}
            />
          </Field>

          <AuthError message={error} />

          <Field>
            <Button type="submit" disabled={pending}>
              {pending ? "Updating…" : "Update password"}
            </Button>
          </Field>
        </FieldGroup>
      </form>
    </AuthShell>
  )
}
