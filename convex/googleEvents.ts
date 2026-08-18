import { MAX_ATTENDEES, MAX_DESCRIPTION_LENGTH } from "./schema"

/*
 * Google Calendar JSON, mapped to the mirror.
 *
 * PURE, and at the convex root rather than under convex/lib — that directory is
 * aliased `@shared` and compiled into the client bundle, and none of this is
 * needed in a browser. The same placement `entryTags.ts` has, for the same
 * reason `schema.ts` gives for it.
 *
 * Everything here treats its input as `unknown` and narrows. The Calendar API is
 * a network boundary: a field that is documented as present is still absent in
 * practice on some rows, and a mapper that trusts the shape crashes the cron for
 * every user at once.
 */

export type GoogleAttendee = {
  name?: string
  email?: string
  response: string
}

export type GoogleEventRow = {
  calendarId: string
  eventId: string
  title: string
  startedAt: number
  endedAt: number
  isAllDay: boolean
  status: string
  myResponse: string
  location?: string
  description?: string
  conferenceUrl?: string
  htmlLink?: string
  organizer?: { name?: string; email?: string }
  attendees: Array<GoogleAttendee>
  attendeeCount: number
  googleUpdatedAt: number
}

/**
 * What one item in a sync page means.
 *
 * A DELETE is not an error case, it is half the protocol. Incremental sync
 * reports a removed or cancelled event as `{ id, status: "cancelled" }` with no
 * `start` and no `end` — a tombstone. Storing it would leave a block on the grid
 * for a meeting that is not happening, and there are no times to store anyway.
 */
export type GoogleSyncItem =
  | { kind: "delete"; eventId: string }
  | { kind: "upsert"; row: GoogleEventRow }

function str(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined
}

function obj(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined
}

/**
 * One end of an event, as an instant.
 *
 * Google sends either `dateTime` (RFC3339 WITH an offset — absolute, so
 * `Date.parse` is lossless) or `date` (a bare calendar day, for an all-day
 * event). A bare day has no zone and therefore no single instant; it is parsed
 * as UTC midnight and the row is flagged `isAllDay`, which is what stops it
 * being drawn. Nothing downstream may treat an all-day span as a working window.
 */
function instantOf(
  side: Record<string, unknown> | undefined
): { ms: number; allDay: boolean } | null {
  if (side === undefined) return null
  const dateTime = str(side.dateTime)
  if (dateTime !== undefined) {
    const ms = Date.parse(dateTime)
    return Number.isFinite(ms) ? { ms, allDay: false } : null
  }
  const date = str(side.date)
  if (date !== undefined) {
    const ms = Date.parse(`${date}T00:00:00.000Z`)
    return Number.isFinite(ms) ? { ms, allDay: true } : null
  }
  return null
}

/** The video link, if Google gave one. `entryPoints` also carries phone numbers
 *  and SIP addresses; only the video one is a thing to click from here. */
function conferenceUrlOf(raw: Record<string, unknown>): string | undefined {
  const data = obj(raw.conferenceData)
  const points = data === undefined ? undefined : data.entryPoints
  if (Array.isArray(points)) {
    for (const point of points) {
      const entry = obj(point)
      if (entry !== undefined && entry.entryPointType === "video") {
        const uri = str(entry.uri)
        if (uri !== undefined) return uri
      }
    }
  }
  return str(raw.hangoutLink)
}

export function mapGoogleEvent(
  raw: unknown,
  calendarId: string
): GoogleSyncItem | null {
  const event = obj(raw)
  if (event === undefined) return null

  const eventId = str(event.id)
  if (eventId === undefined) return null

  if (event.status === "cancelled") return { kind: "delete", eventId }

  const start = instantOf(obj(event.start))
  const end = instantOf(obj(event.end))
  if (start === null || end === null) return null

  const rawAttendees = Array.isArray(event.attendees) ? event.attendees : []
  const attendees: Array<GoogleAttendee> = []
  let myResponse = "none"
  for (const candidate of rawAttendees) {
    const attendee = obj(candidate)
    if (attendee === undefined) continue
    // The RSVP is read off EVERY attendee, not only the capped slice: the self
    // attendee can sit past MAX_ATTENDEES on a large invite, and losing it there
    // would silently report "none" on exactly the meetings with most people in
    // them.
    if (attendee.self === true) {
      myResponse = str(attendee.responseStatus) ?? "needsAction"
    }
    if (attendees.length < MAX_ATTENDEES) {
      attendees.push({
        name: str(attendee.displayName),
        email: str(attendee.email),
        response: str(attendee.responseStatus) ?? "needsAction",
      })
    }
  }

  const organizerRaw = obj(event.organizer)
  const description = str(event.description)
  const updated = Date.parse(str(event.updated) ?? "")

  return {
    kind: "upsert",
    row: {
      calendarId,
      eventId,
      // "" is legal and normal. A nameless event must still be drawable, and the
      // grid's own `titleOf` fallback is what names it.
      title: str(event.summary) ?? "",
      startedAt: start.ms,
      // An all-day end is Google's EXCLUSIVE next-day midnight, which is already
      // the span we want. A timed end that is not after its start would make a
      // zero-height block; one minute is the same floor `calendarEvents` applies
      // to an entry, for the same reason.
      endedAt: Math.max(end.ms, start.ms + 60_000),
      isAllDay: start.allDay || end.allDay,
      // schema.ts documents this column as "confirmed" | "tentative", never
      // "cancelled" — but the validator is v.string(), so nothing at the
      // database layer enforces that. This narrowing is what makes the
      // invariant true rather than merely something Google happens to send
      // today; "cancelled" is already routed to a delete tombstone above, so
      // anything else Google sends collapses to "confirmed".
      status: event.status === "tentative" ? "tentative" : "confirmed",
      myResponse,
      location: str(event.location),
      description:
        description === undefined
          ? undefined
          : description.slice(0, MAX_DESCRIPTION_LENGTH),
      conferenceUrl: conferenceUrlOf(event),
      htmlLink: str(event.htmlLink),
      organizer:
        organizerRaw === undefined
          ? undefined
          : {
              name: str(organizerRaw.displayName),
              email: str(organizerRaw.email),
            },
      attendees,
      attendeeCount: rawAttendees.length,
      googleUpdatedAt: Number.isFinite(updated) ? updated : start.ms,
    },
  }
}

/** Whether a mirrored event may be drawn on the time grid at all.
 *
 *  All-day events are the whole rule: they have no clock, so they have no
 *  defensible span — and `allDaySlot={false}` means the grid has no rail to put
 *  them on anyway. */
export function isDrawable(row: { isAllDay: boolean }): boolean {
  return !row.isAllDay
}
