import { useMemo, useRef, useState } from "react"
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router"
import { useQuery, useSuspenseQuery } from "@tanstack/react-query"
import { convexQuery } from "@convex-dev/react-query"
import { BillPreview } from "@/components/invoices/bill-preview"
import { InvoiceForm } from "@/components/invoices/invoice-form"
import { Page, PageBreadcrumb } from "@/components/shell/page"
import { Button } from "@/components/ui/button"
import { useCreateInvoice } from "@/hooks/use-invoice-mutations"
import { errorMessage } from "@/lib/error-message"
import { invoiceDisabledReason } from "@/lib/export/export-disabled-reason"
import { defaultFilters, rangeOf, PRESET_LABELS } from "@/lib/history-filters"
import {
  REFUSAL_FIELD_OF,
  draftArgs,
  newInvoiceDraft,
  refusedField,
  singleClientId,
} from "@/lib/invoice-draft"
import { parseInvoiceSearch } from "@/lib/invoice-search"
import { format } from "@/lib/report-series"
import { pageTitle } from "@shared/brand"
import { dayOf } from "@shared/day"
import { NO_PROJECT_FILTER } from "@shared/entryFilter"
import { NO_PROJECT_LABEL, SUMMARY_LABEL } from "@shared/labels"
import {
  billableBucketsOf,
  invoiceLineDrafts,
  mergeLines as mergeLineDrafts,
} from "@shared/invoiceLines"
import { api } from "../../../convex/_generated/api"
import type { InvoiceDraft, InvoiceFieldErrors } from "@/lib/invoice-draft"
import type { InvoiceSearch } from "@/lib/invoice-search"
import type { Id } from "../../../convex/_generated/dataModel"

/*
 * `invoices_.new`, with the underscore, and the URL is still `/invoices/new`.
 *
 * The same escape the record route beside this one takes, for the same reason:
 * written `invoices.new.tsx` this becomes a CHILD of `/_authed/invoices`, so
 * `/invoices/new` renders the LIST and this page appears only inside an
 * `<Outlet />` a list of invoices has no reason to carry.
 *
 * It does NOT collide with `/invoices/$invoiceId`. TanStack ranks a static
 * segment above a dynamic one, so `new` is matched as itself rather than as an
 * invoice id — which is worth knowing, because the failure would have been this
 * page's URL rendering "there is no invoice at this address".
 *
 * Check `src/routeTree.gen.ts` after touching this: it must parent to
 * `AuthedRoute`, and a route that has quietly become a child of the list
 * renders the wrong component at a URL that still looks right.
 */
export const Route = createFileRoute("/_authed/invoices_/new")({
  head: () => ({ meta: [{ title: pageTitle("New invoice") }] }),
  /*
   * THE FIRST ROUTE IN THIS APP WITH SEARCH PARAMS, so this is the pattern.
   *
   * A plain function, which is the form `router-core`'s `validateSearch` falls
   * through to when the value carries neither a `~standard` nor a `parse` — no
   * schema library, and none is installed. What it returns IS the search state
   * the page reads and every link rebuilds, which is why the parser invents
   * nothing: a default written in here would be written into the URL as though
   * the user had chosen it.
   *
   * It never throws. The router would catch it and render this route's error
   * component instead of the page (see `matchRoutes`), and an error screen is
   * the wrong answer for a truncated paste or a stale bookmark — this page has
   * no state to lose. Unreadable params are dropped; what an absent range then
   * MEANS is decided below, where the user's timezone is known, and said out
   * loud above the figures drawn from it.
   */
  validateSearch: parseInvoiceSearch,
  component: NewInvoiceRoute,
})

function NewInvoiceRoute() {
  const search = Route.useSearch()
  const navigate = useNavigate()
  return (
    <NewInvoicePage
      search={search}
      /* STRAIGHT TO THE DOCUMENT. An invoice raised and left on the page it was
         raised from is a number the user has to go looking for — and there is
         nothing left to do here, because there is nothing left that can be
         done to it. */
      onCreated={(invoiceId) =>
        void navigate({ to: "/invoices/$invoiceId", params: { invoiceId } })
      }
    />
  )
}

