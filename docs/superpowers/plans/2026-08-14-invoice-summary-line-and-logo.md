# Invoice Summary Line and Logo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make invoices merge same-rate project time into one user-described line by default, and snapshot an optional account logo into invoice screen and PDF renderings.

**Architecture:** Keep all monetary line decisions in the existing pure `convex/lib/invoiceLines.ts` pipeline, with the page and mutation applying the same `mergeLines` transform immediately after `invoiceLineDrafts`. Store only Convex `_storage` IDs, resolve URLs at query boundaries, snapshot the current logo ID onto each invoice, and extend the pure PDF op model with an image box whose bytes are fetched only by the export button.

**Tech Stack:** TypeScript 6, React 19, TanStack Router/Query, Convex 1.43, convex-test, Vitest/Testing Library, pdf-lib, Tailwind CSS.

## Global Constraints

- `MAX_LINE_DESCRIPTION_LENGTH = 100`; blank summary descriptions fall back to `SUMMARY_LABEL = "Professional services"`.
- Merge only when every priced line has the same `unitCents`; recompute one amount with `lineAmountCents(totalQuantity, unitCents)` and omit `projectId`.
- `SETTINGS_DEFAULTS.mergeInvoiceLines = true`; an explicit per-invoice toggle overrides the account setting without changing it.
- Accept logo uploads only when metadata says PNG or JPEG and size is at most `MAX_LOGO_BYTES = 1 MiB`; rejected uploads are deleted.
- Replacing or clearing the account logo never deletes a previously accepted file because existing invoices may snapshot it.
- `invoiceFields.logoStorageId` is a creation-time snapshot and is never accepted as a caller argument.
- The record page and PDF render no placeholder for missing invoice logos; `/invoices/new` alone links a dashed empty state to Settings.
- `invoiceDocPages` remains pure and synchronous; network reads stay in `ExportPdfButton`.
- `LOGO_BOX = { width: 160, height: 48 }`; a logo shifts the first-page head down by `LOGO_BAND = 58`.
- Follow `convex/_generated/ai/guidelines.md`: object-form functions, validators on every registered function, indexed reads, no unbounded new scans.

---

### Task 1: Shared merged-line behavior and draft contract

**Files:**
- Modify: `convex/lib/invoiceLines.test.ts`
- Modify: `convex/lib/invoiceLines.ts`
- Modify: `convex/lib/labels.ts`
- Modify: `src/lib/invoice-draft.test.ts`
- Modify: `src/lib/invoice-draft.ts`

**Interfaces:**
- Produces: `SUMMARY_LABEL: string`.
- Produces: `mergeLines(lines: ReadonlyArray<InvoiceLineDraft>, description: string): Array<InvoiceLineDraft>`.
- Produces: `InvoiceDraft.mergeLines: boolean`, `InvoiceDraft.summaryDescription: string`, and matching values from `draftArgs`.

- [ ] **Step 1: Write failing pure-function tests**

  Add literal assertions covering: empty input unchanged; one line rewritten with no project; several same-rate lines merged in input order with summed quantity and one rounding; different rates returned deeply unchanged and ordered; zero-rate lines merge as a real rate.

- [ ] **Step 2: Verify the merge tests fail for the missing export**

  Run: `npm.cmd test -- convex/lib/invoiceLines.test.ts`

  Expected: FAIL because `mergeLines` and/or `SUMMARY_LABEL` do not exist.

- [ ] **Step 3: Implement the minimum pure transform**

  Export `SUMMARY_LABEL = "Professional services"`; in `mergeLines`, return `[]` for no lines, return the original array when any `unitCents` differs, otherwise sum `quantityCentis` and return one `time` draft using the supplied description, shared rate, `lineAmountCents`, and `projectId: null`.

- [ ] **Step 4: Verify pure-function tests pass**

  Run: `npm.cmd test -- convex/lib/invoiceLines.test.ts`

- [ ] **Step 5: Write failing draft tests**

  Assert `newInvoiceDraft` defaults to `mergeLines: true` (or the supplied setting) and `summaryDescription: SUMMARY_LABEL`; assert `draftArgs` sends both values; assert `refusedField` recognizes `summaryDescription`.

