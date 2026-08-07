import { describe, expect, it } from "vitest"
import {
  defaultFilters,
  hasClientSideFilter,
  matches,
  periodFilters,
  stepPeriod,
} from "./history-filters"
import type { Filters } from "./history-filters"
import type { Doc } from "../../convex/_generated/dataModel"

const base: Filters = {
  period: "custom",
  from: "2026-08-03",
  to: "2026-08-09",
  projectId: null,
  billableOnly: false,
  text: "",
  presets: [],
}

function entry(over: Partial<Doc<"timeEntries">> = {}): Doc<"timeEntries"> {
  return {
    _id: "e1" as Doc<"timeEntries">["_id"],
    _creationTime: 0,
    userId: "u",
    clientKey: "k",
    title: "Work",
    startedAt: 0,
    endedAt: 1,
    durationMs: 3_600_000,
    tagIds: [],
    billable: false,
    source: "web",
    updatedAt: 0,
    deletedAt: null,
    ...over,
  }
}

const noNames = () => ""

describe("stepping a period", () => {
  it("steps a week back by exactly seven days", () => {
    const stepped = stepPeriod(base, -1)
    expect(stepped.from).toBe("2026-07-27")
    expect(stepped.to).toBe("2026-08-02")
  })

  it("steps a custom range by its own span, not to a calendar boundary", () => {
    // "3 Aug – 5 Aug" back is "31 Jul – 2 Aug". Snapping to a week would give
    // the user a range they never asked for.
    const three = { ...base, from: "2026-08-03", to: "2026-08-05" }
    const stepped = stepPeriod(three, -1)
    expect(stepped.from).toBe("2026-07-31")
    expect(stepped.to).toBe("2026-08-02")
  })

  it("steps months by calendar month, not by 30 days", () => {
    const august = { ...base, period: "month" as const, from: "2026-08-01", to: "2026-08-31" }
    const july = stepPeriod(august, -1)
    expect(july.from).toBe("2026-07-01")
    expect(july.to).toBe("2026-07-31")
  })

  it("does not overflow when stepping back from a 31-day month", () => {
    // Naively subtracting a month from 31 August lands on 31 June, which the
    // Date constructor silently rolls into July.
    const august = { ...base, period: "month" as const, from: "2026-08-01", to: "2026-08-31" }
    const stepped = stepPeriod(august, -1)
    expect(stepped.to).toBe("2026-07-31")
  })

  it("gets February right in a leap year", () => {
    const march = { ...base, period: "month" as const, from: "2028-03-01", to: "2028-03-31" }
    const feb = stepPeriod(march, -1)
    expect(feb.from).toBe("2028-02-01")
    expect(feb.to).toBe("2028-02-29")
  })

  it("preserves every other filter, which is the point of stepping", () => {
    const filtered = { ...base, text: "invoice", billableOnly: true, projectId: "p1" }
    const stepped = stepPeriod(filtered, 1)
    expect(stepped.text).toBe("invoice")
    expect(stepped.billableOnly).toBe(true)
    expect(stepped.projectId).toBe("p1")
  })
})

describe("period presets", () => {
  it("a week honours the stored week-start day", () => {
    // Sunday-start and Monday-start give different weeks for the same date.
    const monday = periodFilters("week", "2026-08-06", 1, base)
    const sunday = periodFilters("week", "2026-08-06", 0, base)
    expect(monday.from).toBe("2026-08-03")
    expect(sunday.from).toBe("2026-08-02")
  })

  it("a month spans the whole calendar month", () => {
    const august = periodFilters("month", "2026-08-06", 1, base)
    expect(august.from).toBe("2026-08-01")
    expect(august.to).toBe("2026-08-31")
  })

  it("defaults to the current week", () => {
    expect(defaultFilters("2026-08-06", 1).period).toBe("week")
  })
})

describe("client-side filters", () => {
  it("matches text across title, note AND project name", () => {
    // Searching only the title would miss the field this product exists for.
    const withNote = entry({ title: "Work", note: "sent the invoice to Dana" })
    expect(matches(withNote, { ...base, text: "invoice" }, noNames)).toBe(true)

    const byProject = entry({ title: "Work", projectId: "p1" as never })
    expect(
      matches(byProject, { ...base, text: "acme" }, () => "Acme redesign")
    ).toBe(true)
  })

  it("is case-insensitive", () => {
    expect(matches(entry({ title: "Invoicing" }), { ...base, text: "INVOIC" }, noNames)).toBe(
      true
    )
  })

  it("distinguishes 'no project' from 'any project'", () => {
    const none = entry()
    const some = entry({ projectId: "p1" as never })
    expect(matches(none, { ...base, projectId: "" }, noNames)).toBe(true)
    expect(matches(some, { ...base, projectId: "" }, noNames)).toBe(false)
    expect(matches(some, { ...base, projectId: "p1" }, noNames)).toBe(true)
  })

  it("finds entries with no note", () => {
    expect(matches(entry({ note: undefined }), { ...base, presets: ["no-note"] }, noNames)).toBe(
      true
    )
    expect(
      matches(entry({ note: "   " }), { ...base, presets: ["no-note"] }, noNames)
    ).toBe(true)
    expect(
      matches(entry({ note: "real" }), { ...base, presets: ["no-note"] }, noNames)
    ).toBe(false)
  })

  it("treats 'under a minute' as strictly under", () => {
    // The chip exists to find mis-starts. An exact 60s entry is not one.
    const chip = { ...base, presets: ["under-a-minute" as const] }
    expect(matches(entry({ durationMs: 59_999 }), chip, noNames)).toBe(true)
    expect(matches(entry({ durationMs: 60_000 }), chip, noNames)).toBe(false)
  })

  it("combines presets with AND", () => {
    const both = { ...base, presets: ["no-project" as const, "no-note" as const] }
    expect(matches(entry(), both, noNames)).toBe(true)
    expect(matches(entry({ note: "x" }), both, noNames)).toBe(false)
    expect(matches(entry({ projectId: "p1" as never }), both, noNames)).toBe(false)
  })

  it("knows when nothing but the date range is active", () => {
    expect(hasClientSideFilter(base)).toBe(false)
    expect(hasClientSideFilter({ ...base, text: "  " })).toBe(false)
    expect(hasClientSideFilter({ ...base, text: "x" })).toBe(true)
    expect(hasClientSideFilter({ ...base, billableOnly: true })).toBe(true)
  })
})
