/// <reference types="vite/client" />
// invoices.createFromRange — where tracked time becomes an invoice line.
//
// Reuses entries.rangeBreakdownImpl rather than re-scanning (see the comment
// on that export), so most of the arithmetic is already proven by
// entries.breakdown.test.ts. What is proven HERE is specific to invoicing:
// the snapshot rule, the two hard refusals, and the unrated-time exclusion.
import { convexTest } from "convex-test"
import { describe, expect, it, vi } from "vitest"
import schema from "./schema"
import { api, internal } from "./_generated/api"
import { traceErrorCode } from "./lib/codes"
import { parseInvoiceSequence } from "./lib/invoiceNumber"
import { NO_PROJECT_LABEL } from "./lib/labels"
import {
  INVOICE_LIST_LIMIT,
  INVOICE_NUMBER_SCAN_LIMIT,
  INVOICE_SCAN_LIMIT,
} from "./lib/scan"
import type { Id } from "./_generated/dataModel"

const modules = import.meta.glob("./**/*.*s")

const setup = () => convexTest(schema, modules)

const ALICE = "user_alice"
const BOB = "user_bob"
const HOUR = 3_600_000

const MON = Date.parse("2026-08-03T00:00:00Z")
const RANGE = { fromMs: MON, toMs: MON + 7 * 24 * HOUR, timeZone: "UTC", weekStartDay: 1 }

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise
  } catch (error) {
    expect(traceErrorCode(error) ?? String(error)).toBe(code)
    return
  }
  throw new Error(`expected rejection with code ${code}, but it resolved`)
}

type EntryOver = {
  startedAt: number
  durationMs?: number
  projectId?: Id<"projects">
  billable?: boolean
  clientKey?: string
}

/** Inserted directly, like entries.breakdown.test.ts's own fixture helper —
 *  the mutation under test is about pricing a range, not about the ordinary
 *  create path. */
async function entry(t: ReturnType<typeof setup>, over: EntryOver) {
  const durationMs = over.durationMs ?? HOUR
  return await t.run(async (ctx) => {
    return await ctx.db.insert("timeEntries", {
      userId: ALICE,
      clientKey: over.clientKey ?? `inv-${over.startedAt}-${Math.random()}`,
      title: "Work",
      startedAt: over.startedAt,
      endedAt: over.startedAt + durationMs,
      durationMs,
      projectId: over.projectId,
      tagIds: [],
      billable: over.billable ?? true,
      source: "web",
      updatedAt: MON,
      deletedAt: null,
    })
  })
}

async function client(t: ReturnType<typeof setup>, name: string) {
  return await t.mutation(internal.clients.createAs, {
    userId: ALICE,
    name,
    address: `${name} Address`,
  })
}

async function project(
  t: ReturnType<typeof setup>,
  over: { name: string; hourlyRateCents?: number; clientId?: Id<"clients"> }
) {
  const result = await t.mutation(internal.projects.createAs, {
    userId: ALICE,
    name: over.name,
    hourlyRateCents: over.hourlyRateCents,
  })
  if (over.clientId !== undefined) {
    await t.mutation(internal.projects.updateAs, {
      userId: ALICE,
      projectId: result.projectId,
      clientId: over.clientId,
    })
  }
  return result
}

async function create(
  t: ReturnType<typeof setup>,
  over: Partial<{ clientKey: string; fromMs: number; toMs: number; timeZone: string; weekStartDay: number }> = {}
) {
  return await t.mutation(internal.invoices.createFromRangeAs, {
    userId: ALICE,
    clientKey: over.clientKey ?? `k-${Math.random()}`,
    fromMs: over.fromMs ?? RANGE.fromMs,
    toMs: over.toMs ?? RANGE.toMs,
    timeZone: over.timeZone ?? RANGE.timeZone,
    weekStartDay: over.weekStartDay ?? RANGE.weekStartDay,
  })
}

async function get(t: ReturnType<typeof setup>, invoiceId: Id<"invoices">) {
  return await t.query(internal.invoices.getAs, { userId: ALICE, invoiceId })
}

