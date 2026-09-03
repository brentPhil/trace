/** What an offline-disabled control says. Sentences, beside the control, never a hidden button. */
export const OFFLINE_INVOICE_REASON =
  "You're offline. Raising an invoice needs a connection, so its number is unique."
export const OFFLINE_UPLOAD_REASON = "You're offline. Uploads need a connection."
export const OFFLINE_GOOGLE_REASON = "You're offline. Google Calendar settings need a connection."
export const OFFLINE_SIGN_OUT_REASON = "You're offline. Sign out once you're back online."
export function pendingSignOutReason(pending: number): string {
  return `${pending} ${pending === 1 ? "change is" : "changes are"} still syncing. Sign out once they have saved.`
}
