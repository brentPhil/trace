import { lineAmountCents } from "@shared/invoiceMath"
import type { ProjectColor } from "@shared/palette"

/**
 * Everything the landing page's fragments draw, in one place.
 *
 * FICTIONAL, deliberately: this is a public page, and no real client or
 * project name belongs on it. Amounts go through `lineAmountCents` rather than
 * being typed in, so the sample invoice obeys the same rule a real one does —
 * see sample-data.test.ts.
 */

export type SampleProject = {
  name: string
  color: ProjectColor
  archived: boolean
}

export const PROJECTS = {
  harbour: { name: "Harbour Studio", color: "teal", archived: false },
  northwind: { name: "Northwind Books", color: "indigo", archived: false },
  internal: { name: "Internal", color: "slate", archived: false },
} satisfies Record<string, SampleProject>

/** Starts at 1:47:12 rather than 0:00:00, so the first paint looks like a real day. */
export const RUNNING_ENTRY = {
  title: "[HS-44] Booking flow: mobile date picker",
  project: PROJECTS.harbour,
  elapsedSeconds: 6432,
}

export type SampleEntry = {
  title: string
  project: SampleProject
  /** Minutes after midnight. */
  startMinute: number
  endMinute: number
  note: string | null
}

export const DAY: { label: string; entries: ReadonlyArray<SampleEntry> } = {
  label: "Tuesday, 15 September",
  entries: [
    {
      title: "[HS-41] Homepage hero, second pass",
      project: PROJECTS.harbour,
      startMinute: 9 * 60 + 2,
      endMinute: 10 * 60 + 48,
      note: "Moved the booking button above the fold. Client wants the old photo back.",
    },
    {
      title: "Weekly check-in",
      project: PROJECTS.northwind,
      startMinute: 10 * 60 + 55,
      endMinute: 11 * 60 + 25,
      note: null,
    },
    {
      title: "[NB-12] Catalogue import script",
      project: PROJECTS.northwind,
      startMinute: 11 * 60 + 30,
      endMinute: 13 * 60 + 10,
      note: "Import now skips duplicate ISBNs and lists them at the end.",
    },
    {
      title: "[HS-43] Booking flow: time slots",
      project: PROJECTS.harbour,
      startMinute: 14 * 60,
      endMinute: 15 * 60 + 35,
      note: "Slots respect the studio's closing time. Timezones still to check.",
    },
    {
      title: "September invoices",
      project: PROJECTS.internal,
      startMinute: 15 * 60 + 40,
      endMinute: 16 * 60 + 52,
      note: "Both sent. Northwind asked for line-level notes, which are already on it.",
    },
  ],
}

const HOUR_MS = 3_600_000

export const WEEK = {
  days: [
    { label: "Mon", ms: 6 * HOUR_MS + 42 * 60_000 },
    { label: "Tue", ms: 7 * HOUR_MS + 12 * 60_000 },
    { label: "Wed", ms: 0 },
    { label: "Thu", ms: 6 * HOUR_MS + 24 * 60_000 },
    { label: "Fri", ms: 5 * HOUR_MS + 30 * 60_000 },
  ],
  /** 21.50 hours, in the hundredths an invoice line is stored in. */
  billableCentis: 2150,
  entryCount: 23,
  rateCents: 9000,
} as const

export type SampleInvoiceLine = {
  kind: "time"
  description: string
  quantityCentis: number
  unitCents: number
  amountCents: number
}

function timeLine(
  description: string,
  quantityCentis: number
): SampleInvoiceLine {
  return {
    kind: "time",
    description,
    quantityCentis,
    unitCents: WEEK.rateCents,
    amountCents: lineAmountCents(quantityCentis, WEEK.rateCents),
  }
}

export const INVOICE = {
  number: "2026-014",
  client: "Northwind Books",
  currency: "USD",
  lines: [
    timeLine("Catalogue import script", 1250),
    timeLine("Search results page", 675),
    timeLine("Weekly check-ins", 400),
  ],
} as const
