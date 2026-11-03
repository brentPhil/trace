import { useState } from "react"
import { useToastManager } from "@/components/ui/toast"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { ChevronDown } from "lucide-react"
import { downloadBlob, exportFilename } from "@/lib/export/download"
import { exportDisabledReason } from "@/lib/export/export-disabled-reason"
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
  load,
  from,
  to,
  currency,
  timeZone,
  use12Hour,
  disabledReason,
}: {
  /**
   * The breakdown to export, fetched when a format is picked — WITH each row's
   * entries, which the breakdown the page draws its charts from does not carry
   * (see `withEntries` in convex/entries.ts). A function rather than the data
   * so the entries are only ever read by somebody who asked for a document.
   */
  load: () => Promise<Breakdown>
  from: DayString
  to: DayString
  currency: string
  timeZone: string
  use12Hour: boolean
  /** Non-null disables the control and is announced as its description. */
  disabledReason: string | null
}) {
  const [busy, setBusy] = useState(false)
  const toasts = useToastManager()

  async function run(format: "pdf" | "csv" | "xlsx") {
    setBusy(true)
    try {
      const breakdown = await load()
      /*
       * THE RULE ABOVE, ASKED AGAIN OF WHAT WAS ACTUALLY FETCHED. The trigger
       * was enabled on the page's own breakdown; this one is a second read,
       * and a range that grew past the scan limit in between would otherwise
       * become exactly the floor-as-a-document this control exists to refuse.
       */
      const refusal = exportDisabledReason(breakdown, false)
      if (refusal !== null) {
        toasts.add({ title: refusal, priority: "high" })
        return
      }
      const rows = reportRows(breakdown, { from, to, currency, timeZone, use12Hour })
      const blob =
        format === "csv"
          ? csvBlob(rows)
          : format === "xlsx"
            ? await xlsxBlob(rows)
            : await (await import("@/lib/export/to-pdf")).pdfBlob(rows)
      downloadBlob(blob, exportFilename(from, to, format))
    } catch {
      // Not `errorMessage(thrown)`: that surfaces a caught error's own
      // message when it has one, and a library failure (pdf-lib, write-excel-file)
      // throws a string written for a developer, not a client checking a
      // total. Naming the FORMAT is what the user can act on here; the
      // failure itself was silent before this, an unhandled rejection with a
      // button that looked like it had done nothing.
      toasts.add({ title: `${FORMAT_LABEL[format]} export failed.`, priority: "high" })
    } finally {
      setBusy(false)
    }
  }

  const describedBy = disabledReason === null ? undefined : "export-disabled-reason"

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
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
        <DropdownMenuContent>
          <DropdownMenuItem onClick={() => void run("pdf")}>PDF</DropdownMenuItem>
          <DropdownMenuItem onClick={() => void run("csv")}>CSV</DropdownMenuItem>
          <DropdownMenuItem onClick={() => void run("xlsx")}>XLSX</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
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