- [ ] **Step 6: Verify draft tests fail, then implement the draft fields**

  Run before and after implementation: `npm.cmd test -- src/lib/invoice-draft.test.ts`

  Add `summaryDescription` to `INVOICE_FIELDS` and `REFUSAL_FIELD_OF`; add both fields to `InvoiceDraft`, its constructor options, defaults, and `draftArgs`.

- [ ] **Step 7: Commit the slice**

  Commit: `feat: derive merged invoice lines`

---

### Task 2: Convex settings, logo storage, and invoice snapshots

**Files:**
- Create: `convex/lib/logo.ts`
- Modify: `convex/lib/codes.ts`
- Modify: `convex/schema.ts`
- Modify: `convex/settings.test.ts`
- Modify: `convex/settings.ts`
- Modify: `convex/invoices.test.ts`
- Modify: `convex/invoices.ts`
- Modify: `convex/lib/scan.ts`

**Interfaces:**
- Produces: `MAX_LOGO_BYTES`, `ACCEPTED_LOGO_CONTENT_TYPES`, `LOGO_INPUT_ACCEPT`, and `isAcceptedLogoContentType(value: string | undefined): value is "image/png" | "image/jpeg"` shared by UI and mutation.
- Produces: settings queries with `mergeInvoiceLines: boolean`, `logoStorageId?: Id<"_storage">`, `logoUrl: string | null`.
- Produces: `settings.generateLogoUploadUrl`, `settings.setLogo({ storageId })`, `settings.clearLogo()`.
- Consumes: `mergeLines` and `SUMMARY_LABEL` from Task 1.
- Produces: `invoices.get.logoUrl: string | null`; `createFromRange` accepts `mergeLines?` and `summaryDescription?` and snapshots the account logo ID.

- [ ] **Step 1: Write failing settings default and upload-validation tests**

  Assert pre-column rows read `mergeInvoiceLines === true` and `logoUrl === null`; toggle merge settings through `updateAs`. Store test blobs through Convex storage, assert PNG/JPEG within 1 MiB can be selected, wrong MIME and oversized blobs refuse `INVALID_LOGO`, and rejected IDs no longer exist in `_storage`. Assert clear/repoint only changes the pointer and keeps previously accepted storage objects.

- [ ] **Step 2: Verify settings tests fail**

  Run: `npm.cmd test -- convex/settings.test.ts`

- [ ] **Step 3: Add schema/constants/error code and implement settings functions**

  Add optional settings columns and optional invoice snapshot column. Extend `Settings`, defaults, return validators, `getImpl`, `updateArgs`, and update types. Resolve `logoUrl` with `ctx.storage.getUrl`; require auth on upload URL, set, and clear functions. In `setLogo`, inspect `ctx.db.system.get("_storage", storageId)`, delete and refuse invalid/missing metadata, and patch or insert the settings pointer without deleting the previous pointer.

- [ ] **Step 4: Verify settings tests pass**

  Run: `npm.cmd test -- convex/settings.test.ts`

- [ ] **Step 5: Write failing invoice merge/bound/snapshot tests**

  Add tests proving: absent `mergeLines` follows account default; explicit false keeps project lines; same-rate projects merge with the summary text and one rounding; mixed rates stay split; blank description stores `SUMMARY_LABEL`; 101 characters refuse `TOO_LONG` with `meta.field === "summaryDescription"`; a logo ID is snapshotted and survives settings repoint/clear; an invoice created without a logo remains without one.

- [ ] **Step 6: Verify invoice tests fail**

  Run: `npm.cmd test -- convex/invoices.test.ts`

- [ ] **Step 7: Implement creation-time merge and logo snapshot**

  Add `MAX_LINE_DESCRIPTION_LENGTH = 100` and `summaryDescription` to `InvoiceField`; validate and fallback before scanning. Read the account merge default only when the arg is absent, apply `mergeLines(invoiceLineDrafts(...), summaryDescription)` once, read the settings logo ID during creation, and store it on the invoice. Extend only `get`/`getAs` with `logoUrl`; leave `list` unchanged. Convert merged `projectId: null` to an absent Convex field at insertion.

