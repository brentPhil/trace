import {
  ACCEPTED_AUDIO_CONTENT_TYPES,
  MAX_LIBRARY_BYTES,
  MAX_TRACK_BYTES,
  MAX_TRACK_COUNT,
  isAcceptedAudioContentType,
} from "@shared/audio"

/*
 * What the page can know before it sends a byte.
 *
 * ADVISORY, NEVER AUTHORITATIVE. `acceptTrack` in convex/music.ts remains the
 * only thing that decides whether a track is stored, and every sentence below
 * is a local echo of a rule it already enforces. The value here is not a second
 * layer of safety — it is that a 300 MB file currently uploads IN FULL, gets
 * stored by Convex, is read by `addTrackAction`, is refused, and is deleted,
 * with the user watching a progress bar the whole way for an answer that was
 * knowable from `file.size` alone.
 *
 * Structural `Candidate` rather than `File`: this module is in the `unit`
 * (Node) test project, and three fields is genuinely all that a cap check
 * reads off an upload.
 */

export type Candidate = { name: string; size: number; type: string }
export type LibraryState = { libraryBytes: number; trackCount: number }
export type PrecheckResult = { ok: true } | { ok: false; reason: string }

const OK: PrecheckResult = { ok: true }

/** Megabytes as the rest of the page writes them — see `formatMb` in
 *  -music.tsx, whose rounding this deliberately matches so "12 MB free" here
 *  and "12 MB of 500 MB used" there cannot disagree by a decimal. */
function mb(bytes: number): string {
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`
}

/** "MP3, M4A, WAV, OGG or FLAC", built from the allow-list rather than typed
 *  out, so a format added to the server appears in this sentence by itself. */
export function acceptedFormatList(): string {
  const names = ACCEPTED_AUDIO_CONTENT_TYPES.map((type) =>
    type === "audio/mpeg"
      ? "MP3"
      : type === "audio/mp4"
        ? "M4A"
        : type.replace("audio/", "").toUpperCase()
  )
  const last = names[names.length - 1]
  return `${names.slice(0, -1).join(", ")} or ${last}`
}

/**
 * Whether this file can possibly be accepted, given the library as it stands.
 *
 * Order matters: the per-track cap is reported before the library cap, because
 * "that track is too big" is actionable (pick a different file) while "your
 * library is full" sends the user to delete things they may not need to.
 */
export function precheck(
  candidate: Candidate,
  against: LibraryState
): PrecheckResult {
  if (candidate.size > MAX_TRACK_BYTES) {
    return {
      ok: false,
      reason: `That track is ${mb(candidate.size)}. The limit is ${mb(MAX_TRACK_BYTES)} per track.`,
    }
  }

  // ONLY when the OS gave a type. An empty `file.type` is not a claim that the
  // file is unacceptable — it is the absence of a claim, and the server
  // resolves it by sniffing the stored blob. Refusing here would reject files
  // that would have been accepted, which is a regression wearing a validation's
  // clothes. See the Content-Type comment in `postFileWithProgress`.
  if (candidate.type !== "" && !isAcceptedAudioContentType(candidate.type)) {
    return { ok: false, reason: `Chroneli plays ${acceptedFormatList()}.` }
  }

  const free = MAX_LIBRARY_BYTES - against.libraryBytes
  if (candidate.size > free) {
    return {
      ok: false,
      reason: `Your library has ${mb(Math.max(0, free))} free; this track needs ${mb(candidate.size)}.`,
    }
  }

  if (against.trackCount + 1 > MAX_TRACK_COUNT) {
    return {
      ok: false,
      reason: `Your library holds ${MAX_TRACK_COUNT} tracks. Remove one to make room.`,
    }
  }

  return OK
}

/** The library as it will be once `candidate` has landed. Threaded through a
 *  batch so each file is checked against what the earlier ones consumed. */
export function advance(
  state: LibraryState,
  candidate: Candidate
): LibraryState {
  return {
    libraryBytes: state.libraryBytes + candidate.size,
    trackCount: state.trackCount + 1,
  }
}
