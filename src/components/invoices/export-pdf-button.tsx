import { useState } from "react"
import { useToastManager } from "@/components/ui/toast"
import { Button } from "@/components/ui/button"
import { Download } from "lucide-react"
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
  logoUrl: string | null
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
  beforeExport,
}: {
  invoice: InvoiceForExport
  timeZone: string
  /**
   * Run first; a `false` cancels the export.
   *
   * The editor passes its Save here, because a buffered editor makes exporting
   * and storing two different acts and lets them disagree — a PDF built from
   * what is on screen while the database still holds what was there this
   * morning. The client would be holding a document the freelancer's own record
   * contradicts, and neither of them would know.
   *
   * A `false` means the save was REFUSED, and then nothing is exported and
   * nothing is said here: the refusal is already on screen beside the field it
   * came from, and a toast on top of it would only take the eye away from the
   * text that needs correcting. A PDF that does not match the record is the one
   * outcome worse than no PDF.
   *
   * The record page passes nothing: there is no pending edit there to commit,
   * because there is nothing to edit.
   *
   * It must REPORT a refusal, not throw one — a rejection here would land in the
   * catch below and be reported as "PDF export failed", which is a sentence
   * about the wrong half of what just happened.
   */
  beforeExport?: () => Promise<boolean>
}) {
  const [busy, setBusy] = useState(false)
  const toasts = useToastManager()

  async function run() {
    setBusy(true)
    try {
      if (beforeExport !== undefined && !(await beforeExport())) return

      const issuedOn = dayOf(invoice.issuedAt, timeZone)
      let logo: { bytes: Uint8Array; format: "png" | "jpeg" } | undefined
      if (invoice.logoUrl !== null) {
        try {
          const response = await fetch(invoice.logoUrl)
          if (response.ok) {
            const contentType = response.headers
              .get("content-type")
              ?.split(";", 1)[0]
              ?.trim()
            const format =
              contentType === "image/png"
                ? "png"
                : contentType === "image/jpeg"
                  ? "jpeg"
                  : undefined
            if (format !== undefined) {
              logo = {
                bytes: new Uint8Array(await response.arrayBuffer()),
                format,
              }
            }
          }
        } catch {
          // Decoration is best-effort. The invoice's money must still export.
        }
      }
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
        logo,
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
    <Button
      variant="outline"
      size="sm"
      disabled={busy}
      onClick={() => void run()}
    >
      <Download className="size-4" />
      {busy ? "Exporting…" : "Export PDF"}
    </Button>
  )
}
