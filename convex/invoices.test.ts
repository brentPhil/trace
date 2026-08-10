/// <reference types="vite/client" />
// invoices.createFromRange — where tracked time becomes an invoice line.
//
// Reuses entries.rangeBreakdownImpl rather than re-scanning (see the comment
// on that export), so most of the arithmetic is already proven by
// entries.breakdown.test.ts. What is proven HERE is specific to invoicing:
// the snapshot rule, the two hard refusals, and the unrated-time exclusion.
import { convexTest } from "convex-test"
import { describe, expect, it } from "vitest"
import schema from "./schema"
import { internal } from "./_generated/api"
import { traceErrorCode } from "./lib/codes"
import { lineAmountCents } from "./lib/invoiceMath"
import { SUMMARY_SCAN_LIMIT } from "./lib/scan"
import type { Id } from "./_generated/dataModel"

const modules = import.meta.glob("./**/*.*s")

const setup = () => convexTest(schema, modules)

const ALICE = "user_alice"
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
    expect(invoice.lines[0]?.amountCents).toBe(lineAmountCents(9880, 1000))
    expect(invoice.clientId).toBe(clientId)
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

    const after = await get(t, invoiceId)
    expect(after.lines).toEqual(before.lines)
    expect(after).toEqual(before)
  })

  it("refuses a truncated range rather than invoicing a floor", async () => {
    const t = setup()
    const { projectId } = await project(t, { name: "Website", hourlyRateCents: 1000 })

    const BATCH = 500
    const n = SUMMARY_SCAN_LIMIT + 1
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
})
