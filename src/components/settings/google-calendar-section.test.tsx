import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { GoogleCalendarSection } from "@/components/settings/google-calendar-section"
import type { GoogleConnectionStatus } from "@/components/settings/google-calendar-section"
import type { Doc, Id } from "../../../convex/_generated/dataModel"

afterEach(cleanup)

const NOW = Date.parse("2026-08-17T09:00:00.000Z")

function calendar(over: Partial<Doc<"googleCalendars">> = {}) {
  return {
    _id: "gc_1" as Id<"googleCalendars">,
    _creationTime: NOW,
    userId: "user_alice",
    googleId: "primary",
    summary: "Brent",
    show: false,
    syncToken: null,
    lastSyncedAt: null,
    updatedAt: NOW,
    ...over,
  } as Doc<"googleCalendars">
}

function project(over: Partial<Doc<"projects">> = {}) {
  return {
    _id: "proj_1" as Id<"projects">,
    _creationTime: NOW,
    userId: "user_alice",
    name: "Acme",
    color: "amber",
    archived: false,
    billableByDefault: false,
    hourlyRateCents: undefined,
    updatedAt: NOW,
    deletedAt: null,
    ...over,
  } as Doc<"projects">
}

/** A connection, with the fields a case is not about filled in. `lastError`
 *  defaults to null so only the tests that are about a failing sync see the
 *  "attempts have failed" line. */
function conn(
  over: Partial<GoogleConnectionStatus> = {}
): GoogleConnectionStatus {
  return {
    connected: true,
    status: "ok",
    lastSyncedAt: NOW,
    lastError: null,
    lastErrorAt: null,
    ...over,
  }
}

const noActions = {
  connect: vi.fn(),
  disconnect: vi.fn(),
  setShow: vi.fn(),
  setProject: vi.fn(),
  createProject: vi.fn(async () => ({ projectId: "proj_new" as Id<"projects"> })),
}

afterEach(() => {
  noActions.connect.mockClear()
  noActions.disconnect.mockClear()
  noActions.setShow.mockClear()
  noActions.setProject.mockClear()
  noActions.createProject.mockClear()
})

