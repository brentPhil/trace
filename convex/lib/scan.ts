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
 * 8 MiB. Call what is left ~3.0 MB.
 *
 * WHAT AN `invoices` ROW COSTS — redone, because the editor this comment used
 * to warn about now exists. `invoices.update` is where a human first types
 * into one of these rows, and every bound it enforces is a term here:
 * `billedTo` and `payTo` at `MAX_PARTY_LENGTH` (601 each, which is clients.ts's
 * `MAX_NAME_LENGTH` + a newline + `MAX_ADDRESS_LENGTH`, so a block
 * `createFromRange` snapshots always fits the editor that has to save it back),
 * `purchaseOrder` at 100, `paymentTerms` at 200. That is ~1.5 KB of text beside
 * a handful of ids and numbers — call the row ~1.8 KB, where this comment said
 * ~800 B while `billedTo` was the only writable text on it.
 *
 * So the LIMIT halved rather than the estimate being quietly restated. 1,000
 * rows is ~1.8 MB of the ~3.0 MB available; the old 2,000 would now be ~3.6 MB
 * and would not fit. An account past 1,000 invoices is refused a new number
 * instead of handed a wrong one, which is the trade this constant already
 * made at 2,000 and the same one `RANGE_TOO_LARGE` makes.
 *
 * THE BOUNDS COUNT CHARACTERS AND THE CEILING COUNTS BYTES, and everything
 * above equates the two — which is only true for ASCII. Being exact about how
 * far that goes, rather than calling it headroom:
 *
 *     1 B/char  1,000 rows ~ 1.8 MB   fits inside the ~3.0 MB above
 *     2 B/char  1,000 rows ~ 3.3 MB   does NOT fit
 *     3 B/char  1,000 rows ~ 4.8 MB   does NOT fit
 *
 * So the honest statement is not that 1,000 has margin for any account. It is
 * that 1,000 holds for an account whose invoices are ASCII, and that what makes
 * it hold for everyone else is that no real party block is anywhere near its
 * 601-character bound — a name and a postal address run 60-120 characters, not
 * 601, and the bounds exist to stop a paste accident rather than to describe a
 * document. An account that genuinely saturated these fields in a three-byte
 * script would exceed the budget at roughly 600 invoices, and would get the
 * platform's opaque error rather than this constant's refusal.
 *
 * Lowering the number until that case fits is the wrong fix: it would trade a
 * limit nobody reaches for one many accounts do.
 *
 * NAMING THE TENSION IN THAT SENTENCE, because it is the shape of the halving
 * this comment just defended. The paragraph above says a real party block runs
 * 60-120 characters, which makes a real `invoices` row ~400 B rather than the
 * ~1.8 KB the division uses — and at ~400 B even 2,000 rows would be ~0.8 MB,
 * comfortably inside the ~3.0 MB budget. So 1,000 is set by a paste-accident
 * guard nobody approaches, while 2,000 was a limit no account would reach and
 * 1,000 is one a decade of monthly multi-client invoicing does. The argument
 * against lowering further applies, in weaker form, to the lowering that
 * happened here.
 *
 * It stands anyway, and deliberately: every bound in this file is derived from
 * a PROVABLE worst case rather than from an expected one, because a limit sized
 * to the typical row fails exactly on the atypical account — the one that
 * pasted a contract into an address field — and fails as the platform's opaque
 * transaction error rather than as a sentence. What is not defensible is
 * pretending the trade is free, which is why this paragraph exists rather than
 * a quiet number change.
 *
 * The right fix is neither number: it is to stop scanning. `nextInvoiceNumber`
 * reads the whole table only because it needs the highest sequence ever used
 * and string order does not track sequence order (see above) — persisting that
 * high-water mark on write removes the scan, this constant, and this entire
 * comment. That is the change to make before raising this number, not instead
 * of thinking about it.
 *
 * An invoice deliberately carries NO notes field, which is what would blow the
 * estimate all over again — an invoice is a statement of what is owed, and
 * free-form commentary belongs on the time entries the lines were built from.
 * `paymentTerms` is bounded at 200 for precisely that reason: it is the field
 * a notes field would come back as.
 */
export const INVOICE_NUMBER_SCAN_LIMIT = 1_000

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
 * above uses. An `invoices` row is ~1.8 KB once `invoices.update`'s bounds are
 * summed (see that constant — `billedTo` and `payTo` at 601 each,
 * `purchaseOrder` at 100, `paymentTerms` at 200, beside ids and numbers). An
 * `invoiceLines` row is a description, four numbers and two ids — call it
 * ~400 B. For M lines an invoice, a page of 50 costs 50 x (1,800 + M x 400)
 * bytes and 50 x (1 + M) documents.
 *
 * That ~400 B assumes a bound `invoiceLines.description` does not actually
 * have. It is a bare `v.string()`, and it holds today only because the sole
 * writer is `createFromRange`, which puts a project name (bounded by
 * projects.ts) or `NO_PROJECT_LABEL` in it. A line editor writing free text
 * breaks the per-row figure the same way an unbounded `purchaseOrder` would
 * have broken `INVOICE_NUMBER_SCAN_LIMIT`'s — so it gets the same warning, and
 * `invoices.update` is the worked example of answering it: whichever editor
 * first lets a human type a description must bound its length, and then redo
 * the division below.
 *
 * DOCUMENTS BIND, NOT BYTES, and it is worth saying plainly because the
 * accounting above is all in bytes and the byte ceiling is the LOOSER of the
 * two here. At a page of 50 the document limit is reached at M = 327 and the
 * byte limit not until M = 415, so the real headroom is:
 *
 *     M <= 326 fits. M = 200 -> 10,050 docs (61% of 16,384) and ~4.1 MB (49%).
 *
 * WHAT BOUNDS M: nothing, honestly. `createFromRange` writes one line per
 * project with billable time in the range, which is bounded only by how many
 * projects an account has, and a line editor would add custom charges with no
 * cap at all. M = 200 is a working figure for an invoice a human raises and
 * prints, not a proof; 326 is where that figure stops having any margin left.
 * The margin is therefore ~1.6x, NOT the 4x an earlier draft of this comment
 * claimed — 50 invoices of 800 lines is 40,050 documents, two and a half times
 * the ceiling, and the claim was simply wrong. Anyone raising this constant
 * must redo the division above rather than trust a remembered margin.
 *
 * THE RESIDUAL RISK, stated because this file's job is to leave nothing for a
 * reader to re-derive: unlike `RANGE_TOO_LARGE` and `INVOICE_HISTORY_TOO_LARGE`,
 * which refuse in a sentence the user can act on, `invoices.list` takes no
 * arguments — there is no range to narrow. If a page ever did exceed a ceiling
 * the user would get the platform's own opaque error on the only route that
 * reaches an invoice, with no way to open one and delete lines. Today that
 * state is unreachable (nothing writes lines but `createFromRange`, at one per
 * project), which is why this ships as an argued bound rather than machinery.
 * The moment a line editor makes M genuinely unbounded, the fix is NOT a bigger
 * number here: it is storing `totalCents` on the invoice, so the list reads 50
 * documents instead of 50 x (1 + M) and this whole paragraph goes away. An
 * invoice holding its own total is also more faithful to the snapshot rule, not
 * less — it is the same argument `invoiceLines.amountCents` already makes one
 * level down.
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
