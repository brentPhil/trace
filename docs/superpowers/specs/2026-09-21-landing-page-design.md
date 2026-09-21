# Signed-out landing page

The page at `/` is currently a wordmark, one sentence and two buttons. It is
what a stranger sees at chroneli.com, and it says nothing about what the
product does. This spec turns it into a landing page that shows the product
working and states what it is for, in the product's own voice.

## Decisions

Four questions were settled before design:

**How the product is shown.** Live fragments: small pieces of the real UI,
drawn with the app's own utility strings and components and fed static sample
data. Not screenshots, because screenshots need a light and a dark capture of
every view and go stale the day the UI changes. Not typography alone, because
that asks a visitor to take the product on faith.

**What the page may claim.** No business claims beyond one: the owner
confirmed Chroneli is free. No pricing tiers, testimonials, user counts or
comparisons. Every feature claim is listed under "Claims, verified" below with
the code or doc that backs it, and a claim not in that list does not go on the
page.

**The desktop link.** It points at
`https://github.com/brentPhil/trace/releases/latest`. **No release has been
published yet**, so that URL 404s until the owner publishes one (see
`docs/desktop.md` → Releasing). Publishing a release is a precondition for
deploying this page, not part of the change.

**How the fragments are built.** Reuse where the real component is pure
presentation, copy where it is not.

- **Reused as-is:** `InvoiceLines` (`src/components/invoices/invoice-lines.tsx`)
  and `ProjectDot`. `InvoiceLines` is a pure table over `format-money`,
  `invoice-document` and `@shared/money`, and it is the fragment whose
  arithmetic the page makes a promise about, so a hand-copied version is where
  drift would cost most.
- **Purpose-built:** the timer bar and the entry rows. `TimerBar` and
  `EntryRow` are props-driven (they import only Convex *types*), but they bring
  popovers, `ManualEntryDialog`, inline editors and the `useAnnounce` context
  with them — interactive machinery that has no business inside an inert
  illustration, and a context the signed-out tree does not provide. Their
  fragments copy the utility strings instead, and each fragment's header
  comment names the component it mirrors, so a change to one is a grep away
  from the other.

## Layout, and how it sits with DESIGN.md

**No page measure.** DESIGN.md's One Measure Rule holds here as written: the
page takes the full width, and **prose is capped where the prose is** — each
copy block at `max-w-[60ch]`, the hero headline at `max-w-[20ch]` with
`text-balance`. A 68rem column was considered and rejected: at 1920px it
leaves the ~830px dead band of page the rule records as tried and reverted.

**Each section is a two-column grid at `lg`** — copy in one column, its
fragment in the other — and stacks, copy first, below `lg`. The fragment
column takes the remaining width, the way the timer bar and the log take the
width in the app. Bands (`bg-card` between two hairlines) are full-bleed; their
contents carry `px-4` themselves, left-flush, per §3.

**The top bar is a header, not navigation.** DESIGN.md §5 says navigation is a
left rail, never a top nav. This bar holds the wordmark and two auth links and
nothing that navigates within the product, which is what the rule is about. A
comment at the call site says so, so it is not read as precedent for an app
page.

Everything else in DESIGN.md applies unchanged:

- Standard tokens only. No new colour token, no gradients, no glow, no
  shadow on anything that does not float.
- Sentence case throughout. No uppercase tracked-out eyebrows.
- Every digit is `font-mono tabular-nums tracking-[-0.02em]` (The Tabular
  Rule).
- No state carried by colour alone; absence is the app's hatch
  (`HATCH_EMPTY`, `src/lib/hatch.ts`), in the fragments exactly as in the app.
- No tiles, no hero-metric template, no icons-in-boxes feature grid (§6).

## Page structure

Top to bottom. Sections are separated by `border` hairlines; the day log and
the closing call to action sit in `bg-card` bands.

**Top bar.** The wordmark (`APP_NAME`) on the left. On the right, `Sign in`
(ghost) and `Create account` (primary). No theme control: `ThemeChoice` is a
three-way Light/Dark/System tab strip built for the sidebar popup, and a
visitor gets the system preference, which is the app's default anyway.

**1. Hero.**
- Headline, `h1`, at `clamp(2rem, 5vw, 3.25rem)`, weight 500, `-0.01em`. This
  is a size of its own, not DESIGN.md's Display role, which belongs to a
  running duration.
- Headline copy: *Know where the day went. And what you did with it.*
- One sentence under it: hours become invoices, and the notes you write
  along the way become the account behind them.
- `Create account` (primary) and `Sign in` (outline), then a muted line:
  *Free. No card.*
- The **timer bar fragment**, recording: a title, a `ProjectDot` and project
  name, the billable mark, the stop glyph, the `--primary` boundary, and an
  elapsed duration that ticks. On `lg` it sits in the second column; below,
  under the buttons.

