import { internalMutation } from "./_generated/server"
import { components } from "./_generated/api"

/**
 * Deletes the stored JWKS so Better Auth regenerates it on the next request.
 *
 * Run this after BETTER_AUTH_SECRET changes. The JWKS private key is encrypted
 * with that secret, so a new secret leaves the existing key undecryptable and
 * every call to /api/auth/convex/token fails with:
 *
 *   BetterAuthError: Failed to decrypt private key.
 *
 * Sign-in still succeeds when this happens — the session cookie is unaffected —
 * but the client never receives a Convex token, so an app using
 * `expectAuth: true` waits indefinitely rather than erroring.
 *
 * Safe to run: the keypair is derived state, not user data. Sessions, accounts
 * and users are untouched. Outstanding Convex tokens stop verifying, so clients
 * fetch a fresh one.
 *
 *   npx convex run maintenance:clearJwks
 */
export const clearJwks = internalMutation({
  args: {},
  handler: async (ctx) => {
    // deleteMany is paginated. A JWKS holds a handful of keys at most, so one
    // page is enough; this is not a general-purpose bulk delete.
    await ctx.runMutation(components.betterAuth.adapter.deleteMany, {
      input: { model: "jwks" },
      paginationOpts: { cursor: null, numItems: 100 },
    })
    return { cleared: true }
  },
})