- [ ] **Step 8: Update scan accounting comments and verify backend tests**

  State that line descriptions are now bounded at 100 and recalculate the `INVOICE_LIST_LIMIT` byte figures (about 100 B less per line than the old 400 B estimate). Mention `logoStorageId` as a bounded ID term in the invoice-number scan accounting without changing its limit.

  Run: `npm.cmd test -- convex/lib/invoiceLines.test.ts convex/settings.test.ts convex/invoices.test.ts`

- [ ] **Step 9: Commit the slice**

  Commit: `feat: store invoice merge and logo settings`

---

### Task 3: Settings and invoice composition UI

**Files:**
- Modify: `src/test-utils/fixtures.ts`
- Modify: `src/routes/_authed/-settings.test.tsx`
- Modify: `src/routes/_authed/settings.tsx`
- Modify: `src/routes/_authed/-invoice-new.test.tsx`
- Modify: `src/routes/_authed/invoices_.new.tsx`
- Modify: `src/components/invoices/invoice-form.tsx`
- Modify: `src/components/invoices/bill-preview.tsx`
- Modify: `src/routes/_authed/-invoice-record.test.tsx`
- Modify: `src/components/invoices/invoice-record.tsx`

**Interfaces:**
- Consumes: settings upload/set/clear mutations and logo constants from Task 2.
- Consumes: `mergeLines`, draft fields, `settings.logoUrl`, and `invoice.logoUrl`.
- Produces: user-controlled per-invoice merge toggle and logo upload/remove UI.

- [ ] **Step 1: Write failing settings UI tests**

  Assert the Invoice lines checkbox reflects/saves the account value. Assert Invoice logo states its shared PNG/JPEG/1 MB limits, accepts only those MIME types, posts the file to the generated upload URL, calls `setLogo`, previews `logoUrl`, offers Remove only when set, calls `clearLogo`, and shows an actionable failure toast.

- [ ] **Step 2: Verify settings UI tests fail, then implement the two Sections**

  Run before and after: `npm.cmd test -- src/routes/_authed/-settings.test.tsx`

  Insert Invoice lines after Default hourly rate. Add Invoice logo at the end with an aspect-preserving bounded preview, file input, disabled/uploading state, and Remove button. Use existing control, focus, error, and toast vocabulary; do not add decorative motion or color.

- [ ] **Step 3: Write failing new-invoice tests**

  Cover default merged preview, explicit split preview, mixed-rate status copy, summary field visibility only while merged, blank description fallback behavior, toggle and summary args sent to mutation, and the logo/Settings placeholder states.

- [ ] **Step 4: Verify new-invoice tests fail, then wire the page**

  Run before and after: `npm.cmd test -- src/routes/_authed/-invoice-new.test.tsx`

  Seed the draft merge value from settings, apply the shared transform in the existing `useMemo`, render a checkbox above the preview, pass the mixed-rate condition to `BillPreview`, render Summary description between Payment terms and Currency only when merging, and add the left-column logo slot above `InvoiceForm`.

- [ ] **Step 5: Write failing record tests and implement masthead logo**

  Assert an invoice `logoUrl` renders one decorative image (`alt=""`) at the masthead right and no image/placeholder renders for `null`.

  Run before and after: `npm.cmd test -- src/routes/_authed/-invoice-record.test.tsx`

- [ ] **Step 6: Run the invoice UI regression set and commit**

  Run: `npm.cmd test -- src/routes/_authed/-settings.test.tsx src/routes/_authed/-invoice-new.test.tsx src/routes/_authed/-invoice-record.test.tsx`

  Commit: `feat: add invoice merge and logo controls`

---

### Task 4: PDF logo operation and resilient export

