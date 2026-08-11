import { invoiceDocPages } from "./pdf/invoice-doc"
import { reportPages } from "./pdf/report-doc"
import { renderPages } from "./pdf/render"
import type { InvoiceDoc } from "./pdf/invoice-doc"
import type { ReportRows } from "./report-rows"

export async function pdfBlob(rows: ReportRows): Promise<Blob> {
  return await renderPages(reportPages(rows))
}

/**
 * The invoice, as a PDF.
 *
 * Beside `pdfBlob` rather than in a module of its own, because the thing worth
 * saying about both is the same one: the page builder is pure and testable, and
 * `renderPages` — the only file that touches pdf-lib and the only one that
 * fetches font bytes — is shared. Both are reached through `await import()`, so
 * pdf-lib and the two embedded TTFs stay out of the app's main bundle.
 */
export async function invoicePdfBlob(invoice: InvoiceDoc): Promise<Blob> {
  return await renderPages(invoiceDocPages(invoice))
}
