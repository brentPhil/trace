import { FolderClosed } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ProjectPicker } from "@/components/classifiers/classifier-pickers"
import { formatTimeOfInstant } from "@/lib/format-time"
import { cn } from "@/lib/utils"
import type { Doc, Id } from "../../../convex/_generated/dataModel"

/*
 * The Google Calendar settings block.
 *
 * PRESENTATIONAL: its data and its writes both arrive as props, exactly as
 * `EntryRow` and `CalendarPanel` take theirs. That is what lets it render against
 * fixtures with no backend anywhere near it, and it keeps every write in this
 * feature originating in one place — the page.
 *
 * THERE IS NO AUTO-TRACK SWITCH HERE, and its absence is the design. An earlier
 * draft had one: nominate a calendar and every meeting on it would interrupt
 * whatever was running. It was replaced by a checkbox on the individual meeting
 * (Phase 2), because a per-calendar switch has to GUESS which meetings were worth
 * interrupting for — an accepted-RSVP test, a sole-attendee test, a grace window
 * — and PRODUCT.md rules out guessing on the user's behalf. Do not add one back.
 */

export type GoogleConnectionStatus = {
  connected: boolean
  status: "ok" | "reauth"
  lastSyncedAt: number | null
}

export type GoogleCalendarActions = {
  connect: () => void
  disconnect: () => void
  setShow: (googleId: string, show: boolean) => void
  setProject: (googleId: string, projectId: Id<"projects"> | null) => void
  /** Get-or-create, the same contract `ProjectPicker` takes everywhere else it
   *  is mounted — its "Create project" row needs somewhere to send a new name. */
  createProject: (name: string) => Promise<{ projectId: Id<"projects"> }>
}

const connectButtonClass =
  "justify-self-start rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-ground"

export function GoogleCalendarSection({
  connection,
  calendars,
  projects,
  timeZone,
  use12Hour,
  actions,
}: {
  connection: GoogleConnectionStatus
  calendars: Array<Doc<"googleCalendars">>
  projects: Array<Doc<"projects">>
  /** Threaded through for the "Last synced" line, the same way every other
   *  formatted time on this page gets them from the account's own settings. */
  timeZone: string
  use12Hour: boolean
  actions: GoogleCalendarActions
}) {
  if (!connection.connected) {
    return (
      <div className="grid gap-2">
        <p className="text-sm text-muted-foreground">
          Show your meetings on the calendar view, and read the details without
          leaving this tab. Chroneli only ever reads — nothing is written back to
          Google.
        </p>
        <button
          type="button"
          onClick={actions.connect}
          className={connectButtonClass}
        >
          Connect Google Calendar
        </button>
      </div>
    )
  }

  return (
    <div className="grid gap-4">
      {/*
        THE RE-CONSENT BANNER, as a SENTENCE.
        It is the only thing that tells a user their calendar stopped syncing —
        without it the grid simply goes quiet, which reads as "no meetings this
        week" rather than as a broken connection. Text and a button, never a
        coloured dot: PRODUCT.md's rule that meaning is never carried by hue
        alone, and this is the case that rule exists for.
      */}
      {connection.status === "reauth" ? (
        <div className="grid gap-2 rounded-md border border-edge-raised p-3">
          <p className="text-sm text-foreground">
            Chroneli has lost access to your Google Calendar, so meetings have
            stopped updating. Reconnect to start syncing again.
          </p>
          <button
            type="button"
            onClick={actions.connect}
            className={connectButtonClass}
          >
            Reconnect
          </button>
        </div>
      ) : null}

      {calendars.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No calendars found on this account yet.
        </p>
      ) : (
        <ul className="grid gap-3">
          {calendars.map((calendar) => (
            <li
              key={calendar._id}
              className="flex flex-wrap items-center justify-between gap-3"
            >
              <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                {calendar.summary}
              </span>

              {/*
                The project entries made from this calendar's meetings inherit.
                DISABLED while the calendar is hidden: a hidden calendar is not
                mirrored, so nothing on it can become an entry, so a default
                project there is a setting with no effect — and a control that
                does nothing is worse than no control.

                `ProjectPicker` has no `disabled` prop of its own, so a hidden
                calendar renders a SEPARATE, genuinely non-interactive button in
                its place rather than the real picker wrapped in `aria-disabled`
                — a `pointer-events-none` div still leaves the underlying trigger
                focusable and clickable by keyboard, which is a lie a screen
                reader or a keyboard user would believe. A native
                `disabled` button cannot be focused or activated by any input at
                all, and is announced as "Project, button, dimmed" (exact wording
                is the screen reader's), never as if it might do something.
              */}
              {calendar.show ? (
                <ProjectPicker
                  projects={projects}
                  value={calendar.defaultProjectId ?? null}
                  onCreate={actions.createProject}
                  onChange={(projectId) =>
                    actions.setProject(calendar.googleId, projectId)
                  }
                />
              ) : (
                <Button
                  type="button"
                  variant="quiet"
                  size="row-trigger"
                  disabled
                  aria-label="Project"
                  className="rounded-md px-2 py-0 text-[length:inherit] text-muted-foreground"
                >
                  <FolderClosed className="size-4" />
                </Button>
              )}

              <CalendarShowSwitch
                checked={calendar.show}
                label={`Show ${calendar.summary} on the calendar view`}
                onChange={(next) => actions.setShow(calendar.googleId, next)}
              />
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center justify-between gap-3">
        {/* Through the app's own time formatter, never a raw timestamp — and
            nothing at all before the first sync, because "never" as a date reads
            as a fault. */}
        <span className="text-xs text-muted-foreground">
          {connection.lastSyncedAt === null
            ? "Not synced yet"
            : `Last synced ${formatTimeOfInstant(connection.lastSyncedAt, timeZone, use12Hour)}`}
        </span>
        <button
          type="button"
          onClick={actions.disconnect}
          className="text-xs text-muted-foreground underline underline-offset-2"
        >
          Disconnect
        </button>
      </div>
    </div>
  )
}

/**
 * The "show this calendar on the grid" control.
 *
 * No `Switch` component exists in `src/components/ui` — this codebase has never
 * needed a two-state toggle before, only checkboxes (`SelectionCheckbox`,
 * the plain `<input type="checkbox">`s on this same page) and the pressed-icon
 * `BillableToggle`. A native `<button role="switch" aria-checked>` is the
 * standard accessible pattern for exactly this control, is reachable and
 * operable from the keyboard with no extra wiring (Enter and Space both
 * activate a `<button>`), and needs no colour to carry its state — `aria-checked`
 * carries it for assistive tech, and the thumb's position carries it visually.
 */
function CalendarShowSwitch({
  checked,
  label,
  onChange,
}: {
  checked: boolean
  label: string
  onChange: (next: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        checked ? "border-foreground bg-foreground" : "border-edge bg-ground"
      )}
    >
      <span
        className={cn(
          "inline-block size-3.5 rounded-full shadow transition-transform",
          checked ? "translate-x-4 bg-ground" : "translate-x-0.5 bg-foreground"
        )}
      />
    </button>
  )
}
