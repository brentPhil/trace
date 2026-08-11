# Invoicing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a filtered range on `/reports` into a real, numbered invoice document with its own editable page and PDF, so a freelancer stops retyping totals from one screen into another.

**Architecture:** Three new owned tables (`clients`, `invoices`, `invoiceLines`). An invoice holds **values, not references** — once a line exists it never recomputes. `createFromRange` is the one place time becomes money, and it reuses `rangeBreakdownImpl`'s per-project cut so the invoice and `/reports` are the same arithmetic over the same scan. The invoice PDF reuses the `pdf/ops` + `pdf/render` primitives the report export already built.

**Tech Stack:** TypeScript, Convex, TanStack Start/Router, React 19, Base UI, Tailwind v4, Vitest (`unit` / `dom` / `convex` projects), `pdf-lib` + `@pdf-lib/fontkit` with embedded DM Sans.

This implements **steps 1 and 5–7** of §9 in
`docs/superpowers/specs/2026-08-10-invoicing-and-report-export-design.md`.
Steps 2–4 (the export pipeline) shipped as
`docs/superpowers/plans/2026-08-10-report-export.md`; 818 tests across 54 files
are green on `master` at `1b8458b`.

## Global Constraints

- **Money is integer cents.** Never a float. `convex/lib/money.ts` is the only parser and formatter; `MAX_RATE_CENTS` in `convex/projects.ts` is the existing ceiling.
- **Decimal hours are 2 dp, floored, integer arithmetic** — `centiHours(ms)` from `@shared/duration`. An invoice quantity IS a centiHours value.
- **An invoice line's amount is stored, never derived at render.**
- **`userId` leads every Convex index.** Ownership is a key prefix, not a filter.
- **Every client-supplied id goes through `getOwned`** (`convex/owned.ts`). Fetch and ownership-check cannot be separated.
- **Pure shared code lives in `convex/lib` (aliased `@shared`)** and imports neither Convex nor the DOM.
- **`src/` must not import from `convex/`** except via `@shared`.
- **Components must not import the generated Convex API for types** — `eslint.config.js` enforces this.
- **Brass is currency amounts only** (DESIGN.md). A duration is not money.
- **Errors are raised with `traceError(CODE, message)`** — existing codes include `NOT_FOUND`, `TOO_LONG`, `IN_USE`, `INVALID_RATE`.
- Run `pnpm test`, `pnpm typecheck`, `pnpm lint` before every commit. Expect exactly 2 pre-existing `no-shadow` warnings in `src/components/ui/sidebar.tsx` and 0 errors.
- Commit messages end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## File Structure

| File | Responsibility |
|---|---|
| `convex/schema.ts` | +3 tables, +`projects.clientId` |
| `convex/owned.ts` | `OWNED_TABLES` gains the three |
| `convex/clients.ts` | client CRUD |
| `convex/lib/invoiceNumber.ts` | pure numbering (`@shared`) |
| `convex/lib/invoiceMath.ts` | pure line/tax/total arithmetic (`@shared`) |
| `convex/invoices.ts` | invoice + line mutations, `createFromRange` |
| `src/routes/_authed/invoices.tsx` | list |
| `src/routes/_authed/invoices.$invoiceId.tsx` | editor |
| `src/components/invoices/*` | editor pieces |
| `src/lib/export/pdf/invoice-doc.ts` | pure invoice page ops |

---

### Task 1: `clients`, and projects that point at one

**Files:**
- Modify: `convex/schema.ts`, `convex/owned.ts`
- Create: `convex/clients.ts`, `convex/clients.test.ts`

**Interfaces:**
- Produces: `clients.list`, `clients.create`, `clients.update`, `clients.setArchived` (plus `*As` internal twins, mirroring `convex/projects.ts` exactly).
- Produces: `projects.clientId?: Id<"clients">`, settable through the existing `projects.update`.

- [ ] **Step 1: Write the failing test**

Create `convex/clients.test.ts`, mirroring the harness in `convex/entries.breakdown.test.ts` (`convexTest(schema, import.meta.glob("./**/*.*s"))`, an `expectCode` helper, `ALICE`/`BOB` constants):

