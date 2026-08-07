import { Resend } from "@convex-dev/resend"
import { components } from "./_generated/api"
import type { GenericActionCtx } from "convex/server"
import type { DataModel } from "./_generated/dataModel"

/**
 * testMode defaults to true in this component, which silently restricts
 * delivery to Resend's own test addresses — mail to a real user just never
 * arrives, with no error. Opting into real delivery is therefore explicit:
 * set RESEND_TEST_MODE=false on the deployment.
 */
export const resend = new Resend(components.resend, {
  testMode: process.env.RESEND_TEST_MODE !== "false",
})

// Resend requires a verified domain for real sending. onboarding@resend.dev
// works without one but only delivers to your own Resend account address.
const FROM = process.env.EMAIL_FROM ?? "Trace <onboarding@resend.dev>"

function resetEmail(url: string) {
  const text = [
    "Reset your Trace password",
    "",
    "Open this link to choose a new password:",
    url,
    "",
    "The link expires in one hour. If you didn't ask to reset your password,",
    "you can ignore this email — nothing has changed.",
  ].join("\n")

  // Deliberately plain and inline-styled. Email clients strip stylesheets and
  // handle dark mode inconsistently, so this does not try to mirror the app's
  // theme; it tries to be readable everywhere.
  const html = `
    <div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a;max-width:480px">
      <p style="margin:0 0 16px"><strong>Reset your Trace password</strong></p>
      <p style="margin:0 0 24px">Choose a new password using the link below.</p>
      <p style="margin:0 0 24px">
        <a href="${url}" style="display:inline-block;padding:10px 16px;background:#1a1a1a;color:#ffffff;text-decoration:none;border-radius:6px">Set a new password</a>
      </p>
      <p style="margin:0 0 8px;color:#666">Or paste this into your browser:</p>
      <p style="margin:0 0 24px;word-break:break-all;color:#666">${url}</p>
      <p style="margin:0;color:#666">
        The link expires in one hour. If you didn't ask to reset your password,
        you can ignore this email &mdash; nothing has changed.
      </p>
    </div>
  `.trim()

  return { text, html }
}

export async function sendPasswordResetEmail(
  ctx: GenericActionCtx<DataModel>,
  { to, url }: { to: string; url: string }
) {
  // Falls back to logging the link when Resend is not usably configured, so
  // the flow stays testable. A *present but bogus* key is treated the same as
  // a missing one on purpose: otherwise the send is queued, fails against the
  // Resend API in the background, and the user gets neither an email nor a
  // link — the worst of both. Real keys are `re_` followed by ~30 characters.
  const apiKey = process.env.RESEND_API_KEY
  const looksUsable = !!apiKey && apiKey.startsWith("re_") && apiKey.length > 20

  // Local-development affordance only. With no usable key there is no delivery
  // path at all, so the link goes to the logs to keep the flow testable. Once a
  // key is configured the link is never logged again: it is a single-use
  // account-takeover credential, and read access to logs must not confer
  // account access. The recipient is omitted for the same reason.
  if (!looksUsable) {
    console.warn(
      apiKey
        ? "[email] RESEND_API_KEY is set but does not look like a real key " +
            "(expected 're_' followed by ~30 characters). Logging the reset " +
            "link instead of attempting a send that would fail silently."
        : "[email] RESEND_API_KEY is not set. Logging the password reset " +
            "link instead of sending it."
    )
    console.info(`[email] Password reset link: ${url}`)
    return
  }

  if (process.env.RESEND_TEST_MODE !== "false") {
    console.warn(
      "[email] RESEND_TEST_MODE is not 'false', so Resend delivers only to " +
        "its own test addresses and this message will be dropped. The link is " +
        "deliberately NOT logged: a key is configured, so delivery is the " +
        "intended path. Set RESEND_TEST_MODE=false to send for real."
    )
  }

  const { text, html } = resetEmail(url)

  // A delivery failure must not change the shape of the response. Better Auth
  // invokes this callback only for accounts that actually exist, so an error
  // escaping here would make a registered address distinguishable from an
  // unknown one and undo the enumeration protection the whole flow relies on.
  try {
    await resend.sendEmail(ctx, {
      from: FROM,
      to,
      subject: "Reset your Trace password",
      text,
      html,
    })
  } catch (error) {
    console.error(
      "[email] Password reset delivery failed. Swallowed so the response " +
        "stays identical for known and unknown addresses.",
      error
    )
  }
}
