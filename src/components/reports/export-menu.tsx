import { useState } from "react"
import { ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu"
import { Toast } from "@/components/ui/toast"
import { downloadBlob, exportFilename } from "@/lib/export/download"
import { csvBlob } from "@/lib/export/to-csv"
import { reportRows } from "@/lib/export/report-rows"
import { xlsxBlob } from "@/lib/export/to-xlsx"
import type { Breakdown } from "@/lib/report-series"
import type { DayString } from "@shared/day"

/** What each format is called in a sentence a user reads. */
const FORMAT_LABEL: Record<"pdf" | "csv" | "xlsx", string> = {
  pdf: "PDF",
  csv: "CSV",
  xlsx: "XLSX",
}

/**
 * The three formats, and the one rule above them.
 *
 * Disabled with the reason ON the trigger rather than enabled-then-failing.
 * `truncated` means every figure on this page is a floor; a floor that becomes
 * a PDF in a client's inbox is the single worst thing this feature can do, and
 * a toast after a click that appeared to work is not a refusal.
 */
export function ExportMenu({
  breakdown,
  from,
  to,
  currency,
  disabledReason,
}: {
  breakdown: Breakdown
  from: DayString
  to: DayString
  currency: string
  /** Non-null disables the control and is announced as its description. */
  disabledReason: string | null
}) {
  const [busy, setBusy] = useState(false)
  const toasts = Toast.useToastManager()

  async function run(format: "pdf" | "csv" | "xlsx") {
    setBusy(true)
    try {
      const rows = reportRows(breakdown, { from, to, currency })
      const blob =
        format === "csv"
          ? csvBlob(rows)
          : format === "xlsx"
            ? await xlsxBlob(rows)
            : await (await import("@/lib/export/to-pdf")).pdfBlob(rows)
      downloadBlob(blob, exportFilename(from, to, format))
    } catch {
      // Not `errorMessage(thrown)`: that surfaces a caught error's own
      // message when it has one, and `to-pdf.ts`'s stub — like a future
      // library failure — throws a string written for a developer, not a
      // client checking a total. Naming the FORMAT is what the user can act
      // on here; the failure itself was silent before this, an unhandled
      // rejection with a button that looked like it had done nothing.
      toasts.add({ title: `${FORMAT_LABEL[format]} export failed.`, priority: "high" })
    } finally {
      setBusy(false)
    }
  }

  const describedBy = disabledReason === null ? undefined : "export-disabled-reason"

  return (
    <>
      <Menu>
        <MenuTrigger
          render={
            <Button
              variant="outline"
              size="sm"
              disabled={disabledReason !== null || busy}
              aria-describedby={describedBy}
            >
              {busy ? "Exporting…" : "Export"}
              <ChevronDown className="size-4" />
            </Button>
          }
        />
        <MenuContent>
          <MenuItem onClick={() => void run("pdf")}>PDF</MenuItem>
          <MenuItem onClick={() => void run("csv")}>CSV</MenuItem>
          <MenuItem onClick={() => void run("xlsx")}>XLSX</MenuItem>
        </MenuContent>
      </Menu>
      {/*
        Rendered rather than put in `title`: a tooltip on a DISABLED control is
        unreachable by keyboard and invisible to a screen reader, which is
        exactly the user who most needs to know why the button will not work.
      */}
      {disabledReason === null ? null : (
        <span id="export-disabled-reason" className="sr-only">
          {disabledReason}
        </span>
      )}
    </>
  )
}
