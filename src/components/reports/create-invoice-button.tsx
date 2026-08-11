import { useState } from "react"
import { Button } from "@/components/ui/button"
import { errorMessage } from "@/lib/error-message"

/**
 * The other half of the pair on /reports, and deliberately not an item in the
 * `Export` menu beside PDF/CSV/XLSX.
 *
 * They are separate controls because they are separate acts. An export is a
 * read: it changes nothing and can be repeated until the file is right.
 * Creating an invoice mints a NUMBERED document that will be sent to someone,
 * one past the highest sequence this account has ever used, and there is no
 * repeating that. Folding it into the dropdown would present the two as four
 * flavours of one button.
 *
 * TWO KINDS OF REFUSAL, and they are shaped differently on purpose:
 *
 *   - What is knowable from the range on screen — it is still totalling, it is
 *     truncated, the filters narrow it, there is nothing in it — disables the
 *     trigger and states the reason ON it (`disabledReason`), the same
 *     discipline `ExportMenu` follows. A control that looks live and then
 *     fails has already let the user believe the act happened.
 *   - What only the server can decide, because only it sees the rows the
 *     invoice will actually be built from: a range covering two clients
 *     (`MIXED_CLIENTS`), a history too large to prove the next number unique
 *     (`INVOICE_HISTORY_TOO_LARGE`), a scan that ran out (`RANGE_TOO_LARGE`).
 *     Those arrive after the click and are printed beside the button, not in a
 *     toast: each one names two clients, or a range, or a fix, and a sentence
 *     that has to be read and acted on should not be on a timer.
 */
export function CreateInvoiceButton({
  disabledReason,
  onCreate,
}: {
  /** Non-null disables the control and is announced as its description. */
  disabledReason: string | null
  /** Mints the invoice and goes to it. Rejects with the server's refusal,
   *  which is printed here — passed in, never reached for, so this component
   *  never learns the Convex function surface (eslint.config.js). */
  onCreate: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)

  async function run() {
    // The in-flight guard, and the reason it is not merely `disabled={busy}`:
    // a double click can land two events before React has painted the disabled
    // state, and the second one would be a second invoice with a second number.
    // `clientKey` (see `useCreateInvoice`) makes a RETRIED request safe; this
    // is what makes a second CLICK safe.
    if (busy) return
    setBusy(true)
    setRefusal(null)
    try {
      await onCreate()
    } catch (thrown) {
      setRefusal(errorMessage(thrown))
    } finally {
      setBusy(false)
    }
  }

  const describedBy = disabledReason === null ? undefined : "create-invoice-disabled-reason"

  return (
    <div className="flex flex-col items-end gap-1.5">
      <Button
        size="sm"
        disabled={disabledReason !== null || busy}
        aria-describedby={describedBy}
        onClick={() => void run()}
      >
        {busy ? "Creating…" : "Create invoice"}
      </Button>
      {/*
        Rendered rather than put in `title`, for the reason `ExportMenu` gives:
        a tooltip on a DISABLED control is unreachable by keyboard and invisible
        to a screen reader, which is exactly the user who most needs to know why
        the button will not work.
      */}
      {disabledReason === null ? null : (
        <span id="create-invoice-disabled-reason" className="sr-only">
          {disabledReason}
        </span>
      )}
      {refusal === null ? null : (
        // Left-aligned inside a right-aligned column: the block sits under the
        // button, the sentence reads normally.
        <p role="alert" className="max-w-80 text-left text-xs text-alarm">
          {refusal}
        </p>
      )}
    </div>
  )
}
