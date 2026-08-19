/**
 * Which track plays next, as arithmetic.
 *
 * Pure on purpose: this is the only part of the music feature with real
 * branching in it, and keeping it away from the `<audio>` element is what makes
 * the branches testable without a DOM, an autoplay policy, or a decoder.
 *
 * `null` means STOP — not "index zero". A list that has run out and a list that
 * wraps are different outcomes, and returning 0 for both is how a repeat-off
 * playlist quietly loops forever.
 */
export type RepeatMode = "off" | "one" | "all"

export type QueuePosition = {
  length: number
  /** Index into the TRACK LIST, never into `order`. */
  index: number
  repeat: RepeatMode
  /** A permutation of `0..length-1`, or null when shuffle is off. */
  order: Array<number> | null
}

/** Where `index` sits within the playback order — the list itself, or the shuffle. */
function positionOf({ index, order }: QueuePosition): number {
  if (order === null) return index
  const at = order.indexOf(index)
  // An order that has gone stale against the list (a track was deleted mid-play)
  // is treated as no order at all rather than as an error. The alternative is
  // throwing inside an `ended` handler, where nothing can catch it usefully.
  return at === -1 ? index : at
}

function trackAt(position: QueuePosition, slot: number): number {
  const { order } = position
  if (order === null || slot < 0 || slot >= order.length) return slot
  return order[slot]
}

function step(position: QueuePosition, delta: 1 | -1): number | null {
  const { length, repeat } = position
  if (length <= 0) return null

  const slot = positionOf(position) + delta
  if (slot >= 0 && slot < length) return trackAt(position, slot)
  if (repeat === "all") return trackAt(position, (slot + length) % length)
  return null
}

/**
 * The next track, or null to stop.
 *
 * `repeat: "one"` returns the CURRENT index, which is what makes a single
 * track loop when it ends.
 */
export function nextIndex(position: QueuePosition): number | null {
  if (position.length <= 0) return null
  if (position.repeat === "one") return position.index
  return step(position, 1)
}

/**
 * The previous track, or null to stop.
 *
 * NOT symmetric with `nextIndex` under `repeat: "one"`. Repeat-one describes
 * what happens when a track ENDS on its own; pressing Previous is a request to
 * move, and honouring repeat-one there would trap the user on one track with a
 * button that visibly does nothing.
 */
export function prevIndex(position: QueuePosition): number | null {
  return step(position, -1)
}

/**
 * A deterministic permutation of `0..length-1`.
 *
 * Seeded rather than `Math.random`, so a re-render cannot reshuffle a queue
 * mid-playback and so the tests can assert a real permutation. Mulberry32 —
 * small, and its quality is irrelevant here: nobody can hear the difference
 * between one shuffle of twelve tracks and another.
 */
export function shuffledOrder(length: number, seed: number): Array<number> {
  const order = Array.from({ length }, (_, i) => i)
  let state = seed >>> 0
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  for (let i = length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  return order
}
