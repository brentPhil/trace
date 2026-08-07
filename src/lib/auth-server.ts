import { convexBetterAuthReactStart } from "@convex-dev/better-auth/react-start"

// basePath defaults to "/api/auth", which is where src/routes/api/auth/$.ts
// proxies from.
export const {
  handler,
  getToken,
  fetchAuthQuery,
  fetchAuthMutation,
  fetchAuthAction,
} = convexBetterAuthReactStart({
  convexUrl: process.env.VITE_CONVEX_URL!,
  convexSiteUrl: process.env.VITE_CONVEX_SITE_URL!,
})
