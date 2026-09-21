# Landing Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the three-line signed-out page at `/` with a landing page that shows Chroneli working through four inert "live fragments" and states, accurately, what it does.

**Architecture:** `src/routes/index.tsx` keeps its `beforeLoad` redirect and renders `<LandingPage />`. The page lives in `src/components/landing/`: one static sample-data module feeds four presentational fragments (timer bar, day log, report readout, invoice), each an `inert` illustration beside a block of prose. The invoice fragment reuses the real `InvoiceLines`; the others copy the real components' utility strings and name the component they mirror.

**Tech Stack:** React 19, TanStack Router/Start, Tailwind v4, shadcn (Base UI) `buttonVariants`, lucide-react, Vitest (`unit` = node for `*.test.ts`, `dom` = jsdom for `*.test.tsx`), Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-21-landing-page-design.md`

## Global Constraints

- Read `DESIGN.md` before touching anything visual. Standard tokens only: **no new colour token, no edit to `src/styles.css`**, no gradients, no glow, no shadow.
- **Do not edit anything in `src/components/ui/`.** Override at the call site with `className`.
- Every digit the user reads: `font-mono tabular-nums tracking-[-0.02em]` (The Tabular Rule).
- Sentence case everywhere. No uppercase tracked-out eyebrow labels.
- Absence is `HATCH_EMPTY` from `src/lib/hatch.ts`, never a colour.
- No page measure. Prose is capped where the prose is: copy blocks `max-w-[60ch]`, hero headline `max-w-[20ch] text-balance`. Blocks are left-flush with `px-4`; never `mx-auto`.
- Every fragment root carries `inert` and `data-landing-fragment="<name>"`.
- The only motion is the ticking duration, driven by `useSecond()` — **no `setInterval`, no counter**. Nothing animates in.
- **Copy is part of the spec. Do not "improve" it.** In particular: offline and Google Calendar are claimed for the web app only; the invoice claim is "every line prints hours × rate", never "never rounds"; the only business claim is "Free".
- Sample data uses fictional names only: "Harbour Studio", "Northwind Books", "Internal".
- Run commands with `pnpm`. Tests: `pnpm vitest run <path>`.
- Commit messages end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/desktop-release.ts` (create) | The two public desktop URLs, named once |
| `src/components/landing/sample-data.ts` (create) | Every sample value the fragments draw |
| `src/components/landing/sample-data.test.ts` (create) | Sample data is internally consistent |
| `src/components/landing/fragments/timer-bar.tsx` (create) | Recording timer bar, ticking |
| `src/components/landing/fragments/timer-bar.test.tsx` (create) | Tick + inert |
| `src/components/landing/fragments/day-log.tsx` (create) | One day of entry rows with notes and one hatch |
| `src/components/landing/fragments/report-readout.tsx` (create) | Four figures + monochrome week strip |
| `src/components/landing/fragments/invoice.tsx` (create) | `InvoiceLines` over sample lines |
| `src/components/landing/fragments/fragments.test.tsx` (create) | Day log, readout, invoice render what they claim |
| `src/components/landing/landing-header.tsx` (create) | Wordmark + auth links |
| `src/components/landing/landing-page.tsx` (create) | The sections, in order, and all page copy |
| `src/routes/index.tsx` (modify) | Render `LandingPage`, add description meta |
| `src/routes/-index.test.tsx` (create) | Redirect, links, headings, inert fragments |

---

### Task 1: Sample data and desktop URLs

**Files:**
- Create: `src/lib/desktop-release.ts`
- Create: `src/components/landing/sample-data.ts`
- Test: `src/components/landing/sample-data.test.ts`

**Interfaces:**
- Consumes: `lineAmountCents(quantityCentis: number, unitCents: number): number` from `@shared/invoiceMath`; `ProjectColor` from `@shared/palette`.
- Produces:
  - `DESKTOP_RELEASES_URL: string`, `DESKTOP_INSTALL_URL: string`
  - `type SampleProject = { name: string; color: ProjectColor; archived: boolean }`
  - `PROJECTS: { harbour: SampleProject; northwind: SampleProject; internal: SampleProject }`
  - `RUNNING_ENTRY: { title: string; project: SampleProject; elapsedSeconds: number }` (elapsedSeconds = 6432, i.e. `1:47:12`)
  - `type SampleEntry = { title: string; project: SampleProject; startMinute: number; endMinute: number; note: string | null }`
  - `DAY: { label: string; entries: ReadonlyArray<SampleEntry> }`
  - `WEEK: { days: ReadonlyArray<{ label: string; ms: number }>; billableCentis: number; entryCount: number; rateCents: number }`
  - `type SampleInvoiceLine = { kind: "time"; description: string; quantityCentis: number; unitCents: number; amountCents: number }`
  - `INVOICE: { number: string; client: string; currency: "USD"; lines: ReadonlyArray<SampleInvoiceLine> }`

- [ ] **Step 1: Write the failing test**

