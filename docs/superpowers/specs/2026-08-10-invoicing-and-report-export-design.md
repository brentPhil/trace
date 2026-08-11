# Invoicing and report export

*2026-08-10*

## The problem

Reports computes every number an invoice needs — `totalMs`, `billableMs`,
`billableCents`, `unratedBillableMs`, per-day and per-project — and offers no way
to get any of it out of the browser. The product's own stated job is "a
defensible account of the work behind an invoice", and today the last mile of
that job is done by hand.

The two reference documents the user works from make the gap exact.

Toggl's summary report PDF for 07/13/2026–07/25/2026 reports `98:48:00` total,
`100%` billable, `988.00 USD`. The invoice raised three days later carries a
single line: `Brent Philip · 98.8 · 988.00`. `98.8` is `98:48:00` rendered as
decimal hours; `988.00` is `98.8 × $10.00`. The invoice was produced by reading
numbers off one screen and typing them into another.

A screenshot of that invoice mid-edit shows the failure mode plainly: quantity
`80.13`, amount `0`. A transcription step sits between the tracked time and the
money, and it is unverified.

## What this adds

Two controls on `/reports`, in the filter row, right-aligned:

```
[ Create invoice ]   [ Export ▾ ]
                       ├ PDF
                       ├ CSV
                       └ XLSX
```

`Export` produces a document of the filtered range in the shape of the reference
report. `Create invoice` turns the same range into a real invoice document with
its own page, editable and exportable.

They are separate controls because they are separate acts. An export is a
read — it changes nothing and can be repeated. Creating an invoice mints a
numbered document that will be sent to someone. Folding the second into a
dropdown beside three file formats would present them as four flavours of the
same button.

---

## 1. An invoice is a snapshot

The load-bearing decision, and everything below follows from it.

**Once an invoice line exists it holds values, not references.** Fix a typo in a
July entry in September and the July invoice does not move. Rename a client and
last year's invoices still say what they said.

This is not caution, it is the rule the schema already argues for itself.
`schema.ts` refuses to store a `dayKey` because recomputing it "changes an
already-invoiced month with no audit trail". `projects.remove` refuses while
live entries reference a project so that "a July invoice stays reproducible in
September". Both sentences are about a document that does not exist yet. This
spec is that document, and it would be strange to build it as the one thing in
the system that silently rewrites its own history.

An invoice that recomputes itself is not a document. It is a dashboard with a
number at the bottom, and it cannot be defended six months later against a
client's copy.

### Tables

```ts
clients: {
  userId: v.string(),
  name: v.string(),
  /** Free-text block, rendered verbatim, newlines preserved. Addresses are not
   *  a schema — a structured address form is a taxonomy nobody asked for and
   *  gets the international cases wrong. */
  address: v.string(),
  email: v.optional(v.string()),
  /** Archive, never delete — the same rule as projects, and for the same
   *  reason: an invoice raised last year must still render its client. */
  archived: v.boolean(),
  updatedAt: v.number(),
  deletedAt: v.union(v.number(), v.null()),
}.index("by_user_archived_name", ["userId", "archived", "name"])
```

`projects` gains `clientId: v.optional(v.id("clients"))`. Optional, because a
project without a client is normal and must stay startable.

```ts
invoices: {
  userId: v.string(),
  /** UUIDv7 minted client-side before the mutation is sent — the same
   *  idempotency device `timeEntries.clientKey` uses. A retry after a lost
   *  response must not mint a second invoice number. */
  clientKey: v.string(),
  /** "072726-0013" — MMDDYY-NNNN, matching the reference. Auto-generated,
   *  user-editable, unique per user. */
  number: v.string(),
  status: v.union(v.literal("draft"), v.literal("issued"), v.literal("paid")),
  /** Ordered, and applied to the subtotal in order. `basisPoints` rather than a
   *  percentage float: 8.25% is 825, and no tax line is ever the result of
   *  0.1 + 0.2. Kept on the document rather than in a fourth table — there are
   *  at most a handful, they are never queried independently, and a table would
   *  buy an index nothing reads. */
  taxes: v.array(v.object({ label: v.string(), basisPoints: v.number() })),
  clientId: v.union(v.id("clients"), v.null()),
  /** SNAPSHOT of the client's block at creation, not a join. */
  billedTo: v.string(),
  /** Snapshot of the user's own block; defaults from settings. */
  payTo: v.string(),
  /** Snapshot. `userSettings.currency` may change; this invoice may not. */
  currency: v.string(),
  issuedAt: v.number(),
  dueAt: v.number(),
  purchaseOrder: v.optional(v.string()),
  paymentTerms: v.optional(v.string()),
  /** Provenance: which range built this. Never read to recompute anything —
   *  it exists so a human can ask "where did this come from". */
  sourceFromMs: v.union(v.number(), v.null()),
  sourceToMs: v.union(v.number(), v.null()),
  updatedAt: v.number(),
  deletedAt: v.union(v.number(), v.null()),
}
  .index("by_user_number", ["userId", "number"])
  .index("by_user_clientKey", ["userId", "clientKey"])
  .index("by_user_issued", ["userId", "issuedAt"])
```

