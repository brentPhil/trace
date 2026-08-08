import { useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useSuspenseQuery } from "@tanstack/react-query"
import { convexQuery, useConvexMutation } from "@convex-dev/react-query"
import { Toast } from "@/components/ui/toast"
import { useLatest } from "@/hooks/use-latest"
import { errorMessage } from "@/lib/error-message"
import { formatTotal } from "@/lib/format-total"
import { cn } from "@/lib/utils"
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
    <div className="flex flex-col">
      <main className="flex flex-1 flex-col gap-8 px-4 py-6">
        <h1 className="text-sm font-semibold">Settings</h1>

        <Section
          title="Time zone"
          hint="Every day boundary in the app comes from this — which entries fall on which day, what the week totals cover, and when a recap is for. Changing it re-files history rather than rewriting it, so nothing is lost, but old days may shift."
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
          hint="Decimal hours are floored to two places, so no figure ever shows more time than was recorded and the parts never sum above the whole. It applies to totals and exports — never to a single entry's own row, and never to the recap, where a span reads better as a span."
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
          title="Tab title"
          hint="Announced by screen readers whenever it changes, which is why it can be switched off. It updates once a minute rather than once a second for the same reason."
        >
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.tabTitleClock}
              onChange={(event) => save({ tabTitleClock: event.target.checked })}
              className="size-4 accent-[var(--enlarger)]"
            />
            Show the running timer in the browser tab
          </label>
        </Section>
      </main>
    </div>
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
    <section className="flex flex-col gap-2 border-b border-edge-soft pb-6 last:border-b-0">
      <h2 className="text-sm font-medium">{title}</h2>
      {hint === undefined ? null : (
        <p className="max-w-prose text-xs leading-relaxed text-muted-foreground">
          {hint}
        </p>
      )}
      <div className="pt-1">{children}</div>
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
  "rounded-md border border-edge-soft bg-ground px-2 py-1.5 text-sm",
  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
)
