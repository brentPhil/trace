import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { beginBrowserLogin, onBrowserLogin } from "@/lib/desktop-bridge"
import { errorMessage } from "@/lib/error-message"
import type { BrowserLoginFailureReason } from "@/lib/desktop-bridge"

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

/**
 * The desktop app's whole sign-in screen.
 *
 * There is no form here on purpose. Google refuses OAuth from embedded
 * webviews and names WKWebView — which is what Tauri uses on macOS — so a
 * Google button inside this window fails outright there. Sending BOTH sign-in
 * methods to the real browser keeps one path rather than two, and it means the
 * browser always holds a session, which is what a later Calendar-connect fix
 * will need.
 */
export function DesktopSignIn() {
  const [waiting, setWaiting] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  useEffect(() => {
    let cleanup: (() => void) | null = null
    let cancelled = false
    void onBrowserLogin({
      token: (token) => {
        // Straight to the route that redeems it; that is what sets the cookie.
        location.replace(`/desktop-callback?token=${encodeURIComponent(token)}`)
      },
      failed: (reason) => {
        setWaiting(false)
        setFailure(
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

  async function start() {
    setFailure(null)
    setWaiting(true)
    try {
      await beginBrowserLogin()
    } catch (thrown) {
      setWaiting(false)
      setFailure(errorMessage(thrown))
    }
  }

  return (
    <div className="w-full max-w-sm space-y-4 text-center">
      <p className="text-muted-foreground text-sm">
        Chroneli signs you in through your browser, so your password manager and
        Google both work normally.
      </p>
      <Button onClick={() => void start()} disabled={waiting} className="w-full">
        Continue in browser
      </Button>
      {waiting && (
        <p className="text-muted-foreground text-sm">
          Waiting for your browser… come back once you have signed in.
        </p>
      )}
      {failure !== null && (
        <p role="alert" className="text-sm">
          {failure}
        </p>
      )}
    </div>
  )
}
