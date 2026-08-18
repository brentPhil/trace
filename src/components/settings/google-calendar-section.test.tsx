import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { GoogleCalendarSection } from "@/components/settings/google-calendar-section"
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
        connection={{ connected: false, status: "ok", lastSyncedAt: null }}
        calendars={[]}
        projects={[]}
        timeZone="UTC"
        use12Hour={false}
        actions={noActions}
      />
    )
    expect(screen.getByRole("button", { name: /Connect Google/i })).toBeTruthy()
    expect(screen.queryByRole("switch")).toBeNull()
  })

  it("lists calendars with a Show control once connected", () => {
    render(
      <GoogleCalendarSection
        connection={{ connected: true, status: "ok", lastSyncedAt: NOW }}
        calendars={[
          calendar(),
          calendar({ _id: "gc_2" as Id<"googleCalendars">, googleId: "team", summary: "Team" }),
        ]}
        projects={[]}
        timeZone="UTC"
        use12Hour={false}
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
        connection={{ connected: true, status: "ok", lastSyncedAt: NOW }}
        calendars={[calendar()]}
        projects={[]}
        timeZone="UTC"
        use12Hour={false}
        actions={{ ...noActions, setShow }}
      />
    )
    fireEvent.click(screen.getByRole("switch"))
    expect(setShow).toHaveBeenCalledWith("primary", true)
  })

  it("shows the re-consent banner when the grant was revoked", () => {
    render(
      <GoogleCalendarSection
        connection={{ connected: true, status: "reauth", lastSyncedAt: NOW }}
        calendars={[calendar({ show: true })]}
        projects={[]}
        timeZone="UTC"
        use12Hour={false}
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
        connection={{ connected: true, status: "ok", lastSyncedAt: NOW }}
        calendars={[calendar({ show: false })]}
        projects={[]}
        timeZone="UTC"
        use12Hour={false}
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
        connection={{ connected: true, status: "ok", lastSyncedAt: NOW }}
        calendars={[calendar({ show: false })]}
        projects={[project()]}
        timeZone="UTC"
        use12Hour={false}
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
        connection={{ connected: true, status: "ok", lastSyncedAt: NOW }}
        calendars={[calendar({ show: true })]}
        projects={[project()]}
        timeZone="UTC"
        use12Hour={false}
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
        connection={{ connected: true, status: "ok", lastSyncedAt: NOW }}
        calendars={[]}
        projects={[]}
        timeZone="America/New_York"
        use12Hour={true}
        actions={noActions}
      />
    )
    // NOW is 09:00 UTC == 5:00 AM in America/New_York.
    expect(screen.getByText(/Last synced 5:00 AM/)).toBeTruthy()
  })

  it("renders nothing about syncing before the first sync ever completes — 'never' as a date reads as a fault", () => {
    render(
      <GoogleCalendarSection
        connection={{ connected: true, status: "ok", lastSyncedAt: null }}
        calendars={[]}
        projects={[]}
        timeZone="UTC"
        use12Hour={false}
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
        connection={{ connected: true, status: "ok", lastSyncedAt: NOW }}
        calendars={[]}
        projects={[]}
        timeZone="UTC"
        use12Hour={false}
        actions={{ ...noActions, disconnect }}
      />
    )
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }))
    expect(disconnect).toHaveBeenCalled()
  })
})
