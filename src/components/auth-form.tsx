import { useEffect, useState } from "react"
import { Link } from "@tanstack/react-router"
import { EyeIcon, EyeOffIcon } from "lucide-react"
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
import {
  beginBrowserLogin,
  isDesktopShell,
  onBrowserLogin,
} from "@/lib/desktop-bridge"
import { errorMessage } from "@/lib/error-message"
import type { BrowserLoginFailureReason } from "@/lib/desktop-bridge"

type Mode = "signin" | "signup"

// `Record<BrowserLoginFailureReason, string>`, not `Record<string, string>`:
// the wider type let this table silently drift out of sync with the reasons
// the bridge actually promises to emit — nothing caught a missing key, so a
// new reason would have quietly fallen through to the generic copy below
// forever. This narrower type makes a missing key a compile error instead.
//
// `onBrowserLogin`'s `failed` callback still hands over a plain `string` —
// see `BrowserLoginFailureReason` in desktop-bridge.ts for why it is not
// typed as this union at that boundary — so `isKnownFailure` below is a real
// runtime check, not a formality: an unrecognised string from Rust is
// genuinely possible here, and it is what falls through to the generic copy.
const FAILURE_COPY: Record<BrowserLoginFailureReason, string> = {
  timed_out: "That timed out waiting for your browser. Try again.",
  state_mismatch: "That sign-in did not match this app. Try again.",
  listener_died: "Lost track of your browser’s reply. Try again.",
}

function isKnownFailure(reason: string): reason is BrowserLoginFailureReason {
  return reason in FAILURE_COPY
}

const COPY = {
  signin: {
    heading: "Sign in",
    submit: "Sign in",
    /** The Google button says "Sign in with Google" / "Sign up with Google" —
     *  the same verb as the screen it is on, so the two paths read as two ways
     *  of doing one thing rather than two different offers. */
    social: "Sign in",
    pending: "Signing in…",
    switchPrompt: "Don't have an account?",
    switchLabel: "Create one",
    switchTo: "/signup",
  },
  signup: {
    heading: "Create your account",
    submit: "Create account",
    social: "Sign up",
    pending: "Creating account…",
    switchPrompt: "Already have an account?",
    switchLabel: "Sign in",
    switchTo: "/login",
  },
} as const

/**
 * Google's own mark, at the size the button's other glyphs use.
 *
 * The four colours are Google's, not ours, and they are the one place on this
 * screen where hue appears — a third-party brand mark is not the app's own
 * semantic colour, so it does not spend `enlarger` or `brass`. A monochrome
 * "G" would be quieter and is also against Google's brand terms for this
 * button, which is a fight not worth having over a login screen.
 */
function GoogleMark() {
  return (
    <svg viewBox="0 0 18 18" aria-hidden focusable="false">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.41 5.41 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  )
}

