import { Link } from "@tanstack/react-router"
import { buttonVariants } from "@/components/ui/button"
import {
  DESKTOP_INSTALL_URL,
  DESKTOP_RELEASES_URL,
} from "@/lib/desktop-release"
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
// An implicit auto column grows to its widest child's min-content width, so a
// fragment with non-wrapping rows would push the section, prose included, past a
// phone's edge. Use an explicit shrinkable column on small screens.
const SECTION =
  "grid grid-cols-[minmax(0,1fr)] gap-8 px-4 py-16 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:items-center lg:gap-12"
const H2 = "text-xl font-medium tracking-[-0.01em] text-foreground"
const LINK = "underline underline-offset-4 hover:text-foreground"

function CallToAction() {
  return (
    <div className="flex flex-wrap gap-3">
      <Link
        to="/signup"
        search={{ redirect: undefined }}
        className={cn(buttonVariants())}
      >
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
        Starting, stopping and editing entries keep working without a
        connection, and sync in order when you are back. Raising an invoice
        needs the network.
      </>
    ),
  },
  {
    label: "Google Calendar",
    body: (
      <>
        Link a calendar in the web app and its meetings appear on your day in
        the calendar view, where one can be tracked without retyping it.
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
        . The builds are unsigned, so the first launch needs one extra step —
        see the{" "}
        <a className={LINK} href={DESKTOP_INSTALL_URL}>
          install steps for unsigned builds
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
        <kbd className="rounded-sm border border-border px-1 font-mono text-xs">
          ?
        </kbd>{" "}
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
              {APP_NAME} turns the hours you track into invoices, and the notes
              you write along the way into the account behind them.
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
                Every entry has a title, and room for a line about what actually
                happened. A conventional tracker gives you a number and no
                memory. The hours alone cannot answer what you did on Tuesday,
                which is exactly what an invoice, a standup or a client asks.
              </p>
            </div>
            <DayLogFragment />
          </div>
        </section>

        <section className={SECTION}>
          <div className="flex flex-col gap-4">
            <h2 className={H2}>Where the period went.</h2>
            <p className={PROSE}>
              Reports searches your titles, notes and projects, filters by
              project, billable and date range, and exports to PDF, CSV or
              Excel.
            </p>
          </div>
          <ReportReadoutFragment />
        </section>

        <section className="border-t border-border">
          <div className={SECTION}>
            <div className="flex flex-col gap-4">
              <h2 className={H2}>From hours to an invoice.</h2>
              <p className={PROSE}>
                Pick a range in Reports and turn its billable hours into an
                invoice. Every line prints hours × rate, so your client can
                check the total with a calculator. Export it as a PDF.
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
                <dt className="text-sm font-medium text-foreground">
                  {fact.label}
                </dt>
                <dd className={cn(PROSE, "text-sm")}>{fact.body}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="flex flex-col gap-4 border-y border-border bg-card px-4 py-16">
          <h2 className={H2}>Start with today.</h2>
          <p className={PROSE}>
            Create an account and track your next hour. It is free.
          </p>
          <CallToAction />
        </section>
      </main>

      <footer className="flex items-center justify-between gap-4 px-4 py-6 text-xs text-muted-foreground">
        <span>{APP_NAME}</span>
        <span className="font-mono tracking-[-0.02em] tabular-nums">
          © {new Date().getFullYear()}
        </span>
      </footer>
    </div>
  )
}