**2. The note is the product.**
- The **day log fragment**: a day header with its total, then five entry rows
  at the app's 54px height, each with project dot, title, time range and mono
  duration. Two rows show a note line. One row has no note and shows the
  hatched treatment. Below `md` the rows wrap as `entry-row.tsx` does.
- Copy: a conventional tracker gives you a number and no memory. The hours
  cannot answer "what did I do on Tuesday", which is the question an invoice,
  a standup or a client asks.

**3. Where the period went.**
- The **report readout fragment**: the four label-figure-hairline figures
  `summary-panel.tsx` shows (Tracked, Billable, Earned, Entries), on the
  page's own background, and a small monochrome daily bar strip with one
  hatched empty day.
- Copy: Reports searches titles, notes and projects; filters by project,
  billable and date range; and exports to PDF, CSV and Excel.

**4. From hours to an invoice.**
- The **invoice fragment**: `InvoiceLines` over three sample lines and its
  total.
- Copy: every line prints hours × rate, so a client can check the total with
  a calculator; and the invoice exports to PDF.
- **Not** "never silently rounds". That is PRODUCT.md's internal principle,
  and invoices floor hours to hundredths before multiplying
  (`convex/lib/invoiceMath.ts`). The checkable claim is the true one.

**5. The rest, stated plainly.** A list of four rows, each a label and one
sentence, no icons:
- **Works offline, in the browser.** Starting, stopping and editing entries
  keep working without a connection and sync in order when you are back.
  Raising an invoice needs the network. **Not** claimed for the desktop app:
  `docs/offline.md` forbids describing it as offline-capable on macOS.
- **Google Calendar.** Link a calendar and its meetings appear on your day in
  the calendar view, where one can be tracked without retyping it. Stated for
  the web app: connecting is broken in the macOS desktop app
  (`docs/desktop.md`, "Google Calendar connect is still broken on macOS").
- **Desktop app.** Chroneli also runs as an app on Windows and macOS. Links to
  `releases/latest`, says the builds are unsigned, and links to the install
  steps rather than characterising them.
- **Yours to set up.** Light and dark, a set of theme presets, and keyboard
  shortcuts — press `?` in the app to see them.

**6. Closing band.** An `h2`, one sentence, and both buttons again. Then a
footer line with the wordmark and the year.

These copy constraints are part of the spec. An implementer must not "improve"
section 5 back into an unqualified claim.

## Claims, verified

| Claim | Backed by |
|---|---|
| Free | Owner, 2026-09-21 |
| Reports searches titles, notes, projects | `convex/lib/entryFilter.ts` |
| Filters: project, billable, date range | `src/components/history/filter-controls.tsx` |
| Exports PDF, CSV, Excel | `src/components/reports/export-menu.tsx` |
| Invoice lines print hours × rate | `convex/lib/invoiceMath.ts`, `invoice-lines.tsx` |
| Invoice PDF export | `src/components/invoices/export-pdf-button.tsx` |
| Offline, browser, entries | `docs/offline.md` |
| Calendar meetings, "Track this" | `src/components/calendar/calendar-meeting-popover.tsx` |
| Theme presets | `src/lib/theme-presets.ts` |
| `?` lists shortcuts | `src/components/a11y/shortcuts-overlay.tsx` |
| Desktop app, Windows and macOS | `docs/desktop.md` (link live once a release is published) |

## Motion

The ticking duration is the page's only motion. It is state, which is what
DESIGN.md says motion is for, and it ticks under `prefers-reduced-motion` too,
for the reason the app gives: a running timer must stay readable when
everything else stops. The fragment has no running dot and nothing pulses.
Nothing on the page animates in.

**The tick uses the app's clock, not a counter.** `src/lib/clock.ts` says never
accumulate: a `setInterval` counter drifts and stalls in a background tab. The
fragment reads `useSecond()` (`src/hooks/use-clock.ts`), which returns `null`
during server rendering and the first client render. While it is `null` the
fragment shows the fixed sample value `1:47:12`, so server and client agree;
after that it shows `1:47:12 + (second − firstSecond)`, where `firstSecond` is
the first non-null value seen.

## Accessibility

- Each fragment root is `inert`, which removes it from the accessibility tree
  and the tab order. A screen reader hears the adjacent prose, not a timer
  ticking once a second, and a keyboard user never lands on a control that does
  nothing. The prose beside each fragment carries what it shows.
- One `h1` (the headline), one `h2` per section including the closing band.
- Every call-to-action is a `Link` styled with `buttonVariants`, as the current
  page does, because it navigates.
- Contrast is unaffected: no token is added, so `styles.contrast.test.ts`
  still measures everything the page draws.

## Code shape

