/*
 * The Google Calendar API boundary.
 *
 * `fetch` is INJECTED rather than reached for. `fetch()` is available in the
 * default Convex runtime so this needs no `"use node"`, but a module that calls
 * the global directly cannot be tested without a network or a global stub, and
 * every branch in here is a response class that has to be handled correctly
 * exactly once.
 *
 * The three outcomes are deliberately different types, because the caller's
 * response to each is different and getting them confused is the expensive
 * failure:
 *
 *   - `gone` (410) is ROUTINE. A syncToken has aged out; clear it and refetch
 *     the window. Not an error, and it must not be logged as one.
 *   - `GoogleAuthError` (401/403 on the grant) means STOP. The user revoked
 *     access; retrying every 15 minutes forever is how a quiet failure becomes
 *     an expensive one, and the recovery needs a human to consent again.
 *   - `GoogleTransientError` (429/5xx) means TRY LATER. The mirror stays
 *     stale-but-present, which is the whole reason there is a mirror.
 */

const CALENDAR_API = "https://www.googleapis.com/calendar/v3"

export class GoogleAuthError extends Error {}
export class GoogleTransientError extends Error {}

export type EventsPage = {
  items: Array<unknown>
  nextPageToken: string | null
  nextSyncToken: string | null
  /** True when Google refused a stale `syncToken`. The caller clears the stored
   *  token and refetches the window; the page carries no items. */
  gone: boolean
}

async function call(
  fetchImpl: typeof fetch,
  accessToken: string,
  url: string
): Promise<Response> {
  const response = await fetchImpl(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  })

  if (response.status === 401 || response.status === 403) {
    throw new GoogleAuthError(`Google refused the grant (${response.status})`)
  }
  if (response.status === 429 || response.status >= 500) {
    throw new GoogleTransientError(`Google is unavailable (${response.status})`)
  }
  return response
}

export async function fetchCalendarList(
  fetchImpl: typeof fetch,
  accessToken: string
): Promise<Array<{ googleId: string; summary: string }>> {
  const response = await call(
    fetchImpl,
    accessToken,
    `${CALENDAR_API}/users/me/calendarList?maxResults=250&minAccessRole=reader`
  )
  if (!response.ok) {
    throw new GoogleTransientError(`calendarList failed (${response.status})`)
  }

  const body: unknown = await response.json()
  const items =
    typeof body === "object" && body !== null && Array.isArray(
      (body as { items?: unknown }).items
    )
      ? ((body as { items: Array<unknown> }).items)
      : []

  const calendars: Array<{ googleId: string; summary: string }> = []
  for (const candidate of items) {
    if (typeof candidate !== "object" || candidate === null) continue
    const item = candidate as { id?: unknown; summary?: unknown }
    if (typeof item.id !== "string" || item.id === "") continue
    calendars.push({
      googleId: item.id,
      // A calendar with no summary is normal — a secondary calendar the user
      // never named. Its address is what they would recognise it by anyway, and
      // an empty row in Settings is unclickable.
      summary:
        typeof item.summary === "string" && item.summary !== ""
          ? item.summary
          : item.id,
    })
  }
  return calendars
}

export async function fetchEventsPage(
  fetchImpl: typeof fetch,
  accessToken: string,
  args: {
    calendarId: string
    syncToken: string | null
    timeMinMs: number
    timeMaxMs: number
    pageToken: string | null
  }
): Promise<EventsPage> {
  const params = new URLSearchParams({
    // Recurrences as INSTANCES, not as a rule plus exceptions. Each instance
    // gets its own event id, which is what keeps a daily standup from being one
    // row — and what makes Phase 2's per-meeting checkbox addressable at all.
    singleEvents: "true",
    maxResults: "250",
  })

  if (args.syncToken !== null) {
    // Google rejects syncToken combined with a time window outright, so this is
    // an either/or rather than a preference.
    params.set("syncToken", args.syncToken)
  } else {
    params.set("timeMin", new Date(args.timeMinMs).toISOString())
    params.set("timeMax", new Date(args.timeMaxMs).toISOString())
  }
  if (args.pageToken !== null) params.set("pageToken", args.pageToken)

  const response = await call(
    fetchImpl,
    accessToken,
    `${CALENDAR_API}/calendars/${encodeURIComponent(args.calendarId)}/events?${params.toString()}`
  )

  if (response.status === 410) {
    return { items: [], nextPageToken: null, nextSyncToken: null, gone: true }
  }
  if (!response.ok) {
    throw new GoogleTransientError(`events.list failed (${response.status})`)
  }

  const body = (await response.json()) as {
    items?: unknown
    nextPageToken?: unknown
    nextSyncToken?: unknown
  }
  return {
    items: Array.isArray(body.items) ? body.items : [],
    nextPageToken:
      typeof body.nextPageToken === "string" ? body.nextPageToken : null,
    nextSyncToken:
      typeof body.nextSyncToken === "string" ? body.nextSyncToken : null,
    gone: false,
  }
}
