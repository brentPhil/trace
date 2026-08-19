/**
 * The music Chroneli ships with.
 *
 * A literal array, not a database table and not a directory listing. These
 * files are served from `public/` as Cloudflare Workers static assets, so the
 * catalog costs no storage billing, no signed URLs, no rows and no query.
 *
 * BOUNDED BY GIT, NOT BY CLOUDFLARE. Every mp3 here is a binary blob in history
 * forever, and cannot be removed later without rewriting it. The ceiling is
 * roughly twelve tracks / ~55 MB; past that the manifest moves to R2 and
 * `resolveTrackUrl` grows a base URL — which is the whole reason the
 * indirection exists.
 *
 * NO CATEGORIES. Lo-fi / Ambient / Deep Focus are meaningless partitions of a
 * one-element set. A `category` field goes here when there are enough tracks to
 * divide, and nothing else changes.
 *
 * Provenance for every file is in public/music/LICENSE.md. A track whose
 * licence cannot be produced on request has to be pulled.
 */
export type CatalogTrack = {
  /** Stable id stored in `musicPreferences.trackRef`. NEVER derived from the
   *  filename: renaming a file must not orphan every preference pointing at
   *  it. */
  slug: string
  name: string
  /** Public path, served from `public/`. */
  file: string
}

export const CATALOG: ReadonlyArray<CatalogTrack> = [
  {
    slug: "lofi-chill-beats",
    name: "Lo-fi Chill Beats",
    file: "/music/alex-morgan-lofi-chill-vlog-beats-573883.mp3",
  },
]
