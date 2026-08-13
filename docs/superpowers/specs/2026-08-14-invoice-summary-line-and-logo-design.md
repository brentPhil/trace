# The merged summary line, and a logo on the document

**Date:** 2026-08-14
**Status:** designed

Two changes to what an invoice looks like, raised together because they touch the
same four surfaces — the shared line derivation, `/invoices/new`, the record
page, and the PDF — and because both are about the document being *the
freelancer's*, not the product's.

1. **The merged summary line.** An invoice currently prints one line per
   project, always. By default it should print **one line** — a description, the
   total hours, the rate, the amount — with the per-project breakdown available
   by choice rather than imposed.
2. **The logo.** There is nowhere to upload one, and no invoice carries one. Add
   the setting, the storage, the snapshot, and all three renderings.

---

## Part 1 — The merged summary line

### What is being changed, and what is not

`convex/lib/invoiceLines.ts` is the single derivation both `/invoices/new`'s
preview and `invoices.createFromRange` call. That module's whole existence is the
rule that *a preview computed a second way is a promise the product breaks in a
client's inbox*, and an invoice is write-once, so nothing here may create a
second place where lines are decided.

So the merge is **a new pure function in that same module**, called by both
sides, immediately after `invoiceLineDrafts`. Nothing about how a bucket is
priced, skipped, rounded or named changes. What changes is only whether the
resulting drafts are collapsed before they are drawn and stored.

### Decisions

| Question | Decision |
| --- | --- |
| Where merging happens | `mergeLines()` in `convex/lib/invoiceLines.ts`, pure, shared |
| Default | **Merged**, account-wide, overridable per invoice |
| Description | Typed on `/invoices/new`, prefilled `Professional services` |
| Rates differ across projects | **Do not merge** — fall back to per-project lines and say so |
| Merged amount | `lineAmountCents(totalQuantity, rate)` — one rounding step |
| Merged `projectId` | Absent; the line spans projects |
| Merged `kind` | `"time"`, unchanged |

### `mergeLines`

```ts
export function mergeLines(
  lines: ReadonlyArray<InvoiceLineDraft>,
  description: string
): Array<InvoiceLineDraft>
```

Given the drafts `invoiceLineDrafts` produced, in the order it produced them:

- **No lines.** Returned unchanged. There is nothing to summarise, and
  `NO_PRICED_TIME` already refuses this document at creation.
- **Every line shares one `unitCents`.** One line comes back:
  `description` as given, `quantityCentis` the sum of the quantities,
  `unitCents` the shared rate, `amountCents` from `lineAmountCents(totalQuantity,
  unitCents)`, and no `projectId`.
- **Rates differ.** The input array is returned **untouched**. One line cannot
  carry two multipliers, and the three alternatives are all worse: a blended rate
  usually fails to reproduce the total by a cent or two once it is rounded to
  print, dropping the rate leaves a client unable to check the arithmetic, and
  dropping the quantity as well hides the hours being billed. Splitting is the
  only option where every printed line still reconciles with a calculator.

A **single** line is still rewritten — its description becomes the summary text
and its `projectId` is dropped — because "one project" is exactly the case a user
turning this on is trying to stop seeing named on the document.

### Why the amount is recomputed rather than summed

`lineAmountCents` computes an amount from the quantity the document **prints**,
so `80.13 × $10.00 = $801.32` can be reproduced by hand. Summing the per-project
amounts instead would give a merged line whose three printed numbers do not
multiply out, because each project's own amount was rounded separately first. One
merge, one rounding, one reconcilable line.

The consequence, stated rather than hidden: **a merged invoice's total can differ
from the same range's split total by a cent or two.** Both are drawn in the
preview before the button is pressed, and flipping the toggle redraws it, so the
figure being minted is always the figure on screen.

### The description

A new **Summary description** field in the `Document` group of `InvoiceForm`,
between `Payment terms` and `Currency`.

- Prefilled `Professional services`, exported as `SUMMARY_LABEL` from
  `convex/lib/labels.ts` — beside `NO_PROJECT_LABEL`, and shared for the same
  reason that one is: the preview, the mutation's fallback and the form's prefill
  must be one string.
