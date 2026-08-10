import { reportPages } from "./pdf/report-doc"
import { renderPages } from "./pdf/render"
import type { ReportRows } from "./report-rows"

export async function pdfBlob(rows: ReportRows): Promise<Blob> {
  return await renderPages(reportPages(rows))
}
