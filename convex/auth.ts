import { betterAuth } from "better-auth/minimal"
import { createClient } from "@convex-dev/better-auth"
import { convex } from "@convex-dev/better-auth/plugins"
import authConfig from "./auth.config"
import { components } from "./_generated/api"
import { query } from "./_generated/server"
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
    },
    plugins: [
      // Required for Convex compatibility.
      convex({ authConfig }),
    ],
  })
}

// safeGetAuthUser returns null when signed out rather than throwing, so this
// can be loaded on pages that render both signed-in and signed-out states.
export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    return await authComponent.safeGetAuthUser(ctx)
  },
})
