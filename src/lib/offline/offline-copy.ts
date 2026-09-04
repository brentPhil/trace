/** What an offline-disabled control says. Sentences, beside the control, never a hidden button. */
export const OFFLINE_INVOICE_REASON =
  "You're offline. Raising an invoice needs a connection, so its number is unique."
export const OFFLINE_UPLOAD_REASON =
  "You're offline. Uploads need a connection."
export const OFFLINE_GOOGLE_REASON =
  "You're offline. Google Calendar settings need a connection."
export const OFFLINE_SIGN_OUT_REASON =
  "You're offline. Sign out once you're back online."

/**
 * A WARNING beside sign-out, not a refusal.
 *
 * Refusing while the queue is non-empty was the first design and it was a
 * trap: an op the server keeps refusing, or a drain that has thrown, leaves
 * the count above zero for good — and the user is then told to wait for
 * something that will never happen, with sign-out, and therefore the device
 * clear, unreachable on that machine forever.
 *
 * The trade runs the other way round. Losing queued changes is bad; leaving
 * one person's entries cached on a machine the next person uses is worse, and
 * an unreachable sign-out guarantees exactly that. So the count is stated,
 * the loss is stated, and the choice is the user's.
 */
export function pendingSignOutWarning(pending: number): string {
  return `${pending} ${pending === 1 ? "change has" : "changes have"} not synced yet and will be lost.`
}