export function AuthForm({
  mode,
  redirectTo = "/",
  className,
  ...props
}: React.ComponentProps<"div"> & { mode: Mode; redirectTo?: string }) {
  const copy = COPY[mode]
  const [pending, setPending] = useState(false)
  const [googlePending, setGooglePending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [revealPassword, setRevealPassword] = useState(false)
  /** Desktop shell only: the browser has been opened and has not answered. */
  const [waitingForBrowser, setWaitingForBrowser] = useState(false)

  /**
   * THE LISTENERS GO UP ON MOUNT, NOT ON CLICK. This ordering is the feature.
   *
   * `begin_browser_login` resolves as soon as the shell has LAUNCHED the
   * browser — not when the browser comes back — and Tauri does not replay an
   * event to a listener that was not there when it fired. Register inside the
   * click handler (invoke, then listen) and a token arriving in that gap is
   * simply lost: the browser signed in, the shell emitted, nobody heard, and
   * the app sits on "Waiting for your browser…" forever for a sign-in that
   * already succeeded. The gap is small and entirely real — a browser that is
   * already open with a live session can round-trip in well under the time it
   * takes to await a dynamic `import("@tauri-apps/api/event")`.
   *
   * A mount effect closes it by construction rather than by care: there is no
   * ordering left to get wrong, because the only path to `beginBrowserLogin`
   * is a click, and a click cannot precede the mount that renders the button.
   *
   * Client-only by nature, so unlike the shell check inside the click handler
   * this one costs nothing at hydration — effects do not run on the server and
   * React does not compare them.
   */
  useEffect(() => {
    if (!isDesktopShell()) return
    let cleanup: (() => void) | null = null
    let cancelled = false
    void onBrowserLogin({
      token: (token) => {
        // Straight to the route that redeems it; that is what sets the cookie.
        location.replace(`/desktop-callback?token=${encodeURIComponent(token)}`)
      },
      failed: (reason) => {
        setGooglePending(false)
        setWaitingForBrowser(false)
        setError(
          isKnownFailure(reason)
            ? FAILURE_COPY[reason]
            : "Sign-in did not finish. Try again."
        )
      },
    }).then((unlisten) => {
      // The unmount can land while `listen` is still resolving; a listener
      // registered after its cleanup ran would survive forever.
      if (cancelled) unlisten()
      else cleanup = unlisten
    })
    return () => {
      cancelled = true
      cleanup?.()
    }
  }, [])

  /**
   * Sign in with Google — IDENTITY ONLY.
   *
   * No calendar scope is requested here. `convex/auth.ts` keeps the provider on
   * Google's default profile-and-email scopes, and the calendar permission is
   * asked for later, by `linkSocial` in Settings, at the moment somebody
   * actually clicks Connect Google Calendar. That is Google's own
   * recommendation — incremental authorisation — and it means signing up does
   * not open with a request to read your calendar plus an unverified-app
   * warning, which is a heavy first impression for someone still deciding
   * whether to try the tracker.
   *
   * `signIn.social` rather than `linkSocial`: this is the front door, where
   * there is no session yet to link anything to. Better Auth links it to an
   * existing email-and-password account of the same address on its own, because
   * Google reports the address as verified.
   *
   * No `await` completes here — the call navigates the document to Google, so
   * anything after it is unreachable. The pending state exists to stop a second
   * click during the hop, not to be cleared afterwards.
   *
   * IN THE DESKTOP SHELL, NONE OF THAT WORKS. Google refuses OAuth from
   * embedded webviews — `disallowed_useragent`, naming WKWebView, which is what
   * Tauri uses on macOS — so navigating this window to Google is a dead end. So
   * in the shell the same button hands off to the real browser instead. Only
   * this one path differs; email and password are typed and submitted right
   * here, exactly as on the web, because nothing about them was ever broken.
   */
  async function signInWithGoogle() {
    if (pending || googlePending) return
    setError(null)
    setGooglePending(true)

    /*
     * READ AT CLICK TIME, NOT AT RENDER TIME. `isDesktopShell()` reads
     * `window.__TAURI_INTERNALS__`, which the server cannot see and so always
     * answers "web" for. Branching the RENDERED TREE on that answer is what
     * forced /login off server-rendered markup before: server and client
     * disagreed, and until React caught up the desktop app showed a live
     * Google button that could only fail.
     *
     * Read here instead and that whole problem evaporates. A click handler is
     * not part of the markup React diffs during hydration, so the server and
     * the client render byte-identical HTML and the shell/web difference only
     * ever materialises after a human has clicked something — by which point
     * `window` is unambiguous. That is the entire reason /login gets full SSR
     * back.
     */
    if (isDesktopShell()) {
      setWaitingForBrowser(true)
      try {
        await beginBrowserLogin()
      } catch (thrown) {
        // Never swallowed: the browser failing to open (or the loopback port
        // failing to bind) is the end of the road for this sign-in, and the
        // only other thing on screen is a button stuck looking busy.
        setWaitingForBrowser(false)
        setGooglePending(false)
        setError(errorMessage(thrown))
      }
      // The pending state stays ON through the wait, deliberately: the browser
      // is now the place this sign-in is happening, and a second click would
      // bind a second port and a second nonce for the same intent. It is
      // released by the failure handler in the mount effect above, or never —
      // a token navigates this document away.
      return
    }

    const result = await authClient.signIn.social({
      provider: "google",
      callbackURL: redirectTo,
    })

    // Reached only when Better Auth refused before redirecting — a missing
    // client id being the one that actually happens. Without this the button
    // sits in its pending state forever and the screen says nothing.
    if (result.error) {
      setError(result.error.message ?? "Could not reach Google. Try again.")
      setGooglePending(false)
    }
  }

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
      {/*
        GOOGLE FIRST, then the divider, then the credentials.

        Order is not neutral: whichever path is on top is the one most people
        take, and this one is a single click against three fields. The email
        form keeps its place directly underneath rather than behind a
        disclosure, because an existing account holder should not have to
        expand anything to sign in the way they always have.
      */}
      <Button
        type="button"
        variant="outline"
        size="lg"
        onClick={signInWithGoogle}
        disabled={pending || googlePending}
        className="w-full"
      >
        <GoogleMark />
        {googlePending ? "Opening Google…" : `${copy.social} with Google`}
      </Button>

      {/*
        Only in the shell, and only while the browser has the sign-in. The
        button alone says "Opening Google…", which in a desktop app is
        ambiguous about WHERE — this line answers that, and tells the user the
        app is not stuck but waiting on something they now have to go and do.

        Not an `aria-live` region: it appears directly under the control that
        was just activated and it is not an error. The failure path goes to
        `AuthError` below, which is the announcing surface.
      */}
      {waitingForBrowser && (
        <p className="text-sm text-muted-foreground">
          Waiting for your browser… come back once you have signed in.
        </p>
      )}

      {/*
        A labelled rule, not a bare one. `<span>` on the surface colour cuts the
        line rather than overlaying it, so the word sits IN the rule instead of
        on a plate over it — at this size a background patch would read as a
        chip.

        `aria-hidden` because it is punctuation: a screen reader announcing "or"
        between two labelled controls adds nothing, and the controls already say
        what they each do.
      */}
      <div aria-hidden className="flex items-center gap-3">
        <span className="h-px flex-1 bg-edge-soft" />
        <span className="text-xs text-muted-foreground">or</span>
        <span className="h-px flex-1 bg-edge-soft" />
      </div>

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
            {/*
              A REVEAL TOGGLE, because the failure it fixes is silent: when a
              password manager does not fire, the only feedback on a mistyped
              password is a rejected sign-in, and the user cannot tell a typo
              from a wrong password.

              `type` swaps rather than any masking of our own, so the field
              stays a real password input for autofill and for the browser's own
              credential handling.
            */}
            <div className="relative">
              <Input
                id="password"
                name="password"
                type={revealPassword ? "text" : "password"}
                autoComplete={
                  mode === "signup" ? "new-password" : "current-password"
                }
                required
                minLength={8}
                disabled={pending}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? AUTH_ERROR_ID : undefined}
                // Room for the toggle, so a long password never runs under it.
                className="pr-10"
              />
              <button
                type="button"
                // Not in the tab order. The toggle sits between the password
                // field and the submit button, and a keyboard user filling this
                // form wants Tab to go from password to Sign in — someone who
                // wants the toggle can still reach it, and everyone else is not
                // made to step over it on the way out of the form.
                tabIndex={-1}
                onClick={() => setRevealPassword((shown) => !shown)}
                disabled={pending}
                // The label states what the control DOES, not what the field
                // currently is: "Show password" while hidden, "Hide password"
                // while shown.
                aria-label={revealPassword ? "Hide password" : "Show password"}
                aria-pressed={revealPassword}
                className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50"
              >
                {revealPassword ? (
                  <EyeOffIcon className="size-4" aria-hidden />
                ) : (
                  <EyeIcon className="size-4" aria-hidden />
                )}
              </button>
            </div>
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