`billedTo` is snapshotted text while `clientId` is kept beside it. The snapshot
is what makes the document stable; the id is what still answers "show me
everything billed to Vessel Vanguard".

```ts
invoiceLines: {
  userId: v.string(),
  invoiceId: v.id("invoices"),
  kind: v.union(v.literal("time"), v.literal("custom")),
  description: v.string(),
  /** Hundredths of an hour. 98.8 h is 9880. An integer, never a float — the
   *  same reason money is held in cents. */
  quantityCentis: v.number(),
  unitCents: v.number(),
  /** STORED, not derived at render. Deriving it would make the printed
   *  document a function of today's rounding rules rather than of the day it
   *  was raised. */
  amountCents: v.number(),
  /** Provenance only. Never read for money. */
  projectId: v.optional(v.id("projects")),
  sortKey: v.number(),
}.index("by_user_invoice", ["userId", "invoiceId"])
```

### Numbering and dates

`number` defaults to `MMDDYY-NNNN` in the issue date's local zone, matching the
reference's `072726-0013`. `NNNN` is one past the highest sequence this user has
ever used, read from `by_user_number` — **not** a count of invoices, which would
reuse a number after a deletion and produce two documents claiming to be
`#072726-0013`. It is user-editable, and uniqueness per user is enforced on
write rather than assumed from the generator.

`issuedAt` defaults to today. `dueAt` defaults to `issuedAt + 30 days`. The
reference invoice has them equal, which is due-on-receipt; net 30 is the more
common default and either way the field is editable, so this is a starting value
rather than a policy.

### The penny problem

Reports computes `billableCents` by summing every entry's exact fractional-cent
value and rounding **once** at the end. That is the correct way to total a set of
entries, and `entries.rangeSummary` documents it as the rule.

An invoice cannot use it. An invoice line prints `98.80 × $10.00 = $988.00`, and
a client must be able to reproduce that with a calculator from the three numbers
in front of them. So the line's amount is computed from the **displayed,
rounded** quantity:

```
quantityCentis = floor(totalMs / 3_600_000 × 100)
amountCents    = round(quantityCentis × unitCents / 100)
```

The floor to two decimal places is the decimal-hours contract already stated in
`2026-08-08-time-tracking-implementation-plan.md`: "2 dp, floor, applied to
totals and export only".

**These two arithmetics can disagree by a cent or two, and that is accepted.**
What is not accepted is disagreeing silently. The invoice editor shows a quiet
note whenever its total differs from the Reports figure for the same range, and
the `AMOUNT` column's info affordance states the derivation in full. A one-cent
difference the user can see and explain is fine; a one-cent difference they
discover from a client is the bug.

---

## 2. Backend

### One addition to `rangeBreakdown`, not a new query

The reference report's largest block is `MEMBER | DESCRIPTION` — one row per
distinct description. `rangeBreakdown` currently cuts its scan three ways: by
day, by project, by hour of day. It gains a fourth, off the **same scan**:

```ts
titles: v.array(v.object({
  projectId: v.union(v.id("projects"), v.null()),
  title: v.string(),
  totalMs: v.number(),
  billableMs: v.number(),
  billableCents: v.number(),
  count: v.number(),
})),          // descending by totalMs, capped
titlesTruncated: v.boolean(),
```

A separate query would be a second scan of the same rows and a second chance to
disagree with the charts above it — the exact thing that file's own doctrine
("one scan, one ledger type, one rounding rule") exists to prevent.

The cap is 500 distinct titles. Past that the table is not a document anyone
reads, and `titlesTruncated` says so on the page and in the PDF rather than
quietly ending the list.

Since `trace` is single-user, Toggl's "member" axis is meaningless; the block is
retitled **Project and description breakdown** and grouped by project.

### New function files