async function countInvoices(t: ReturnType<typeof setup>): Promise<number> {
  return await t.run(async (ctx) => (await ctx.db.query("invoices").collect()).length)
}

describe("invoices.createFromRange", () => {
  it("makes one line per project, priced at that project's rate", async () => {
    const t = setup()
    const { clientId } = await client(t, "Acme")
    const { projectId } = await project(t, { name: "Website", hourlyRateCents: 1000, clientId })
    // 98:48:00 of billable time -> 98.80 centihours, matching the reference
    // invoice line in convex/lib/invoiceMath.test.ts.
    await entry(t, { startedAt: MON + HOUR, durationMs: 98 * HOUR + 48 * 60_000, projectId })

    const { invoiceId } = await create(t)
    const invoice = await get(t, invoiceId)

    expect(invoice.lines).toHaveLength(1)
    expect(invoice.lines[0]?.quantityCentis).toBe(9880)
    expect(invoice.lines[0]?.unitCents).toBe(1000)
    // The literal, not `lineAmountCents(9880, 1000)` — asserting against the
    // function under test proves nothing about it.
    expect(invoice.lines[0]?.amountCents).toBe(98_800)
    expect(invoice.clientId).toBe(clientId)
  })

  /*
   * 98:48:00 is EXACTLY 98.80 hours, so `centiHours` has no remainder to lose
   * and `lineAmountCents(9880, 1000)` equals the breakdown's own
   * `billableCents` — the test above passes identically whether the amount is
   * computed from the rounded quantity or taken straight from the breakdown.
   * This fixture has a real remainder, so the two arithmetics genuinely
   * differ and this test can actually fail against the wrong one.
   */
  it("prices a line from the rounded quantity, not the breakdown's exact billableCents", async () => {
    const t = setup()
    const { projectId } = await project(t, { name: "Website", hourlyRateCents: 6100 })
    // 1h 0m 20s = 3,620,000ms. centiHours floors 100.5(5)... down to 100
    // centihours, so lineAmountCents(100, 6100) = 6_100 exactly. The exact
    // value — (3,620,000 / 3,600,000) x 6100 = 6133.8(8)... -> 6_134 rounded —
    // is what `billableCents` would price this same time at.
    await entry(t, { startedAt: MON + HOUR, durationMs: HOUR + 20_000, projectId })

    const { invoiceId } = await create(t)
    const invoice = await get(t, invoiceId)

    expect(invoice.lines).toHaveLength(1)
    expect(invoice.lines[0]?.quantityCentis).toBe(100)
    expect(invoice.lines[0]?.unitCents).toBe(6100)
    expect(invoice.lines[0]?.amountCents).toBe(6_100)
  })

  /*
   * THE RULE THE WHOLE DESIGN EXISTS FOR. Create an invoice, then edit a source
   * entry. The invoice must not move.
   */
  it("is a snapshot: editing a source entry afterwards does not change it", async () => {
    const t = setup()
    const { projectId } = await project(t, { name: "Website", hourlyRateCents: 1000 })
    const entryId = await entry(t, { startedAt: MON + HOUR, durationMs: HOUR, projectId })

    const { invoiceId } = await create(t)
    const before = await get(t, invoiceId)

    // Double the entry's duration through the ordinary edit path.
    await t.mutation(internal.entries.editTimeAs, {
      userId: ALICE,
      entryId,
      field: "duration",
      value: 2 * HOUR,
    })

    // Prove the edit itself landed — otherwise a no-op edit path would pass
    // this test's real assertion below while proving nothing about it.
    const editedEntry = await t.run(async (ctx) => await ctx.db.get(entryId))
    expect(editedEntry?.durationMs).toBe(2 * HOUR)

    const after = await get(t, invoiceId)
    expect(after.lines).toEqual(before.lines)
    expect(after).toEqual(before)
  })

  /*
   * Pins the CONSTANT's value, not just the behaviour it drives. The test
   * below seeds `INVOICE_SCAN_LIMIT + 1` rows and would pass identically if
   * the constant were raised back to `SUMMARY_SCAN_LIMIT` (5,000) — it
   * would just seed and refuse at a higher number, never noticing that 5,000
   * sits ABOVE the ~3,100-row byte ceiling this limit exists to stay under
   * (see convex/lib/scan.ts). Raising the constant past that ceiling brings
   * back the opaque platform failure `RANGE_TOO_LARGE` was written to
   * replace, and only an assertion on the literal value can catch that.
   */
  it("keeps INVOICE_SCAN_LIMIT below the documented byte ceiling", () => {
    expect(INVOICE_SCAN_LIMIT).toBe(2_000)
  })

  it("refuses a truncated range rather than invoicing a floor", async () => {
    const t = setup()
    const { projectId } = await project(t, { name: "Website", hourlyRateCents: 1000 })

    const BATCH = 500
    // INVOICE_SCAN_LIMIT, not SUMMARY_SCAN_LIMIT — createFromRange scans
    // inside a mutation and refuses at the lower of the two (see the
    // constant's comment in convex/lib/scan.ts).
    const n = INVOICE_SCAN_LIMIT + 1
    for (let offset = 0; offset < n; offset += BATCH) {
      const upper = Math.min(offset + BATCH, n)
      await t.run(async (ctx) => {
        for (let i = offset; i < upper; i += 1) {
          await ctx.db.insert("timeEntries", {
            userId: ALICE,
            clientKey: `trunc-${i}`,
            title: "Work",
            startedAt: MON + i * 60_000,
            endedAt: MON + i * 60_000 + 60_000,
            durationMs: 60_000,
            projectId,
            tagIds: [],
            billable: true,
            source: "web",
            updatedAt: MON,
            deletedAt: null,
          })
        }
      })
    }

    await expectCode(create(t, { toMs: MON + (n + 10) * 60_000 }), "RANGE_TOO_LARGE")
  }, 60_000)

  it("refuses a range spanning two clients, naming both", async () => {
    const t = setup()
    const { clientId: acmeId } = await client(t, "Acme Corp")
    const { clientId: globexId } = await client(t, "Globex Inc")
    const { projectId: acmeProject } = await project(t, {
      name: "Acme work",
      hourlyRateCents: 1000,
      clientId: acmeId,
    })
    const { projectId: globexProject } = await project(t, {
      name: "Globex work",
      hourlyRateCents: 2000,
      clientId: globexId,
    })
    await entry(t, { startedAt: MON + HOUR, projectId: acmeProject })
    await entry(t, { startedAt: MON + 2 * HOUR, projectId: globexProject })

    try {
      await create(t)
      throw new Error("expected MIXED_CLIENTS")
    } catch (error) {
      expect(traceErrorCode(error)).toBe("MIXED_CLIENTS")
      const message = error instanceof Error ? error.message : String(error)
      expect(message).toContain("Acme Corp")
      expect(message).toContain("Globex Inc")
    }
  })

  it("excludes billable time that has no rate, and reports how much", async () => {
    const t = setup()
    const { projectId } = await project(t, { name: "Unrated" })
    await entry(t, { startedAt: MON + HOUR, durationMs: 2 * HOUR, projectId })

    const { invoiceId, unratedMs } = await create(t)
    const invoice = await get(t, invoiceId)

    expect(invoice.lines).toHaveLength(0)
    expect(unratedMs).toBe(2 * HOUR)
  })

  /*
   * A rate of ZERO is a price somebody chose (pro bono), not the absence of
   * one — see `rateOf` in entries.ts. Conflating the two would silently
   * under-bill: a $0.00 line that should print on the document instead
   * vanishes into `unratedMs` beside genuinely-unpriced work.
   */
  it("prices a zero-rate project as a real $0.00 line, not as unrated", async () => {
    const t = setup()
    const { projectId } = await project(t, { name: "Pro bono", hourlyRateCents: 0 })
    await entry(t, { startedAt: MON + HOUR, durationMs: HOUR, projectId })

    const { invoiceId, unratedMs } = await create(t)
    const invoice = await get(t, invoiceId)

    expect(invoice.lines).toHaveLength(1)
    expect(invoice.lines[0]?.unitCents).toBe(0)
    expect(invoice.lines[0]?.amountCents).toBe(0)
    expect(unratedMs).toBe(0)
  })

  /*
   * No fixture elsewhere in this suite creates a billable entry with NO
   * `projectId` while an account default rate is set, so the "No project"
   * label on a line — the one path through `description: project?.name ??
   * NO_PROJECT_LABEL` that actually reaches the fallback — was never
   * asserted.
   */
  it("labels a line with no project 'No project', priced at the account default rate", async () => {
    const t = setup()
    await t.mutation(internal.settings.updateAs, {
      userId: ALICE,
      defaultHourlyRateCents: 1500,
    })
    await entry(t, { startedAt: MON + HOUR, durationMs: HOUR })

    const { invoiceId } = await create(t)
    const invoice = await get(t, invoiceId)

    expect(invoice.lines).toHaveLength(1)
    expect(invoice.lines[0]?.description).toBe(NO_PROJECT_LABEL)
    expect(invoice.lines[0]?.unitCents).toBe(1500)
    expect(invoice.lines[0]?.projectId).toBeUndefined()
  })

  it("excludes non-billable time entirely", async () => {
    const t = setup()
    const { projectId } = await project(t, { name: "Website", hourlyRateCents: 1000 })
    await entry(t, { startedAt: MON + HOUR, projectId, billable: false })

    const { invoiceId, unratedMs } = await create(t)
    const invoice = await get(t, invoiceId)

    expect(invoice.lines).toHaveLength(0)
    expect(unratedMs).toBe(0)
  })

  it("snapshots the client's address, so renaming the client later does not rewrite it", async () => {
    const t = setup()
    const { clientId } = await client(t, "Acme")
    const { projectId } = await project(t, { name: "Website", hourlyRateCents: 1000, clientId })
    await entry(t, { startedAt: MON + HOUR, projectId })

    const { invoiceId } = await create(t)
    const before = await get(t, invoiceId)
    expect(before.billedTo).toContain("Acme")

    await t.mutation(internal.clients.updateAs, {
      userId: ALICE,
      clientId,
      name: "Acme Renamed LLC",
    })

    const after = await get(t, invoiceId)
    expect(after.billedTo).toBe(before.billedTo)
    expect(after.billedTo).toContain("Acme")
    expect(after.billedTo).not.toContain("Renamed")
  })

  it("is idempotent on clientKey, so a retry does not mint a second number", async () => {
    const t = setup()
    const { projectId } = await project(t, { name: "Website", hourlyRateCents: 1000 })
    await entry(t, { startedAt: MON + HOUR, projectId })

    const first = await create(t, { clientKey: "k1" })
    const second = await create(t, { clientKey: "k1" })

    expect(second.invoiceId).toBe(first.invoiceId)
    expect(await countInvoices(t)).toBe(1)
  })

  /*
   * `unratedMs` is how the editor (Task 6) names excluded time — "3h 12m of
   * billable time has no rate and is not on this invoice". Before this was
   * persisted, a retry (a lost response, a re-sent form) hit the replay
   * branch and got back `0`, as though nothing had ever been excluded: a
   * client asking "why does this add up short" after a reload would be told
   * nothing was hidden, when 2h genuinely was.
   */
  it("returns the stored unratedMs on a replay, not zero", async () => {
    const t = setup()
    const { projectId } = await project(t, { name: "Unrated" })
    await entry(t, { startedAt: MON + HOUR, durationMs: 2 * HOUR, projectId })

    const first = await create(t, { clientKey: "replay-unrated" })
    expect(first.unratedMs).toBe(2 * HOUR)

    const second = await create(t, { clientKey: "replay-unrated" })
    expect(second.replayed).toBe(true)
    expect(second.invoiceId).toBe(first.invoiceId)
    expect(second.unratedMs).toBe(2 * HOUR)
  })

  it("stamps number, currency, dueAt and status on creation", async () => {
    const t = setup()
    await t.mutation(internal.settings.updateAs, { userId: ALICE, currency: "EUR" })
    const { projectId } = await project(t, { name: "Website", hourlyRateCents: 1000 })
    await entry(t, { startedAt: MON + HOUR, projectId })

    /*
     * `Date.now()` is mocked to a COUNTER, not left real, for the assertion
     * below. Two real `Date.now()` calls inside one synchronous mutation land
     * on the same millisecond under convex-test, so a plain
     * `dueAt - issuedAt === 30 days` check could not tell "one clock read,
     * reused for both fields" from "two reads that happened to tie" — a
     * second read would have silently passed the same assertion. A counter
     * makes the two implementations diverge: `dueAt` computed from a SECOND
     * `Date.now()` call would land 1ms past 30 days, and only reusing the
     * FIRST read keeps the difference exact.
     */
    let tick = MON
    const dateNowSpy = vi.spyOn(Date, "now").mockImplementation(() => {
      tick += 1
      return tick
    })
    let invoiceId: Id<"invoices">
    try {
      ;({ invoiceId } = await create(t))
    } finally {
      dateNowSpy.mockRestore()
    }
    const invoice = await get(t, invoiceId)

    expect(invoice.status).toBe("draft")
    // settings.currencyOf is otherwise unexercised anywhere in this suite —
    // without this, a currency snapshot that silently fell back to "USD"
    // regardless of the account's own setting would pass every other test.
    expect(invoice.currency).toBe("EUR")
    expect(invoice.number).toMatch(/^\d{6}-\d{4,}$/)
    // Net 30, in milliseconds, from the SAME issuedAt this invoice stamped —
    // see the mock above for why this can now actually tell that apart from
    // a second clock read.
    expect(invoice.dueAt - invoice.issuedAt).toBe(30 * 24 * 60 * 60 * 1000)
  })

  it("gives two invoices created in sequence different, advancing numbers", async () => {
    const t = setup()
    const { projectId } = await project(t, { name: "Website", hourlyRateCents: 1000 })
    await entry(t, { startedAt: MON + HOUR, projectId })

    const first = await create(t, { clientKey: "seq-1" })
    const second = await create(t, { clientKey: "seq-2" })

    const firstInvoice = await get(t, first.invoiceId)
    const secondInvoice = await get(t, second.invoiceId)

    expect(secondInvoice.number).not.toBe(firstInvoice.number)
    const firstSeq = parseInvoiceSequence(firstInvoice.number)
    const secondSeq = parseInvoiceSequence(secondInvoice.number)
    expect(firstSeq).not.toBeNull()
    expect(secondSeq).not.toBeNull()
    expect(secondSeq as number).toBeGreaterThan(firstSeq as number)
  })

  /*
   * `nextInvoiceNumber` needs the highest sequence ever used, and
   * `by_user_number` sorts `number` as a STRING — so no bounded slice of that
   * index provably contains the maximum (see INVOICE_NUMBER_SCAN_LIMIT's
   * comment in convex/lib/scan.ts). This proves the mutation refuses once its
   * bounded read of the WHOLE table can no longer prove correctness, rather
   * than silently handing out a number some other invoice already holds.
   */
  it("refuses to mint a number once the invoice history is too large to scan safely", async () => {
    const t = setup()
    const { projectId } = await project(t, { name: "Website", hourlyRateCents: 1000 })
    await entry(t, { startedAt: MON + HOUR, projectId })

    const BATCH = 500
    const n = INVOICE_NUMBER_SCAN_LIMIT + 1
    for (let offset = 0; offset < n; offset += BATCH) {
      const upper = Math.min(offset + BATCH, n)
      await t.run(async (ctx) => {
        for (let i = offset; i < upper; i += 1) {
          await ctx.db.insert("invoices", {
            userId: ALICE,
            clientKey: `hist-${i}`,
            number: `010100-${String(i).padStart(4, "0")}`,
            status: "draft",
            clientId: null,
            billedTo: "",
            payTo: "",
            currency: "USD",
            issuedAt: MON,
            dueAt: MON + 30 * 24 * HOUR,
            taxes: [],
            sourceFromMs: null,
            sourceToMs: null,
            unratedMsAtCreation: 0,
            updatedAt: MON,
            deletedAt: null,
          })
        }
      })
    }

    await expectCode(create(t), "INVOICE_HISTORY_TOO_LARGE")
  }, 60_000)

  it("lines carry a stable sortKey, matching print order", async () => {
    const t = setup()
    const { projectId: alpha } = await project(t, { name: "Alpha", hourlyRateCents: 1000 })
    const { projectId: bravo } = await project(t, { name: "Bravo", hourlyRateCents: 1000 })
    const { projectId: charlie } = await project(t, { name: "Charlie", hourlyRateCents: 1000 })
    // Distinct totals so `breakdown.projects`'s descending-by-time order is
    // unambiguous: Charlie (3h) > Bravo (2h) > Alpha (1h).
    await entry(t, { startedAt: MON + HOUR, durationMs: HOUR, projectId: alpha })
    await entry(t, { startedAt: MON + 2 * HOUR, durationMs: 2 * HOUR, projectId: bravo })
    await entry(t, { startedAt: MON + 5 * HOUR, durationMs: 3 * HOUR, projectId: charlie })

    const { invoiceId } = await create(t)
    const invoice = await get(t, invoiceId)

    expect(invoice.lines.map((l) => l.description)).toEqual(["Charlie", "Bravo", "Alpha"])
    expect(invoice.lines.map((l) => l.sortKey)).toEqual([0, 1, 2])
  })
})

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