- Sent as `summaryDescription` on `createFromRange`, bounded by a new
  `MAX_LINE_DESCRIPTION_LENGTH = 100` in `convex/invoices.ts`, through the same
  `checkText` every other typed field uses, with `meta.field:
  "summaryDescription"` so the refusal lands beside the box.
- **Blank falls back to `SUMMARY_LABEL`.** A blank description cell beside a real
  amount reads as a rendering fault, which is the argument `NO_PROJECT_LABEL`
  already makes one level down.
- Shown on the form **only while merging is on**. A field that cannot affect the
  document must not sit on the form claiming it can.

`MAX_LINE_DESCRIPTION_LENGTH` is not housekeeping. `INVOICE_LIST_LIMIT`'s comment
in `convex/lib/scan.ts` says so explicitly:

> Whichever surface first lets a human type a line DESCRIPTION must do the same,
> and then redo the division below.

This is that surface. 100 characters is the same bound a purchase order and a
client's name get, and it keeps an `invoiceLines` row inside the ~400 B the
division already assumes — so the division holds, and its comment must be updated
to say the bound now exists rather than that it is owed. Merging also *reduces*
`M`, the per-invoice line count that comment identifies as the number actually at
risk.

### The control

**Settings** gains a `Section` titled *Invoice lines*, between *Default hourly
rate* and *Notes in the PDF report*:

- `userSettings.mergeInvoiceLines: v.optional(v.boolean())`, optional and
  additive exactly like `groupEntries` — a row written before this column existed
  has no opinion and falls through to `SETTINGS_DEFAULTS`.
- `SETTINGS_DEFAULTS.mergeInvoiceLines = true`. On by default, which is what the
  user asked for and is also the safer default of the two: a merged line names no
  internal project taxonomy on a document that leaves the building.

**`/invoices/new`** gains a toggle above the preview, seeded from the setting and
held in the same `typed` overlay every other field uses — so flipping it holds
for this invoice and changes nothing about the account.

Both travel to the mutation explicitly:

```
mergeLines: v.optional(v.boolean())
summaryDescription: v.optional(v.string())
```

`mergeLines` absent falls back to the account setting, which is what keeps a
caller with no form (a script, a test) behaving sensibly — the same three-state
shape `billedTo` already uses. It is **not** read from settings when the form
sends it: the preview and the stored document must agree, and a server that
consulted a setting the page had overridden is precisely how they would not.

### What merging costs, stated

- **`invoiceLines.projectId` is absent on a merged line.** It is documented
  "Provenance only. Never read for money", and the invoice's own
  `sourceProjectId`, `sourceText`, `sourcePresets` and the two source instants
  are unaffected — so "which range and which filter built this" is still
  answerable. "Which projects fed this line" is not, on a merged invoice. That is
  the feature, not a regression.
- A merged invoice's per-project totals live only in `/reports` for that same
  range. Acceptable: the invoice is the document sent to a client, not the
  freelancer's own analysis of a fortnight.

### The preview

`BillPreview` already draws the real lines through the same `InvoiceLines`
component the record page and the PDF print from. It gains one sentence, drawn
only when merging is on **and** `mergeLines` declined to merge:

> These projects bill at different rates, so this invoice lists them separately.

`role="status"`, muted — nothing has failed and the invoice is perfectly
raisable, which is exactly why it has to be said out loud before the document is
minted. The same treatment `UNPRICED_NOTE` gets beside it.

---

## Part 2 — The logo

### Storage

First use of Convex file storage in this codebase.

**Settings:**

- `userSettings.logoStorageId: v.optional(v.id("_storage"))` — optional and
  additive like every column added since `currency`.
- `settings.generateLogoUploadUrl` — an authed mutation returning
  `ctx.storage.generateUploadUrl()`.
- `settings.setLogo({ storageId })` — reads
  `ctx.db.system.get("_storage", storageId)` and refuses unless `contentType` is
  `image/png` or `image/jpeg` and `size <= MAX_LOGO_BYTES` (1 MiB), deleting the
  rejected upload so a refused file does not linger. New error code
  `INVALID_LOGO`, its own code rather than `TOO_LONG` for the reason
  `INVALID_RATE` has one: a caller branching on `TOO_LONG` would send someone to
  shorten a text field over an image that is the wrong format.
