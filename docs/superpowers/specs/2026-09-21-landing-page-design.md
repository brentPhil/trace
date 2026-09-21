# Signed-out landing page

The page at `/` is currently a wordmark, one sentence and two buttons. It is
what a stranger sees at chroneli.com, and it says nothing about what the
product does. This spec turns it into a landing page that shows the product
working and states what it is for, in the product's own voice.

## Decisions

Four questions were settled before design:

**How the product is shown.** Live fragments: small pieces of the real UI,
drawn with the app's own utility strings and `ui/` components and fed static
sample data. Not screenshots, because screenshots need a light and a dark
capture of every view and go stale the day the UI changes. Not typography
alone, because that asks a visitor to take the product on faith.

**What the page may claim.** The owner confirmed four claims as true today:
Chroneli is free; there is a desktop app for Windows and macOS; the Google
Calendar link works for ordinary accounts; entries keep recording offline and
sync later. Nothing else is claimed. No pricing tiers, testimonials, user
counts or comparisons.

**The desktop link.** It points at
`https://github.com/brentPhil/trace/releases/latest`. **No release has been
published yet**, so that URL 404s until the owner publishes one (see
`docs/desktop.md` → Releasing). Publishing a release is a precondition for
deploying this page, not part of the change.

**How the fragments are built.** They are purpose-built presentational
components, not the real ones. `timer-bar.tsx` is 1,084 lines and, like
`entry-row.tsx` and `bill-preview.tsx`, is wired to Convex. Mounting those on
the signed-out page would ship the app's bundle to every visitor and couple a
marketing page to the internals of the product's two signature components.
Extracting shared presentational cores would avoid drift, but it refactors
those components for the sake of the landing page, which gets the risk
backwards. The cost of this choice is drift, and it is managed by naming: every
fragment's header comment names the component it mirrors, so a change to one
is a grep away from the other.

## The one exemption from DESIGN.md

DESIGN.md's **One Measure Rule** says there is no page measure and every page
takes the full width. The argument is that the log is a table, and a table
with a trailing cluster pinned right reads correctly at any width.

This page is not a table. It is prose written for someone who is not yet a
user, and a line of prose at 1600px is unreadable. So this page takes a single
content column capped at `max-w-[68rem]`, with hero copy capped at `60ch`.
It stays **left-flush with `px-4`**, as the rule's second half requires,
rather than centred. The exemption is stated in a comment at the cap, so it
does not become a precedent for an app page.

Everything else in DESIGN.md applies unchanged:

- Standard tokens only. No new colour token, no gradients, no glow, no
  shadow on anything that does not float.
- Sentence case throughout. No uppercase tracked-out eyebrows above sections.
- Every digit is `font-mono tabular-nums tracking-[-0.02em]` (The Tabular
  Rule).
- No state is carried by colour alone (The Over-Determined State Rule), and
  absence is a hatch (The Hatch Rule), in the fragments exactly as in the app.
- No tiles, no hero-metric template, no icons-in-boxes feature grid (§6).

## Page structure

Top to bottom. Sections are separated by `border` hairlines; the day log and
the closing call to action sit in `bg-card` bands, which is DESIGN.md's band
shape.

**Top bar.** The wordmark (`APP_NAME`) on the left. On the right, the existing
`ThemeToggle`, then `Sign in` (ghost) and `Create account` (primary). No
sidebar, because a visitor is not in the app.

**1. Hero.**
- Headline, at the Display role: *Know where the day went. And what you did
  with it.*
- One sentence under it: hours become invoices, and the notes you write
  along the way become the account behind them.
- `Create account` (primary) and `Sign in` (outline), then a muted line:
  *Free. No card.*
- Below, the **timer bar fragment**, in the recording state: a title, a
  project dot and name, a billable mark, the stop glyph, the `--primary`
  boundary, and an elapsed duration that ticks.

**2. The note is the product.**
- The **day log fragment**: a day header with its total, then five entry rows
  at the app's 54px height, each with project hue, title, time range and mono
  duration. Two rows show a note line. One row has no note and shows the
  hatched treatment the app uses for it.
- Copy beside it: a conventional tracker gives you a number and no memory. The
  hours cannot answer "what did I do on Tuesday", which is the question an
  invoice, a standup or a client asks.

