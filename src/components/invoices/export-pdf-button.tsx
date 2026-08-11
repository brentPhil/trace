import { useState } from "react"
import { Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Toast } from "@/components/ui/toast"
import { downloadBlob, invoiceFilename } from "@/lib/export/download"
import { dayOf } from "@shared/day"
import type { InvoiceDocLine } from "@/lib/export/pdf/invoice-doc"

/**
 * The invoice this control needs, and nothing else.
 *
 * Declared structurally rather than imported from the generated Convex API —
 * the boundary `eslint.config.js` enforces — which also keeps this component
 * renderable in a test from a plain object.
 */
type InvoiceForExport = {
  number: string
  billedTo: string
  payTo: string
  currency: string
  issuedAt: number
  dueAt: number
  purchaseOrder?: string
  paymentTerms?: string
  notes?: string
  taxes: ReadonlyArray<{ label: string; basisPoints: number }>
  lines: ReadonlyArray<InvoiceDocLine>
}

/**
 * `Export PDF` — the whole reason this feature exists.
 *
 * TWO CONVERSIONS HAPPEN HERE, and they are the reason this is a component
 * rather than a line in the route.
 *
 * The dates. The document prints DAYS, and a day only exists once a zone has
 * been chosen — the user's STORED one, never the browser's. Resolving it here,
 * beside the editor that already renders its date fields the same way, is what
 * lets `invoice-doc.ts` stay a pure page builder with no clock and no settings
 * in it. A freelancer exporting from an airport must get the date they raised
 * the invoice on.
 *
 * The import. `pdf-lib` and two embedded TTFs are several hundred kilobytes,
 * and they are pulled in on the click rather than on the page load — the same
 * `await import()` the report's export menu uses, for the same reason.
 */
export function ExportPdfButton({
  invoice,
  timeZone,
}: {
  invoice: InvoiceForExport
  timeZone: string
}) {
  const [busy, setBusy] = useState(false)
  const toasts = Toast.useToastManager()

  async function run() {
    setBusy(true)
    try {
      const issuedOn = dayOf(invoice.issuedAt, timeZone)
      const { invoicePdfBlob } = await import("@/lib/export/to-pdf")
      const blob = await invoicePdfBlob({
        number: invoice.number,
        billedTo: invoice.billedTo,
        payTo: invoice.payTo,
        currency: invoice.currency,
        issuedOn,
        dueOn: dayOf(invoice.dueAt, timeZone),
        purchaseOrder: invoice.purchaseOrder,
        paymentTerms: invoice.paymentTerms,
        notes: invoice.notes,
        taxes: invoice.taxes,
        lines: invoice.lines,
      })
      downloadBlob(blob, invoiceFilename(invoice.number, issuedOn))
    } catch {
      /*
       * Not `errorMessage(thrown)`. A library failure (pdf-lib, a font fetch)
       * throws a string written for a developer, and the user cannot act on it
       * — the same decision, in the same words, as the report's export menu.
       * What is NOT acceptable is silence: before the report menu grew this
       * catch, a failed export was an unhandled rejection and the button simply
       * went back to looking ready.
       */
      toasts.add({ title: "PDF export failed.", priority: "high" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button variant="outline" size="sm" disabled={busy} onClick={() => void run()}>
      <Download className="size-4" />
      {busy ? "Exporting…" : "Export PDF"}
    </Button>
  )
}
