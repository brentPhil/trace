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
 * 2,000 sits below that with room for the row to grow. It is deliberately the
 * same number everywhere, because two different bounds would mean two different
 * answers to "is this classifier still in use?" for the same account.
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