`convex/clients.ts` — list, create, update, archive. `convex/invoices.ts` —
`createFromRange`, get, list, update, `setStatus`, remove, plus line mutations.
Both follow `owned.ts` and lead every index with `userId`, so ownership stays a
key prefix rather than a filter someone can forget.

### The truncation rule

`scanRange` bounds every figure on Reports at `SUMMARY_SCAN_LIMIT`, and
`truncated` is how the page says the totals are "a floor, not the real total".

**When `truncated` is true, export and invoice creation are both refused.** Not
warned about — refused, with the reason stated and the fix named (narrow the
dates). A floor that becomes a PDF handed to a client, or a line on an invoice,
is a client under-billed by an unknown amount with nothing on the document to
reveal it. This is the single worst thing this feature could do, and it is
cheap to make impossible.

`Create invoice` additionally refuses when the filtered range spans two clients,
naming both. Merging them silently bills one company for another company's work.

---

## 3. Export pipeline

Generated in the browser, using real writer libraries.

```
src/lib/export/
  report-rows.ts   Breakdown → { meta, tiles, dayRows, projectRows, titleRows }
  to-csv.ts        RFC 4180 quoting, hand-rolled
  to-xlsx.ts       SheetJS — real number and date cells
  to-pdf.ts        pdf-lib — A4 portrait, repeating header, "Page N / M"
  download.ts      Blob → anchor
```

`report-rows.ts` takes the **structural** `Breakdown` type from
`src/lib/report-series.ts`, not the generated Convex API. That is the boundary
`report-series.ts` already keeps and `eslint.config.js` already enforces, and it
is what lets all three writers be tested against fixtures with no backend at
all — which is exactly the kind of code worth running under a dozen shapes of
made-up data.

Both libraries load behind `await import()` inside the click handler. Nothing
reaches the main bundle; a user who never exports pays nothing.

### Charts are drawn, not screenshotted

The PDF's bars and donut are drawn as vector primitives in `pdf-lib`, not
rasterized from the Recharts SVG on screen.

Serializing the live SVG would tie export to the Summary tab being mounted, to
the tab having finished animating, and to whatever the browser laid out that
frame. A stacked bar chart and a donut are rectangles and arcs. Drawing them
directly makes the document a pure function of the breakdown: deterministic,
testable, and independent of what is on screen.

### The PDF is paper

The app is a warm graphite room. A `bg-ground` PDF is a document nobody can
print and a recipient reads as broken.

The palette is re-derived at paper luminance through one small mapping table, so
DESIGN.md's rules survive the trip: brass stays the only colour on a currency
amount (the Two Temperatures Rule), empty days keep their hatch rather than
becoming a bar of height zero (the Hatch Rule), and nothing in the document
carries meaning by colour alone — every series is labelled.

---

## 4. Surfaces

| Route | What it is |
|---|---|
| `/reports` | unchanged, plus the two controls above |
| `/invoices` | list — number, client, issued date, total, status |
| `/invoices/$invoiceId` | the editor |
| `/projects` | gains a **Clients** tab |

`NAV_ITEMS` gains a fifth entry, **Invoices** (`FileText`), between Reports and
Projects.

Clients get no nav item. An address book is not a peer of Timer and Reports, and
`/projects` is already the screen where classifiers live; it takes a `Tabs`
strip (Projects · Clients) using the component `/reports` just adopted.
Assigning a client to a project happens in the project row, beside the rate it
already carries.

---

## 5. The invoice editor

```
Invoices › #072726-0013                          [Draft ▾]   [ Export PDF ]
───────────────────────────────────────────────────────────────────────────
Invoice                                                      ┌───────────┐
  Invoice ID:      #072726-0013                              │  + Logo   │
  Invoice Date:    07/27/2026                                └───────────┘
  Due date:        08/26/2026
  Purchase order:  —
  Payment terms:   —

  Billed to:                    Pay to:            SET CURRENCY
  ┌──────────────────┐          ┌────────────────┐  [ USD ▾ ]
  │ Vessel Vanguard  │          │ Brent Philip L.│
  │ Bonita Springs…  │          │ Ortega         │
  └──────────────────┘          └────────────────┘

  DESCRIPTION            QUANTITY      RATE        AMOUNT
  Vessel Vanguard          98.80     10.00 /hr     988.00
  + Add custom charge
  ───────────────────────────────────────────────────────
  SUBTOTAL                                    988.00 USD
  + Add tax
                                   TOTAL      988.00 USD

  [ custom message or payment details… ]
```