describe("GoogleCalendarSection", () => {
  it("offers to connect when nothing is linked", () => {
    render(
      <GoogleCalendarSection
        connection={conn({ connected: false, status: "ok", lastSyncedAt: null })}
        calendars={[]}
        projects={[]}
        timeZone="UTC"
        use12Hour={false}
        nowMs={NOW}
        actions={noActions}
      />
    )
    expect(screen.getByRole("button", { name: /Connect Google/i })).toBeTruthy()
    expect(screen.queryByRole("switch")).toBeNull()
  })

  it("lists calendars with a Show control once connected", () => {
    render(
      <GoogleCalendarSection
        connection={conn({ connected: true, status: "ok", lastSyncedAt: NOW })}
        calendars={[
          calendar(),
          calendar({ _id: "gc_2" as Id<"googleCalendars">, googleId: "team", summary: "Team" }),
        ]}
        projects={[]}
        timeZone="UTC"
        use12Hour={false}
        nowMs={NOW}
        actions={noActions}
      />
    )
    expect(screen.getByText("Brent")).toBeTruthy()
    expect(screen.getByText("Team")).toBeTruthy()
    expect(screen.getAllByRole("switch")).toHaveLength(2)
  })

  it("calls setShow with the calendar's google id", () => {
    const setShow = vi.fn()
    render(
      <GoogleCalendarSection
        connection={conn({ connected: true, status: "ok", lastSyncedAt: NOW })}
        calendars={[calendar()]}
        projects={[]}
        timeZone="UTC"
        use12Hour={false}
        nowMs={NOW}
        actions={{ ...noActions, setShow }}
      />
    )
    fireEvent.click(screen.getByRole("switch"))
    expect(setShow).toHaveBeenCalledWith("primary", true)
  })

  it("shows the re-consent banner when the grant was revoked", () => {
    render(
      <GoogleCalendarSection
        connection={conn({ connected: true, status: "reauth", lastSyncedAt: NOW })}
        calendars={[calendar({ show: true })]}
        projects={[]}
        timeZone="UTC"
        use12Hour={false}
        nowMs={NOW}
        actions={noActions}
      />
    )
    // The banner is the ONLY thing that tells a user their calendar stopped
    // syncing. Without it the grid simply goes quiet, which reads as "no
    // meetings this week".
    expect(screen.getByText(/lost access/i)).toBeTruthy()
    expect(screen.getByRole("button", { name: /Reconnect/i })).toBeTruthy()
  })

  it("disables the project picker on a hidden calendar", () => {
    // A hidden calendar is not mirrored, so nothing it holds can become an
    // entry, so a default project on it would be a setting with no effect.
    render(
      <GoogleCalendarSection
        connection={conn({ connected: true, status: "ok", lastSyncedAt: NOW })}
        calendars={[calendar({ show: false })]}
        projects={[]}
        timeZone="UTC"
        use12Hour={false}
        nowMs={NOW}
        actions={noActions}
      />
    )
    const trigger = screen.getByRole("button", { name: /project/i })
    expect(trigger.getAttribute("disabled")).not.toBeNull()
  })

  it("clicking a disabled project picker does nothing — it is genuinely inert, not just styled to look it", () => {
    const setProject = vi.fn()
    render(
      <GoogleCalendarSection
        connection={conn({ connected: true, status: "ok", lastSyncedAt: NOW })}
        calendars={[calendar({ show: false })]}
        projects={[project()]}
        timeZone="UTC"
        use12Hour={false}
        nowMs={NOW}
        actions={{ ...noActions, setProject }}
      />
    )
    fireEvent.click(screen.getByRole("button", { name: /project/i }))
    expect(screen.queryByRole("option")).toBeNull()
    expect(setProject).not.toHaveBeenCalled()
  })

  it("opens a real picker and calls setProject with the calendar's google id, on a shown calendar", () => {
    const setProject = vi.fn()
    render(
      <GoogleCalendarSection
        connection={conn({ connected: true, status: "ok", lastSyncedAt: NOW })}
        calendars={[calendar({ show: true })]}
        projects={[project()]}
        timeZone="UTC"
        use12Hour={false}
        nowMs={NOW}
        actions={{ ...noActions, setProject }}
      />
    )
    fireEvent.click(screen.getByLabelText(/^Project/))
    fireEvent.click(screen.getByRole("option", { name: /Acme/ }))
    expect(setProject).toHaveBeenCalledWith("primary", "proj_1")
  })

  it("formats Last synced through the app's own time formatter, in the caller's zone and clock", () => {
    render(
      <GoogleCalendarSection
        connection={conn({ connected: true, status: "ok", lastSyncedAt: NOW })}
        calendars={[]}
        projects={[]}
        timeZone="America/New_York"
        use12Hour={true}
        nowMs={NOW}
        actions={noActions}
      />
    )
    // NOW is 09:00 UTC == 5:00 AM in America/New_York.
    expect(screen.getByText(/Last synced 5:00 AM/)).toBeTruthy()
  })

  it("says the date too when the last sync was not today", () => {
    // A time of day alone reads as today, so a three-day-old mirror looked
    // freshly synced — the precise opposite of what this line is for.
    render(
      <GoogleCalendarSection
        connection={conn({ lastSyncedAt: NOW - 3 * 86_400_000 })}
        calendars={[]}
        projects={[]}
        timeZone="UTC"
        use12Hour={false}
        nowMs={NOW}
        actions={noActions}
      />
    )
    expect(screen.getByText(/Last synced 14 Aug, 09:00/)).toBeTruthy()
  })

  it("says syncing is failing while the grant itself is still good", () => {
    /*
     * A 429 or a 5xx leaves `status` at "ok" on purpose, so the cron keeps
     * retrying. With `lastSyncedAt` no longer stamped on a failed run, this
     * sentence is the only thing on the screen that explains why the time has
     * stopped moving. As TEXT, never a colour.
     */
    render(
      <GoogleCalendarSection
        connection={conn({ lastError: "events.list failed (429)", lastErrorAt: NOW })}
        calendars={[]}
        projects={[]}
        timeZone="UTC"
        use12Hour={false}
        nowMs={NOW}
        actions={noActions}
      />
    )
    expect(screen.getByText(/attempts to sync this calendar have failed/i)).toBeTruthy()
    // The re-consent banner is a different state and must not appear too.
    expect(screen.queryByText(/lost access/i)).toBeNull()
  })

  it("does not repeat itself when the grant is gone — the re-consent banner already says it", () => {
    render(
      <GoogleCalendarSection
        connection={conn({
          status: "reauth",
          lastError: "Google refused the refresh token",
          lastErrorAt: NOW,
        })}
        calendars={[]}
        projects={[]}
        timeZone="UTC"
        use12Hour={false}
        nowMs={NOW}
        actions={noActions}
      />
    )
    expect(screen.getByText(/lost access/i)).toBeTruthy()
    expect(screen.queryByText(/attempts to sync/i)).toBeNull()
  })

  it("renders nothing about syncing before the first sync ever completes — 'never' as a date reads as a fault", () => {
    render(
      <GoogleCalendarSection
        connection={conn({ connected: true, status: "ok", lastSyncedAt: null })}
        calendars={[]}
        projects={[]}
        timeZone="UTC"
        use12Hour={false}
        nowMs={NOW}
        actions={noActions}
      />
    )
    expect(screen.queryByText(/Last synced/)).toBeNull()
    expect(screen.getByText(/Not synced yet/)).toBeTruthy()
  })

  it("calls disconnect from its own button", () => {
    const disconnect = vi.fn()
    render(
      <GoogleCalendarSection
        connection={conn({ connected: true, status: "ok", lastSyncedAt: NOW })}
        calendars={[]}
        projects={[]}
        timeZone="UTC"
        use12Hour={false}
        nowMs={NOW}
        actions={{ ...noActions, disconnect }}
      />
    )
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }))
    expect(disconnect).toHaveBeenCalled()
  })
})
