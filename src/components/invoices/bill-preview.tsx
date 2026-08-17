import { InvoiceLines } from "@/components/invoices/invoice-lines"
import { formatTotal } from "@/lib/format-total"
import { SET_A_RATE_NOTE, UNPRICED_NOTE } from "@/lib/export/report-rows"
import type { DurationDisplay } from "@/lib/format-total"
import type { InvoiceLineDraft } from "@shared/invoiceLines"

/**
 * What the button is about to bill, drawn before it is pressed.
 *
 * THE LINES ARE NOT AN ILLUSTRATION. They are `invoiceLineDrafts` over the same
 * `entries.rangeBreakdown` answer `invoices.createFromRange` prices, through the
 * one derivation both sides call (convex/lib/invoiceLines.ts) — so what is on
 * this screen is not "roughly what you will get", it is the rows that will be
 * inserted, with the same descriptions, the same floored quantities and the
 * same amounts. A preview computed a second way would be worse than no preview:
 * it is a promise the product then breaks in a client's inbox, and an invoice is
 * write-once, so there is no correcting it afterwards.
 *
 * `InvoiceLines` rather than a table of its own, for the same reason: it is the
 * component the record page and — through `invoice-document.ts` — the PDF print
 * from, so the preview, the record and the paper are one column order and one
 * totals block. The one thing it is handed that is not stored yet is the shape:
 * drafts carry no `kind`, and `createFromRange` writes every line it derives as
 * `"time"`, which is what makes the RATE cell read `$120.00/hr` here exactly as
 * it will there.
 *
 * Taxes are `[]`, because `createFromRange` writes `taxes: []` — there is no tax
 * editor, and an empty array is what the document will actually carry rather
 * than a simplification made for the preview.
 */
export function BillPreview({
  pending,
  lines,
  currency,
  unratedMs,
  durationDisplay,
  mergeDeclined,
}: {
  /**
   * The scan has not landed, or what is on screen is a stale answer for a
   * different range.
   *
   * Drawn as a SENTENCE rather than as a zero-line document, and that is not a
   * nicety. `InvoiceLines` renders "No lines on this invoice" over a $0.00
   * total, and while `NO_PRICED_TIME` means no such invoice can ever be MINTED,
   * that drawing is still exactly what a range where every project is unrated
   * previews as — it is the evidence for the refusal beside the button. Showing
   * it while the scan is still running would put that evidence on screen for a
   * range nothing has finished checking, in the one place a user decides whether
   * to bill a client: an empty table reads as "there is nothing here", when the
   * truth is "we do not know yet". The words are the button's own refusal,
   * verbatim, because they are the same fact.
   */
  pending: boolean
  lines: ReadonlyArray<InvoiceLineDraft>
  currency: string
  /** Billable milliseconds in the range that NO rate covers, straight from the
   *  breakdown. See the note below for why this cannot be silent. */
  unratedMs: number
  durationDisplay: DurationDisplay
  mergeDeclined: boolean
}) {
  return (
    <section
      aria-labelledby="bill-preview-heading"
      className="flex flex-col gap-4"
    >
      <div className="flex flex-col gap-1">
        <h2 id="bill-preview-heading" className="text-sm font-semibold">
          What this will bill
        </h2>
        <p className="max-w-prose text-xs text-muted-foreground">
          These are the lines the invoice will carry, priced as they will be
          stored. An invoice bills billable time only.
        </p>
      </div>

      {pending ? (
        <p role="status" className="text-sm text-muted-foreground">
          Still totalling this period.
        </p>
      ) : (
        <InvoiceLines
          // `kind: "time"` is not a default chosen here — it is what
          // `createFromRange` inserts for every line it derives from a range.
          lines={lines.map((line) => ({ kind: "time" as const, ...line }))}
          currency={currency}
          taxes={[]}
        />
      )}

      {!pending && mergeDeclined ? (
        <p role="status" className="max-w-prose text-xs text-muted-foreground">
          These projects bill at different rates, so this invoice lists them
          separately.
        </p>
      ) : null}

      {/*
        BILLABLE TIME NOBODY HAS PRICED, and the reason it is on this screen at
        all: `invoiceLineDrafts` deliberately leaves those buckets off rather
        than guessing a rate or billing them at zero, so that work is on NO line
        of the table above and is invoiced to nobody. Told before the document
        is minted, because there is no editor afterwards to add it.

        `UNPRICED_NOTE` verbatim — the sentence /reports' own exports already
        carry (src/lib/export/report-rows.ts). Three near-identical sentences
        drift until they claim three different things, and this is the one that
        would have to survive being read beside a PDF of the same range.

        `status` rather than `alert`: nothing has failed and the invoice is
        perfectly raisable, which is exactly why it has to be said out loud.
        Muted rather than Alarm — DESIGN.md reserves Alarm for destructive and
        error, never for a warning.
      */}
      {unratedMs > 0 ? (
        <p role="status" className="max-w-prose text-xs text-muted-foreground">
          {UNPRICED_NOTE} There is{" "}
          <span className="font-mono tabular-nums tracking-[-0.02em]">
            {formatTotal(unratedMs, durationDisplay)}
          </span>{" "}
          of it in this period, and it will not appear on the invoice at all.{" "}
          {/* `SET_A_RATE_NOTE`, shared with the button's own refusal for the
              range where EVERY bucket is unpriced — see
              `invoiceDisabledReason`. One fix, so one sentence naming it. */}
          {SET_A_RATE_NOTE}
        </p>
      ) : null}
    </section>
  )
}