/*
 * Rows are inserted directly rather than raised through `createFromRange`,
 * because every property this list has is a property of the ROWS — the order
 * they come back in, whose they are, whether they are in the trash, and how
 * many of them there are. Going through the mutation would mean stamping
 * `issuedAt` from a mocked clock and seeding a range of entries per invoice to
 * assert an ordering that has nothing to do with either.
 */
type InvoiceOver = {
  number: string
  issuedAt: number
  userId?: string
  status?: "draft" | "issued" | "paid"
  billedTo?: string
  currency?: string
  taxes?: Array<{ label: string; basisPoints: number }>
  deletedAt?: number | null
}

async function seedInvoice(
  t: ReturnType<typeof setup>,
  over: InvoiceOver
): Promise<Id<"invoices">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("invoices", {
      userId: over.userId ?? ALICE,
      clientKey: `seed-${over.userId ?? ALICE}-${over.number}`,
      number: over.number,
      status: over.status ?? "draft",
      clientId: null,
      billedTo: over.billedTo ?? "Acme Corp\n1 Way, Springfield",
      payTo: "",
      currency: over.currency ?? "USD",
      issuedAt: over.issuedAt,
      dueAt: over.issuedAt + 30 * 24 * HOUR,
      taxes: over.taxes ?? [],
      sourceFromMs: null,
      sourceToMs: null,
      unratedMsAtCreation: 0,
      updatedAt: over.issuedAt,
      deletedAt: over.deletedAt ?? null,
    })
  })
}

