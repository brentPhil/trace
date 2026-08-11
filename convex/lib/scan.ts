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
 * How many `invoices` rows `createFromRange` may read while computing the
 * next invoice number before it refuses, rather than risk handing out one
 * already in use.
 *
 * `nextInvoiceNumber` needs the HIGHEST sequence ever used, not every number —
 * so the obvious optimisation is reading a small tail of `by_user_number`
 * instead of the whole table. That does not work here. The index sorts
 * `number` — `MMDDYY-NNNN` — as a STRING, and string order diverges from
 * sequence order in two ways that both matter: (1) the six-digit date stamp
 * leads every comparison, so an old invoice whose sequence is high sorts
 * BEFORE a recent invoice whose sequence is low, and the true maximum can sit
 * anywhere in the table, not at either end; (2) even within one date, `NNNN`
 * grows past four digits once the sequence does, and "10000" sorts BEFORE
 * "9999" as a string though it is numerically larger. No slice of the index,
 * front or back, provably contains the maximum. `number` is also
 * user-editable (see convex/lib/invoiceNumber.ts), so a handwritten scheme
 * can land anywhere in that order too. The only read that is provably
 * correct is the whole table.
 *
 * So this bounds a full scan instead, and refusing past it is the same trade
 * `RANGE_TOO_LARGE` makes: two invoices claiming the same number is a client's
 * bookkeeper finding a duplicate id, which a refusal is cheaper than.
 *
 * This scan runs in the SAME mutation, and so the SAME transaction, as the
 * `timeEntries` scan bounded by `INVOICE_SCAN_LIMIT` above — its budget is
 * whatever the 8 MiB ceiling has left after that scan's own worst case
 * (`INVOICE_SCAN_LIMIT` rows at up to ~2.7 KB each, or ~5.4 MB), not the full
 * 8 MiB. An `invoices` row is far lighter: nothing this mutation writes onto
 * one is free text yet, so the worst case is `billedTo` — bounded by
 * `clients.ts`'s own `MAX_NAME_LENGTH` (100) plus `MAX_ADDRESS_LENGTH` (500)
 * — beside a handful of ids and numbers, call it ~800 bytes. 2,000 such rows
 * is ~1.6 MB, leaving real headroom inside the ~2.6 MB the entry scan's worst
 * case leaves behind.
 *
 * An invoice deliberately carries NO notes field, which is what would otherwise
 * blow this estimate — an invoice is a statement of what is owed, and free-form
 * commentary belongs on the time entries the lines were built from. The two
 * free-text fields that remain (`purchaseOrder`, `paymentTerms`) are short by
 * nature, but nothing yet enforces that: the editor that first WRITES them must
 * bound their length, or this estimate stops holding.
 */
export const INVOICE_NUMBER_SCAN_LIMIT = 2_000

/**
 * How many `invoices` rows `invoices.list` hands back, newest first.
 *
 * Unlike the number scan above, this one runs in its OWN query rather than
 * inside `createFromRange`'s mutation, so it has the whole 8 MiB transaction to
 * spend rather than what an entry scan left behind. It still does not spend it,
 * because the invoice rows are not what costs: the list prints a per-invoice
 * TOTAL, a total is `invoiceTotals` over that invoice's stored `invoiceLines`,
 * and so the read is a page of invoices PLUS every line of every one of them.
 *
 * The arithmetic, on the same per-row accounting `INVOICE_NUMBER_SCAN_LIMIT`
 * above uses. An `invoices` row is ~800 B (`billedTo` bounded by clients.ts's
 * `MAX_NAME_LENGTH` + `MAX_ADDRESS_LENGTH`, beside ids and numbers). An
 * `invoiceLines` row is a description, four numbers and two ids — call it
 * ~400 B. So this page's worst case is 50 x (800 + M x 400) bytes for M lines
 * an invoice: at M = 200 that is ~4.0 MB, half the ceiling, across 50 x 201 =
 * 10,050 documents against the 16,384-document limit.
 *
 * WHAT BOUNDS M: nothing, honestly. `createFromRange` writes one line per
 * project with billable time in the range, which is bounded only by how many
 * projects an account has, and the editor adds custom charges with no cap at
 * all. M = 200 above is a working figure for an invoice a human raises and
 * prints, not a proof — and the page size IS the margin bought for it. 50
 * rather than the ~200 the byte budget would nominally allow, so an account
 * whose invoices run four times longer than that figure still fits.
 *
 * Returning the newest page and offering no "load older" is the accepted v1
 * trade, and the UI has to SAY so: a list that silently stops at 50 invoices
 * is a list that lies about how many exist. `invoices.list` reads one row past
 * this to learn whether older ones exist, and /invoices interpolates this same
 * constant into the sentence naming the cap — the same device `TITLE_CAP_NOTE`
 * (src/lib/export/report-rows.ts) uses for `TITLE_ROW_LIMIT` below, and for
 * the same reason: a constant here and a hand-typed number in a sentence stop
 * agreeing the day only one of them changes.
 */
export const INVOICE_LIST_LIMIT = 50

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
