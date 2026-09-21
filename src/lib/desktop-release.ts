/**
 * The desktop app's two public URLs, named once.
 *
 * `DESKTOP_RELEASES_URL` 404s until a GitHub release has been PUBLISHED —
 * `desktop.yml` only ever creates drafts (see docs/desktop.md → Releasing).
 * Publishing one is a precondition for deploying the landing page. Kept here
 * rather than in `@shared/brand` because nothing in Convex needs it, and
 * `convex/lib` is the shared layer only for what Convex does need.
 */
export const DESKTOP_RELEASES_URL =
  "https://github.com/brentPhil/trace/releases/latest"

/** The unsigned-install steps, which have one home and should keep it. */
export const DESKTOP_INSTALL_URL =
  "https://github.com/brentPhil/trace/blob/master/docs/desktop.md#unsigned-installs"