async function seedLine(
  t: ReturnType<typeof setup>,
  invoiceId: Id<"invoices">,
  over: { amountCents: number; sortKey?: number; userId?: string }
) {
  await t.run(async (ctx) => {
    await ctx.db.insert("invoiceLines", {
      userId: over.userId ?? ALICE,
      invoiceId,
      kind: "time",
      description: "Work",
      quantityCentis: 100,
      unitCents: over.amountCents,
      amountCents: over.amountCents,
      sortKey: over.sortKey ?? 0,
      deletedAt: null,
    })
  })
}

const listAs = async (t: ReturnType<typeof setup>, userId = ALICE) =>
  await t.query(internal.invoices.listAs, { userId })

describe("invoices.list", () => {
  it("rejects an anonymous caller", async () => {
    const t = setup()
    await expectCode(t.query(api.invoices.list, {}), "UNAUTHENTICATED")
  })

  /*
   * Descending `by_user_issued`, not insertion order — the two are seeded
   * apart here on purpose. A list ordered by `_creationTime` would pass an
   * ascending-vs-descending check and still put a back-dated invoice in the
   * wrong place, which is exactly what a freelancer raising last month's
   * invoice today produces.
   */
  it("returns the newest issued invoice first", async () => {
    const t = setup()
    await seedInvoice(t, { number: "010126-0001", issuedAt: MON })
    await seedInvoice(t, { number: "020126-0002", issuedAt: MON + 5 * 24 * HOUR })
    await seedInvoice(t, { number: "030126-0003", issuedAt: MON + 2 * 24 * HOUR })

    const { invoices } = await listAs(t)
    expect(invoices.map((row) => row.number)).toEqual([
      "020126-0002",
      "030126-0003",
      "010126-0001",
    ])
  })

  it("totals the stored line amounts and this invoice's own taxes", async () => {
    const t = setup()
    const invoiceId = await seedInvoice(t, {
      number: "010126-0001",
      issuedAt: MON,
      taxes: [
        { label: "GST", basisPoints: 500 },
        { label: "PST", basisPoints: 500 },
      ],
    })
    await seedLine(t, invoiceId, { amountCents: 98_800, sortKey: 0 })
    await seedLine(t, invoiceId, { amountCents: 1_200, sortKey: 1 })

    const { invoices } = await listAs(t)
    // The literals, not `invoiceTotals(...)` — asserting against the same
    // function the query calls would prove nothing about either. $1,000.00 of
    // lines, then two 5% taxes applied to that SUBTOTAL rather than compounded.
    expect(invoices).toHaveLength(1)
    expect(invoices[0]?.totalCents).toBe(110_000)
  })

  /*
   * A total is an N+1 read, so the one thing that can silently go wrong is a
   * line query keyed on the wrong invoice — which no single-invoice fixture
   * can catch, because with one invoice every line belongs to it.
   */
  it("totals each invoice from its own lines", async () => {
    const t = setup()
    const first = await seedInvoice(t, { number: "010126-0001", issuedAt: MON })
    const second = await seedInvoice(t, {
      number: "010126-0002",
      issuedAt: MON + HOUR,
    })
    await seedLine(t, first, { amountCents: 500 })
    await seedLine(t, second, { amountCents: 25_000 })

    const { invoices } = await listAs(t)
    expect(invoices.map((row) => [row.number, row.totalCents])).toEqual([
      ["010126-0002", 25_000],
      ["010126-0001", 500],
    ])
  })

  it("never returns another user's invoices", async () => {
    const t = setup()
    const bobInvoice = await seedInvoice(t, {
      userId: BOB,
      number: "010126-0001",
      issuedAt: MON,
    })
    await seedLine(t, bobInvoice, { userId: BOB, amountCents: 99_999 })

    expect(await listAs(t, ALICE)).toEqual({ invoices: [], truncated: false })
    expect((await listAs(t, BOB)).invoices).toHaveLength(1)
  })

  it("excludes a soft-deleted invoice", async () => {
    const t = setup()
    await seedInvoice(t, { number: "010126-0001", issuedAt: MON })
    await seedInvoice(t, {
      number: "010126-0002",
      issuedAt: MON + HOUR,
      deletedAt: MON + 2 * HOUR,
    })

    const { invoices } = await listAs(t)
    expect(invoices.map((row) => row.number)).toEqual(["010126-0001"])
  })

  /*
   * The v1 trade: the newest page, no "load older", and `truncated` so the
   * screen can SAY the history goes further back. A list that stopped at the
   * cap with nothing to mark it would read as "this account has 50 invoices".
   */
  it("caps the page and reports that older invoices exist", async () => {
    const t = setup()
    for (let i = 0; i <= INVOICE_LIST_LIMIT; i += 1) {
      await seedInvoice(t, {
        number: `010126-${String(i).padStart(4, "0")}`,
        issuedAt: MON + i * HOUR,
      })
    }

    const { invoices, truncated } = await listAs(t)
    expect(invoices).toHaveLength(INVOICE_LIST_LIMIT)
    expect(truncated).toBe(true)
    // Newest first, so the ONE dropped invoice is the oldest — never the one
    // just raised.
    expect(invoices[0]?.number).toBe(`010126-${String(INVOICE_LIST_LIMIT).padStart(4, "0")}`)
  })

  it("reports no truncation when the whole history fits", async () => {
    const t = setup()
    await seedInvoice(t, { number: "010126-0001", issuedAt: MON })

    expect((await listAs(t)).truncated).toBe(false)
  })
})