```ts
describe("clients", () => {
  it("rejects anonymous callers on every public function", async () => {
    const t = setup()
    await expectCode(t.query(api.clients.list, {}), "UNAUTHENTICATED")
    await expectCode(t.mutation(api.clients.create, { name: "Acme", address: "" }), "UNAUTHENTICATED")
  })

  it("never returns another user's clients", async () => {
    const t = setup()
    await t.mutation(internal.clients.createAs, { userId: BOB, name: "Bob Co", address: "" })
    expect(await t.query(internal.clients.listAs, { userId: ALICE })).toEqual([])
  })

  it("refuses an empty name, because an invoice billed to nobody is not a document", async () => {
    const t = setup()
    await expectCode(
      t.mutation(internal.clients.createAs, { userId: ALICE, name: "  ", address: "" }),
      "TOO_LONG"
    )
  })

  /*
   * The address is a free-text block rendered verbatim on the document, so its
   * newlines are load-bearing — a normaliser that collapsed them would print a
   * three-line address on one line.
   */
  it("preserves the newlines in an address block", async () => {
    const t = setup()
    const address = "Vessel Vanguard LLC\nBonita Springs, FL\n34134, USA"
    const { clientId } = await t.mutation(internal.clients.createAs, {
      userId: ALICE, name: "Vessel Vanguard", address,
    })
    const found = (await t.query(internal.clients.listAs, { userId: ALICE })).find(
      (c) => c._id === clientId
    )
    expect(found?.address).toBe(address)
  })

  it("archives rather than deletes, so last year's invoices still render", async () => {
    const t = setup()
    const { clientId } = await t.mutation(internal.clients.createAs, {
      userId: ALICE, name: "Acme", address: "",
    })
    await t.mutation(internal.clients.setArchivedAs, { userId: ALICE, clientId, archived: true })
    const all = await t.query(internal.clients.listAs, { userId: ALICE })
    expect(all.find((c) => c._id === clientId)?.archived).toBe(true)
  })

  it("refuses to load a client belonging to someone else", async () => {
    const t = setup()
    const { clientId } = await t.mutation(internal.clients.createAs, {
      userId: BOB, name: "Bob Co", address: "",
    })
    await expectCode(
      t.mutation(internal.clients.updateAs, { userId: ALICE, clientId, name: "Stolen" }),
      "NOT_FOUND"
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run --project convex convex/clients.test.ts
```

Expected: FAIL — `api.clients` does not exist.

- [ ] **Step 3: Add the schema**

In `convex/schema.ts`, beside `projectFields`:

```ts
export const clientFields = {
  userId: v.string(),
  name: v.string(),
  /** A free-text block rendered VERBATIM on the invoice, newlines included.
   *  Deliberately not a structured address: a street/city/postcode schema is a
   *  taxonomy nobody asked for and gets the international cases wrong. */
  address: v.string(),
  email: v.optional(v.string()),
  /** Archive, never delete — the same rule as projects, and for the same
   *  reason: an invoice raised last year must still render its client. */
  archived: v.boolean(),
  updatedAt: v.number(),
  deletedAt: v.union(v.number(), v.null()),
}
```

Add to `defineSchema`:

```ts
  clients: defineTable(clientFields).index("by_user_archived_name", [
    "userId",
    "archived",
    "name",
  ]),
```

And add to `projectFields`:

```ts
  /** Optional, and stays optional: a project without a client is normal and
   *  must remain startable. What makes "Create invoice" able to pre-fill. */
  clientId: v.optional(v.id("clients")),
```

- [ ] **Step 4: Register the table as owned**

In `convex/owned.ts`, extend the tuple:

```ts
const OWNED_TABLES = ["timeEntries", "projects", "tags", "clients"] as const
```

- [ ] **Step 5: Write `convex/clients.ts`**

Mirror `convex/projects.ts` structure exactly — same validator layout, same `*As` internal twins, same `traceError` codes. Name validation reuses the project rule:

