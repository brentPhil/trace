/**
 * Marks an entry id that no server row has yet.
 *
 * An optimistic `start` has to put SOMETHING in `_id` — the real one does not
 * exist until the mutation lands — but the placeholder must be recognisable,
 * for two reasons:
 *
 *   Sending it to a mutation is an argument-validation error, because
 *   `v.id("timeEntries")` rejects anything that is not a real document id.
 *
 *   Any UI keyed on `_id` needs to know the identity is provisional, since it
 *   changes exactly once when the server's document replaces the placeholder.
 *   Reading that swap as "a different entry" is what silently discarded text
 *   typed during the round trip.
 *
 * Its own module, free of Convex and React imports, so component tests can
 * import it without pulling a client into jsdom.
 */
const OPTIMISTIC_ID_PREFIX = "optimistic:"

/** Builds the placeholder from the clientKey — deterministic, so it is stable
 *  across the many times Convex re-runs a pending optimistic update. */
export function optimisticIdFor(clientKey: string): string {
  return `${OPTIMISTIC_ID_PREFIX}${clientKey}`
}

export function isOptimisticId(id: string): boolean {
  return id.startsWith(OPTIMISTIC_ID_PREFIX)
}