`src/components/landing/sample-data.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { lineAmountCents } from "@shared/invoiceMath"
import { DAY, INVOICE, RUNNING_ENTRY, WEEK } from "./sample-data"

/*
 * The landing page prints these numbers to strangers. A sample invoice whose
 * amounts disagree with the rule the real invoice uses would be the page
 * contradicting its own claim ("every line prints hours × rate").
 */
describe("landing sample data", () => {
  it("prices every invoice line with the real invoice rule", () => {
    for (const line of INVOICE.lines) {
      expect(line.amountCents).toBe(lineAmountCents(line.quantityCentis, line.unitCents))
    }
  })

  it("has exactly one entry without a note, so the hatch is shown once", () => {
    expect(DAY.entries.filter((e) => e.note === null)).toHaveLength(1)
  })

  it("lays the day out in order with no overlaps", () => {
    for (const [i, e] of DAY.entries.entries()) {
      expect(e.endMinute).toBeGreaterThan(e.startMinute)
      const next = DAY.entries[i + 1]
      if (next) expect(next.startMinute).toBeGreaterThanOrEqual(e.endMinute)
    }
  })

  it("has exactly one empty day in the week strip", () => {
    expect(WEEK.days.filter((d) => d.ms === 0)).toHaveLength(1)
  })

  it("never bills more than was tracked", () => {
    const trackedMs = WEEK.days.reduce((sum, d) => sum + d.ms, 0)
    // centis are hundredths of an hour: 36_000 ms each
    expect(WEEK.billableCentis * 36_000).toBeLessThanOrEqual(trackedMs)
  })

  it("starts the running timer at 1:47:12", () => {
    expect(RUNNING_ENTRY.elapsedSeconds).toBe(1 * 3600 + 47 * 60 + 12)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/components/landing/sample-data.test.ts`
Expected: FAIL — `Failed to resolve import "./sample-data"`.

- [ ] **Step 3: Write the implementation**

`src/lib/desktop-release.ts`:

```ts
/**
 * The desktop app's two public URLs, named once.
 *
 * `DESKTOP_RELEASES_URL` 404s until a GitHub release has been PUBLISHED —
 * `desktop.yml` only ever creates drafts (see docs/desktop.md → Releasing).
 * Publishing one is a precondition for deploying the landing page. Kept here
 * rather than in `@shared/brand` because nothing in Convex needs it, and
 * `convex/lib` is the shared layer only for what Convex does need.
 */
export const DESKTOP_RELEASES_URL = "https://github.com/brentPhil/trace/releases/latest"

/** The unsigned-install steps, which have one home and should keep it. */
export const DESKTOP_INSTALL_URL =
  "https://github.com/brentPhil/trace/blob/master/docs/desktop.md#unsigned-installs"
```

`src/components/landing/sample-data.ts`:

