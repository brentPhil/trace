import { describe, expect, it } from "vitest"
import { billableBucketsOf, invoiceLineDrafts } from "./invoiceLines"
import { NO_PROJECT_LABEL } from "./labels"
import type { BillableBucket, BreakdownProject } from "./invoiceLines"

/*
 * The ONE derivation of an invoice line, asserted against LITERALS.
 *
 * That is the whole discipline of this file. `invoices.createFromRange` writes
 * these rows and `/invoices/new` previews them, and both call this function — so
 * a test that checked either side by calling `invoiceLineDrafts` again would
 * pass no matter what this function did, including doing it wrong on both sides
 * at once. The numbers below are written out by hand, and the convex test
 * (`convex/invoices.test.ts`) and the dom test (`-invoice-new.test.tsx`) pin the
 * same figures from the mutation and from the screen respectively. Break the
 * arithmetic here and all three fail together, which is exactly what "the
 * preview shows what gets billed" has to mean.
 */

const HOUR = 3_600_000

function bucket(over: Partial<BillableBucket> = {}): BillableBucket {
  return {
    projectId: "p1",
    billableMs: HOUR,
    unratedBillableMs: 0,
    project: { name: "Website", hourlyRateCents: 1000 },
    ...over,
  }
}

describe("invoiceLineDrafts", () => {
  /* 98:48:00 is exactly 98.80 h, which is the reference invoice's own line —
   * see convex/lib/invoiceMath.test.ts. */
  it("prices a bucket at the project's own rate", () => {
    expect(invoiceLineDrafts([bucket({ billableMs: 98 * HOUR + 48 * 60_000 })], null)).toEqual(
      [
        {
          description: "Website",
          quantityCentis: 9880,
          unitCents: 1000,
          amountCents: 98_800,
          projectId: "p1",
        },
      ]
    )
  })

  /*
   * THE ROUNDING, on a fixture where the two candidate arithmetics genuinely
   * differ. 1h 0m 20s is 100.5(5)... centihours, floored to 100, so the line is
   * 100 x $61.00 = $61.00 — while the exact fractional-cent value of that same
   * time is $61.34. A test at 98:48:00 alone cannot tell the two apart.
   */
  it("computes the amount from the FLOORED quantity, not from exact milliseconds", () => {
    const [line] = invoiceLineDrafts(
      [
        bucket({
          billableMs: HOUR + 20_000,
          project: { name: "Website", hourlyRateCents: 6100 },
        }),
      ],
      null
    )
    expect(line?.quantityCentis).toBe(100)
    expect(line?.amountCents).toBe(6_100)
  })

  it("falls back to the account rate for a project that has none", () => {
    const [line] = invoiceLineDrafts([bucket({ project: { name: "Website" } })], 1500)
    expect(line?.unitCents).toBe(1500)
    expect(line?.amountCents).toBe(1_500)
  })

  /*
   * ZERO IS A RATE SOMEBODY CHOSE (pro bono), not the absence of one. `||`
   * here instead of `??` would silently bill a free project at the account
   * default — the difference between a $0.00 line the client expects and an
   * invoice for work that was given away.
   */
  it("keeps a zero-rate project at $0.00 rather than falling through to the default", () => {
    const [line] = invoiceLineDrafts(
      [bucket({ project: { name: "Pro bono", hourlyRateCents: 0 } })],
      1500
    )
    expect(line?.unitCents).toBe(0)
    expect(line?.amountCents).toBe(0)
  })

  /* Time nobody has priced is left OFF, never guessed at and never billed at
   * zero — the excluded total is reported separately so the absence is stated. */
  it("skips a bucket whose billable time has no rate", () => {
    expect(
      invoiceLineDrafts(
        [bucket({ unratedBillableMs: HOUR, project: { name: "Unrated" } })],
        null
      )
    ).toEqual([])
  })

  it("skips a bucket with no billable time at all", () => {
    expect(invoiceLineDrafts([bucket({ billableMs: 0 })], 1000)).toEqual([])
  })

  /* A blank cell beside a real amount on a printed invoice reads as a rendering
   * fault, not as "work with no project". The label is shared with the client's
   * own charts through convex/lib/labels.ts. */
  it("names the unassigned bucket rather than leaving the description blank", () => {
    const [line] = invoiceLineDrafts(
      [bucket({ projectId: null, project: undefined })],
      2000
    )
    expect(line?.description).toBe(NO_PROJECT_LABEL)
    expect(line?.unitCents).toBe(2000)
    expect(line?.projectId).toBe(null)
  })

  /* A bucket assembled with no rate anywhere must produce no line rather than
   * one priced `null`. Unreachable from a real breakdown — `unratedBillableMs`
   * would be non-zero — and the guard is here because that proof lives in
   * another file. */
  it("drops a bucket that has no rate anywhere, rather than pricing it null", () => {
    expect(
      invoiceLineDrafts([bucket({ project: { name: "Website" } })], null)
    ).toEqual([])
  })

  /* The caller hands buckets in print order and gets them back in it —
   * `rangeBreakdownImpl` sorts descending by time, and that ordering becomes
   * both the preview's row order and the stored `sortKey`. */
  it("keeps the order it was given, skipped buckets and all", () => {
    const lines = invoiceLineDrafts(
      [
        bucket({ projectId: "c", project: { name: "Charlie", hourlyRateCents: 1000 } }),
        bucket({
          projectId: "b",
          unratedBillableMs: HOUR,
          project: { name: "Bravo" },
        }),
        bucket({ projectId: "a", project: { name: "Alpha", hourlyRateCents: 1000 } }),
      ],
      null
    )
    expect(lines.map((line) => line.description)).toEqual(["Charlie", "Alpha"])
  })
})