/**
 * Compose an invoice from a range, then mint it.
 *
 * THE PAGE THE FEATURE WAS MISSING. `createFromRange` grew every field a
 * document needs — `billedTo`, `payTo`, the terms, the dates — and nothing
 * asked for any of them, so `Create invoice` on /reports minted documents with
 * a blank Billed to and a blank Pay to and no way to fix either, because an
 * invoice is write-once.
 *
 * A ROUTE RATHER THAN A MODAL. DESIGN.md's standing instruction is to exhaust
 * inline and progressive alternatives first, and the thing that settles it here
 * is that this screen is two panels at once: a form of eight fields and a
 * preview of the lines those fields will be attached to. A dialog holding both
 * is a page with a scrollbar in it — and this URL is worth being a URL, because
 * "the invoice I was about to raise" survives a reload, a second tab, and a trip
 * to /projects to set the rate the preview just said was missing.
 *
 * Exported and taking its search as a prop — the same split every route test in
 * this directory relies on, so the page renders against a seeded query client
 * with no router context.
 */
export function NewInvoicePage({
  search,
  onCreated,
}: {
  search: InvoiceSearch
  onCreated: (invoiceId: Id<"invoices">) => void
}) {
  const { data: settings } = useSuspenseQuery(convexQuery(api.settings.get, {}))
  const { data: projects } = useSuspenseQuery(
    convexQuery(api.projects.list, {})
  )
  const { data: clients } = useSuspenseQuery(convexQuery(api.clients.list, {}))
  /*
   * The last invoice's standing fields — pay to, payment terms, notes, and the
   * billed-to block as a fallback. See `newInvoiceDraft` for which of them wins
   * over what, and `invoiceCarryOver` in convex/invoices.ts for why the
   * purchase order is not among them.
   *
   * SUSPENDED like the three above rather than a plain `useQuery`, so the boxes
   * are filled on the FIRST paint. A late-arriving prefill is the one thing this
   * page's draft handling cannot absorb gracefully: `typed` overlays the base,
   * so a value landing after somebody has started typing either loses to them
   * (leaving the carried-over block invisible) or overwrites them. One more
   * bounded read on a page that already blocks on three is the cheaper half of
   * that trade.
   */
  const { data: previousInvoice } = useSuspenseQuery(
    convexQuery(api.invoices.lastDetails, {})
  )
  const { createInvoice } = useCreateInvoice()

  const timeZone = settings.timezone

  /*
   * A LINK WITH NO READABLE PERIOD BILLS THE CURRENT WEEK, and says so.
   *
   * `parseInvoiceSearch` drops a range it cannot read rather than objecting to
   * it, so this is where the absence acquires a meaning — `defaultFilters`'
   * own week.
   *
   * DELIBERATELY NOT /reports' opening range, which is the current QUARTER
   * (see `reportsDefaultFilters`). The two used to be the same call and are
   * not any more, on purpose: a fallback here is a guess about what a mangled
   * link meant, and the smallest sensible guess is the right one when the
   * consequence of guessing wide is a draft invoice covering three months of
   * work nobody asked to bill.
   *
   * The alternative — refusing to draw anything until a period arrives — makes
   * a truncated paste a dead end, and the fallback is not a silent one: the
   * period is stated in the strip below and the notice beside it says the link
   * carried none.
   */
  const rangeGiven = search.from !== undefined && search.to !== undefined
  const range = useMemo(() => {
    if (search.from !== undefined && search.to !== undefined) {
      return { fromMs: search.from, toMs: search.to }
    }
    const today = dayOf(Date.now(), timeZone)
    return rangeOf(defaultFilters(today, settings.weekStartDay), timeZone)
  }, [search.from, search.to, timeZone, settings.weekStartDay])

  /*
   * The SAME scan `createFromRange` prices from, with the SAME filter.
   *
   * `billableOnly: true` is not a copy of a chip's state and must not become
   * one: the mutation hard-codes it, and it is load-bearing here beyond which
   * rows are counted. `rangeBreakdownImpl` sorts its projects by TOTAL time, so
   * a scan that also saw non-billable rows can order the buckets differently —
   * and that order is the `sortKey` the lines are stored under. A preview
   * listing the same three lines in a different order is a preview that is
   * wrong about the document.
   *
   * ONE THING THIS CANNOT MATCH, stated because it is the page's only gap: the
   * mutation reads with `INVOICE_SCAN_LIMIT`, which is smaller than the limit
   * this public query uses (see convex/lib/scan.ts). A range between the two
   * draws here and is refused `RANGE_TOO_LARGE` on the button — surfaced below,
   * in a sentence that explains exactly that.
   */
  const { data: breakdown, isPlaceholderData } = useQuery({
    ...convexQuery(api.entries.rangeBreakdown, {
      fromMs: range.fromMs,
      toMs: range.toMs,
      timeZone,
      weekStartDay: settings.weekStartDay,
      billableOnly: true,
      projectId: search.projectId ?? null,
      text: search.text ?? "",
      presets: [...(search.presets ?? [])],
    }),
    placeholderData: (previous) => previous,
  })

  /*
   * THE LINES, from the shared derivation and nothing else.
   *
   * `billableBucketsOf` then `invoiceLineDrafts` — the exact pair
   * `createFromRangeImpl` calls, over the exact same breakdown answer. There is
   * no rounding, no skipping and no naming decided on this page: a preview that
   * priced its own rows would be a promise the product breaks in a client's
   * inbox, and an invoice is write-once, so there is no correcting it.
   *
   * The account's fallback rate is the same `defaultHourlyRateCents` the server
   * reads through `defaultRateCents`, `?? null` in both places — `??` and not
   * `||`, because a zero rate is pro bono work somebody chose.
   */
  const rawLines = useMemo(
    () =>
      breakdown === undefined
        ? []
        : invoiceLineDrafts(
            billableBucketsOf(breakdown.projects),
            settings.defaultHourlyRateCents ?? null
          ),
    [breakdown, settings.defaultHourlyRateCents]
  )

  /*
   * The range's own client, for the Billed to prefill only.
   *
   * The server would snapshot this block itself if the form sent nothing — but
   * the form sends everything (see `draftArgs`), so putting it in the box is
   * what keeps the two the same document. `partyBlockOf` on both sides means
   * the text is identical to the newline.
   */
  const clientBlock = useMemo(() => {
    const clientIdOf = (projectId: string) =>
      projects.find((project) => project._id === projectId)?.clientId ?? null
    const clientId = singleClientId(breakdown?.projects ?? [], clientIdOf)
    if (clientId === null) return null
    const client = clients.find((row) => row._id === clientId)
    return client === undefined
      ? null
      : { name: client.name, address: client.address }
  }, [breakdown, projects, clients])

  /*
   * TYPED VALUES OVER PREFILLED ONES, recomputed rather than reconciled.
   *
   * The prefill cannot be a `useState` initialiser: the range's client is only
   * known once the breakdown lands, which is after the first paint. Seeding it
   * later would mean an effect that overwrites the box, and an effect that
   * overwrites a box is one race away from deleting what somebody was typing.
   *
   * So the base is derived every render from whatever is currently known, and
   * `typed` overlays it. A field the user has touched holds its own value
   * forever after — INCLUDING an empty one, which is how a client's address
   * gets cleared off a document on purpose and stays cleared.
   */
  const prefill = useMemo(
    () =>
      newInvoiceDraft({
        nowMs: Date.now(),
        timeZone,
        currency: settings.currency,
        client: clientBlock,
        previous: previousInvoice,
        mergeInvoiceLines: settings.mergeInvoiceLines,
      }),
    [
      timeZone,
      settings.currency,
      settings.mergeInvoiceLines,
      clientBlock,
      previousInvoice,
    ]
  )
  const [typed, setTyped] = useState<Partial<InvoiceDraft>>({})
  const draft: InvoiceDraft = { ...prefill, ...typed }

  const lines = useMemo(
    () =>
      draft.mergeLines
        ? mergeLineDrafts(
            rawLines,
            draft.summaryDescription.trim() === ""
              ? SUMMARY_LABEL
              : draft.summaryDescription.trim()
          )
        : rawLines,
    [draft.mergeLines, draft.summaryDescription, rawLines]
  )
  const mergeDeclined =
    draft.mergeLines &&
    rawLines.length > 1 &&
    new Set(rawLines.map((line) => line.unitCents)).size > 1

  const [errors, setErrors] = useState<InvoiceFieldErrors>({})
  /** A refusal that named no field — `MIXED_CLIENTS`, `RANGE_TOO_LARGE`,
   *  `INVOICE_HISTORY_TOO_LARGE`, a network failure. It goes beside the button,
   *  which is the only place a refusal about the whole document can land. */
  const [refusal, setRefusal] = useState<string | null>(null)
  /** The label and the `disabled` attribute — state, because both are rendered
   *  and a ref does not re-render. It is NOT the guard; see `inFlight`. */
  const [busy, setBusy] = useState(false)
  /*
   * THE ACTUAL IN-FLIGHT GUARD, and it has to be a ref.
   *
   * `busy` above cannot do this job. It is read from the render closure — the
   * same value `disabled={… || busy}` renders from — so two clicks landing
   * before React has re-rendered both see `busy === false`, both pass, and the
   * account gets two documents with two numbers. A ref is the only thing whose
   * write is visible to the second handler in that same tick.
   *
   * `clientKey` (see `useCreateInvoice`) makes a RETRIED request safe; this is
   * what makes a second CLICK safe. Neither substitutes for the other: the key
   * is minted per call, so two calls are two keys and the replay branch in
   * `createFromRangeImpl` never sees them as the same request.
   */
  const inFlight = useRef(false)

  /** Editing a field is also the answer to that field's refusal — the same rule
   *  every other editable surface in this product follows, and it stops a
   *  message pointing at text that has since been fixed. */
  const edit = (patch: Partial<InvoiceDraft>) => {
    setTyped((current) => ({ ...current, ...patch }))
    setErrors((current) => {
      const next = { ...current }
      for (const key of Object.keys(patch)) {
        delete next[REFUSAL_FIELD_OF[key as keyof InvoiceDraft]]
      }
      return next
    })
  }

  /*
   * What the range on screen cannot support, said ON the trigger.
   *
   * The SAME `invoiceDisabledReason` /reports' button uses — not a second set
   * of words for the same four states. The button there is a link now, so this
   * is where those sentences are finally acted on: a link cannot be pressed
   * into a refusal, and a hand-typed URL at a truncated range has to meet the
   * same rule the button did.
   *
   * `lines.length` is the fourth of those states and the one this page is best
   * placed to answer, because it has already priced them: a range whose every
   * bucket is unrated draws an empty table above and would mint a permanent,
   * numbered, $0.00 document. `createFromRange` refuses it too — see
   * `NO_PRICED_TIME` — so this is the sentence before the click rather than the
   * only thing standing in the way.
   */
  const disabledReason = invoiceDisabledReason(
    breakdown,
    isPlaceholderData,
    lines.length
  )

  async function create() {
    // Set BEFORE the first `await` — the ref write and this read are in one
    // synchronous block, which is exactly the window `disabled` cannot cover.
    if (inFlight.current || disabledReason !== null) return
    inFlight.current = true
    setBusy(true)
    setErrors({})
    setRefusal(null)
    try {
      const { invoiceId } = await createInvoice({
        fromMs: range.fromMs,
        toMs: range.toMs,
        timeZone,
        weekStartDay: settings.weekStartDay,
        projectId: search.projectId ?? null,
        text: search.text ?? "",
        presets: [...(search.presets ?? [])],
        ...draftArgs(draft, timeZone),
      })
      onCreated(invoiceId)
    } catch (thrown) {
      // A refusal keeps every typed value. Nothing is reverted and nothing is
      // cleared, so the message names the field, the field still holds the text
      // that earned it, and pressing the button again after fixing it sends the
      // whole set exactly as before.
      const field = refusedField(thrown)
      if (field === null) setRefusal(errorMessage(thrown))
      else setErrors({ [field]: errorMessage(thrown) })
    } finally {
      // Both, and in this order: the guard is what makes the control pressable
      // again in fact, `busy` is what makes it look it. Every refusal above has
      // a fix the user can go and apply, so the button must come back.
      inFlight.current = false
      setBusy(false)
    }
  }

  return (
    /*
      NOT PINNED — see `Page`'s rule. The header is a breadcrumb and a title,
      and this page's one action is deliberately at its FOOT, after the form and
      the preview it is a decision about. Pinning the top would keep the way OUT
      on screen and leave the thing you came to press below the fold.

      The heading takes `Page`'s vocabulary rather than restating it. It used to
      carry a comment arguing for `text-sm font-semibold` "the same as
      /invoices, /projects and /settings" — an argument that had to be made in
      four files because the value was written in four files. It is made once
      now, in `Page`, and the rest of it still holds: a bigger heading here
      would make this page look like a different product's, and the hierarchy
      this page needs is between its two panels rather than above them.
    */
    <Page
      title="New invoice"
      above={
        <PageBreadcrumb
          parentTo="/invoices"
          parentLabel="Invoices"
          current="New invoice"
        />
      }
    >
      {/* Full width and `px-4` on the content element itself, like every other
          page — see The One Measure Rule. `pb-6` only: the top padding is the
          title row's. */}
      <div className="flex flex-1 flex-col gap-6 px-4 pb-6">
        <SourceStrip
          range={range}
          rangeGiven={rangeGiven}
          search={search}
          projectName={(id) =>
            projects.find((project) => project._id === id)?.name ?? null
          }
          timeZone={timeZone}
        />

        {/*
          FORM LEFT, PREVIEW RIGHT, and one column until there is room for two.
          They are read together — "who is this for" beside "what is on it" —
          and the DOM order is the order they are read in, so a keyboard reaches
          the boxes before the table it is about to attach them to.
        */}
        <div className="grid gap-8 xl:grid-cols-2 xl:gap-12">
          <div className="flex min-w-0 flex-col gap-7">
            {settings.logoUrl === null ? (
              <Link
                to="/settings"
                className="hover:border-edge-strong flex h-20 items-center justify-center rounded-md border border-dashed border-edge px-4 text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                No logo — add one in Settings
              </Link>
            ) : (
              <div className="flex h-20 items-center justify-end">
                <img
                  src={settings.logoUrl}
                  alt=""
                  className="max-h-16 max-w-full object-contain"
                />
              </div>
            )}
            <InvoiceForm draft={draft} errors={errors} onChange={edit} />
          </div>
          <div className="flex min-w-0 flex-col gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.mergeLines}
                onChange={(event) => edit({ mergeLines: event.target.checked })}
              />
              Merge same-rate projects into one line
            </label>
            <BillPreview
              pending={breakdown === undefined || isPlaceholderData}
              lines={lines}
              currency={draft.currency}
              unratedMs={breakdown?.unratedBillableMs ?? 0}
              durationDisplay={settings.durationDisplay}
              mergeDeclined={mergeDeclined}
            />
          </div>
        </div>

        {/*
          THE ONE BUTTON, on its own rule at the foot of the page.
          Edge Soft above it because it separates the composing from the act —
          the heavier boundary the totals block uses, applied to the same kind
          of transition.
        */}
        <div className="flex flex-col gap-3 border-t border-edge-soft pt-5">
          <div className="flex flex-wrap items-start gap-4">
            <Button
              disabled={disabledReason !== null || busy}
              /* One description, whichever is the live one. Disabled, the only
                 thing worth announcing is why it cannot be pressed; enabled, it
                 is what pressing it does permanently. Both are on screen either
                 way — this chooses which one is read out with the control. */
              aria-describedby={
                disabledReason === null
                  ? "create-invoice-permanence"
                  : "create-invoice-refused"
              }
              onClick={() => void create()}
            >
              {busy ? "Creating…" : "Create invoice"}
            </Button>

            {/*
              SAID BESIDE THE BUTTON, not in a confirmation step. An invoice is
              write-once and the user has to know that BEFORE pressing, not
              after — and a second dialog asking "are you sure" would be the
              ceremony DESIGN.md rejects, on a page whose entire content is
              already the thing being confirmed.
            */}
            <p
              id="create-invoice-permanence"
              className="max-w-prose text-xs text-muted-foreground"
            >
              This mints a numbered document, one past the highest this account
              has used.{" "}
              <span className="text-foreground">
                An invoice cannot be edited afterwards
              </span>{" "}
              — check the blocks and the lines above, because the only thing you
              can do to a finished invoice is export it.
            </p>
          </div>

          {/*
            The trigger's refusal, VISIBLE rather than `sr-only`.
            /reports keeps its copy for screen readers because the control there
            is one of two in a crowded header strip; this is a page whose single
            action is disabled, and a disabled button with no stated reason is a
            dead end for everybody, not only for a screen reader.
          */}
          {disabledReason === null ? null : (
            <p
              id="create-invoice-refused"
              className="max-w-prose text-xs text-muted-foreground"
            >
              {disabledReason}
            </p>
          )}

          {refusal === null ? null : (
            <p role="alert" className="max-w-prose text-xs text-alarm">
              {refusal}
            </p>
          )}
        </div>
      </div>
    </Page>
  )
}

