import { Link } from "@tanstack/react-router"
import { Button, buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { InvoiceSearch } from "@/lib/invoice-search"

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
 * IT IS A LINK NOW, AND THAT IS THE WHOLE CHANGE. It used to mint on click,
 * from this page, with none of the document's own fields — no Billed to, no Pay
 * to, no terms — because there was nowhere to ask for them and, an invoice being
 * write-once, nowhere to add them afterwards either. It now carries the range
 * and the filter into `/invoices/new`, where they are asked for beside a preview
 * of the lines they will be attached to.
 *
 * THE REFUSALS DID NOT MOVE WITH IT, and that is deliberate. What is knowable
 * from the range on screen — still totalling, truncated, nothing in it — keeps
 * disabling the control HERE and stating the reason ON it, because a link that
 * leads to a page which must then refuse is worse than a disabled control: the
 * user has spent a navigation, and possibly a filled-in form, to be told
 * something this page already knew. `/invoices/new` checks the same three
 * states with the same `invoiceDisabledReason`, for the URL that was typed
 * rather than clicked.
 *
 * What only the server can decide — a range covering two clients
 * (`MIXED_CLIENTS`), a history too large to number safely, a scan that ran out
 * — is raised where the attempt is made, which is now the create page. Nothing
 * on this page mints anything, so nothing on this page has a refusal to print.
 */
export function CreateInvoiceLink({
  disabledReason,
  search,
}: {
  /** Non-null renders a disabled control and is announced as its description. */
  disabledReason: string | null
  /** The range and the filter, as `/invoices/new`'s own search params. Built by
   *  `invoiceSearchOf` so the link and the page's parser are two halves of one
   *  contract — see src/lib/invoice-search.ts. */
  search: InvoiceSearch
}) {
  if (disabledReason !== null) {
    return (
      <div className="flex flex-col items-end gap-1.5">
        {/*
          A real disabled `<button>`, not a Link with `aria-disabled`. A link
          the browser will still follow — or restore from a middle-click, or
          preload on hover — is not disabled, it is only dressed as it, and this
          control's whole job in that state is to not be reachable.
        */}
        <Button size="sm" disabled aria-describedby="create-invoice-disabled-reason">
          Create invoice
        </Button>
        {/*
          Rendered rather than put in `title`, for the reason `ExportMenu` gives:
          a tooltip on a DISABLED control is unreachable by keyboard and
          invisible to a screen reader, which is exactly the user who most needs
          to know why the button will not work.
        */}
        <span id="create-invoice-disabled-reason" className="sr-only">
          {disabledReason}
        </span>
      </div>
    )
  }

  return (
    // `buttonVariants` rather than a second affirmative style: this is the
    // page's primary action and has to weigh the same as the Export trigger
    // beside it, and an anchor that reads as a button must BE the button's own
    // declaration or the two drift a border-radius apart.
    <Link
      to="/invoices/new"
      search={search}
      className={cn(buttonVariants({ size: "sm" }))}
    >
      Create invoice
    </Link>
  )
}
