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
 * NO CATEGORIES, still. Four tracks is enough to shuffle but not enough to
 * divide: every one of them is lo-fi, so a category control would offer a
 * single option and read as a promise the library does not keep. A `category`
 * field goes here when the catalog actually spans more than one, and nothing
 * else changes when it does.
 *
 * ORDER IS THE DEFAULT ORDER. The first entry is what a brand-new account with
 * no history plays, so it is the least-demanding one deliberately.
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
  {
    slug: "lofi-sunny-cafe",
    name: "Lo-fi Sunny Cafe",
    file: "/music/alex-morgan-lofi-sunny-cafe-568156.mp3",
  },
  {
    slug: "lofi-restaurant",
    name: "Lo-fi Restaurant",
    file: "/music/alex-morgan-lofi-restaurant-568157.mp3",
  },
  {
    slug: "lofi-relax",
    name: "Lo-fi Relax",
    file: "/music/kulakovka-lofi-relax-570489.mp3",
  },
]
