import { InvoiceLines } from "@/components/invoices/invoice-lines"
import { cn } from "@/lib/utils"
import { INVOICE } from "../sample-data"

/**
 * The REAL `InvoiceLines`, not a copy. This is the fragment whose arithmetic
 * the page makes a promise about ("every line prints hours × rate"), so it
 * draws through the same table the record, the preview and the PDF use.
 *
 * Hidden below `sm`: `InvoiceLines` is a `min-w-[34rem]` table in an
 * overflow-x-auto box, which does not fit a phone's width, and because the
 * fragment root is `inert` that box cannot be scrolled to reach the rest of
 * it — so below `sm` the section's prose carries the claim instead.
 */
export function InvoiceFragment({ className }: { className?: string }) {
  return (
    <div
      data-landing-fragment="invoice"
      inert
      className={cn(
        "hidden flex-col gap-3 rounded-lg border border-border bg-background p-4 sm:flex",
        className
      )}
    >
      <div className="flex items-baseline justify-between gap-4 text-sm">
        <span className="font-medium">{INVOICE.client}</span>
        <span className="font-mono tracking-[-0.02em] text-muted-foreground tabular-nums">
          {INVOICE.number}
        </span>
      </div>
      <InvoiceLines
        lines={INVOICE.lines}
        currency={INVOICE.currency}
        taxes={[]}
      />
    </div>
  )
}
