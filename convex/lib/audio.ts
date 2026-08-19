/** Maximum accepted audio upload: 20 MiB. Comfortably holds a ten-minute
 *  256 kbps track. */
export const MAX_TRACK_BYTES = 20 * 1024 * 1024

/** Maximum total audio stored per account. Convex bills storage per GB, and
 *  audio is roughly a thousand times the footprint of the invoice logos that
 *  are the only files this product stored before. */
export const MAX_LIBRARY_BYTES = 500 * 1024 * 1024

/** Bounds the row read that sums `bytes` for the cap above. A denormalised
 *  running total would be a number that can drift from the rows it claims to
 *  describe, and a storage meter that lies is worse than one that costs a few
 *  hundred rows to compute. */
export const MAX_TRACK_COUNT = 500

/** Longest accepted track name. */
export const MAX_TRACK_NAME_LENGTH = 200

/** An ALLOW-list, never a deny-list. */
export const ACCEPTED_AUDIO_CONTENT_TYPES = [
  "audio/mpeg",
  "audio/mp4",
  "audio/wav",
  "audio/ogg",
  "audio/flac",
] as const
export type AudioContentType = (typeof ACCEPTED_AUDIO_CONTENT_TYPES)[number]

export const AUDIO_INPUT_ACCEPT = ACCEPTED_AUDIO_CONTENT_TYPES.join(",")

export function isAcceptedAudioContentType(
  value: string | undefined
): value is AudioContentType {
  return (ACCEPTED_AUDIO_CONTENT_TYPES as ReadonlyArray<string>).includes(
    value ?? ""
  )
}

/** A filename with its extension stripped, trimmed and bounded — the seed for
 *  a new track's editable name. Never used as an identity. */
export function trackNameFromFilename(filename: string): string {
  const withoutExtension = filename.replace(/\.[^./\\]+$/, "")
  const trimmed = withoutExtension.trim()
  return (trimmed === "" ? "Untitled track" : trimmed).slice(
    0,
    MAX_TRACK_NAME_LENGTH
  )
}
