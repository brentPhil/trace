import { useState } from "react"
import { Link, createFileRoute } from "@tanstack/react-router"
import { useSuspenseQuery } from "@tanstack/react-query"
import { convexQuery } from "@convex-dev/react-query"
import { ExportPdfButton } from "@/components/invoices/export-pdf-button"
import { InvoiceLines } from "@/components/invoices/invoice-lines"
import { InvoiceMeta } from "@/components/invoices/invoice-meta"
import { PartyBlock } from "@/components/invoices/party-block"
import { UnsavedChangesGuard } from "@/components/invoices/unsaved-changes-guard"
import { Button } from "@/components/ui/button"
import { InvoiceUnreachable } from "@/routes/_authed/invoices_.$invoiceId"
import { useInvoiceMutations } from "@/hooks/use-invoice-mutations"
import { errorMessage } from "@/lib/error-message"
import {
  INVOICE_HEAD_FIELDS,
  changedHeadFields,
  commitHeadForm,
  editHeadForm,
  headOf,
  headPatch,
  liveCollisions,
  nameFields,
  reconcileHeadForm,
  refusedHeadField,
  seedHeadForm,
  takeNewerHeadForm,
} from "@/lib/invoice-head"
import { cn } from "@/lib/utils"
import { supportedCurrencies } from "@shared/money"
import { api } from "../../../convex/_generated/api"
import type { InvoiceHead, InvoiceHeadField } from "@/lib/invoice-head"
import type { Id } from "../../../convex/_generated/dataModel"

/*
 * `invoices_.$invoiceId_.edit` — TWO trailing underscores, and the URL is still
 * `/invoices/$invoiceId/edit`.
 *
 * The first escapes `/invoices`, exactly as the record route beside this one
 * does. The second is the same trap one level down: written
 * `invoices_.$invoiceId.edit.tsx`, TanStack's flat routing makes this a CHILD of
 * the record route, so `/invoices/…/edit` would render the READ-ONLY RECORD and
 * this editor would appear only inside an `<Outlet />` the record has no reason
 * to carry — a page of inputs that never draws, at a URL that looks right. The
 * trailing underscore on the parameter segment is the router's own escape hatch
 * for exactly that.
 *
 * Verify in `src/routeTree.gen.ts` after touching either file: both routes must
 * declare `getParentRoute: () => AuthedRoute`.
 */
export const Route = createFileRoute("/_authed/invoices_/$invoiceId_/edit")({
  /* Two tabs, two invoices — and now also one invoice open twice, as its record
   * and as its editor. The tab strip has to separate all three, so this says
   * which one it is as well as which document. */
  head: ({ loaderData }: { loaderData?: { number: string } }) => ({
    meta: [
      {
        title:
          loaderData === undefined
            ? "Edit invoice — Trace"
            : `Edit invoice #${loaderData.number} — Trace`,
      },
    ],
  }),
  component: InvoiceEditRoute,
  errorComponent: InvoiceUnreachable,
  loader: async ({ context, params }): Promise<{ number: string }> => {
    const invoiceId = params.invoiceId as Id<"invoices">
    const [, invoice] = await Promise.all([
      context.queryClient.ensureQueryData(convexQuery(api.settings.get, {})),
      context.queryClient.ensureQueryData(convexQuery(api.invoices.get, { invoiceId })),
    ])
    return { number: invoice.number }
  },
})

function InvoiceEditRoute() {
  const { invoiceId } = Route.useParams()
  /*
   * KEYED, and the buffered draft is why.
   *
   * `InvoiceEditor` seeds its form once, in a `useState` initialiser. A change
   * of `$invoiceId` alone re-renders this route rather than remounting it — no
   * route in this app sets `remountDeps`, and TanStack's default keeps the
   * component across a params-only navigation — so without a key the initialiser
   * never runs again and the draft from the PREVIOUS invoice stays in the boxes.
   * Reconciliation then reads the new document as a server push against that
   * draft, keeps the old text as the user's unsaved edit, and Save writes one
   * invoice's address onto another. The path is ordinary: edit A, Back to a B
   * editor already in history, answer Discard changes.
   *
   * The key says what is actually true — a different invoice is a different
   * form — and it is the only thing that says it, because `useState` has no
   * "these props are for a different subject" of its own.
   */
  return <InvoiceEditor key={invoiceId} invoiceId={invoiceId as Id<"invoices">} />
}

