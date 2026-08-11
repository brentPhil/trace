import { useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useSuspenseQuery } from "@tanstack/react-query"
import { convexQuery, useConvexMutation } from "@convex-dev/react-query"
import { Page } from "@/components/shell/page"
import { Toast } from "@/components/ui/toast"
import { useLatest } from "@/hooks/use-latest"
import { errorMessage } from "@/lib/error-message"
import { formatTotal } from "@/lib/format-total"
import { rateHelp } from "@/lib/format-money"
import { cn } from "@/lib/utils"
import { formatMoney, parseMoney, supportedCurrencies } from "@shared/money"
import { api } from "../../../convex/_generated/api"

export const Route = createFileRoute("/_authed/settings")({
  head: () => ({ meta: [{ title: "Settings — Trace" }] }),
  component: Settings,
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(convexQuery(api.settings.get, {}))
  },
})

/** A sample used to show what each duration format actually looks like. */
const SAMPLE_MS = 8 * 3_600_000 + 12 * 60_000

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
]

const RUNAWAY_CHOICES = [4, 6, 8, 10, 12, 24]

function Settings() {
  const { data: settings } = useSuspenseQuery(convexQuery(api.settings.get, {}))
  const update = useLatest(useConvexMutation(api.settings.update))
  const toasts = Toast.useToastManager()

  const save = (patch: Parameters<typeof update>[0]) => {
    void update(patch).catch((thrown: unknown) => {
      toasts.add({ title: errorMessage(thrown), priority: "high" })
    })
  }

  return (
    /*
      NOT PINNED — see `Page`'s rule. The header is a lone title, and nothing
      on it acts on what scrolls underneath: every control on this page is
      inside the section it belongs to and saves the instant it changes, so
      there is nothing at the top that a reader eight sections down still
      needs. Pinning would cost a permanent band of ground to keep the word
      "Settings" in view of a page that has already been navigated to.
    */
    <Page title="Settings">
      {/*
        FULL WIDTH, like every other page — but the fix for a wide settings
        page is in `Section`, not here.

        Capping the page was the old answer to a real problem: at 1600px each
        Section's `border-b` was a 1329px hairline running under a 272px
        `<select>`, six times down the page. That is a row with an empty
        middle, and narrowing the page only hid it. `Section` now puts the
        title and hint in a column beside the control, so the rule spans
        something.

        `pb-6` only — the top padding is the title row's, above.
      */}
      <div className="flex flex-1 flex-col gap-8 px-4 pb-6">
        <Section
          title="Time zone"
          hint="Every day boundary in the app comes from this — which entries fall on which day, and what the week totals cover. Changing it re-files history rather than rewriting it, so nothing is lost, but old days may shift."
        >
          <TimezoneField
            value={settings.timezone}
            onChange={(timezone) => save({ timezone })}
          />
        </Section>

        <Section title="Week starts on">
          <select
            aria-label="Week starts on"
            value={settings.weekStartDay}
            onChange={(event) => save({ weekStartDay: Number(event.target.value) })}
            className={fieldClass}
          >
            {WEEKDAYS.map((name, index) => (
              <option key={name} value={index}>
                {name}
              </option>
            ))}
          </select>
        </Section>

        <Section
          title="Durations"
          hint="Decimal hours are floored to two places, so no figure ever shows more time than was recorded and the parts never sum above the whole. It applies to totals and exports — never to a single entry's own row, where a span reads better as a span."
        >
          <div className="flex flex-col gap-2">
            <Radio
              name="durationDisplay"
              checked={settings.durationDisplay === "hms"}
              onChange={() => save({ durationDisplay: "hms" })}
            >
              Hours and minutes
              <Sample>{formatTotal(SAMPLE_MS, "hms")}</Sample>
            </Radio>
            <Radio
              name="durationDisplay"
              checked={settings.durationDisplay === "decimal"}
              onChange={() => save({ durationDisplay: "decimal" })}
            >
              Decimal hours
              <Sample>{formatTotal(SAMPLE_MS, "decimal")}</Sample>
            </Radio>
          </div>
        </Section>

        <Section title="Clock">
          <div className="flex flex-col gap-2">
            <Radio
              name="timeFormat"
              checked={settings.timeFormat === "24"}
              onChange={() => save({ timeFormat: "24" })}
            >
              24-hour
              <Sample>17:30</Sample>
            </Radio>
            <Radio
              name="timeFormat"
              checked={settings.timeFormat === "12"}
              onChange={() => save({ timeFormat: "12" })}
            >
              12-hour
              <Sample>5:30 PM</Sample>
            </Radio>
          </div>
        </Section>

        <Section
          title="Runaway timers"
          hint="A banner appears once a timer has been running longer than this. It never stops anything on your behalf — a long session might be real work, and a tracker that ends it for you is a tracker that loses time."
        >
          <select
            aria-label="Warn after"
            value={Math.round(settings.runawayThresholdMs / 3_600_000)}
            onChange={(event) =>
              save({ runawayThresholdMs: Number(event.target.value) * 3_600_000 })
            }
            className={fieldClass}
          >
            {RUNAWAY_CHOICES.map((hours) => (
              <option key={hours} value={hours}>
                After {hours} hours
              </option>
            ))}
          </select>
        </Section>

        <Section
          title="Currency"
          /*
           * The second sentence is the one that matters, and it was missing.
           * Rates are stored per PROJECT as a plain number of hundredths;
           * currency is a single per-USER label applied to all of them. So
           * switching from USD to EUR re-labels a $10.00/hr project as
           * €10.00/hr — no conversion, no rate touched, and every historical
           * figure on /reports re-labelled with it. Saying only "symbol,
           * placement and decimal count" made that sound cosmetic.
           *
           * Deliberately a permanent sentence rather than a confirm dialog:
           * every other control on this page saves the instant you change it,
           * and a modal that appears only when some project happens to have a
           * rate is a warning most users would never see at all.
           */
          hint="Formats every rate and billable amount — on /projects and /reports — with this currency's own symbol and placement, rather than assuming a symbol that is wrong for you. Changing it RE-LABELS the rates you have already set; it does not convert them. A project at 10.00 stays the number 10.00 and simply starts reading as 10.00 of the new currency, on past reports as well as future ones. Only currencies divided into hundredths are offered, because that is what a rate is stored as."
        >
          <CurrencyField
            value={settings.currency}
            onChange={(currency) => save({ currency })}
          />
        </Section>

        {/*
          THE FALLBACK, not "the" rate. A project's own rate always wins; this
          is what prices everything no project rate covers — including billable
          time with no project at all, which was previously unpriceable however
          billable it was, and showed up on /reports only as a footnote saying
          so. Toggl resolves rates the same way and calls this the workspace
          rate: the most granular rate wins, and this is the least granular one
          there is.
        */}
        <Section
          title="Default hourly rate"
          hint="Used for billable time that no project rate covers — including entries with no project, like a standup. A project with its own rate always overrides this, and a project set to 0.00 really does mean unpaid rather than falling back here. Leave it blank and that time stays unpriced, and /reports says so rather than counting it as nothing."
        >
          <RateField
            cents={settings.defaultHourlyRateCents}
            currency={settings.currency}
            onChange={(defaultHourlyRateCents) => save({ defaultHourlyRateCents })}
          />
        </Section>

        <Section
          title="Tab title"
          hint="Announced by screen readers whenever it changes, which is why it can be switched off. It updates once a minute rather than once a second for the same reason."
        >
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.tabTitleClock}
              onChange={(event) => save({ tabTitleClock: event.target.checked })}
              // NOT `--enlarger`: this checkbox's own CHECKED state is a
              // setting being toggled, not a timer running — the Cold Light
              // Rule reads it the same way it reads a checked box anywhere
              // else in Settings, and this was the only unconditional
              // `--enlarger` in the codebase. Matches the neutral `--ink`
              // accent the `Radio` controls in this file already use.
              className="size-4 accent-[var(--ink)]"
            />
            Show the running timer in the browser tab
          </label>
        </Section>
      </div>
    </Page>
  )
}

