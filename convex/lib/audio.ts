/** Maximum accepted audio upload: 250 MiB. Holds a long lossless set — a
 *  full-length WAV or FLAC album side — not just a compressed single. */
export const MAX_TRACK_BYTES = 250 * 1024 * 1024

/**
 * Maximum total audio stored per account.
 *
 * SIZED AGAINST `MAX_TRACK_BYTES`, not chosen independently. The pair has to
 * leave room for a library rather than for one file: at 500 MiB — what this
 * was when a track could only be 20 MiB — a 250 MiB cap would have meant an
 * account was full after two uploads, and the two limits would have spent
 * their time contradicting each other. 2 GiB holds eight tracks at the
 * ceiling and a great many ordinary ones.
 *
 * Convex bills storage per GB, so this number is a real cost per account.
 */
export const MAX_LIBRARY_BYTES = 2 * 1024 * 1024 * 1024

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

/**
 * A size, in the unit a person would say it in.
 *
 * ONE COPY, HERE, in the shared layer — deliberately not a helper on the page.
 * There were three hand-rolled `formatMb` functions before this, one per
 * component, each doing MiB arithmetic and labelling it "MB". That was
 * tolerable while every number they rendered was megabytes. It stopped being
 * tolerable when `MAX_LIBRARY_BYTES` became 2 GiB, which all three would have
 * written as "2048 MB".
 *
 * `convex/lib` is the layer both sides import, so the SERVER's rejection
 * sentence and the CLIENT's warning are now formatted by the same function
 * from the same constant — which is what stops "no larger than 20 MB" sitting
 * hardcoded in an error string while the cap has moved on, as it had here.
 *
 * MiB and GiB arithmetic, labelled "MB" and "GB", matching the constants above
 * and how storage is spoken about in practice.
 */
export function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024)
  // A gibibyte is the switch. Below it "1023 MB" still reads naturally; above
  // it "2048 MB" does not.
  if (mb >= 1024) {
    return `${Math.round((mb / 1024) * 10) / 10} GB`
  }
  return `${Math.round(mb * 10) / 10} MB`
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