- `settings.clearLogo()` — clears the pointer only.
- `settings.get` gains `logoUrl: v.union(v.string(), v.null())`, resolved through
  `ctx.storage.getUrl`. `null` when unset **and** when the file has gone missing,
  which the UI treats identically: there is no logo to draw.

`MAX_LOGO_BYTES` and the accepted content types live in a new
`convex/lib/logo.ts` so the Settings UI states the same limits the mutation
enforces, rather than a hand-typed sentence that stops agreeing with them.

### Frozen per invoice

`invoiceFields.logoStorageId: v.optional(v.id("_storage"))`, written by
`createFromRange` from the account's current setting and **never recomputed** —
the same snapshot rule as `billedTo`, `currency` and `unratedMsAtCreation`. It is
deliberately **not** an argument to the mutation: like `clientId` and the source
provenance, it records a fact about the moment the document was raised, and
provenance a caller can assert is not provenance.

`invoices.get` extends its return validator with `logoUrl`, the same
`.extend()` device `invoiceListRow` already uses. `invoices.list` does not — a
list row prints no logo.

**Uploaded logo files are never deleted by this product.** Replacing or clearing
the logo only repoints `userSettings.logoStorageId`; the old file stays, because
invoices reference it and reprinting one must reproduce what the client received.
Proving a file unreferenced would require scanning every invoice in the account,
which is the unbounded read `INVOICE_NUMBER_SCAN_LIMIT` exists to refuse. At
1 MiB a logo and a handful of rebrands a decade, the storage is not worth the
scan.

### The three renderings

**Settings** — a `Section` titled *Invoice logo*, at the end of the page beside
the other document-shaped preferences:

- The current logo drawn at its real aspect ratio in a bounded box, or an empty
  state when unset.
- A file input accepting `image/png,image/jpeg`, and a Remove button when one is
  set.
- The limits stated from the shared constants: PNG or JPEG, up to 1 MB.

**`/invoices/new`** — a logo slot above the form, full width of the left column:

- With a logo: the image, as the document will carry it.
- Without: a dashed placeholder reading *"No logo — add one in Settings"*,
  linking to `/settings`. This is the placeholder the user asked for, and it is
  right **here** specifically: this is a form, and on a form an unset field is an
  invitation. It is where every other "asked once, then frozen" question on this
  page lives.

**The record page and the PDF** — the real logo, top-right of the masthead,
opposite the word `Invoice`; **nothing at all** when the invoice carries none.

The dashed placeholder `InvoiceRecord` used to draw stays deleted, and its
comment's argument is why:

> A dashed `Logo` box on the one screen whose claim is fidelity showed the
> freelancer something the client never receives.

That argument is untouched by this feature. A real logo on that page is what the
client received; a placeholder is not, and an invoice raised before a logo
existed must keep rendering without one forever.

### PDF mechanics

`invoiceDocPages` is pure and synchronous, and must stay so — pagination is the
part that breaks, and it is asserted against plain objects.

- **A new op.**
  `ImageOp = { kind: "image", x, y, width, height, data: Uint8Array, format:
  "png" | "jpeg" }`, where `x`/`y` is the bottom-left of a **box** and
  `width`/`height` is the box, not the image.
- **`render.ts`** — still the only file importing pdf-lib — embeds via
  `embedPng`/`embedJpg`, scales the image to fit inside the box preserving aspect
  ratio, and anchors it **top-right** within it.
- **The box is a constant**: `LOGO_BOX = { width: 160, height: 48 }`, top-right at
  the page's top margin. Because its height never varies, the pure builder
  reserves the same space whatever the image's proportions are, and pagination
  stays deterministic without the builder ever seeing the pixels.
- **The head shifts down** by `LOGO_BAND = 58` when a logo is present — the box
  plus clearance — so the meta grid and the party blocks can never collide with
  it. `headOps` already returns its own `tableTop` and `budgetOf(0)` already
  derives the first page's row budget from it, so the shorter first page needs no
  further arithmetic.
