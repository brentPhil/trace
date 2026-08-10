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

/**
 * How many `timeEntries` rows `invoices.createFromRange` may scan before
 * refusing — LOWER than `SUMMARY_SCAN_LIMIT`, because that number is sized for
 * a QUERY and this scan runs inside a MUTATION.
 *
 * `rangeBreakdownImpl` (convex/entries.ts) is shared between `rangeBreakdown`,
 * a query, and `invoices.createFromRangeImpl`, a mutation — and a mutation's
 * transaction shares the SAME ~3,100-row byte ceiling documented on
 * `ENTRY_SCAN_LIMIT` above with every write it goes on to perform, on top of
 * it. `SUMMARY_SCAN_LIMIT` sits past where that ceiling arrives on this table,
 * so a large-but-real range would blow the transaction on bytes before
 * `truncated` was ever computed — and `RANGE_TOO_LARGE`, the refusal that
 * exists so a truncated range is never silently invoiced, would never fire.
 * The user would see the platform's own opaque internal error instead of the
 * one this product wrote for them.
 *
 * Set equal to `ENTRY_SCAN_LIMIT` rather than a second hand-picked number: the
 * same per-row byte accounting justifies both, over the same table, inside the
 * same kind of transaction.
 */
export const INVOICE_SCAN_LIMIT = ENTRY_SCAN_LIMIT

/**
 * How many `(week, project, description)` ROWS a breakdown will keep — NOT
 * how many distinct descriptions.
 *
 * `byTitle` in convex/entries.ts is keyed by
 * `weekStart\u0000projectId\u0000title`, so the same description repeated in
 * a second week, or under a second project, counts twice against this cap,
 * not once. Past this the block is not a table anyone reads, and shipping
 * every row of a pathological range costs the client more than the answer is
 * worth. `titlesTruncated` is what stops the list from merely ending: a
 * document that silently stops naming work reads as a complete account of
 * the period.
 *
 * The cut is taken from `allTitles` AFTER it is sorted by time across the
 * WHOLE RANGE, not per week — so a week whose own rows happen to sort late in
 * that global ordering can lose some of them while an earlier, larger week
 * keeps every one of its own. That week's printed Subtotal is then a genuine
 * UNDERSTATEMENT of its real total, not merely an incomplete list, and
 * `titlesTruncated` alone does not say so — see `TITLE_CAP_NOTE` in
 * src/lib/export/report-rows.ts, which is what has to carry that warning to
 * the reader and interpolates this same number into it, so the two can never
 * name two different limits.
 *
 * Exported from here — not convex/entries.ts — because `src/` may only reach
 * into Convex through the `@shared` alias onto convex/lib; entries.ts itself
 * is off limits to it (see eslint.config.js's component/Convex boundary).
 */
export const TITLE_ROW_LIMIT = 500