/**
 * The invoice document's head, edited and then SAVED.
 *
 * THIS PAGE IS THE PRODUCT'S ONE EXCEPTION TO SAVE-ON-BLUR, and the exception is
 * deliberate rather than inherited. `InlineEdit` commits on blur on every entry
 * row, /projects and /settings, and it should: those are settings and
 * corrections, the write is invisible, and a save button on each would be
 * ceremony around a two-second fix.
 *
 * An invoice is not one of those. It is a document that gets SENT — the values
 * on it are what a client will be asked to pay, and the user asked to decide
 * when a change to it becomes real. Autosaving eight fields means the document
 * is rewritten while it is being composed, with no moment at which the person
 * writing it said "yes, this one". So the head is buffered here and written on
 * Save.
 *
 * THE TRADE WAS STATED AND ACCEPTED: an edit can now be lost. A closed tab, a
 * crash, a navigation — none of those cost anything under autosave and all of
 * them cost the last few minutes here. What can be done about it is done: the
 * Save button says when there is something to save, and `UnsavedChangesGuard`
 * catches both ways off the page. What cannot be done about it is a browser
 * process ending; that is the price of the control, and it was the price asked
 * for.
 *
 * Exported and taking its id as a prop — the same split every route test in
 * this directory relies on, so the page can be rendered against a seeded query
 * client with no router context.
 *
 * The lines and totals render READ-ONLY, from the same component the record
 * page uses. Editing them — rates, custom charges, taxes — is Task 6.
 */