/*
 * The step between the scan and the pricing, which used to happen twice.
 *
 * `createFromRangeImpl` assembled its buckets from the project DOCUMENTS it had
 * fetched, while a preview could only assemble its own from whatever it could
 * see — a second `projects.list` subscription that omits soft-deleted rows and
 * can lag this scan by a frame. Both now read the breakdown's own rows, which
 * is the single answer both sides already hold.
 */
describe("billableBucketsOf", () => {
  function project(over: Partial<BreakdownProject> = {}): BreakdownProject {
    return {
      projectId: "p1",
      name: "Website",
      hourlyRateCents: 1000,
      billableMs: HOUR,
      unratedBillableMs: 0,
      ...over,
    }
  }

  it("carries the rate and the name off the scan's own row", () => {
    expect(billableBucketsOf([project()])).toEqual([
      {
        projectId: "p1",
        billableMs: HOUR,
        unratedBillableMs: 0,
        project: { name: "Website", hourlyRateCents: 1000 },
      },
    ])
  })

  /*
   * A project with no rate keeps `hourlyRateCents` ABSENT rather than 0. The
   * two mean opposite things one function along: absent falls through to the
   * account default, and zero is pro bono work somebody priced. A mapper that
   * defaulted the field would bill every unrated project at nothing.
   */
  it("leaves a rateless project's rate absent rather than zero", () => {
    const buckets = billableBucketsOf([project({ hourlyRateCents: undefined })])
    expect(buckets[0]?.project).toEqual({ name: "Website", hourlyRateCents: undefined })
    // And the consequence one function along: the account default covers it.
    expect(invoiceLineDrafts(buckets, 2500)[0]?.unitCents).toBe(2500)
  })

  it("keeps a zero-rate project at zero", () => {
    expect(
      invoiceLineDrafts(billableBucketsOf([project({ hourlyRateCents: 0 })]), 2500)[0]
        ?.unitCents
    ).toBe(0)
  })

  /*
   * `projectId: null` is BOTH the unassigned bucket and a project row the scan
   * could not resolve — `rangeBreakdownImpl` writes `doc?._id ?? null` and
   * `doc?.name ?? ""`. A line cannot tell them apart and neither has a name or
   * a rate, so both must arrive as `project: undefined` and get the shared
   * label rather than an empty description.
   */
  it("hands the unassigned bucket down with no project at all", () => {
    expect(
      billableBucketsOf([project({ projectId: null, name: "", hourlyRateCents: undefined })])
    ).toEqual([
      { projectId: null, billableMs: HOUR, unratedBillableMs: 0, project: undefined },
    ])
    expect(
      invoiceLineDrafts(
        billableBucketsOf([project({ projectId: null, name: "", hourlyRateCents: undefined })]),
        2000
      )[0]?.description
    ).toBe(NO_PROJECT_LABEL)
  })

  /* The scan's order IS the print order and the stored `sortKey`. A mapper that
   * sorted, grouped or filtered here would renumber the document. */
  it("preserves the order it was given, one bucket for one row", () => {
    const buckets = billableBucketsOf([
      project({ projectId: "c", name: "Charlie" }),
      project({ projectId: "b", name: "Bravo", billableMs: 0 }),
      project({ projectId: "a", name: "Alpha" }),
    ])
    expect(buckets.map((b) => b.projectId)).toEqual(["c", "b", "a"])
  })
})