// ---------------------------------------------------------------------------

/**
 * WHAT IS BEING BILLED, before anything about the document itself.
 *
 * There is no filter bar on this page and there must not be — the narrowing was
 * chosen on /reports, and a second set of controls here would let the two
 * disagree about which rows an invoice covers. What replaces it is this: the
 * period and every filter, stated, so a link's contents are checkable by
 * reading rather than by trusting.
 *
 * A `<dl>`, the same name/value treatment the document's own head gets on the
 * record page, so the two pages of this flow share one vocabulary.
 */
function SourceStrip({
  range,
  rangeGiven,
  search,
  projectName,
  timeZone,
}: {
  range: { fromMs: number; toMs: number }
  rangeGiven: boolean
  search: InvoiceSearch
  projectName: (projectId: string) => string | null
  timeZone: string
}) {
  const rows: Array<{ label: string; value: string }> = [
    { label: "Period", value: periodText(range, timeZone) },
  ]
  if (search.projectId !== undefined) {
    rows.push({
      label: "Project",
      value:
        search.projectId === NO_PROJECT_FILTER
          ? // The sentinel, not an id — `""` means "entries with NO project",
            // and it is named with the same label every chart and every invoice
            // line gives that bucket.
            NO_PROJECT_LABEL
          : // A project that no longer exists, or one from another account's
            // link. Stated as unknown rather than printed as an opaque id: the
            // scan will simply match nothing, and the empty preview below is
            // then explained instead of mysterious.
            (projectName(search.projectId) ?? "An unknown project"),
    })
  }
  if (search.text !== undefined)
    rows.push({ label: "Search", value: `“${search.text}”` })
  if (search.presets !== undefined) {
    rows.push({
      label: "Filters",
      value: search.presets.map((preset) => PRESET_LABELS[preset]).join(", "),
    })
  }

  return (
    <div className="flex flex-col gap-2">
      <dl className="flex flex-col gap-1.5">
        {rows.map((row) => (
          <div
            key={row.label}
            className="grid grid-cols-[6rem_1fr] items-baseline gap-3"
          >
            <dt className="text-[0.8125rem] font-medium text-muted-foreground">
              {row.label}
            </dt>
            <dd className="min-w-0 text-sm">{row.value}</dd>
          </div>
        ))}
      </dl>

      {/*
        The fallback, stated. A page that quietly billed a week nobody chose
        would be indistinguishable from one that billed the right one, and the
        difference is a client's invoice.

        `status` rather than `alert`: nothing failed, and the page in front of
        the user is entirely usable — it is simply about a different fortnight
        than they may have meant.
      */}
      {rangeGiven ? null : (
        <p role="status" className="max-w-prose text-xs text-muted-foreground">
          This link carried no period Chroneli could read, so the preview below
          covers the current week. Choose the period on{" "}
          <Link to="/reports" className="underline underline-offset-2">
            Reports
          </Link>{" "}
          and use Create invoice there to bill exactly what you were looking at.
        </p>
      )}
    </div>
  )
}

/**
 * "3 – 9 Aug 2026" — the range as days, in the STORED zone.
 *
 * `toMs` is EXCLUSIVE (every window in this product is half-open), so the last
 * billed day is the one containing the instant before it. Reading `toMs`
 * directly would name the morning after as part of the period on every single
 * invoice, which is the kind of off-by-one a client notices and the freelancer
 * cannot explain.
 *
 * The month and year are stated once where they are the same at both ends —
 * the same shape `weekLabel` gives a week in the exported report.
 */
function periodText(
  range: { fromMs: number; toMs: number },
  timeZone: string
): string {
  const from = dayOf(range.fromMs, timeZone)
  const to = dayOf(range.toMs - 1, timeZone)
  const full: Intl.DateTimeFormatOptions = {
    day: "numeric",
    month: "short",
    year: "numeric",
  }
  if (from === to) return format(from, full)
  const sameMonth = from.slice(0, 7) === to.slice(0, 7)
  const sameYear = from.slice(0, 4) === to.slice(0, 4)
  const start = sameMonth
    ? { day: "numeric" as const }
    : sameYear
      ? { day: "numeric" as const, month: "short" as const }
      : full
  return `${format(from, start)} – ${format(to, full)}`
}