export function InvoiceEditor({ invoiceId }: { invoiceId: Id<"invoices"> }) {
  const { data: invoice } = useSuspenseQuery(convexQuery(api.invoices.get, { invoiceId }))
  const { data: settings } = useSuspenseQuery(convexQuery(api.settings.get, {}))
  const { updateInvoice } = useInvoiceMutations()

  const server = headOf(invoice)
  const [form, setForm] = useState(() => seedHeadForm(server))
  /** Refusals from the last Save, keyed by the field `invoices.update` named in
   *  `meta.field`. Never a toast: the text that was refused is still in the box,
   *  and the message belongs beside it. */
  const [errors, setErrors] = useState<Partial<Record<InvoiceHeadField, string>>>({})
  /** A refusal that named no field — a network failure, or a code this build
   *  does not know. It goes above the Save button, which is the only place a
   *  save that failed for no stated field can honestly be reported. */
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  /*
   * The live query moved. Reconciled DURING RENDER rather than in an effect,
   * which is React's own answer for state that has to adjust to new props: an
   * effect would paint one frame of the un-reconciled form first, and on this
   * page that frame is somebody's half-typed address flashing back to the
   * server's copy. The call is conditional on a real change, so it cannot loop.
   *
   * What reconciliation actually decides — whose value wins, per field, and why
   * neither "server always" nor "draft always" is acceptable — is argued in
   * `reconcileHeadForm`.
   */
  const reconciled = reconcileHeadForm(form, server)
  if (reconciled !== form) setForm(reconciled)

  const dirty = changedHeadFields(reconciled.draft, reconciled.committed)
  const collisions = liveCollisions(reconciled)

  /** A change to a field is also the answer to that field's refusal — the same
   *  rule `InlineEdit` and `PartyBlock` follow, and it stops a message pointing
   *  at text that has since been fixed. */
  const edit = (patch: Partial<InvoiceHead>) => {
    setForm((current) => editHeadForm(current, patch))
    setErrors((current) => {
      const next = { ...current }
      for (const field of Object.keys(patch)) delete next[field as InvoiceHeadField]
      return next
    })
  }

  /**
   * The one write on this page.
   *
   * Returns whether it left the document saved, because `Export PDF` has to
   * know: a PDF built from a draft the server refused would be a document that
   * disagrees with the record it claims to be.
   *
   * ONLY THE CHANGED FIELDS are sent. An invoice raised before a bound
   * tightened would otherwise have every Save refused over an address nobody
   * was editing.
   *
   * A refusal keeps EVERY typed value. Nothing is reverted, nothing is cleared,
   * and the form stays dirty — so the message names the field, the field still
   * holds the text that earned it, and pressing Save again after fixing it
   * sends the whole set exactly as before.
   */
  const save = async (): Promise<boolean> => {
    const fields = changedHeadFields(form.draft, form.committed)
    // Not an error and not a write: a Save with nothing to save has already
    // succeeded. Reachable through Export PDF, whose button is not the one
    // disabled by a clean form.
    if (fields.length === 0) return true

    setSaving(true)
    try {
      await updateInvoice({ invoiceId, ...headPatch(form.draft, fields) })
      setForm((current) => commitHeadForm(current, fields))
      setErrors({})
      setSaveError(null)
      return true
    } catch (thrown) {
      const field = refusedHeadField(thrown)
      const message = errorMessage(thrown)
      if (field === null) setSaveError(message)
      else {
        setErrors({ [field]: message })
        setSaveError(null)
      }
      return false
    } finally {
      setSaving(false)
    }
  }

  /*
   * The document as it WILL BE, not as it was last fetched.
   *
   * `Export PDF` saves first, and Convex acknowledges a mutation before the
   * subscription redelivers the row — so exporting from `invoice` would print
   * the pre-edit values for a moment after a successful save. Building the
   * export from the draft removes the window entirely: what is printed is
   * exactly the bytes the save just sent, trimmed the same way the server trims
   * them, and the empty strings the optional fields carry here read as absent
   * on the paper exactly as the absent columns do.
   *
   * Every field, not only the dirty ones — the clean ones equal what is stored
   * by definition, so there is nothing to be careful about and a filtered spread
   * would just be a second thing to keep in step.
   */
  const exported = { ...invoice, ...headPatch(reconciled.draft, INVOICE_HEAD_FIELDS) }

  return (
    <div className="flex flex-col">
      {/* Only while dirty. A guard that fires on a clean form teaches people to
          click through it, which is how a guard stops working. */}
      <UnsavedChangesGuard when={dirty.length > 0} what={nameFields(dirty)} />

      {/* Full width and `px-4` on the content element itself, like every other
          page — see The One Measure Rule. */}
      <div className="flex flex-1 flex-col gap-6 px-4 py-6">
        <div className="flex items-start justify-between gap-3">
          <nav aria-label="Breadcrumb">
            <ol className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <li>
                <Link to="/invoices" className="underline-offset-2 hover:underline">
                  Invoices
                </Link>
              </li>
              {/* Decorative: the trail is already ordered, and a screen reader
                  announcing "rsaquo" between the crumbs is noise. */}
              <li aria-hidden="true">›</li>
              <li>
                {/* The number links back to the RECORD, which is the document
                    this page is editing. A breadcrumb that skipped it would
                    make the record unreachable from the one page that most
                    wants to check against it. */}
                <Link
                  to="/invoices/$invoiceId"
                  params={{ invoiceId }}
                  className="tabular underline-offset-2 hover:underline"
                >
                  #{invoice.number}
                </Link>
              </li>
              <li aria-hidden="true">›</li>
              <li aria-current="page" className="text-foreground">
                Edit
              </li>
            </ol>
          </nav>

          <div className="flex items-center gap-2">
            {/*
              DISABLED WHEN CLEAN. A Save that does nothing teaches people to
              press it out of superstition, and a button pressed out of
              superstition is one nobody reads the state of — which is the whole
              signal this page depends on.

              Dirtiness is computed against the STORED values, never a touched
              flag: typing over a value and typing it back has changed nothing,
              and a form that called that dirty would light this button and then
              warn, on the way out, about losing an edit that does not exist.
            */}
            <Button size="sm" disabled={dirty.length === 0 || saving} onClick={() => void save()}>
              {saving ? "Saving…" : "Save"}
            </Button>
            <ExportPdfButton
              invoice={exported}
              timeZone={settings.timezone}
              beforeExport={save}
            />
          </div>
        </div>

        <h1 className="text-sm font-semibold">Invoice</h1>

        {/*
          A save that failed for no named field. Above the document rather than
          beside a control, because there is no control it is about — and
          `role="alert"` so it is announced rather than merely drawn near a
          button the user has already stopped looking at.
        */}
        {saveError === null ? null : (
          <p role="alert" className="max-w-prose text-xs text-alarm">
            {saveError}
          </p>
        )}

        {collisions.length === 0 ? null : (
          /*
            THE DOCUMENT MOVED UNDER AN EDIT — another tab, another device.
            Neither silent answer is acceptable (see `reconcileHeadForm`), so the
            unsaved text is kept and this says so.

            `status`, not `alert`: nothing has failed and nothing is blocked. The
            offer is the honest half — the user can take the newer document and
            lose their own edit, and until they choose, Save will write theirs
            over it, which this sentence states rather than implies.
          */
          <div
            role="status"
            className="flex flex-col gap-2 rounded-md border border-edge-soft bg-surface px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
          >
            <p className="max-w-prose text-xs text-muted-foreground">
              This invoice changed somewhere else while you were editing{" "}
              {nameFields(collisions)}. Your unsaved text is still here — saving
              will replace what arrived.
            </p>
            {/* The transition lives in `invoice-head.ts` with the rest of the
                state machine, not inline here. It reverts only the fields the
                sentence above just named — which is a rule worth a unit test,
                and inline in this JSX it had neither one nor a home. */}
            <Button variant="ghost" size="sm" onClick={() => setForm(takeNewerHeadForm)}>
              Use the newer version
            </Button>
          </div>
        )}

        <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <InvoiceMeta
            number={invoice.number}
            issuedAt={reconciled.draft.issuedAt}
            dueAt={reconciled.draft.dueAt}
            purchaseOrder={reconciled.draft.purchaseOrder}
            paymentTerms={reconciled.draft.paymentTerms}
            timeZone={settings.timezone}
            errors={errors}
            onChange={edit}
          />
          <LogoSlot />
        </div>

        <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
          <PartyBlock
            label="Billed to"
            value={reconciled.draft.billedTo}
            placeholder={"Client name\nStreet\nCity, country"}
            error={errors.billedTo}
            onChange={(billedTo) => edit({ billedTo })}
            onRevert={() => edit({ billedTo: reconciled.committed.billedTo })}
          />
          <PartyBlock
            label="Pay to"
            value={reconciled.draft.payTo}
            placeholder={"Your name\nStreet\nCity, country"}
            error={errors.payTo}
            onChange={(payTo) => edit({ payTo })}
            onRevert={() => edit({ payTo: reconciled.committed.payTo })}
          />
          <CurrencyBlock
            currency={reconciled.draft.currency}
            error={errors.currency}
            onChange={(currency) => edit({ currency })}
          />
        </div>

        <InvoiceLines
          lines={invoice.lines}
          currency={reconciled.draft.currency}
          taxes={invoice.taxes}
        />

        {/*
          THE FOOT OF THE DOCUMENT, and that is why it is here rather than in
          the meta grid at the top. This is a message to the client — where to
          send the money, a thank-you, the terms the one-line `Payment terms`
          field is too short to hold — and it is read after the total, not
          beside the invoice date.

          `PartyBlock` itself rather than a second multiline editor: it already
          keeps its newlines and reverts on Escape, and this is prose printed
          verbatim exactly as an address block is. A user should not have to
          learn two editing behaviours in one product.
        */}
        <div className="max-w-prose">
          <PartyBlock
            label="Notes"
            value={reconciled.draft.notes}
            placeholder={"Bank transfer to …\nAccount 1234-5678\n\nThank you!"}
            error={errors.notes}
            onChange={(notes) => edit({ notes })}
            onRevert={() => edit({ notes: reconciled.committed.notes })}
          />
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

/**
 * The logo, as a reserved space and nothing more.
 *
 * Uploading one needs Convex file storage and is deliberately deferred — the
 * plan names it as the natural first follow-up. It renders as a dashed
 * placeholder rather than a `+ Logo` button because a control that cannot do
 * anything is worse than an obvious gap: the gap is honest, the button is a
 * promise. `aria-hidden` for the same reason — there is nothing here to
 * announce and nothing to do.
 */
function LogoSlot() {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "hidden h-20 w-32 shrink-0 items-center justify-center rounded-md",
        "border border-dashed border-edge-soft text-xs text-muted-foreground sm:flex"
      )}
    >
      Logo
    </div>
  )
}