- **`InvoiceDoc` gains** `logo?: { bytes: Uint8Array; format: "png" | "jpeg" }`.
  `ExportPdfButton` fetches `invoice.logoUrl` and decodes the format from the
  response's content type before calling `invoicePdfBlob`, keeping the document
  module free of the network exactly as it is free of the clock.
- **A logo that fails to fetch prints a document without one.** The export must
  not fail over decoration; the amounts are what the document is for.

### The record page's own rendering

An `<img>` with `alt=""` — the logo is decoration beside a masthead that already
says `Invoice` and a `Pay to` block that already names the party. An `alt` of
"Logo" would announce a word the sighted reader does not get.

---

## Files touched

| File | Change |
| --- | --- |
| `convex/lib/invoiceLines.ts` | `mergeLines()` |
| `convex/lib/labels.ts` | `SUMMARY_LABEL` |
| `convex/lib/logo.ts` | new — `MAX_LOGO_BYTES`, accepted content types |
| `convex/lib/codes.ts` | `INVALID_LOGO` |
| `convex/lib/scan.ts` | `INVOICE_LIST_LIMIT` comment — the description bound now exists; `INVOICE_NUMBER_SCAN_LIMIT` comment — `logoStorageId` is a new term |
| `convex/schema.ts` | `userSettings.mergeInvoiceLines`, `userSettings.logoStorageId`, `invoiceFields.logoStorageId` |
| `convex/settings.ts` | the two new fields, `generateLogoUploadUrl`, `setLogo`, `clearLogo`, `logoUrl` on `get` |
| `convex/invoices.ts` | `mergeLines`/`summaryDescription` args, `MAX_LINE_DESCRIPTION_LENGTH`, the merge call, the logo snapshot, `logoUrl` on `get` |
| `src/lib/invoice-draft.ts` | `mergeLines` + `summaryDescription` on the draft, in `draftArgs` and `REFUSAL_FIELD_OF` |
| `src/lib/invoice-document.ts` | nothing — the totals and meta rows are unchanged |
| `src/components/invoices/invoice-form.tsx` | the Summary description field |
| `src/components/invoices/bill-preview.tsx` | the mixed-rate sentence |
| `src/components/invoices/invoice-record.tsx` | the logo in the masthead |
| `src/components/invoices/export-pdf-button.tsx` | fetch the logo bytes |
| `src/routes/_authed/invoices_.new.tsx` | the merge toggle, the logo slot, `mergeLines` through the shared derivation |
| `src/routes/_authed/settings.tsx` | *Invoice lines* and *Invoice logo* sections |
| `src/lib/export/pdf/ops.ts` | `ImageOp` |
| `src/lib/export/pdf/render.ts` | `embedPng`/`embedJpg`, scale-to-fit |
| `src/lib/export/pdf/invoice-doc.ts` | `LOGO_BOX`, `LOGO_BAND`, the shifted head |

## Testing

- **`mergeLines`** — no lines; one line rewritten; several lines at one rate
  merged with the amount reproducing `quantity × rate`; several lines at
  different rates returned untouched and in order; a zero rate (pro bono)
  treated as a rate, never as absence.
- **The preview and the mutation agree** — the existing test that renders
  `/invoices/new` and asserts the drafted lines, extended across both toggle
  states, plus a `createFromRangeAs` test asserting the stored rows match.
- **The bound** — `summaryDescription` past 100 characters refused with
  `TOO_LONG` and `meta.field: "summaryDescription"`; blank stored as
  `SUMMARY_LABEL`.
- **The snapshot** — an invoice raised with a logo keeps its `logoStorageId`
  after the setting is repointed; one raised without stays without.
- **`setLogo`** — a non-image content type and an oversized file both refused
  `INVALID_LOGO`, and the rejected upload deleted.
- **The PDF** — `invoiceDocPages` emits exactly one `image` op when a logo is
  given and none when it is not; the first page's row budget shrinks by
  `LOGO_BAND`; the existing no-overlap geometry assertions still hold with the
  head shifted.
