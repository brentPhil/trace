import { InvoiceLines } from "@/components/invoices/invoice-lines"
import { cn } from "@/lib/utils"
import { INVOICE } from "../sample-data"
import { useReveal } from "../use-reveal"

/**
 * The REAL `InvoiceLines`, not a copy. This is the fragment whose arithmetic
 * the page makes a promise about ("every line prints hours × rate"), so it
 * draws through the same table the record, the preview and the PDF use.
 *
 * Hidden below `sm`: `InvoiceLines` is a `min-w-[34rem]` table in an
 * overflow-x-auto box, which does not fit a phone's width, and because the
 * fragment root is `inert` that box cannot be scrolled to reach the rest of
 * it — so below `sm` the section's prose carries the claim instead.
 *
 * ON REVEAL THE LINES ARRIVE IN PRINT ORDER, then the subtotal, then the
 * total — the order a reader checks an invoice in. `InvoiceLines` is not
 * touched: the stagger reaches its rows from here with descendant variants.
 */
const LINES_PENDING = "[&_tbody_tr]:opacity-0 [&_tfoot_tr]:opacity-0"
const LINES_IN = [
  "[&_tbody_tr]:animate-landing-rise [&_tfoot_tr]:animate-landing-rise",
  "[&_tbody_tr:nth-child(2)]:[animation-delay:120ms]",
  "[&_tbody_tr:nth-child(3)]:[animation-delay:240ms]",
  "[&_tfoot_tr]:[animation-delay:520ms]",
  "[&_tfoot_tr:last-child]:[animation-delay:700ms]",
  "motion-reduce:[&_tr]:animate-none",
].join(" ")

export function InvoiceFragment({ className }: { className?: string }) {
  const [ref, reveal] = useReveal<HTMLDivElement>()

  return (
    <div
      ref={ref}
      data-landing-fragment="invoice"
      inert
      className={cn(
        "hidden flex-col gap-3 rounded-lg border border-border bg-background p-4 sm:flex",
        reveal === "pending" && LINES_PENDING,
        reveal === "in" && LINES_IN,
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