/**
 * The invoice's own currency, which is a SNAPSHOT rather than the account's.
 *
 * `userSettings.currency` may change; this document may not follow it. The
 * list on /settings is narrowed to currencies whose minor unit really is a
 * hundredth (see `supportedCurrencies`), and `invoices.update` checks the same
 * list server-side, so the picker and the validator cannot disagree.
 *
 * A pick used to write immediately and report its refusal as a toast, which was
 * the one refusal on this page that landed away from the control it was about.
 * Buffering settled that by accident: the pick is now part of the same Save as
 * everything else, and the message lands under the select like every other.
 */
function CurrencyBlock({
  currency,
  error,
  onChange,
}: {
  currency: string
  error?: string
  onChange: (currency: string) => void
}) {
  const supported = supportedCurrencies()
  const codes = supported.length > 0 ? supported : [currency, "USD"]
  // A stored code outside the list is still shown, so a value already saved is
  // never silently swapped for something else under the user — the same
  // fallback /settings' own field makes.
  const options = codes.includes(currency) ? codes : [currency, ...codes]

  return (
    <div className="flex shrink-0 flex-col gap-1.5">
      <span className="text-[0.8125rem] font-medium text-muted-foreground">Currency</span>
      <select
        aria-label="Currency"
        aria-invalid={error !== undefined}
        value={currency}
        onChange={(event) => onChange(event.target.value)}
        className={cn(
          "rounded-md border bg-ground px-2 py-1.5 text-sm",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          error === undefined ? "border-edge" : "border-alarm"
        )}
      >
        {options.map((code) => (
          <option key={code} value={code}>
            {code}
          </option>
        ))}
      </select>
      {error === undefined ? null : (
        <p role="alert" className="text-xs text-alarm">
          {error}
        </p>
      )}
    </div>
  )
}
