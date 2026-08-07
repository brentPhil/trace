import { useState } from "react"
import { Link, createFileRoute } from "@tanstack/react-router"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { AUTH_ERROR_ID, AuthError, AuthShell } from "@/components/auth-shell"
import { authClient } from "@/lib/auth-client"

export const Route = createFileRoute("/forgot-password")({
  head: () => ({ meta: [{ title: "Reset your password — Trace" }] }),
  component: ForgotPasswordRoute,
})

function ForgotPasswordRoute() {
  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <ForgotPasswordForm className="w-full max-w-sm" />
    </main>
  )
}

function ForgotPasswordForm({ className }: { className?: string }) {
  const [pending, setPending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    setError(null)
    setPending(true)

    const email = String(new FormData(event.currentTarget).get("email") ?? "")

    const result = await authClient.requestPasswordReset({
      email,
      // Where Better Auth sends the user after it has validated the token.
      // It appends ?token=... to this path.
      redirectTo: "/reset-password",
    })

    setPending(false)

    if (result.error) {
      // Only genuine transport or server failures land here. An unknown email
      // address is a success, by design — see the note below.
      setError(result.error.message ?? "Something went wrong. Try again.")
      return
    }

    setSent(true)
  }

  // Deliberately identical whether or not the account exists. Better Auth
  // returns the same response either way and simulates the token work to blunt
  // timing attacks; saying "no account found" here would hand that back and
  // turn this form into an account-enumeration oracle.
  if (sent) {
    return (
      <AuthShell heading="Check your email" focusHeading className={className}>
        <p className="text-sm text-muted-foreground">
          If an account exists for that address, we&apos;ve sent a link to reset
          the password. It expires in an hour.
        </p>
        <p className="text-sm text-muted-foreground">
          <Link
            to="/login"
            search={{ redirect: undefined }}
            className="text-foreground underline underline-offset-4"
          >
            Back to sign in
          </Link>
        </p>
      </AuthShell>
    )
  }

  return (
    <AuthShell heading="Reset your password" className={className}>
      <form onSubmit={handleSubmit}>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="email">Email</FieldLabel>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              autoFocus
              required
              disabled={pending}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? AUTH_ERROR_ID : undefined}
            />
            <FieldDescription>
              We&apos;ll send a link to set a new password.
            </FieldDescription>
          </Field>

          <AuthError message={error} />

          <Field>
            <Button type="submit" disabled={pending}>
              {pending ? "Sending…" : "Send reset link"}
            </Button>
          </Field>
        </FieldGroup>
      </form>

      <p className="text-sm text-muted-foreground">
        Remembered it?{" "}
        <Link
          to="/login"
          search={{ redirect: undefined }}
          className="text-foreground underline underline-offset-4"
        >
          Sign in
        </Link>
      </p>
    </AuthShell>
  )
}