Three deliberate divergences from the reference.

**A RATE column.** The reference prints `98.8` and `988.00` with the rate
invisible, which works only because there is exactly one rate. With one line per
project there are several, and a client handed `40.25` and `402.50` with no rate
cannot check the line. Reconcilable by hand is the point of the whole document.

**No Save button; fields autosave on blur.** Every other editable surface in
this app saves on blur, and "Never lose time" does not stop applying because the
noun changed to an invoice. The top-right control is **status** instead:
`Draft → Issued → Paid`. Marking an invoice Issued freezes its lines, and
editing then requires an explicit unlock. That is the act that deserves a
deliberate button — not typing an address.

**The `AMOUNT` info affordance states the derivation.** `98:48:00 → 98.80 h
(2 dp, floor) × $10.00 = $988.00`, and the gap against Reports when there is
one. Money the user cannot reproduce is money they will not trust on the screen
they bill from.

### Lines

One line per project in the filtered range: project name as description,
decimal hours as quantity, the project's `hourlyRateCents` as rate.

Unrated billable time is **excluded from the lines and named above them** —
"3h 12m of billable time on Logbook has no rate and is not on this invoice ·
Set rates on Projects" — reusing the sentence and the link Reports already
carries for exactly this case. Rendering it as a `$0.00` line would state a
confident wrong figure in the one place a wrong figure gets sent to a client.

Custom lines (`kind: "custom"`) are added by hand and have no project.

---

## 6. The documents

**Report PDF** — A4 portrait, paper, mirroring the reference's four blocks:

1. `Summary report from 07/13/2026 to 07/25/2026`
2. Tiles: Total Hours · Billable Hours + % · Amount · Average Daily Hours
3. **Duration by day** — stacked bars (billable / non-billable), weekday and
   date axis, empty days hatched
4. **Project distribution** — donut and ranked list with percentage and duration
5. **Project and description breakdown** — from the `titles` cut;
   `PROJECT | DESCRIPTION · DURATION · DURATION % · AMOUNT`, header repeated on
   every page, `TOTAL` row last
6. Footer on every page: account name and `Page N / M`

**CSV** is the breakdown table only: flat, one row per title, no merged cells. A
CSV exists to be pasted into something else, and a faithful reproduction of a
four-block layout is the least useful thing it could contain.

**XLSX** is three sheets — Summary, By day, Breakdown — with real number and
date cells rather than strings, so the recipient can pivot it without retyping
it.

**Invoice PDF** is the editor's paper area at print fidelity: same layout, same
numbers, no chart.

---

## 7. Tests

`vitest` and `convex-test` are already wired.

- **`report-rows`** against fixtures: sparse days, a day holding a zero-length
  entry, a project with no rate, more than 500 distinct titles
- **`to-csv`**: a title containing a comma, a double quote, and a newline — real
  entry titles contain all three
- **`to-pdf`**: page count, and that the repeated header row and the `TOTAL` row
  land where claimed
- **money**: `quantityCentis` floor and `amountCents` rounding, including a case
  where the invoice total legitimately differs from `billableCents`
- **`invoices.createFromRange`**: refuses a truncated range, refuses a range
  spanning two clients, excludes unrated billable time
- **the snapshot rule**: create an invoice, edit a source entry, assert the
  invoice did not move. This is the test the design exists to make pass.

---

## 8. Risks

**Truncation is the one that matters.** `SUMMARY_SCAN_LIMIT` silently bounds
every figure on Reports today. Turning a bounded figure into a PDF is how a
client gets under-billed by an unknown amount. The refusal in §2 is the
mitigation and it is tested directly.

**Bundle weight.** `pdf-lib` and SheetJS are both substantial. Both stay behind
`await import()`, and the built chunk gets checked rather than assumed.

**`to-pdf` wants to become a large file.** It splits into layout primitives —
text, table, bars, donut — and a document script that composes them, so the
thing that changes when the layout changes is not the thing that knows how to
draw a rectangle.

---

## 9. Build order

1. `clients` table, Clients tab, `projects.clientId`
2. `titles` cut on `rangeBreakdown`
3. `report-rows` + CSV + XLSX + the Export dropdown — **usable on its own**
4. `to-pdf` primitives, then the report PDF
5. `invoices` / `invoiceLines` + `createFromRange`
6. Invoice list and editor
7. Invoice PDF, reusing step 4

Step 3 ships independently and is worth having before anything else lands.