// ---------------------------------------------------------------------------

/**
 * The zone list comes from the runtime rather than a bundled table.
 *
 * `Intl.supportedValuesOf` is exactly the set this browser's own formatter can
 * resolve, so a zone offered here can never be one the app then fails to
 * format. A hand-maintained list goes stale every time a country changes its
 * rules, which happens more often than anyone expects.
 */
function TimezoneField({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  const [zones] = useState<Array<string>>(() => {
    try {
      return Intl.supportedValuesOf("timeZone")
    } catch {
      // Older runtimes: keep whatever is stored so the field is never empty and
      // the user's own zone is never silently replaced.
      return [value, "UTC"]
    }
  })

  // The stored zone might not be in the runtime's list (a different browser set
  // it). Including it keeps the select from silently showing something else.
  const options = zones.includes(value) ? zones : [value, ...zones]

  return (
    <select
      aria-label="Time zone"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={cn(fieldClass, "max-w-full")}
    >
      {options.map((zone) => (
        <option key={zone} value={zone}>
          {zone}
        </option>
      ))}
    </select>
  )
}

/**
 * Same idea as `TimezoneField`, with one extra narrowing.
 *
 * The list is `money.supportedCurrencies()` — the runtime's own ISO 4217 codes,
 * minus the ones whose minor unit is not a hundredth. That is the SAME list
 * `settings.update`'s server-side guard checks against, so the picker and the
 * validator cannot disagree: previously the picker offered all 162 codes while
 * the guard accepted any three letters, and neither matched what `formatMoney`
 * could actually render honestly (JPY silently rounded stored hundredths away;
 * KWD showed a third decimal `parseMoney` then refused).
 *
 * A stored code outside the list is still shown, so a value already saved is
 * never silently swapped for something else under the user.
 *
 * Computed during render, NOT held in a `useState` initializer the way
 * `TimezoneField` above holds its zones. That shape earns its place there — the
 * lazy initializer is what stops a `try`/`catch` around a runtime call from
 * re-running every render. Here there is nothing to guard: the module memoises
 * the list itself, so this is a plain read, and freezing a derived value at
 * first render only bought a fallback that could not follow `value` if the
 * stored currency changed underneath it.
 */
/**
 * The account's fallback rate, as an amount in the user's own currency.
 *
 * Commits on blur and on Enter rather than on every keystroke, unlike the
 * selects and checkboxes on this page: a rate is typed a character at a time,
 * and saving "1", then "10", then "100" would write three rates and re-price
 * every historical report twice on the way to the one the user meant.
 *
 * EMPTY CLEARS IT, and that is a real state rather than zero — `null` on the
 * wire, an absent field in the row. "Nobody has priced this" and "priced at
 * nothing" are different facts, and `unratedBillableMs` on /reports exists to
 * tell them apart.
 */
function RateField({
  cents,
  currency,
  onChange,
}: {
  cents: number | undefined
  currency: string
  onChange: (cents: number | null) => void
}) {
  // Seeded with the bare number, no currency symbol, so the input round-trips
  // through `parseMoney` cleanly — the DISPLAY is where a symbol belongs. The
  // same split /projects makes for a project's own rate.
  const [text, setText] = useState(cents === undefined ? "" : (cents / 100).toFixed(2))
  const [error, setError] = useState<string | null>(null)

  const commit = () => {
    // `currency` is passed so the user's OWN sign and ISO code are strippable
    // noise rather than a parse failure — an SGD user pasting "S$10" back out
    // of a figure this app rendered for them. Empty input is `parseMoney`'s own
    // `{ ok: true, cents: null }`, so "clear it" comes through the same parser
    // as every other value rather than being special-cased ahead of it.
    const parsed = parseMoney(text, currency)
    if (!parsed.ok) {
      setError(rateHelp(currency))
      return
    }
    setError(null)
    if (parsed.cents === null) {
      setText("")
      onChange(null)
      return
    }
    setText((parsed.cents / 100).toFixed(2))
    onChange(parsed.cents)
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <input
          aria-label="Default hourly rate"
          aria-invalid={error !== null}
          aria-describedby={error === null ? undefined : "default-rate-error"}
          value={text}
          placeholder="No rate"
          onChange={(event) => setText(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur()
            if (event.key === "Escape") {
              setError(null)
              setText(cents === undefined ? "" : (cents / 100).toFixed(2))
            }
          }}
          className={cn(fieldClass, "w-32 tabular", error !== null && "border-alarm")}
        />
        <span className="text-sm text-muted-foreground">
          per hour
          {cents === undefined ? null : ` · ${formatMoney(cents, currency)}`}
        </span>
      </div>
      {/* The colour is never the only carrier — see DESIGN.md on error states. */}
      {error === null ? null : (
        <p id="default-rate-error" role="alert" className="text-xs text-alarm">
          {error}
        </p>
      )}
    </div>
  )
}

function CurrencyField({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  const supported = supportedCurrencies()
  // Empty only on a runtime that cannot enumerate currencies at all. Keep
  // whatever is stored so the field is never empty and the user's own currency
  // is never silently replaced — the same fallback `TimezoneField` makes.
  const codes = supported.length > 0 ? supported : [value, "USD"]

  const options = codes.includes(value) ? codes : [value, ...codes]

  return (
    <select
      aria-label="Currency"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={cn(fieldClass, "max-w-full")}
    >
      {options.map((code) => (
        <option key={code} value={code}>
          {code}
        </option>
      ))}
    </select>
  )
}

function Section({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    /*
      Label column beside control column, once there is room for two.

      The page is full width like every other page, and this is what keeps that
      from turning each Section into a long hairline under a short control.
      The left column caps the prose at a reading measure — which is what
      `max-w-prose` was doing by hand, and what capping the whole PAGE was
      doing to the rule as well.

      One column below `lg`, where a phone has no width to give a second one.
    */
    <section className="grid gap-2 border-b border-edge-soft pb-6 last:border-b-0 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] lg:gap-x-12">
      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">{title}</h2>
        {hint === undefined ? null : (
          <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>
        )}
      </div>
      <div className="pt-1 lg:pt-0">{children}</div>
    </section>
  )
}

function Radio({
  name,
  checked,
  onChange,
  children,
}: {
  name: string
  checked: boolean
  onChange: () => void
  children: React.ReactNode
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onChange}
        className="size-4 accent-[var(--ink)]"
      />
      {children}
    </label>
  )
}

/** What the choice actually looks like, rather than a description of it. */
function Sample({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-sm border border-edge-soft px-1.5 py-0.5 text-xs tabular text-muted-foreground">
      {children}
    </span>
  )
}

const fieldClass = cn(
  "rounded-md border border-edge bg-ground px-2 py-1.5 text-sm",
  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
)