```ts
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

export type SampleProject = { name: string; color: ProjectColor; archived: boolean }

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

function timeLine(description: string, quantityCentis: number): SampleInvoiceLine {
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/components/landing/sample-data.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/desktop-release.ts src/components/landing/sample-data.ts src/components/landing/sample-data.test.ts
git commit -m "feat(landing): sample data and desktop URLs" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Timer bar fragment

**Files:**
- Create: `src/components/landing/fragments/timer-bar.tsx`
- Test: `src/components/landing/fragments/timer-bar.test.tsx`

**Interfaces:**
- Consumes: `RUNNING_ENTRY` (Task 1); `useSecond(): number | null` from `@/hooks/use-clock`; `formatClock(ms: number): string` from `@shared/duration`; `ProjectDot` from `@/components/classifiers/project-dot`.
- Produces: `TimerBarFragment({ className?: string })`. Root has `data-landing-fragment="timer"` and `inert`; the duration element has `data-landing-elapsed`.

- [ ] **Step 1: Write the failing test**

`src/components/landing/fragments/timer-bar.test.tsx` (its own file: the clock store is module-level, and this test needs it untouched by other renders):

```tsx
import { act, cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { TimerBarFragment } from "./timer-bar"

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe("TimerBarFragment", () => {
  it("opens at the sample value and advances with the wall clock", () => {
    vi.useFakeTimers()
    const { container } = render(<TimerBarFragment />)
    const elapsed = () =>
      container.querySelector("[data-landing-elapsed]")?.textContent

    expect(elapsed()).toBe("1:47:12")

    act(() => {
      vi.advanceTimersByTime(3000)
    })

    // The clock store aligns to wall-clock second boundaries, so the exact
    // figure depends on where in the second the test started. It must have
    // moved, and by seconds, not minutes.
    expect(elapsed()).not.toBe("1:47:12")
    expect(elapsed()).toMatch(/^1:47:1[3-9]$/)
  })

  it("is an inert illustration", () => {
    const { container } = render(<TimerBarFragment />)
    const root = container.querySelector('[data-landing-fragment="timer"]')
    expect(root?.hasAttribute("inert")).toBe(true)
  })

  it("shows the recording state without relying on colour", () => {
    const { container } = render(<TimerBarFragment />)
    expect(container.textContent).toContain("Harbour Studio")
    expect(container.textContent).toContain("Billable")
    expect(container.querySelector("svg.lucide-square")).not.toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/components/landing/fragments/timer-bar.test.tsx`
Expected: FAIL — `Failed to resolve import "./timer-bar"`.

- [ ] **Step 3: Write the implementation**

`src/components/landing/fragments/timer-bar.tsx`:

```tsx
import { useState } from "react"
import { DollarSign, Square } from "lucide-react"
import { ProjectDot } from "@/components/classifiers/project-dot"
import { useSecond } from "@/hooks/use-clock"
import { cn } from "@/lib/utils"
import { formatClock } from "@shared/duration"
import { RUNNING_ENTRY } from "../sample-data"

/**
 * MIRRORS src/components/timer/timer-bar.tsx in its RECORDING state — the
 * `border-primary` boundary, the 42px `--primary` disc showing the stop glyph,
 * the mono duration, and the footer strip with project and billable. If that
 * file's strings change, change these.
 *
 * Not the real component: TimerBar brings popovers, ManualEntryDialog, inline
 * editors and the `useAnnounce` context, none of which belong inside an inert
 * illustration on a signed-out page.
 *
 * THE TICK READS THE APP'S CLOCK, never a counter (src/lib/clock.ts: "never
 * accumulate"). `useSecond()` is null during server rendering and hydration,
 * so both paint the fixed sample value and agree; from the first real second
 * on, the figure is the sample value plus the seconds since then. It keeps
 * ticking under reduced motion, as the app's does — a running duration is
 * state, not decoration.
 */
export function TimerBarFragment({ className }: { className?: string }) {
  const second = useSecond()
  const [firstSecond, setFirstSecond] = useState<number | null>(second)
  // Adjusting state during render, React's documented pattern for "remember
  // the first value seen" — no effect, so no frame where it is missing.
  if (second !== null && firstSecond === null) setFirstSecond(second)

  const elapsedSeconds =
    RUNNING_ENTRY.elapsedSeconds +
    (second !== null && firstSecond !== null ? second - firstSecond : 0)

  return (
    <div
      data-landing-fragment="timer"
      inert
      className={cn("flex flex-col rounded-md border border-primary bg-card", className)}
    >
      <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 sm:px-4 sm:py-3">
        <span className="min-w-[7rem] flex-1 truncate pr-2 text-base sm:text-lg">
          {RUNNING_ENTRY.title}
        </span>
        <span
          data-landing-elapsed
          className="font-mono text-lg tabular-nums tracking-[-0.02em] text-primary"
        >
          {formatClock(elapsedSeconds * 1000)}
        </span>
        <span className="flex size-[42px] shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Square className="size-4 fill-current" />
        </span>
      </div>
      <div className="flex items-center gap-3 border-t border-border px-4 py-1.5">
        <ProjectDot project={RUNNING_ENTRY.project} />
        <span className="flex items-center gap-1 text-xs text-foreground">
          <DollarSign className="size-3.5" />
          Billable
        </span>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/components/landing/fragments/timer-bar.test.tsx`
Expected: PASS, 3 tests. If the first test reads `1:47:12` after advancing, confirm `vi.useFakeTimers()` runs before `render` (the store schedules on subscribe). Do not replace `useSecond` with an interval to make it pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/landing/fragments/timer-bar.tsx src/components/landing/fragments/timer-bar.test.tsx
git commit -m "feat(landing): recording timer bar fragment" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Day log, report readout and invoice fragments

**Files:**
- Create: `src/components/landing/fragments/day-log.tsx`
- Create: `src/components/landing/fragments/report-readout.tsx`
- Create: `src/components/landing/fragments/invoice.tsx`
- Test: `src/components/landing/fragments/fragments.test.tsx`

**Interfaces:**
- Consumes: `DAY`, `WEEK`, `INVOICE` (Task 1); `HATCH_EMPTY` from `@/lib/hatch`; `formatClock`, `formatCompactDuration` from `@shared/duration`; `formatMoney(cents, currency)` from `@shared/money`; `lineAmountCents` from `@shared/invoiceMath`; `InvoiceLines({ lines, currency, taxes })` from `@/components/invoices/invoice-lines`; `ProjectDot`.
- Produces: `DayLogFragment`, `ReportReadoutFragment`, `InvoiceFragment`, each `({ className?: string })`, roots with `inert` and `data-landing-fragment` = `"day-log"`, `"report"`, `"invoice"`. Hatched elements carry `data-hatched`.

- [ ] **Step 1: Write the failing test**

`src/components/landing/fragments/fragments.test.tsx`:

```tsx
import { cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { DayLogFragment } from "./day-log"
import { InvoiceFragment } from "./invoice"
import { ReportReadoutFragment } from "./report-readout"

afterEach(cleanup)

describe("DayLogFragment", () => {
  it("draws five rows, with the one noteless row hatched", () => {
    const { container } = render(<DayLogFragment />)
    expect(container.querySelectorAll("li")).toHaveLength(5)
    expect(container.querySelectorAll("[data-hatched]")).toHaveLength(1)
    expect(container.textContent).toContain("Import now skips duplicate ISBNs")
  })

  it("totals the day from its rows", () => {
    const { container } = render(<DayLogFragment />)
    // 106 + 30 + 100 + 95 + 72 = 403 minutes
    expect(container.textContent).toContain("6h 43m")
  })

  it("is inert", () => {
    const { container } = render(<DayLogFragment />)
    expect(
      container.querySelector('[data-landing-fragment="day-log"]')?.hasAttribute("inert")
    ).toBe(true)
  })
})

describe("ReportReadoutFragment", () => {
  it("shows the four figures the real readout shows, computed from the week", () => {
    const { container } = render(<ReportReadoutFragment />)
    const labels = [...container.querySelectorAll("dt")].map((d) => d.textContent)
    expect(labels).toEqual(["Tracked", "Billable", "Earned", "Entries"])
    expect(container.textContent).toContain("25h 48m")
    expect(container.textContent).toContain("21h 30m")
    expect(container.textContent).toContain("$1,935.00")
  })

  it("hatches the empty day instead of leaving a gap", () => {
    const { container } = render(<ReportReadoutFragment />)
    expect(container.querySelectorAll("[data-hatched]")).toHaveLength(1)
  })
})

describe("InvoiceFragment", () => {
  it("prints hours × rate and the total through the real InvoiceLines", () => {
    const { container } = render(<InvoiceFragment />)
    expect(container.textContent).toContain("Catalogue import script")
    expect(container.textContent).toContain("12.50")
    // 1125.00 + 607.50 + 360.00
    expect(container.textContent).toContain("$2,092.50")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/components/landing/fragments/fragments.test.tsx`
Expected: FAIL — `Failed to resolve import "./day-log"`.

- [ ] **Step 3: Write the day log**

`src/components/landing/fragments/day-log.tsx`:

```tsx
import { ProjectDot } from "@/components/classifiers/project-dot"
import { HATCH_EMPTY } from "@/lib/hatch"
import { cn } from "@/lib/utils"
import { formatClock, formatCompactDuration } from "@shared/duration"
import { DAY } from "../sample-data"

/**
 * MIRRORS src/components/entries/entry-row.tsx and note-line.tsx: a 54px row
 * (`min-h-(--entry-row-height)`), the title at the Title role with its project
 * beside it, the note line under it, and the mono duration pinned right. The
 * noteless row wears `HATCH_EMPTY` exactly as the log's add-note trigger does.
 * If those files' strings change, change these.
 */
export function DayLogFragment({ className }: { className?: string }) {
  const totalMinutes = DAY.entries.reduce((sum, e) => sum + (e.endMinute - e.startMinute), 0)

  return (
    <div
      data-landing-fragment="day-log"
      inert
      className={cn("rounded-lg border border-border bg-background", className)}
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-2 text-sm">
        <span className="font-medium">{DAY.label}</span>
        <span className="font-mono tabular-nums tracking-[-0.02em] text-muted-foreground">
          {formatCompactDuration(totalMinutes * 60_000)}
        </span>
      </div>
      <ul>
        {DAY.entries.map((entry) => (
          <li
            key={entry.title}
            className="flex min-h-(--entry-row-height) items-center gap-4 px-4 py-1.5"
          >
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate text-base font-medium tracking-[-0.01em]">
                  {entry.title}
                </span>
                <ProjectDot project={entry.project} className="shrink-0" />
              </div>
              {entry.note === null ? (
                <span
                  data-hatched
                  className={cn(
                    HATCH_EMPTY,
                    "h-5 self-start rounded-sm px-1.5 text-xs text-muted-foreground/70"
                  )}
                >
                  Add note
                </span>
              ) : (
                <p className="truncate text-xs text-muted-foreground">{entry.note}</p>
              )}
            </div>
            <span className="hidden font-mono text-sm tabular-nums tracking-[-0.02em] text-muted-foreground sm:inline">
              {clockLabel(entry.startMinute)} – {clockLabel(entry.endMinute)}
            </span>
            <span className="w-16 shrink-0 text-right font-mono text-sm tabular-nums tracking-[-0.02em]">
              {formatClock((entry.endMinute - entry.startMinute) * 60_000)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** `9:02`, `13:10`. Sample times only; the app formats by the user's setting. */
function clockLabel(minute: number): string {
  return `${Math.floor(minute / 60)}:${String(minute % 60).padStart(2, "0")}`
}
```

- [ ] **Step 4: Write the report readout**

`src/components/landing/fragments/report-readout.tsx`:

```tsx
import { HATCH_EMPTY } from "@/lib/hatch"
import { cn } from "@/lib/utils"
import { formatCompactDuration } from "@shared/duration"
import { lineAmountCents } from "@shared/invoiceMath"
import { formatMoney } from "@shared/money"
import { WEEK } from "../sample-data"

const CENTI_MS = 36_000

/**
 * MIRRORS src/components/reports/summary-panel.tsx's readout — four
 * label-figure pairs between two hairlines, on the page's own background,
 * NOT tiles — and the daily chart's monochrome bars, with the empty day
 * hatched rather than left as bare axis (DESIGN.md §5 Charts).
 *
 * Earned is priced with `lineAmountCents`, the rule /reports and the invoice
 * share since 89d7b64.
 */
export function ReportReadoutFragment({ className }: { className?: string }) {
  const trackedMs = WEEK.days.reduce((sum, d) => sum + d.ms, 0)
  const maxMs = Math.max(...WEEK.days.map((d) => d.ms))
  const figures = [
    { label: "Tracked", value: formatCompactDuration(trackedMs) },
    { label: "Billable", value: formatCompactDuration(WEEK.billableCentis * CENTI_MS) },
    {
      label: "Earned",
      value: formatMoney(lineAmountCents(WEEK.billableCentis, WEEK.rateCents), "USD"),
    },
    { label: "Entries", value: String(WEEK.entryCount) },
  ]

  return (
    <div data-landing-fragment="report" inert className={cn("flex flex-col gap-6", className)}>
      <dl className="grid grid-cols-2 gap-x-8 gap-y-4 border-y border-border py-3 sm:grid-cols-4">
        {figures.map((f) => (
          <div key={f.label} className="flex min-w-0 flex-col gap-0.5">
            <dt className="text-xs text-muted-foreground">{f.label}</dt>
            <dd className="font-mono text-xl leading-tight tabular-nums tracking-[-0.02em] text-foreground">
              {f.value}
            </dd>
          </div>
        ))}
      </dl>
      <div className="flex h-32 items-stretch gap-3">
        {WEEK.days.map((d) => (
          <div key={d.label} className="flex flex-1 flex-col justify-end gap-1.5">
            {d.ms === 0 ? (
              <div data-hatched className={cn(HATCH_EMPTY, "h-2 w-full rounded-sm")} />
            ) : (
              <div
                className="w-full rounded-sm bg-foreground/80"
                style={{ height: `${(d.ms / maxMs) * 100}px` }}
              />
            )}
            <span className="text-center text-xs text-muted-foreground">{d.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Write the invoice**

`src/components/landing/fragments/invoice.tsx`:

```tsx
import { InvoiceLines } from "@/components/invoices/invoice-lines"
import { cn } from "@/lib/utils"
import { INVOICE } from "../sample-data"

/**
 * The REAL `InvoiceLines`, not a copy. This is the fragment whose arithmetic
 * the page makes a promise about ("every line prints hours × rate"), so it
 * draws through the same table the record, the preview and the PDF use.
 */
export function InvoiceFragment({ className }: { className?: string }) {
  return (
    <div
      data-landing-fragment="invoice"
      inert
      className={cn("flex flex-col gap-3 rounded-lg border border-border bg-background p-4", className)}
    >
      <div className="flex items-baseline justify-between gap-4 text-sm">
        <span className="font-medium">{INVOICE.client}</span>
        <span className="font-mono tabular-nums tracking-[-0.02em] text-muted-foreground">
          {INVOICE.number}
        </span>
      </div>
      <InvoiceLines lines={INVOICE.lines} currency={INVOICE.currency} taxes={[]} />
    </div>
  )
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm vitest run src/components/landing/fragments/fragments.test.tsx`
Expected: PASS, 6 tests. If the `$2,092.50` or `12.50` assertion fails, print `container.textContent` and check how `InvoiceLines` formats quantity (`quantityText`) and the total row — adjust the **expected string** to the real format, never the component.

- [ ] **Step 7: Commit**

```bash
git add src/components/landing/fragments/
git commit -m "feat(landing): day log, report readout and invoice fragments" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: The page, the header and the route

**Files:**
- Create: `src/components/landing/landing-header.tsx`
- Create: `src/components/landing/landing-page.tsx`
- Modify: `src/routes/index.tsx` (whole file)
- Test: `src/routes/-index.test.tsx`

**Interfaces:**
- Consumes: all four fragments (Tasks 2–3); `DESKTOP_RELEASES_URL`, `DESKTOP_INSTALL_URL` (Task 1); `APP_NAME` from `@shared/brand`; `buttonVariants` from `@/components/ui/button`.
- Produces: `LandingHeader()`, `LandingPage()`, `LANDING_DESCRIPTION: string` (exported from `landing-page.tsx`).

- [ ] **Step 1: Write the failing test**

`src/routes/-index.test.tsx`:

```tsx
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { isRedirect } from "@tanstack/react-router"
import { LandingPage } from "@/components/landing/landing-page"
import { DESKTOP_RELEASES_URL } from "@/lib/desktop-release"
import { Route } from "@/routes/index"
import type * as RouterModuleType from "@tanstack/react-router"

type RouterModule = typeof RouterModuleType

// Link needs a router instance; these tests are about where links point, not
// about routing. Same stand-in as -desktop-login-screen.test.tsx.
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<RouterModule>()
  return {
    ...actual,
    Link: ({
      to,
      children,
      search: _search,
      params: _params,
      ...props
    }: {
      to: string
      children: React.ReactNode
      search?: unknown
      params?: unknown
    } & React.ComponentProps<"a">) => (
      <a href={to} {...props}>
        {children}
      </a>
    ),
  }
})

afterEach(cleanup)

describe("/ beforeLoad", () => {
  it("sends a signed-in visitor straight to /timer", () => {
    let thrown: unknown
    try {
      Route.options.beforeLoad?.({ context: { isAuthenticated: true } } as never)
    } catch (error) {
      thrown = error
    }
    expect(isRedirect(thrown)).toBe(true)
    expect((thrown as { options: { to?: string } }).options.to).toBe("/timer")
  })

  it("lets a signed-out visitor through", () => {
    expect(() =>
      Route.options.beforeLoad?.({ context: { isAuthenticated: false } } as never)
    ).not.toThrow()
  })
})

describe("LandingPage", () => {
  it("points all three Create account links at /signup and all three Sign in links at /login", () => {
    render(<LandingPage />)
    const create = screen.getAllByRole("link", { name: "Create account" })
    const signIn = screen.getAllByRole("link", { name: "Sign in" })
    expect(create).toHaveLength(3)
    expect(signIn).toHaveLength(3)
    for (const a of create) expect(a.getAttribute("href")).toBe("/signup")
    for (const a of signIn) expect(a.getAttribute("href")).toBe("/login")
  })

  it("links the desktop download to the releases page", () => {
    render(<LandingPage />)
    expect(
      screen.getByRole("link", { name: /download for windows or macos/i }).getAttribute("href")
    ).toBe(DESKTOP_RELEASES_URL)
  })

  it("has exactly one h1", () => {
    render(<LandingPage />)
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1)
  })

  it("renders all four fragments, every one inert", () => {
    const { container } = render(<LandingPage />)
    const fragments = container.querySelectorAll("[data-landing-fragment]")
    expect(fragments).toHaveLength(4)
    for (const f of fragments) expect(f.hasAttribute("inert")).toBe(true)
  })

  it("scopes offline and Calendar to the web app, and never promises no rounding", () => {
    const { container } = render(<LandingPage />)
    const text = container.textContent ?? ""
    expect(text).toContain("Works offline in the browser")
    expect(text).not.toMatch(/never (silently )?rounds/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/routes/-index.test.tsx`
Expected: FAIL — `Failed to resolve import "@/components/landing/landing-page"`.

- [ ] **Step 3: Write the header**

`src/components/landing/landing-header.tsx`:

```tsx
import { Link } from "@tanstack/react-router"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { APP_NAME } from "@shared/brand"

/**
 * A HEADER, NOT NAVIGATION. DESIGN.md §5 says navigation is a left rail and
 * never a top nav; that rule is about moving around inside the product. This
 * bar holds the wordmark and two ways in, and nothing that navigates within
 * the app, so it is not precedent for an app page.
 *
 * No theme control: `ThemeChoice` is a three-way tab strip built for the
 * sidebar popup, and a visitor gets the system preference, which is the app's
 * default anyway.
 */
export function LandingHeader() {
  return (
    <header className="flex h-14 items-center justify-between gap-4 border-b border-border px-4">
      <span className="text-base font-medium tracking-tight">{APP_NAME}</span>
      <div className="flex items-center gap-2">
        <Link
          to="/login"
          search={{ redirect: undefined }}
          className={cn(buttonVariants({ variant: "ghost" }))}
        >
          Sign in
        </Link>
        <Link
          to="/signup"
          search={{ redirect: undefined }}
          className={cn(buttonVariants())}
        >
          Create account
        </Link>
      </div>
    </header>
  )
}
```

- [ ] **Step 4: Write the page**

`src/components/landing/landing-page.tsx`:

```tsx
import { Link } from "@tanstack/react-router"
import { buttonVariants } from "@/components/ui/button"
import { DESKTOP_INSTALL_URL, DESKTOP_RELEASES_URL } from "@/lib/desktop-release"
import { cn } from "@/lib/utils"
import { APP_NAME } from "@shared/brand"
import { DayLogFragment } from "./fragments/day-log"
import { InvoiceFragment } from "./fragments/invoice"
import { ReportReadoutFragment } from "./fragments/report-readout"
import { TimerBarFragment } from "./fragments/timer-bar"
import { LandingHeader } from "./landing-header"

export const LANDING_DESCRIPTION =
  "A time tracker that records what you got done, not only how long it took. Free."

/*
 * NO PAGE MEASURE (DESIGN.md §3, The One Measure Rule). The page takes the full
 * width; prose is capped where the prose is (`PROSE`), and each section is a
 * two-column grid at `lg` that stacks, copy first, below it.
 *
 * COPY IS SPEC (docs/superpowers/specs/2026-09-21-landing-page-design.md).
 * Offline and Google Calendar are claimed for the web app only — both are
 * unverified or broken in the macOS desktop app. The invoice claim is "hours ×
 * rate", never "never rounds": invoices floor hours to hundredths.
 */
const PROSE = "max-w-[60ch] text-base leading-relaxed text-muted-foreground"
const SECTION =
  "grid gap-8 px-4 py-16 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:items-center lg:gap-12"
const H2 = "text-xl font-medium tracking-[-0.01em] text-foreground"
const LINK = "underline underline-offset-4 hover:text-foreground"

function CallToAction() {
  return (
    <div className="flex flex-wrap gap-3">
      <Link to="/signup" search={{ redirect: undefined }} className={cn(buttonVariants())}>
        Create account
      </Link>
      <Link
        to="/login"
        search={{ redirect: undefined }}
        className={cn(buttonVariants({ variant: "outline" }))}
      >
        Sign in
      </Link>
    </div>
  )
}

const FACTS = [
  {
    label: "Works offline in the browser",
    body: (
      <>
        Starting, stopping and editing entries keep working without a connection, and
        sync in order when you are back. Raising an invoice needs the network.
      </>
    ),
  },
  {
    label: "Google Calendar",
    body: (
      <>
        Link a calendar in the web app and its meetings appear on your day in the
        calendar view, where one can be tracked without retyping it.
      </>
    ),
  },
  {
    label: "Desktop app",
    body: (
      <>
        {APP_NAME} also runs as an app on Windows and macOS.{" "}
        <a className={LINK} href={DESKTOP_RELEASES_URL}>
          Download for Windows or macOS
        </a>
        . The builds are unsigned, so the first launch needs{" "}
        <a className={LINK} href={DESKTOP_INSTALL_URL}>
          one extra step
        </a>
        .
      </>
    ),
  },
  {
    label: "Yours to set up",
    body: (
      <>
        Light and dark, a set of theme presets, and keyboard shortcuts. Press{" "}
        <kbd className="rounded-sm border border-border px-1 font-mono text-xs">?</kbd>{" "}
        in the app to see them all.
      </>
    ),
  },
]

export function LandingPage() {
  return (
    <div className="min-h-svh bg-background text-foreground">
      <LandingHeader />

      <main>
        <section className={SECTION}>
          <div className="flex flex-col gap-6">
            <h1 className="max-w-[20ch] text-[clamp(2rem,5vw,3.25rem)] leading-[1.1] font-medium tracking-[-0.01em] text-balance">
              Know where the day went. And what you did with it.
            </h1>
            <p className={PROSE}>
              {APP_NAME} turns the hours you track into invoices, and the notes you write
              along the way into the account behind them.
            </p>
            <div className="flex flex-col gap-3">
              <CallToAction />
              <p className="text-sm text-muted-foreground">Free. No card.</p>
            </div>
          </div>
          <TimerBarFragment />
        </section>

        <section className="border-y border-border bg-card">
          <div className={SECTION}>
            <div className="flex flex-col gap-4">
              <h2 className={H2}>The note is the product.</h2>
              <p className={PROSE}>
                Every entry has a title, and room for a line about what actually happened.
                A conventional tracker gives you a number and no memory. The hours alone
                cannot answer what you did on Tuesday, which is exactly what an invoice, a
                standup or a client asks.
              </p>
            </div>
            <DayLogFragment />
          </div>
        </section>

        <section className={SECTION}>
          <div className="flex flex-col gap-4">
            <h2 className={H2}>Where the period went.</h2>
            <p className={PROSE}>
              Reports searches your titles, notes and projects, filters by project,
              billable and date range, and exports to PDF, CSV or Excel.
            </p>
          </div>
          <ReportReadoutFragment />
        </section>

        <section className="border-t border-border">
          <div className={SECTION}>
            <div className="flex flex-col gap-4">
              <h2 className={H2}>From hours to an invoice.</h2>
              <p className={PROSE}>
                Pick a range in Reports and turn its billable hours into an invoice. Every
                line prints hours × rate, so your client can check the total with a
                calculator. Export it as a PDF.
              </p>
            </div>
            <InvoiceFragment />
          </div>
        </section>

        <section className="flex flex-col gap-6 border-t border-border px-4 py-16">
          <h2 className={H2}>What else it does.</h2>
          <dl className="divide-y divide-border border-y border-border">
            {FACTS.map((fact) => (
              <div
                key={fact.label}
                className="grid gap-1 py-4 sm:grid-cols-[14rem_minmax(0,1fr)] sm:gap-6"
              >
                <dt className="text-sm font-medium text-foreground">{fact.label}</dt>
                <dd className={cn(PROSE, "text-sm")}>{fact.body}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="flex flex-col gap-4 border-y border-border bg-card px-4 py-16">
          <h2 className={H2}>Start with today.</h2>
          <p className={PROSE}>Create an account and track your next hour. It is free.</p>
          <CallToAction />
        </section>
      </main>

      <footer className="flex items-center justify-between gap-4 px-4 py-6 text-xs text-muted-foreground">
        <span>{APP_NAME}</span>
        <span className="font-mono tabular-nums tracking-[-0.02em]">
          © {new Date().getFullYear()}
        </span>
      </footer>
    </div>
  )
}
```

- [ ] **Step 5: Replace the route**

`src/routes/index.tsx` (whole file — the `beforeLoad` and its comment are unchanged):

```tsx
import { createFileRoute, redirect } from "@tanstack/react-router"
import { LANDING_DESCRIPTION, LandingPage } from "@/components/landing/landing-page"

export const Route = createFileRoute("/")({
  head: () => ({ meta: [{ name: "description", content: LANDING_DESCRIPTION }] }),
  /**
   * Signed in means straight to the app.
   *
   * This is the one place worth doing it, rather than changing where `/login`
   * sends people. Sign-in, sign-up, an old bookmark and a typed bare domain all
   * arrive here, and `safeRedirect` falls back to `/` whenever a `?redirect=`
   * is absent or rejected — so fixing the login route alone would still leave
   * four ways to land on a page whose only content is a link to the real one.
   *
   * `beforeLoad` rather than the component: redirecting from render means the
   * interstitial is painted first and then replaced, which is the flash this
   * removes.
   */
  beforeLoad: ({ context }) => {
    if (context.isAuthenticated) throw redirect({ to: "/timer" })
  },
  /**
   * The signed-OUT landing page, and only that — `beforeLoad` above sends an
   * authenticated visitor to `/timer` before this renders. Someone whose
   * session is not recognised sees this page, and "Sign in" is the way back.
   */
  component: LandingPage,
})
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm vitest run src/routes/-index.test.tsx`
Expected: PASS, 7 tests. If the redirect test fails on the `options.to` shape, log `thrown` and read the shape `redirect()` actually returns in the installed `@tanstack/router-core`; fix the assertion's accessor, not the route.

- [ ] **Step 7: Commit**

```bash
git add src/components/landing/landing-header.tsx src/components/landing/landing-page.tsx src/routes/index.tsx src/routes/-index.test.tsx
git commit -m "feat(landing): the signed-out landing page" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Full checks and visual verification

**Files:** none created. Fix-ups go in the files from Tasks 1–4.

- [ ] **Step 1: Run the whole suite and the static checks**

```bash
pnpm typecheck
```
Expected: no errors. A likely one: `routeTree.gen.ts` is regenerated by the dev server, not by `tsc` — the route file's shape did not change, so none is expected.

```bash
pnpm lint
```
Expected: no errors in `src/components/landing/**` or `src/routes/index.tsx`.

```bash
pnpm check
```
Expected: pass. If Prettier reports the new files, run `pnpm exec prettier --write src/components/landing src/routes/index.tsx src/routes/-index.test.tsx src/lib/desktop-release.ts` and re-run.

```bash
pnpm test
```
Expected: all projects pass, including `src/styles.contrast.test.ts` (untouched, since no token was added).

- [ ] **Step 2: Verify in the browser**

Start the dev server with the preview tool, configuration `chroneli-dev` (port 3100, from `.claude/launch.json`). Load `http://localhost:3100/` while signed out. Check, and fix anything that fails before moving on:

1. Console has no errors and no hydration warning (the timer must not mismatch).
2. The duration ticks once a second and began at `1:47:12`.
3. Desktop width (1600px): each section is two columns; prose lines stop at ~60ch; nothing is centred; the left edge of every block lines up with the header's wordmark.
4. Mobile preset (375px): sections stack copy-first; no horizontal page scroll (the invoice table scrolls inside its own box, which is intended); the header's two buttons fit.
5. Dark colour scheme: every surface follows; the hatch is visible on both the day log and the week strip.
6. A non-default preset: set `data-theme="indigo"` on `<html>` via the JS tool; the primary boundary, disc and buttons take the preset, nothing stays neutral that should not (DESIGN.md's closing audit test).
7. Tab through the page: focus lands only on the header links, the CTAs, and the two desktop links — never inside a fragment.

Take one desktop and one mobile screenshot as proof.

- [ ] **Step 3: Commit any fix-ups**

```bash
git add -A src/components/landing src/routes/index.tsx src/routes/-index.test.tsx src/lib/desktop-release.ts
git commit -m "fix(landing): verification fix-ups" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```
Skip this step if nothing changed.

---

## Deviations from the spec

- **Day log notes:** the spec says two rows show a note and one is hatched, leaving two rows unspecified. In the app every noteless row shows the hatch, so a faithful fragment has four notes and one hatch. The plan does that.
- **Section 5 heading:** the spec's working title "The rest, stated plainly" is a spec label; the visible `h2` is "What else it does."
