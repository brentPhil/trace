import type { RepeatMode } from "./queue"
import type { TrackRef } from "./track-ref"

/**
 * How you like to listen — held on the DEVICE, not in the account.
 *
 * Two reasons, both load-bearing. A volume slider fires a change event per
 * pixel of drag, and routing that to a Convex mutation is a write storm for a
 * value nobody audits. And "how loud" is a fact about THIS LAPTOP'S SPEAKERS:
 * syncing it would mean a user on headphones sets the volume for their next
 * session on desk speakers.
 *
 * Everything read out of here is validated on the way in. This is localStorage
 * — the user can edit it, an old build may have written a different shape, and
 * a throw here happens inside the layout that mounts the player, where it takes
 * the whole authed app down with it.
 */
export type LocalPrefs = {
  volume: number
  shuffle: boolean
  repeat: RepeatMode
  lastTrack: TrackRef | null
}

const KEY = "chroneli:music"

export const DEFAULT_LOCAL_PREFS: LocalPrefs = {
  volume: 0.6,
  shuffle: false,
  repeat: "all",
  lastTrack: null,
}

/** Absent during SSR and in the node test project. */
function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage
  } catch {
    // Accessing localStorage throws outright when cookies are blocked.
    return null
  }
}

function isRepeatMode(value: unknown): value is RepeatMode {
  return value === "off" || value === "one" || value === "all"
}

function isTrackRef(value: unknown): value is TrackRef {
  if (typeof value !== "object" || value === null) return false
  const ref = value as { origin?: unknown; slug?: unknown; trackId?: unknown }
  if (ref.origin === "chroneli") return typeof ref.slug === "string"
  if (ref.origin === "upload") return typeof ref.trackId === "string"
  return false
}

export function readLocalPrefs(): LocalPrefs {
  const raw = storage()?.getItem(KEY)
  if (raw === null || raw === undefined) return DEFAULT_LOCAL_PREFS

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return DEFAULT_LOCAL_PREFS
  }
  if (typeof parsed !== "object" || parsed === null) return DEFAULT_LOCAL_PREFS

  const value = parsed as Partial<Record<keyof LocalPrefs, unknown>>
  return {
    volume:
      typeof value.volume === "number" && Number.isFinite(value.volume)
        ? Math.min(1, Math.max(0, value.volume))
        : DEFAULT_LOCAL_PREFS.volume,
    shuffle:
      typeof value.shuffle === "boolean" ? value.shuffle : DEFAULT_LOCAL_PREFS.shuffle,
    repeat: isRepeatMode(value.repeat) ? value.repeat : DEFAULT_LOCAL_PREFS.repeat,
    lastTrack: isTrackRef(value.lastTrack) ? value.lastTrack : null,
  }
}

export function writeLocalPrefs(patch: Partial<LocalPrefs>): void {
  const store = storage()
  if (store === null) return
  try {
    store.setItem(KEY, JSON.stringify({ ...readLocalPrefs(), ...patch }))
  } catch {
    // Quota exceeded, or private mode. Losing a volume preference is not worth
    // an error the user has to dismiss.
  }
}
