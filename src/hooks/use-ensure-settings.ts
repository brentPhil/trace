import { useEffect, useRef } from "react"
import { useConvexMutation } from "@convex-dev/react-query"
import { api } from "../../convex/_generated/api"

/**
 * Creates the settings row on first authed load, seeding the timezone from the
 * browser.
 *
 * Without this every user runs on the provisional `UTC` default forever, and
 * UTC is wrong for almost everyone. The consequence is not cosmetic: every day
 * boundary in the product is computed from this value, so someone in Los
 * Angeles at 18:00 is already on tomorrow's UTC date — their log shows no
 * "Today" group at all, the day's work sits under a header reading "Yesterday",
 * and the totals row reads 0:00:00 while eight hours are on screen.
 *
 * CLIENT ONLY, deliberately. The obvious home for this is the authed layout's
 * `beforeLoad`, and an earlier comment in convex/settings.ts said so — but
 * `beforeLoad` also runs on the server during SSR, where
 * `resolvedOptions().timeZone` is the SERVER's zone. That would write the wrong
 * zone first, and `ensure` is idempotent by design (it must never re-file an
 * invoiced month because a laptop crossed a border), so the wrong value would
 * then be permanent. An effect runs only in the browser, which is the only
 * place the answer exists.
 *
 * The cost is that the very first authed render uses UTC for one round trip.
 * That is the right trade: a briefly wrong view corrects itself, a wrongly
 * stored zone does not.
 */
export function useEnsureSettings(): void {
  // Plain `useMutation` under the hood, which IS memoised, so this is stable.
  const ensure = useConvexMutation(api.settings.ensure)
  const attempted = useRef(false)

  useEffect(() => {
    // Guards StrictMode's deliberate double-invoke. The mutation is idempotent
    // anyway; this just avoids the redundant round trip.
    if (attempted.current) return
    attempted.current = true

    let suggestedTimezone: string | undefined
    try {
      suggestedTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone
    } catch {
      // A runtime with no usable zone database. The server falls back to UTC,
      // and Settings remains the way to fix it by hand.
      suggestedTimezone = undefined
    }

    void ensure({ suggestedTimezone }).catch(() => {
      // Best effort. A failure here (an expired session, most likely) leaves
      // the user on defaults, which is exactly where they already were — and
      // the authed error boundary handles the session case properly. Retrying
      // is left to the next mount rather than looped.
      attempted.current = false
    })
  }, [ensure])
}
