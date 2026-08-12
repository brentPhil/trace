/*
 * The product's name, in one place.
 *
 * Page titles, the wordmark and the password-reset email all read from here,
 * so renaming the product is this file rather than a sweep through twenty
 * call sites — which is what the previous name cost.
 *
 * It lives in the shared layer, not `src/lib`, because `convex/email.ts`
 * needs the name too and Convex functions cannot import from `src`.
 */

export const APP_NAME = "Chroneli"

/*
 * The em dash and its spaces are the convention every route title follows.
 * Defining it here is the point: every route previously spelled it out
 * individually, and a separator that drifts between tabs looks like a bug.
 */
export function pageTitle(page?: string) {
  return page ? `${page} — ${APP_NAME}` : APP_NAME
}