```ts
const MAX_NAME_LENGTH = 100
/* Long enough for a multi-line international address, short enough that a
 * paste accident cannot become a document. */
const MAX_ADDRESS_LENGTH = 500

function checkName(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed === "") traceError("TOO_LONG", "A client needs a name.")
  if (trimmed.length > MAX_NAME_LENGTH) {
    traceError("TOO_LONG", `Keep the name under ${MAX_NAME_LENGTH} characters.`)
  }
  return trimmed
}

/* NOT trimmed per line, and never collapsed: the block is rendered verbatim on
 * a document, so its internal newlines are the address's shape. Only the
 * surrounding whitespace goes. */
function checkAddress(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.length > MAX_ADDRESS_LENGTH) {
    traceError("TOO_LONG", `Keep the address under ${MAX_ADDRESS_LENGTH} characters.`)
  }
  return trimmed
}
```

`list` returns non-deleted rows through `by_user_archived_name`, archived last. `update` and `setArchived` load through `getOwned(ctx, userId, "clients", clientId)`.

- [ ] **Step 6: Allow `projects.update` to set a client**

Add `clientId: v.optional(v.union(v.id("clients"), v.null()))` to `updateArgs` in `convex/projects.ts`. `null` clears it. Before writing, verify the client is owned:

```ts
  // Ownership of the CLIENT, not just the project. Without this a crafted
  // mutation could file one user's project against another user's client,
  // which then leaks that client's name onto a pre-filled invoice.
  if (args.clientId != null) await getOwned(ctx, userId, "clients", args.clientId)
```

Add a test asserting a project cannot be filed against another user's client.

- [ ] **Step 7: Run tests, then commit**

```bash
pnpm vitest run --project convex convex/clients.test.ts convex/classifiers.test.ts
```

```bash
pnpm test && pnpm typecheck && pnpm lint
```

```bash
git add convex/schema.ts convex/owned.ts convex/clients.ts convex/clients.test.ts convex/projects.ts
git commit -m "feat(clients): give projects someone to be billed to

Archive rather than delete, so an invoice raised last year still renders its
client. The address is a verbatim free-text block: a structured schema is a
taxonomy nobody asked for and gets the international cases wrong.

projects.update verifies ownership of the CLIENT as well as the project —
otherwise a crafted mutation could file one user's project against another
user's client and leak the name onto a pre-filled invoice.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: The invoice tables, and the numbering rule

**Files:**
- Modify: `convex/schema.ts`, `convex/owned.ts`
- Create: `convex/lib/invoiceNumber.ts`, `convex/lib/invoiceNumber.test.ts`

**Interfaces:**
- Produces: `invoices` and `invoiceLines` tables.
- Produces: `nextInvoiceNumber(issuedAt: number, timeZone: string, used: ReadonlyArray<string>): string` and `parseInvoiceSequence(number: string): number | null` from `@shared/invoiceNumber`.

- [ ] **Step 1: Write the failing test**

Create `convex/lib/invoiceNumber.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { nextInvoiceNumber, parseInvoiceSequence } from "./invoiceNumber"

describe("parseInvoiceSequence", () => {
  it("reads the sequence out of the reference format", () => {
    expect(parseInvoiceSequence("072726-0013")).toBe(13)
  })

  it("ignores anything that is not this format, rather than guessing", () => {
    for (const junk of ["", "13", "INV-13", "072726", "072726-", "072726-abc"]) {
      expect(parseInvoiceSequence(junk), junk).toBeNull()
    }
  })

  it("reads a hand-edited number back, so a user's own scheme still advances", () => {
    expect(parseInvoiceSequence("010126-0999")).toBe(999)
  })
})