**Files:**
- Modify: `src/lib/export/pdf/ops.ts`
- Modify: `src/lib/export/pdf/ops.test.ts`
- Modify: `src/lib/export/pdf/render.ts`
- Modify: `src/lib/export/pdf/invoice-doc.ts`
- Modify: `src/lib/export/pdf/invoice-doc.test.ts`
- Modify: `src/components/invoices/export-pdf-button.tsx`
- Modify: `src/routes/_authed/-invoice-record.test.tsx`

**Interfaces:**
- Produces: `ImageOp = { kind: "image"; x; y; width; height; data; format }` in `PdfOp`.
- Produces: `InvoiceDoc.logo?: { bytes: Uint8Array; format: "png" | "jpeg" }`.
- Consumes: `invoice.logoUrl` from Task 2.

- [ ] **Step 1: Write failing pure PDF op/pagination tests**

  Assert no logo emits no image op; a logo emits exactly one image op with `LOGO_BOX`, data, and format; the title remains top-left; the table head and first-page row budget move down by `LOGO_BAND`; continuation pages do not repeat the logo; all existing bottom-margin/no-overlap invariants hold.

- [ ] **Step 2: Verify PDF builder tests fail**

  Run: `npm.cmd test -- src/lib/export/pdf/ops.test.ts src/lib/export/pdf/invoice-doc.test.ts`

- [ ] **Step 3: Implement the pure image op and head geometry**

  Add the discriminated union member. Export `LOGO_BOX` and `LOGO_BAND`; when `invoice.logo` exists, append one top-right image box and start meta rows `LOGO_BAND` lower. Let existing `head.tableTop` and `budgetOf(0)` propagate the shorter first page.

- [ ] **Step 4: Implement renderer scale-to-fit**

  In the only `pdf-lib` module, embed PNG/JPEG based on `format`, compute `scale = min(boxWidth/imageWidth, boxHeight/imageHeight)`, and draw at the box’s top-right while preserving aspect ratio.

- [ ] **Step 5: Write failing export-button tests**

  Assert successful image fetch sends bytes and detected `image/png` or `image/jpeg` format to `invoicePdfBlob`; failed fetch or unsupported response content type still exports the same invoice with no `logo`; the monetary export failure behavior is unchanged.

- [ ] **Step 6: Verify failure, implement resilient fetching, and rerun**

  Fetch `invoice.logoUrl` before the lazy PDF call. Decode `response.arrayBuffer()` only for accepted response MIME types. Catch logo fetch/decoding failure locally and omit `logo`; reserve the outer catch for PDF generation/download failures.

  Run: `npm.cmd test -- src/lib/export/pdf/ops.test.ts src/lib/export/pdf/invoice-doc.test.ts src/routes/_authed/-invoice-record.test.tsx`

- [ ] **Step 7: Commit the slice**

  Commit: `feat: render invoice logos in PDFs`

---

### Task 5: Generated types and complete verification

**Files:**
- Regenerate: `convex/_generated/api.d.ts` if Convex codegen changes it
- Review: every file listed above

- [ ] **Step 1: Regenerate Convex API types**

  Run: `npm.cmd run codegen`

- [ ] **Step 2: Format and check formatting**

  Run: `npm.cmd run format`

  Run: `npm.cmd run check`

- [ ] **Step 3: Run static verification**

  Run: `npm.cmd run typecheck`

  Run: `npm.cmd run lint`

- [ ] **Step 4: Run the full suite and production build**

  Run: `npm.cmd test`

  Run: `npm.cmd run build`

- [ ] **Step 5: Run Convex deployment validation when the configured dev deployment is available**

  Run: `npx.cmd convex dev --once`

  If deployment credentials/network are unavailable, report that separately; do not weaken local type/test/build evidence.

- [ ] **Step 6: Self-review against the spec and inspect the diff**

  Confirm every spec decision has a matching test or observable UI result, no logo deletion path was introduced for accepted files, no invoice list payload gained a logo URL, and no new unbounded read exists.

  Run: `git status --short` and `git diff --check`

- [ ] **Step 7: Commit final generated/formatting changes**

  Commit: `chore: verify invoice summary and logo feature`
