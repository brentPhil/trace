import { isOptimisticId } from "@/lib/optimistic-id"

/**
 * Placeholder ids inside mutation args.
 *
 * An op made offline may name an id the server has not minted yet — the
 * project created a moment earlier, the entry started an hour ago. The
 * outbox learns the real id when the producing op is acknowledged and
 * rewrites every later op before sending it. These two walkers are that
 * rewrite and its precondition. Pure; no Convex, no DOM.
 */

function walk(value: unknown, onString: (s: string) => string): { value: unknown; changed: boolean } {
  if (typeof value === "string") {
    const next = onString(value)
    return { value: next, changed: next !== value }
  }
  if (Array.isArray(value)) {
    let changed = false
    const next: unknown[] = []
    for (const item of value) {
      const r = walk(item, onString)
      if (r.changed) changed = true
      next.push(r.value)
    }
    return { value: changed ? next : value, changed }
  }
  if (typeof value === "object" && value !== null) {
    let changed = false
    const next: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      const r = walk(item, onString)
      if (r.changed) changed = true
      next[key] = r.value
    }
    return { value: changed ? next : value, changed }
  }
  return { value, changed: false }
}

/** Replaces every resolved placeholder. Same reference back when nothing changed. */
export function rewritePlaceholders<T>(value: T, resolved: Record<string, string>): T {
  // `Object.hasOwn`, not `resolved[s] ?? s`. This callback sees EVERY string
  // in the args, not only placeholder-shaped ones, and a plain object answers
  // for its prototype: an entry titled "constructor" or a project named
  // "toString" would look up a function and splice it into the args, which
  // then goes to a mutation that takes strings. Found in review.
  return walk(value, (s) => (Object.hasOwn(resolved, s) ? resolved[s] : s)).value as T
}

/** Placeholders present in `value` that `resolved` cannot answer, in order, once each. */
export function unresolvedPlaceholders(value: unknown, resolved: Record<string, string>): string[] {
  const found: string[] = []
  walk(value, (s) => {
    if (isOptimisticId(s) && !(s in resolved) && !found.includes(s)) found.push(s)
    return s
  })
  return found
}