describe("nextInvoiceNumber", () => {
  const JUL_27 = Date.parse("2026-07-27T15:00:00Z")

  it("formats MMDDYY-NNNN, matching the reference invoice", () => {
    expect(nextInvoiceNumber(JUL_27, "UTC", [])).toBe("072726-0001")
  })

  /*
   * ONE PAST THE HIGHEST EVER USED, not a count of invoices.
   *
   * A count reuses a number after a deletion, and two documents claiming to be
   * #072726-0013 is the kind of thing a client's bookkeeper notices and the
   * freelancer cannot explain.
   */
  it("continues past the highest sequence ever used, not the count", () => {
    expect(nextInvoiceNumber(JUL_27, "UTC", ["072726-0001", "072726-0013"])).toBe(
      "072726-0014"
    )
  })

  it("does not reuse a number after one is deleted", () => {
    // Only 0013 survives; the next must still be 0014, never 0002.
    expect(nextInvoiceNumber(JUL_27, "UTC", ["072726-0013"])).toBe("072726-0014")
  })

  it("counts across dates, because the sequence is per user, not per day", () => {
    expect(nextInvoiceNumber(JUL_27, "UTC", ["010126-0042"])).toBe("072726-0043")
  })

  it("ignores unparseable numbers instead of throwing", () => {
    expect(nextInvoiceNumber(JUL_27, "UTC", ["INV-7", "072726-0003"])).toBe("072726-0004")
  })

  /* The date is the user's local one. A late-evening invoice in Manila must not
   * be numbered with the previous day because the server is in UTC. */
  it("uses the local date in the given zone", () => {
    const lateInManila = Date.parse("2026-07-27T16:30:00Z") // 00:30 on the 28th
    expect(nextInvoiceNumber(lateInManila, "Asia/Manila", [])).toBe("072826-0001")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run --project unit convex/lib/invoiceNumber.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write `convex/lib/invoiceNumber.ts`**

Pure. Use `localPartsOf` / `dayOf` from `./day` for the local date rather than re-deriving it.

```ts
/** `072726-0013` — MMDDYY, then a four-digit sequence. The reference format. */
const NUMBER = /^(\d{6})-(\d{4,})$/

export function parseInvoiceSequence(number: string): number | null {
  const match = NUMBER.exec(number.trim())
  if (match === null) return null
  const sequence = Number(match[2])
  return Number.isSafeInteger(sequence) ? sequence : null
}

export function nextInvoiceNumber(
  issuedAt: number,
  timeZone: string,
  used: ReadonlyArray<string>
): string {
  let highest = 0
  for (const number of used) {
    const sequence = parseInvoiceSequence(number)
    // Unparseable numbers are SKIPPED, not rejected: `number` is user-editable,
    // so somebody's own scheme must not break the generator for the next one.
    if (sequence !== null && sequence > highest) highest = sequence
  }
  const { year, month, day } = localPartsOf(issuedAt, timeZone)
  const stamp = `${pad2(month)}${pad2(day)}${pad2(year % 100)}`
  return `${stamp}-${String(highest + 1).padStart(4, "0")}`
}
```

- [ ] **Step 4: Add the tables**

In `convex/schema.ts`:

```ts
export const invoiceFields = {
  userId: v.string(),
  /** UUIDv7 minted client-side before the mutation is sent — the same
   *  idempotency device `timeEntries.clientKey` uses. A retry after a lost
   *  response must not mint a second invoice number. */
  clientKey: v.string(),
  number: v.string(),
  status: v.union(v.literal("draft"), v.literal("issued"), v.literal("paid")),
  clientId: v.union(v.id("clients"), v.null()),
  /** SNAPSHOT of the client's block at creation, not a join. Renaming a client
   *  must not rewrite last year's invoices; `clientId` beside it is what still
   *  answers "show me everything billed to Vessel Vanguard". */
  billedTo: v.string(),
  payTo: v.string(),
  /** Snapshot. `userSettings.currency` may change; this invoice may not. */
  currency: v.string(),
  issuedAt: v.number(),
  dueAt: v.number(),
  purchaseOrder: v.optional(v.string()),
  paymentTerms: v.optional(v.string()),
  /** Ordered, applied to the subtotal in order. `basisPoints` rather than a
   *  percentage float: 8.25% is 825, and no tax line is ever the result of
   *  0.1 + 0.2. */
  taxes: v.array(v.object({ label: v.string(), basisPoints: v.number() })),
  /** Provenance: which range built this. NEVER read to recompute anything — it
   *  exists so a human can ask where the figures came from. */
  sourceFromMs: v.union(v.number(), v.null()),
  sourceToMs: v.union(v.number(), v.null()),
  updatedAt: v.number(),
  deletedAt: v.union(v.number(), v.null()),
}

export const invoiceLineFields = {
  userId: v.string(),
  invoiceId: v.id("invoices"),
  kind: v.union(v.literal("time"), v.literal("custom")),
  description: v.string(),
  /** Hundredths of an hour. 98.8 h is 9880. An integer, never a float — the
   *  same reason money is held in cents. */
  quantityCentis: v.number(),
  unitCents: v.number(),
  /** STORED, not derived at render. Deriving it would make a printed document
   *  a function of today's rounding rules rather than of the day it was
   *  raised. */
  amountCents: v.number(),
  /** Provenance only. Never read for money. */
  projectId: v.optional(v.id("projects")),
  sortKey: v.number(),
}
```

```ts
  invoices: defineTable(invoiceFields)
    .index("by_user_number", ["userId", "number"])
    .index("by_user_clientKey", ["userId", "clientKey"])
    .index("by_user_issued", ["userId", "issuedAt"]),

  invoiceLines: defineTable(invoiceLineFields).index("by_user_invoice", [
    "userId",
    "invoiceId",
  ]),
```

Extend `OWNED_TABLES` again: `["timeEntries", "projects", "tags", "clients", "invoices", "invoiceLines"]`.

> `invoiceLines` has no `deletedAt`. `OwnedFields` in `owned.ts` requires one — either add `deletedAt` to the line (hard-deleted with its invoice anyway) or widen `owned.ts`. **Choose the former**: keeping every owned row the same shape is worth one unused column, and `getOwned`'s single code path is the thing that makes ownership unforgettable.

- [ ] **Step 5: Run tests and commit**

```bash
pnpm test && pnpm typecheck && pnpm lint
```

```bash
git add convex/schema.ts convex/owned.ts convex/lib/invoiceNumber.ts convex/lib/invoiceNumber.test.ts
git commit -m "feat(invoices): add the tables, and number from the highest ever used

The sequence continues past the highest number ever issued rather than
counting rows: a count reuses a number after a deletion, and two documents
claiming to be #072726-0013 is what a client's bookkeeper notices and the
freelancer cannot explain.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: `createFromRange` — where time becomes money

This is the task the feature exists for. Everything else is a form.

**Files:**
- Create: `convex/lib/invoiceMath.ts`, `convex/lib/invoiceMath.test.ts`
- Create: `convex/invoices.ts`, `convex/invoices.test.ts`
- Modify: `convex/entries.ts` (export `rangeBreakdownImpl` for reuse)

**Interfaces:**
- Produces: `lineAmountCents(quantityCentis, unitCents): number`, `invoiceTotals(lines, taxes): { subtotalCents, taxCents, totalCents }` from `@shared/invoiceMath`.
- Produces: `invoices.createFromRange`, `get`, `list`, `update`, `setStatus`, `remove`, `addLine`, `updateLine`, `removeLine`.

- [ ] **Step 1: Write the failing arithmetic test**

Create `convex/lib/invoiceMath.test.ts`:

```ts
describe("lineAmountCents", () => {
  /* The reference invoice: 98:48:00 -> 98.80 h at $10.00/hr -> $988.00. A
   * client must be able to reproduce this from the three printed numbers. */
  it("reproduces the reference invoice line exactly", () => {
    expect(lineAmountCents(9880, 1000)).toBe(98_800)
  })

  it("rounds the product to the nearest cent, once", () => {
    // 7.33 h at $61.00 = 447.13 exactly.
    expect(lineAmountCents(733, 6100)).toBe(44_713)
    // 0.01 h at $61.00 = 0.61 exactly.
    expect(lineAmountCents(1, 6100)).toBe(61)
    // Half-cent rounds up, stated so it cannot drift.
    expect(lineAmountCents(1, 50)).toBe(1) // 0.005 -> 0.01
  })

  it("prices a zero rate as zero rather than refusing it", () => {
    expect(lineAmountCents(9880, 0)).toBe(0)
  })
})

describe("invoiceTotals", () => {
  it("sums the stored line amounts rather than recomputing them", () => {
    const lines = [{ amountCents: 98_800 }, { amountCents: 1_200 }]
    expect(invoiceTotals(lines, []).subtotalCents).toBe(100_000)
  })

  /* Taxes apply to the SUBTOTAL, each rounded once, and are not compounded —
   * two 5% taxes are 10% of the subtotal, not 5% then 5% of the result. Which
   * of those a jurisdiction wants is a policy question; compounding silently
   * is a wrong number. */
  it("applies each tax to the subtotal, not to the running total", () => {
    const lines = [{ amountCents: 100_000 }]
    const taxes = [
      { label: "GST", basisPoints: 500 },
      { label: "PST", basisPoints: 500 },
    ]
    const { taxCents, totalCents } = invoiceTotals(lines, taxes)
    expect(taxCents).toBe(10_000)
    expect(totalCents).toBe(110_000)
  })

  it("totals an empty invoice as zero rather than NaN", () => {
    expect(invoiceTotals([], [])).toEqual({ subtotalCents: 0, taxCents: 0, totalCents: 0 })
  })
})
```

- [ ] **Step 2: Run it, confirm it fails, then implement**

```bash
pnpm vitest run --project unit convex/lib/invoiceMath.test.ts
```

```ts
/**
 * A line's amount, from the quantity the document PRINTS.
 *
 * NOT from the raw milliseconds. `/reports` sums every entry's exact
 * fractional-cent worth and rounds once at the end, which is the right way to
 * total a set of entries — but an invoice line prints `98.80 x $10.00` and a
 * client must reproduce `$988.00` from those three numbers with a calculator.
 * So the amount is computed from the rounded quantity, and the two can differ
 * by a cent or two. That difference is accepted and surfaced; what is not
 * accepted is it being silent.
 */
export function lineAmountCents(quantityCentis: number, unitCents: number): number {
  return Math.round((quantityCentis * unitCents) / 100)
}
```

- [ ] **Step 3: Write the failing `createFromRange` test**

Create `convex/invoices.test.ts`. The critical cases:

```ts
describe("invoices.createFromRange", () => {
  it("makes one line per project, priced at that project's rate", async () => { /* ... */ })

  /*
   * THE RULE THE WHOLE DESIGN EXISTS FOR. Create an invoice, then edit a source
   * entry. The invoice must not move.
   */
  it("is a snapshot: editing a source entry afterwards does not change it", async () => {
    const t = setup()
    // ... seed one project at $10/hr, one 1h billable entry, create the invoice
    const before = await t.query(internal.invoices.getAs, { userId: ALICE, invoiceId })
    // Now double the entry's duration through the ordinary edit path.
    await t.mutation(internal.entries.updateAs, { userId: ALICE, entryId, /* 2h */ })
    const after = await t.query(internal.invoices.getAs, { userId: ALICE, invoiceId })
    expect(after.lines).toEqual(before.lines)
  })

  it("refuses a truncated range rather than invoicing a floor", async () => {
    // Seed past SUMMARY_SCAN_LIMIT, expect code "RANGE_TOO_LARGE".
  })

  it("refuses a range spanning two clients, naming both", async () => {
    // Two projects with different clientIds, both with time in range.
    // Expect code "MIXED_CLIENTS" and both names in the message.
  })

  it("excludes billable time that has no rate, and reports how much", async () => {
    // A project with no hourlyRateCents and no account default.
    // Expect no line for it, and unratedMs on the result.
  })

  it("excludes non-billable time entirely", async () => { /* ... */ })

  it("snapshots the client's address, so renaming the client later does not rewrite it", async () => {
    // Create invoice, rename client, assert billedTo unchanged.
  })

  it("is idempotent on clientKey, so a retry does not mint a second number", async () => {
    const first = await create({ clientKey: "k1" })
    const second = await create({ clientKey: "k1" })
    expect(second.invoiceId).toBe(first.invoiceId)
    expect(await countInvoices()).toBe(1)
  })
})
```

- [ ] **Step 4: Implement `createFromRange`**

Reuse the existing aggregation rather than re-scanning:

```ts
/*
 * The SAME `rangeBreakdownImpl` /reports draws, called with a MutationCtx.
 *
 * A second scan written here would be a second rounding rule, and the invoice
 * would disagree with the page the user raised it from — which is the one
 * disagreement this product cannot afford. Export it from convex/entries.ts
 * rather than copying it.
 */
const breakdown = await rangeBreakdownImpl(ctx, userId, {
  fromMs: args.fromMs, toMs: args.toMs, timeZone, weekStartDay, billableOnly: true,
})

if (breakdown.truncated) {
  traceError(
    "RANGE_TOO_LARGE",
    "This period is too large to total exactly, so it cannot be invoiced. Narrow the dates."
  )
}
```

Then: resolve each project's `clientId`, refuse if more than one distinct non-null client, build one line per project with `quantityCentis = centiHours(project.billableMs)` and `unitCents` = the project's rate (falling back to `settings.defaultHourlyRateCents`), skipping projects whose billable time is entirely unrated.

- [ ] **Step 5: Run tests and commit**

```bash
pnpm test && pnpm typecheck && pnpm lint
```

```bash
git add convex/lib/invoiceMath.ts convex/lib/invoiceMath.test.ts convex/invoices.ts convex/invoices.test.ts convex/entries.ts
git commit -m "feat(invoices): turn a filtered range into lines, once

createFromRange reuses rangeBreakdownImpl rather than scanning again: a second
scan is a second rounding rule, and an invoice that disagrees with the page it
was raised from is the one disagreement this product cannot afford.

Refuses a truncated range outright. Every figure on a truncated /reports is a
floor, and a floor on an invoice under-bills a client by an unknown amount
with nothing on the document to reveal it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: The invoices list, and a way in

**Files:**
- Create: `src/routes/_authed/invoices.tsx`, `src/routes/_authed/-invoices.test.tsx`
- Modify: `src/components/shell/app-sidebar.tsx`

- [ ] **Step 1: Add the nav entry**

`NAV_ITEMS` gains a fifth entry between Reports and Projects:

```tsx
  { to: "/invoices", label: "Invoices", icon: FileText },
```

Widen the `to` union to include `"/invoices"`. `src/components/shell/app-sidebar.test.tsx` asserts the nav — update it for five items rather than deleting the assertion.

- [ ] **Step 2: Build the list**

Columns: number, client, issued date, total, status. Empty state teaches the interface (DESIGN.md forbids a bare "nothing here"): point at `/reports` as where an invoice comes from. Amounts in brass, dates and counts in ink.

- [ ] **Step 3: Test, then commit** — a `dom` test asserting the empty state names the route to visit, and that rows render number/client/total.

---

### Task 5: The invoice editor — document head

**Files:**
- Create: `src/routes/_authed/invoices.$invoiceId.tsx`
- Create: `src/components/invoices/invoice-meta.tsx`, `src/components/invoices/party-block.tsx`
- Modify: `src/routes/_authed/reports.tsx` — the `Create invoice` button (see below)
- Modify: `convex/invoices.ts` — `update` and `setStatus`, which no task has built yet

**AMENDED 2026-08-11 — two things this task must absorb, because nothing else does.**

**First: the `Create invoice` button does not exist.** The spec opens with it —
two controls on `/reports`, right-aligned, `[ Create invoice ] [ Export ▾ ]`,
separate *because they are separate acts* — and then no task in this plan ever
builds it. Verified in the browser at Task 4: `/reports` has `Export` and
nothing beside it. So `createFromRange` has been callable and unreachable since
Task 3, and `/invoices` can only ever show its empty state.

It lands here rather than in Task 4 because the button's job is to mint an
invoice **and go to it**, and until this task there is no `/invoices/$invoiceId`
to go to. Both of the spec's refusals ship with it, or it is not done: refuse
when the range is `truncated`, and refuse when the range spans two clients,
naming both.

**Second: `update`/`setStatus` do not exist either.** Task 3's file list
promised them and shipped only `createFromRange`/`get`. Task 6 makes the same
promise about the line mutations — check before starting it rather than
discovering it mid-task, which is what happened to `invoices.list` in Task 4.

Layout follows the reference screenshot: breadcrumb `Invoices › #072726-0013`, a status control and `Export PDF` top-right, then `Invoice` heading, the meta grid (ID, invoice date, due date, purchase order, payment terms), a logo slot, `Billed to` / `Pay to` blocks, and the currency selector.

**Three deliberate divergences from the reference, each argued in the spec:**
- **No Save button.** Fields autosave on blur, as every other editable surface in this app does. The top-right control is `status` instead: `Draft → Issued → Paid`.
- **Marking Issued freezes the lines**; editing then needs an explicit unlock. That is the act that deserves a deliberate button, not typing an address.
- Payer defaults come from settings, but are snapshot onto the invoice at creation.

**No notes field.** An invoice states what is owed; free-form commentary belongs on
the time entries the lines were built from, where it already lives. This is also
what keeps `INVOICE_NUMBER_SCAN_LIMIT`'s ~800 B/row estimate honest — so
`update` must bound `purchaseOrder` and `paymentTerms`, the only free text left,
the way `clients.ts` bounds names and addresses.

- [ ] Steps: build `party-block.tsx` (a labelled multiline field preserving newlines), `invoice-meta.tsx` (the field grid), wire autosave-on-blur through `invoices.update`, `dom` tests for autosave and for the frozen-when-issued rule, then commit.

---

### Task 6: The invoice editor — lines, taxes, totals

**Files:**
- Create: `src/components/invoices/line-table.tsx`, `src/components/invoices/totals-panel.tsx`

Columns: `DESCRIPTION | QUANTITY | RATE | AMOUNT`.

**The RATE column is a divergence from the reference and is required.** The reference prints `98.8` and `988.00` with the rate invisible, which works only because there is exactly one rate. With one line per project there are several, and a client handed `40.25` and `402.50` with no rate cannot check the line.

**The `AMOUNT` info affordance states the derivation in full** — `98:48:00 → 98.80 h (2 dp, floor) × $10.00 = $988.00` — and names the gap against `/reports` when there is one. Money the user cannot reproduce is money they will not trust on the screen they bill from.

Unrated billable time is **excluded from the lines and named above them**, reusing the sentence and the `Set rates on Projects` link `/reports` already carries.

- [ ] Steps: quantity/rate parsing through `parseMoney` and `centiHours`, amount recomputed on edit and STORED, `+ Add custom charge`, `+ Add tax`, subtotal/tax/total from `invoiceTotals`, `unit` tests for the parsing edges and `dom` tests for add/remove/reorder, then commit.

---

### Task 7: The invoice PDF

**Files:**
- Create: `src/lib/export/pdf/invoice-doc.ts`, `src/lib/export/pdf/invoice-doc.test.ts`
- Modify: `src/lib/export/to-pdf.ts`

Reuses **everything** the report PDF built: `PAGE`/`PAPER`/`paperColorFor`, the `PdfOp` model, `wrapToWidth`, `numericColumnsOps`, and `renderPages` with embedded DM Sans. `invoiceDocPages(invoice)` is PURE and returns `Array<PdfPage>`; `render.ts` is untouched.

Layout is the editor's paper area at print fidelity: same blocks, same numbers, no chart.

- [ ] Steps: pure page builder + tests (wrapped descriptions do not overlap the numeric columns — reuse the geometry invariant from `report-doc.test.ts`; a long line list paginates with a repeating header; totals land on the last page), wire `invoicePdfBlob`, verify in the browser against `invoice-072726-0013-2026-07-27.pdf`, then commit.

---

## Self-review

**Spec coverage.** §1's three tables → Tasks 1–2. §1's snapshot rule → Task 3's headline test. §1's numbering and dates → Task 2. §1's penny problem → Task 3's `lineAmountCents` and Task 6's info affordance. §2's `createFromRange` and its two refusals → Task 3. §4's routes and Clients tab → Task 4 (nav/list) with the Clients tab folded into Task 1's surface. §5's editor and three divergences → Tasks 5–6. §6's invoice PDF → Task 7.

**Deliberately deferred, and why:** the logo slot renders as an empty affordance in Task 5 but uploading an image needs Convex file storage and is not required to raise an invoice — it is the natural first follow-up.

**Two risks worth stating.** First, `createFromRange` calling `rangeBreakdownImpl` with a `MutationCtx` relies on `MutationCtx` satisfying `QueryCtx`; if it does not typecheck, extract the shared body rather than duplicating the arithmetic. Second, `invoiceLines` gains a `deletedAt` it never uses, purely so `owned.ts` keeps one code path — that is the intended trade and should not be "cleaned up" later without also widening `owned.ts`.
