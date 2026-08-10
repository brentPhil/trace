import type { ReportRows } from "./report-rows"

/** Replaced in Task 8. Present so `ExportMenu`'s dynamic import type-checks. */
export async function pdfBlob(_rows: ReportRows): Promise<Blob> {
  throw new Error("PDF export is not implemented yet")
}
