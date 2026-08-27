import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { beginBrowserLogin, onBrowserLogin } from "@/lib/desktop-bridge"
import { errorMessage } from "@/lib/error-message"

const FAILURE_COPY: Record<string, string> = {
  timed_out: "That timed out waiting for your browser. Try again.",
  state_mismatch: "That sign-in did not match this app. Try again.",
  listener_died: "Lost track of your browser’s reply. Try again.",
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
        setFailure(FAILURE_COPY[reason] ?? "Sign-in did not finish. Try again.")
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