**3. Where the period went.**
- The **report readout fragment**: four label-figure-hairline figures
  (tracked, billable, earned, entries) on the page's own background, not
  tiles, and a small monochrome daily bar strip with one hatched empty day.
- Copy: Reports searches titles, notes and projects, filters by project,
  billable and date range, and exports.

**4. From hours to an invoice.**
- The **invoice preview fragment**: three lines of description, hours × rate =
  amount, all tabular mono, a hairline, and the total.
- Copy carries the defensible-by-default promise from PRODUCT.md: it never
  silently rounds, merges or guesses, and the invoice exports to PDF.

**5. The rest, stated plainly.** A list of four rows, each a label and one
sentence, with no icons:
- **Works offline.** Starting, stopping and editing entries keep working
  without a connection, and sync in order when you are back. (Raising an
  invoice needs the network; the copy must not imply otherwise.)
- **Google Calendar.** Link a calendar and its meetings appear on your day in
  the calendar view, where one can become an entry without being retyped.
- **Desktop app.** Chroneli also runs as an app on Windows and macOS. The
  sentence links to `releases/latest` and says the builds are unsigned, so the
  first launch asks for one extra confirmation.
- **Yours to set up.** Keyboard shortcuts for the core actions, light and dark,
  and a set of theme presets.

**6. Closing band.** One sentence and both buttons again. Then a footer line
with the wordmark and the year.

## Motion

The ticking duration is the page's only motion. It is state, which is what
DESIGN.md says motion is for, and it is the product's own signature. It ticks
under `prefers-reduced-motion` too, for the reason the app gives: a running
timer updates continuously and must stay readable when everything else
stops. The running dot is static rather than pulsing, so there is nothing to
drop under reduced motion. Nothing on the page animates in.

The tick is one `setInterval` at 1s in the timer fragment, started in an
effect and cleared on unmount. The start value is fixed in the sample data
(`1:47:12`), so the first paint and a server render agree, and the page never
shows `0:00:00`.

## Accessibility

- Each fragment is an illustration. Its root is `aria-hidden="true"` and
  `inert`, so a screen reader hears the adjacent prose, not a fake timer
  ticking once a second, and a keyboard user never tabs into a control that
  does nothing. The prose beside each fragment already carries what it shows.
- One `h1` (the headline), one `h2` per section.
- The two call-to-action pairs are `Link`s styled with `buttonVariants`, as
  the current page does, because they navigate.
- The external download link has visible text that names the destination and
  opens in the same tab.
- Contrast is unaffected: no token is added, so `styles.contrast.test.ts`
  still measures everything the page draws.

## Code shape

```
src/routes/index.tsx                          keeps beforeLoad + comments; renders <LandingPage />; head() gains a description
src/components/landing/landing-page.tsx       the sections, in order
src/components/landing/landing-nav.tsx        top bar
src/components/landing/sample-data.ts         every sample value, in one place
src/components/landing/fragments/timer-bar.tsx
src/components/landing/fragments/day-log.tsx
src/components/landing/fragments/report-readout.tsx
src/components/landing/fragments/invoice-preview.tsx
src/routes/-index.test.tsx                    route test
```

`sample-data.ts` uses fictional clients and projects (for example, "Harbour
Studio", "Northwind Books") so no real name appears on a public page. Project
hues come from the existing `--project-*` tokens, which DESIGN.md defines as
data rather than theme, so they stay put when a visitor toggles the theme.

`DESKTOP_RELEASES_URL` is a named constant in `@shared/brand` beside
`APP_DOMAIN`, rather than a literal in JSX, so the one URL that can 404 is
easy to find.

## Testing

`src/routes/-index.test.tsx` asserts:

- An authenticated context still redirects to `/timer` from `beforeLoad`.
- Both `Create account` controls link to `/signup` and both `Sign in` controls
  link to `/login`.
- The desktop link's `href` is `DESKTOP_RELEASES_URL`.
- Every fragment root is `aria-hidden` and `inert`.
- There is exactly one `h1`.
- The timer fragment's duration advances after one second (fake timers) and its
  interval is cleared on unmount.

Visual verification in the browser at desktop and mobile widths, in light and
dark, and with one non-default preset applied, to check that nothing on the
page holds a colour the theme cannot reach (DESIGN.md's closing audit test).

## Out of scope

Pricing page, screenshots, testimonials, analytics, a blog, OG image
generation, and publishing the desktop release. The last is a precondition for
deploying this page and is the owner's action.
