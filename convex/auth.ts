import { betterAuth } from "better-auth/minimal"
import { createClient } from "@convex-dev/better-auth"
import { convex } from "@convex-dev/better-auth/plugins"
import { requireActionCtx } from "@convex-dev/better-auth/utils"
import authConfig from "./auth.config"
import { sendPasswordResetEmail } from "./email"
import { ConvexError } from "convex/values"
import { components } from "./_generated/api"
import { query } from "./_generated/server"
import type { MutationCtx, QueryCtx } from "./_generated/server"
import type { GenericCtx } from "@convex-dev/better-auth"
import type { DataModel } from "./_generated/dataModel"

const siteUrl = process.env.SITE_URL!

// Integrates Convex with Better Auth. Also exposes helpers for reading the
// current user from inside Convex functions.
export const authComponent = createClient<DataModel>(components.betterAuth)

export const createAuth = (ctx: GenericCtx<DataModel>) => {
  return betterAuth({
    baseURL: siteUrl,
    database: authComponent.adapter(ctx),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      // Password reset is the recovery path after a compromise. Better Auth
      // leaves existing sessions alive by default, which would let an attacker
      // keep the session the reset was meant to evict.
      revokeSessionsOnPasswordReset: true,
      // Better Auth returns the same response whether or not the account
      // exists, so this callback simply does not run for unknown addresses.
      // Never surface anything here that would let a caller tell the
      // difference.
      sendResetPassword: async ({ user, url }) => {
        await sendPasswordResetEmail(requireActionCtx(ctx), {
          to: user.email,
          url,
        })
      },
    },
    /*
     * Google, for the calendar link — and LINKED rather than signed in with.
     *
     * `accessType: "offline"` and `prompt: "consent"` are BOTH required. Without
     * them Google issues an access token with no refresh token, and the link
     * dies about an hour later with nothing on screen to say why: the sync just
     * starts failing, and the failure looks like a revoked grant.
     *
     * `calendar.readonly` and nothing wider. This feature never writes to
     * Google, and a scope that permits writing is a scope somebody will
     * eventually write through.
     *
     * The connect flow calls `linkSocial()` from the client rather than
     * `signIn.social`, so the Google account is ADDED to an existing
     * email-and-password identity. The password login keeps working, and
     * `revokeSessionsOnPasswordReset` above keeps meaning what it says.
     */
    socialProviders: {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID!,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
        accessType: "offline",
        prompt: "consent",
        /*
         * NO CALENDAR SCOPE HERE, and its absence is the design.
         *
         * This provider is now the front door as well as the calendar link:
         * `signIn.social` on the auth screens uses it, so anything requested
         * here is requested of somebody who has not yet decided whether to try
         * the product. Asking to read their calendar at that moment — on top of
         * the unverified-app warning Google shows an unpublished client — is a
         * heavy first impression for a tracker they have not used yet.
         *
         * So sign-in takes Google's default profile-and-email scopes, and the
         * calendar permission is requested later by `linkSocial` in Settings,
         * at the moment somebody actually clicks Connect Google Calendar. That
         * is Google's own recommendation, incremental authorisation, and Better
         * Auth supports it directly: `linkSocial`'s `scopes` argument is
         * documented as "additional scopes to request when linking the account
         * … compared to the initial authentication".
         *
         * The consequence to keep in mind: an account linked by SIGN-IN alone
         * holds a token that cannot read the Calendar API. `syncAccount` would
         * see a 403 and flag the connection `reauth`, which is why nothing
         * creates a `googleConnections` row until Connect has run.
         */
      },
    },
    plugins: [
      // Required for Convex compatibility.
      convex({ authConfig }),
    ],
  })
}

/**
 * The identity check every non-public Convex function must call.
 *
 * Route guards in the client only decide what renders; they cannot stop a
 * direct call to a Convex function. This is the layer that actually protects
 * data, so any query, mutation, or action touching a user's entries must start
 * here and scope its reads and writes to the returned user.
 *
 * Throws for anonymous callers. Use safeGetUser when "signed out" is a valid
 * state the caller renders rather than an error.
 */
export const requireUser = async (ctx: QueryCtx | MutationCtx) => {
  const user = await authComponent.safeGetAuthUser(ctx)
  if (!user) {
    throw new ConvexError({
      code: "UNAUTHENTICATED",
      message: "You must be signed in to do that.",
    })
  }
  return user
}

/**
 * The signed-in user's id — the value every domain row is scoped to.
 *
 * This is the Better Auth user's `_id`, a string in the component's namespace
 * rather than a `v.id()` in this deployment. It is the same value as
 * `identity.subject`: safeGetAuthUser looks the user up with
 * `where: [{ field: "_id", value: identity.subject }]`, so the two cannot
 * diverge.
 *
 * Deliberately routed through requireUser rather than reading
 * `identity.subject` directly, even though that would save two component
 * queries per call. requireUser also checks the session has not expired, which
 * is what makes `revokeSessionsOnPasswordReset` above mean anything. Skipping
 * that for speed would quietly re-open the window a password reset exists to
 * close.
 */
export const requireUserId = async (ctx: QueryCtx | MutationCtx) => {
  const user = await requireUser(ctx)
  return user._id
}

/** Returns the signed-in user, or null when anonymous. Never throws. */
export const safeGetUser = async (ctx: QueryCtx | MutationCtx) => {
  return await authComponent.safeGetAuthUser(ctx)
}

// Nullable by design: this is loaded by pages that render both signed-in and
// signed-out states, where being anonymous is not an error.
export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    return await safeGetUser(ctx)
  },
})

// Protected counterpart to getCurrentUser. Exists both as the endpoint an
// authenticated-only loader can call, and as the thing that proves requireUser
// actually rejects anonymous callers.
export const getAuthenticatedUser = query({
  args: {},
  handler: async (ctx) => {
    return await requireUser(ctx)
  },
})
