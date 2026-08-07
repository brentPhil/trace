import { useState } from "react"
import { Link } from "@tanstack/react-router"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { authClient } from "@/lib/auth-client"
import { AUTH_ERROR_ID, AuthError, AuthShell } from "@/components/auth-shell"

type Mode = "signin" | "signup"

const COPY = {
  signin: {
    heading: "Sign in",
    submit: "Sign in",
    pending: "Signing in…",
    switchPrompt: "Don't have an account?",
    switchLabel: "Create one",
    switchTo: "/signup",
  },
  signup: {
    heading: "Create your account",
    submit: "Create account",
    pending: "Creating account…",
    switchPrompt: "Already have an account?",
    switchLabel: "Sign in",
    switchTo: "/login",
  },
} as const

export function AuthForm({
  mode,
  redirectTo = "/",
  className,
  ...props
}: React.ComponentProps<"div"> & { mode: Mode; redirectTo?: string }) {
  const copy = COPY[mode]
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    setError(null)
    setPending(true)

    const form = new FormData(event.currentTarget)
    const email = String(form.get("email") ?? "")
    const password = String(form.get("password") ?? "")
    const name = String(form.get("name") ?? "")

    const result =
      mode === "signup"
        ? await authClient.signUp.email({ email, password, name })
        : await authClient.signIn.email({ email, password })

    if (result.error) {
      setError(result.error.message ?? "Something went wrong. Try again.")
      setPending(false)
      return
    }

    // Full navigation rather than a client-side one. The Convex client is
    // constructed with expectAuth: true, and Convex's own guidance is that
    // authenticated queries can fire before auth is ready when the session
    // changes without a reload. A document load re-runs the root beforeLoad,
    // so the token is on the server HTTP client before anything queries.
    //
    // redirectTo is already validated by safeRedirect at the route boundary.
    window.location.assign(redirectTo)
  }

  return (
    <AuthShell heading={copy.heading} className={className} {...props}>
      <form onSubmit={handleSubmit} noValidate={false}>
        <FieldGroup>
          {mode === "signup" && (
            <Field>
              <FieldLabel htmlFor="name">Name</FieldLabel>
              <Input
                id="name"
                name="name"
                type="text"
                autoComplete="name"
                required
                disabled={pending}
              />
            </Field>
          )}

          <Field>
            <FieldLabel htmlFor="email">Email</FieldLabel>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              autoFocus={mode === "signin"}
              required
              disabled={pending}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? AUTH_ERROR_ID : undefined}
            />
          </Field>

          <Field>
            <div className="flex items-center justify-between gap-3">
              <FieldLabel htmlFor="password">Password</FieldLabel>
              {mode === "signin" && (
                <Link
                  to="/forgot-password"
                  className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
                >
                  Forgot password?
                </Link>
              )}
            </div>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete={
                mode === "signup" ? "new-password" : "current-password"
              }
              required
              minLength={8}
              disabled={pending}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? AUTH_ERROR_ID : undefined}
            />
            {mode === "signup" && (
              <FieldDescription>At least 8 characters.</FieldDescription>
            )}
          </Field>

          <AuthError message={error} />

          <Field>
            <Button type="submit" disabled={pending}>
              {pending ? copy.pending : copy.submit}
            </Button>
          </Field>
        </FieldGroup>
      </form>

      <p className="text-sm text-muted-foreground">
        {copy.switchPrompt}{" "}
        <Link
          to={copy.switchTo}
          // Carry the return destination across, so bouncing between sign-in
          // and sign-up does not lose where the user was originally headed.
          search={{ redirect: redirectTo === "/" ? undefined : redirectTo }}
          className="text-foreground underline underline-offset-4"
        >
          {copy.switchLabel}
        </Link>
      </p>
    </AuthShell>
  )
}
