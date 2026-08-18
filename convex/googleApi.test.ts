// The Calendar API boundary.
//
// Every branch here is a response this code will actually receive and must not
// treat as a crash: a 410 on a stale syncToken is ROUTINE, a 401 means the grant
// is gone and retrying it forever is the expensive failure, and a 429 must leave
// the mirror stale rather than empty. `fetch` is injected so none of that needs
// a network.
import { describe, expect, it, vi } from "vitest"
import {
  GoogleAuthError,
  GoogleTransientError,
  fetchCalendarList,
  fetchEventsPage,
} from "./googleApi"

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

const PAGE_ARGS = {
  calendarId: "primary",
  syncToken: null,
  timeMinMs: Date.parse("2026-06-01T00:00:00.000Z"),
  timeMaxMs: Date.parse("2026-12-01T00:00:00.000Z"),
  pageToken: null,
}

describe("fetchEventsPage", () => {
  it("sends the token, the window, and singleEvents on a full fetch", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ items: [], nextSyncToken: "tok_1" })
    )
    const page = await fetchEventsPage(
      fetchImpl as unknown as typeof fetch,
      "at_abc",
      PAGE_ARGS
    )

    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toContain("/calendars/primary/events")
    expect(url).toContain("singleEvents=true")
    expect(url).toContain("timeMin=2026-06-01T00%3A00%3A00.000Z")
    expect(url).toContain("timeMax=2026-12-01T00%3A00%3A00.000Z")
    expect((init!.headers as Record<string, string>).Authorization).toBe(
      "Bearer at_abc"
    )
    expect(page.nextSyncToken).toBe("tok_1")
    expect(page.gone).toBe(false)
  })

  it("sends syncToken instead of the window when it has one", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({ items: [] }))
    await fetchEventsPage(fetchImpl as unknown as typeof fetch, "at_abc", {
      ...PAGE_ARGS,
      syncToken: "tok_1",
    })
    const [url] = fetchImpl.mock.calls[0]
    expect(url).toContain("syncToken=tok_1")
    // Google rejects the combination outright, so this is not a preference.
    expect(url).not.toContain("timeMin")
  })

  it("reports gone on a 410 instead of throwing", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: { message: "Sync token is no longer valid" } }, 410)
    )
    const page = await fetchEventsPage(
      fetchImpl as unknown as typeof fetch,
      "at_abc",
      { ...PAGE_ARGS, syncToken: "stale" }
    )
    expect(page.gone).toBe(true)
    expect(page.items).toEqual([])
  })

  it("throws GoogleAuthError on a 401", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 401))
    await expect(
      fetchEventsPage(fetchImpl as unknown as typeof fetch, "at_abc", PAGE_ARGS)
    ).rejects.toBeInstanceOf(GoogleAuthError)
  })

  it("throws GoogleTransientError on a 429 and on a 503", async () => {
    for (const status of [429, 503]) {
      const fetchImpl = vi.fn(async () => jsonResponse({}, status))
      await expect(
        fetchEventsPage(fetchImpl as unknown as typeof fetch, "at", PAGE_ARGS)
      ).rejects.toBeInstanceOf(GoogleTransientError)
    }
  })

  it("passes a page token through", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ items: [], nextPageToken: "pg_2" })
    )
    const page = await fetchEventsPage(
      fetchImpl as unknown as typeof fetch,
      "at",
      { ...PAGE_ARGS, pageToken: "pg_1" }
    )
    const [url] = fetchImpl.mock.calls[0]
    expect(url).toContain("pageToken=pg_1")
    expect(page.nextPageToken).toBe("pg_2")
  })
})

describe("fetchCalendarList", () => {
  it("maps id and summary, and falls back to the id when unnamed", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        items: [
          { id: "primary", summary: "Brent" },
          { id: "team@example.com" },
          { summary: "no id, dropped" },
        ],
      })
    )
    const calendars = await fetchCalendarList(
      fetchImpl as unknown as typeof fetch,
      "at"
    )
    expect(calendars).toEqual([
      { googleId: "primary", summary: "Brent" },
      { googleId: "team@example.com", summary: "team@example.com" },
    ])
  })
})
