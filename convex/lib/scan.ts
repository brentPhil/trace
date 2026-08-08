/**
 * How many `timeEntries` rows a mutation may read before it gives up.
 *
 * Convex bounds a transaction at 16,384 documents OR 8 MiB, whichever comes
 * first — and on this table it is always the bytes. A row admits a 2,000-char
 * note plus a 500-char title, so the worst case is roughly 2.7 KB and the byte
 * ceiling arrives at about 3,100 documents. A limit chosen against the document
 * count would therefore be a limit that does not bind: the transaction fails on
 * bytes first, with the opaque internal error the limit existed to prevent.
 *
 * 2,000 sits below that with room for the row to grow.
 *
 * It bounds two reads that are no longer the same shape, and the difference
 * matters. `projects.remove` reads `timeEntries` rows through `by_user_project`,
 * where the number above is a genuine byte-safety limit and saturating it means
 * refusing — not because use is proven, but because it is NOT: that function
 * says so itself, and rests on the judgement that 2,000 entries are unlikely to
 * be all soft-deleted in an account that has not been mass-deleting.
 * `tags.remove` reads `entryTags` rows, which are three fields each and nowhere
 * near any ceiling; there the number bounds only the COUNT reported in the
 * message, and saturating it makes a refusal vaguer ("At least 2,000") rather
 * than turning an unused tag into a refused one.
 *
 * One constant rather than two, because the user-facing meaning is the same in
 * both — "past this many, we say 'at least' instead of a total" — and a second
 * number would have to justify why the same account gets two different answers
 * about how precisely its classifiers are counted.
 *
 * It is deliberately NOT what decides whether a tag can be deleted. That was
 * the old design, before `entryTags` existed, and it meant tag deletion stopped
 * working entirely past this many entries.
 */
export const ENTRY_SCAN_LIMIT = 2_000

/**
 * How many entries `rangeSummary` totals before it stops being exact.
 *
 * Higher than the classifier bound because the trade is different. A classifier
 * scan reads whole rows to answer a yes/no question and then REFUSES when it
 * runs out; the summary reads to produce a number, and when it runs out it
 * still returns one — flagged `truncated`, which the UI must surface. Being
 * approximate and saying so is an acceptable answer to "what is the total for
 * this range"; it is not an acceptable answer to "is this tag safe to delete".
 */
export const SUMMARY_SCAN_LIMIT = 5_000
