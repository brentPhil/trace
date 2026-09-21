import { Link } from "@tanstack/react-router"
import { buttonVariants } from "@/components/ui/button"
import {
  DESKTOP_INSTALL_URL,
  DESKTOP_RELEASES_URL,
} from "@/lib/desktop-release"
import { cn } from "@/lib/utils"
import { APP_NAME } from "@shared/brand"
import { DayLogFragment } from "./fragments/day-log"
import { DayRulerFragment } from "./fragments/day-ruler"
import { InvoiceFragment } from "./fragments/invoice"
import { ReportReadoutFragment } from "./fragments/report-readout"
import { TimerBarFragment } from "./fragments/timer-bar"
import { LandingHeader } from "./landing-header"

export const LANDING_DESCRIPTION =
  "A time tracker that records what you got done, not only how long it took. Free."

/*
 * NO PAGE MEASURE (DESIGN.md §3, The One Measure Rule). The page takes the full
 * width; prose is capped where the prose is (`PROSE`), and every block is
 * left-flush with `px-4`.
 *
 * ONE IMAGE. The page's weight sits on the stage under the hero: the running
 * timer bar at full width, the way the app has it, and the day drawn as a
 * ruler beneath it — the literal answer to the headline. Everything after it
 * is evidence for that picture, so the sections get quieter as they go rather
 * than each shouting the same size.
 *
 * COPY IS SPEC (docs/superpowers/specs/2026-09-21-landing-page-design.md).
 * Offline and Google Calendar are claimed for the web app only — both are
 * unverified or broken in the macOS desktop app. The invoice claim is "hours ×
 * rate", never "never rounds": invoices floor hours to hundredths.
 */
const PROSE =
  "max-w-[60ch] text-base leading-relaxed text-pretty text-muted-foreground sm:text-lg"
// Display steps on one ratio, so the headline, the section heads and the
// closing line read as one scale rather than three unrelated sizes. Letter
// spacing tightens as the size grows and never past -0.035em.
const H2 =
  "max-w-[22ch] text-[clamp(1.875rem,1.1rem+2.6vw,3rem)] leading-[1.05] font-medium tracking-[-0.03em] text-balance text-foreground"
const H3 = "text-lg font-medium tracking-[-0.01em] text-foreground"
// An implicit auto column grows to its widest child's min-content width, so a
// fragment with non-wrapping rows would push the section, prose included, past a
// phone's edge. Every grid here states a shrinkable column.
const ONE_COLUMN = "grid grid-cols-[minmax(0,1fr)]"
const LINK = "underline underline-offset-4 hover:text-foreground"

function CallToAction() {
  return (
    <div className="flex flex-wrap gap-3">
      <Link
        to="/signup"
        search={{ redirect: undefined }}
        className={cn(buttonVariants({ size: "lg" }))}
      >
        Create account
      </Link>
      <Link
        to="/login"
        search={{ redirect: undefined }}
        className={cn(buttonVariants({ variant: "outline", size: "lg" }))}
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
        <section className="flex flex-col gap-10 px-4 pt-16 pb-12 sm:pt-24 sm:pb-16">
          {/* Two tones, one sentence: the question in full ink, the product's
              actual answer a step quieter, so the weight falls where the
              category never puts it. */}
          <h1 className="max-w-[15ch] text-[clamp(2.75rem,1.2rem+6vw,5.75rem)] leading-[0.98] font-medium tracking-[-0.035em] text-balance">
            Know where the day went.{" "}
            <span className="text-muted-foreground">
              And what you did with it.
            </span>
          </h1>
          <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between lg:gap-16">
            <p className={cn(PROSE, "max-w-[46ch]")}>
              {APP_NAME} turns the hours you track into invoices, and the notes
              you write along the way into the account behind them.
            </p>
            <div className="flex flex-col gap-3">
              <CallToAction />
              <p className="text-sm text-muted-foreground">Free. No card.</p>
            </div>
          </div>
        </section>

        <div className="flex flex-col gap-6 border-y border-border bg-card px-4 py-8 sm:py-12">
          <TimerBarFragment />
          <DayRulerFragment />
        </div>

        <section
          className={cn(
            ONE_COLUMN,
            "gap-12 px-4 py-20 sm:py-28 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16"
          )}
        >
          <div className="flex flex-col gap-6">
            <h2 className={H2}>The note is the product.</h2>
            <p className={PROSE}>
              Every entry has a title, and room for a line about what actually
              happened. A conventional tracker gives you a number and no memory.
              The hours alone cannot answer what you did on Tuesday, which is
              exactly what an invoice, a standup or a client asks.
            </p>
            {/* The app's own words, not a slogan: the placeholder in every
                entry's note field (src/components/entries/note-line.tsx). */}
            <figure className="flex flex-col gap-2 border-t border-border pt-6">
              <blockquote className="max-w-[24ch] text-2xl leading-snug font-medium tracking-[-0.02em] text-balance text-foreground">
                “What did you actually do? A sentence is plenty.”
              </blockquote>
              <figcaption className="text-sm text-muted-foreground">
                The prompt on every entry’s note.
              </figcaption>
            </figure>
          </div>
          <DayLogFragment className="lg:self-center" />
        </section>

        <section className="flex flex-col gap-14 border-t border-border px-4 py-20 sm:py-28">
          <h2 className={H2}>From the week to the invoice.</h2>
          {/* Two columns only at `xl`, and not an even split: the invoice
              table has a 544px minimum, its inert box cannot scroll, and its
              description column only gets what the three figure columns
              leave — so the invoice takes seven twelfths. */}
          <div
            className={cn(
              ONE_COLUMN,
              "gap-16 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]"
            )}
          >
            <div className="flex flex-col gap-6">
              <div className="flex flex-col gap-3">
                <h3 className={H3}>Where the period went.</h3>
                <p className={cn(PROSE, "sm:text-base")}>
                  Reports searches your titles, notes and projects, filters by
                  project, billable and date range, and exports to PDF, CSV or
                  Excel.
                </p>
              </div>
              <ReportReadoutFragment />
            </div>
            <div className="flex flex-col gap-6">
              <div className="flex flex-col gap-3">
                <h3 className={H3}>From hours to an invoice.</h3>
                <p className={cn(PROSE, "sm:text-base")}>
                  Pick a range in Reports and turn its billable hours into an
                  invoice. Every line prints hours × rate, so your client can
                  check the total with a calculator. Export it as a PDF.
                </p>
              </div>
              <InvoiceFragment />
            </div>
          </div>
        </section>

        <section className="flex flex-col gap-10 border-t border-border px-4 py-20 sm:py-28">
          <h2 className={H2}>What else it does.</h2>
          <dl className={cn(ONE_COLUMN, "gap-x-16 gap-y-10 md:grid-cols-2")}>
            {FACTS.map((fact) => (
              <div
                key={fact.label}
                className="flex flex-col gap-2 border-t border-border pt-5"
              >
                <dt className="text-base font-medium text-foreground">
                  {fact.label}
                </dt>
                <dd className={cn(PROSE, "sm:text-base")}>{fact.body}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="flex flex-col gap-8 border-y border-border bg-card px-4 py-24 sm:py-32">
          <h2 className="max-w-[14ch] text-[clamp(2.25rem,1rem+4.6vw,4.5rem)] leading-[1] font-medium tracking-[-0.035em] text-balance">
            Start with today.
          </h2>
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
