import { CATALOG } from "./catalog"

/**
 * Which track, across both places a track can come from.
 *
 * A discriminated union rather than two nullable columns, because it is the
 * seam every later phase hangs off: a catalog moved to R2, or a playlist
 * reference in Phase 2, is a new member of this union and nothing that reads it
 * changes shape.
 *
 * `trackId` is a plain `string` here rather than `Id<"musicTracks">` so this
 * module stays free of generated Convex types and runs in the pure `unit` test
 * project. The Convex validator in convex/schema.ts is where the real id type
 * is enforced.
 */
export type TrackRef =
  | { origin: "upload"; trackId: string }
  | { origin: "chroneli"; slug: string }

/**
 * The URL to hand the `<audio>` element, or null when there is nothing to play.
 *
 * NULL IS A NORMAL ANSWER, not an error: a preference can point at a track the
 * user has since deleted, and a catalog slug can outlive the file it named. The
 * caller falls through to the next resolution step. Returning a broken URL
 * instead would surface as an unexplained decode failure several layers away.
 *
 * Upload URLs are passed in rather than fetched, because they come from a
 * Convex query that only the React layer can run — keeping them a parameter is
 * what keeps this function pure.
 */
export function resolveTrackUrl(
  ref: TrackRef,
  uploadUrls: ReadonlyMap<string, string>
): string | null {
  if (ref.origin === "chroneli") {
    return CATALOG.find((track) => track.slug === ref.slug)?.file ?? null
  }
  return uploadUrls.get(ref.trackId) ?? null
}

/** A stable string key. `\0` as the separator, for the reason `sittingKey`
 *  gives: a user-supplied id must not be able to impersonate another by
 *  containing the delimiter. */
export function trackRefKey(ref: TrackRef): string {
  return ref.origin === "chroneli"
    ? `chroneli\0${ref.slug}`
    : `upload\0${ref.trackId}`
}

/**
 * Whether two refs name the same track.
 *
 * `null` equals nothing, INCLUDING null. "Nothing is playing" is not a track,
 * so two nothings are not the same track — and the callers use this to decide
 * whether to restart playback, where treating null as a match means a stopped
 * player never starts.
 */
export function trackRefEquals(a: TrackRef | null, b: TrackRef | null): boolean {
  if (a === null || b === null) return false
  return trackRefKey(a) === trackRefKey(b)
}