```
src/routes/index.tsx                          keeps beforeLoad + comments; renders <LandingPage />; head() gains a description
src/components/landing/landing-page.tsx       the sections, in order
src/components/landing/landing-header.tsx     top bar
src/components/landing/sample-data.ts         every sample value, in one place
src/components/landing/fragments/timer-bar.tsx
src/components/landing/fragments/day-log.tsx
src/components/landing/fragments/report-readout.tsx
src/components/landing/fragments/invoice.tsx  InvoiceLines over sample lines
src/lib/desktop-release.ts                    DESKTOP_RELEASES_URL, DESKTOP_INSTALL_URL
src/routes/-index.test.tsx                    route test
```

`DESKTOP_INSTALL_URL` is
`https://github.com/brentPhil/trace/blob/master/docs/desktop.md#unsigned-installs`,
which exists today (the repo is public), so the install steps have one home.

The desktop URLs live in `src/lib`, not `@shared/brand`: `convex/lib` is the
shared layer because Convex functions need it, and nothing in Convex needs a
GitHub URL. Named constants rather than JSX literals, so the one link that can
404 is easy to find.

`sample-data.ts` uses fictional clients and projects (for example, "Harbour
Studio", "Northwind Books") so no real name appears on a public page. Project
hues are `--project-*` values, which DESIGN.md defines as data, so they stay
put when the theme changes.

## Testing

`src/routes/-index.test.tsx`, in the jsdom project, following
`src/routes/-root-auth.test.ts`'s pattern of calling
`Route.options.beforeLoad` directly:

- An authenticated context redirects to `/timer`.
- Every `Create account` link (three: header, hero, closing band) points at
  `/signup`, and every `Sign in` link (three) at `/login`.
- The desktop link's `href` is `DESKTOP_RELEASES_URL`.
- Every fragment root is `inert`.
- There is exactly one `h1`.
- The timer fragment shows `1:47:12` before the clock ticks and a later value
  after it advances (fake timers driving the clock store).

Visual verification in the browser: desktop and mobile widths, light and
dark, one non-default preset (DESIGN.md's closing audit test: nothing on the
page may hold a colour the theme cannot reach), and forced-colors mode, where
`HATCH_EMPTY` relies on its dashed border.

## Out of scope

Pricing page, screenshots, testimonials, analytics, a blog, OG image
generation, a theme control on the page, and publishing the desktop release.
The last is a precondition for deploying this page and is the owner's action.

## Revision, 2026-09-21: the bolder pass

The first build repeated one composition five times (prose left, a small
fragment right) and had no image a visitor would remember. The revision keeps
every claim and every DESIGN.md rule and changes proportion, not vocabulary:
no new token, font, gradient or shadow.

- **The day, drawn.** A new fragment, `fragments/day-ruler.tsx`, draws the
  sample day as one horizontal band from 8:00 to 19:00: each entry a block in
  its project's hue (`--project-*` is data), untracked gaps of 15 minutes or
  more hatched (The Hatch Rule), and the running entry outlined in `--primary`
  with a full-height "now" line. It is the literal answer to the headline and
  the page's one image.
- **The stage.** The timer bar and the ruler sit together at full width in a
  `bg-card` band under the hero, the way the app puts the timer bar above the
  day. They share one tick (`use-running-seconds.ts`), so they cannot disagree.
- **Scale.** The headline is a display size (`clamp(2.75rem, …, 5.75rem)`) in
  two tones: the question in `--foreground`, the answer in
  `--muted-foreground`. Section heads share one scale.
- **The note section** sets the app's own note-field prompt ("What did you
  actually do? A sentence is plenty.", `note-line.tsx`) as a pull quote.
- **Reports and invoicing** are one section, "From the week to the invoice",
  because they are a sequence; two columns only at `xl`, split 5:7 so the
  invoice table's description column has room.
- **Facts** are a two-column list at `md`, each under a hairline.
- **The closing band** repeats the display scale: "Start with today."

## Revision, 2026-09-21: motion

Requested by the owner, and an explicit exception to DESIGN.md's "no entrance
animation" (recorded there). This supersedes the "Motion" section above. Each
animation performs something the product does, in the product's order:

- **Hero (CSS only, on load):** the headline's words arrive one at a time; the
  timer bar rises; the day REPLAYS on the ruler — blocks uncovered from 8:00 to
  now with the playhead on the uncovered edge — and the "now" line then
  breathes.
- **Day log (on reveal):** rows arrive in order, then the one empty note is
  typed over its hatch (`TYPED_NOTE`). Without script or motion it stays
  hatched.
- **Report (on reveal):** the four figures count up to their real values and
  the bars rise from the baseline.
- **Invoice (on reveal):** lines, subtotal, total, in print order.
- **Facts (on reveal):** each hairline is drawn, then its text rises.
- **Closing band:** the running duration at display size, the same tick as the
  hero's, with "Still recording".
- The header is sticky; the primary button's arrow nudges on hover.

`use-reveal.ts` only ever hides an element that starts below the fold, and
returns `static` with no IntersectionObserver, under reduced motion, and on the
server. Every animation carries `motion-reduce:animate-none`.
