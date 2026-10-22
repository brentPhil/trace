import { MIN_SPAN_MS } from "@/lib/calendar-events"
import type { CalendarEventProps } from "@/lib/calendar-events"
import type { EventInput } from "@fullcalendar/react"
import type { Doc, Id } from "../../convex/_generated/dataModel"

/**
 * Google meetings, in the shape FullCalendar takes.
 *
 * The twin of `calendarEvents` in `calendar-events.ts`, and pure for the same
 * reason: a mapping is cheaper to pin down as a function than through a grid,
 * and jsdom cannot assert geometry.
 */

/** A mirrored event plus what this app knows about it — what `google.listMeetings`
 *  returns. */
export type Meeting = Doc<"googleEvents"> & {
  trackOnStart: boolean
  entryId: Id<"timeEntries"> | null
}

/**
 * The typed half of a meeting block's `extendedProps`.
 *
 * `kind` is what tells the panel's render hooks which sort of block they are
 * looking at. It is a DISCRIMINATOR on the props rather than two separate event
 * arrays, because FullCalendar hands back one `EventApi` from `eventClick` and
 * the handler has to decide which popover to open from that alone.
 */
export type MeetingEventProps = {
  kind: "meeting"
  calendarId: string
  eventId: string
  startedAt: number
  endedAt: number
  trackOnStart: boolean
  /**
   * The meeting has not begun, so a tick still has a switch left to fire.
   *
   * Computed here rather than in the render hook so the panel's memo does not
   * re-derive it per block per second — the hook runs once per block per
   * render, this runs once per meeting per mapping.
   */
  startable: boolean
  /**
   * When this meeting's own entry is the running timer, the instant that entry
   * started; `null` otherwise. Non-null draws the block in the running accent
   * with its elapsed clock — see the skip rule in `meetingEvents`.
   */
  recordingSince: number | null
}

/** The same discriminator on an ENTRY's props, so the panel can narrow either
 *  way. `calendar-events.ts` omits `kind` on its own props; absence is what
 *  identifies an entry, and this predicate is the only place that is relied on.
 *
 *  The union has exactly these two members, so presence of `kind` IS the test;
 *  a `=== "meeting"` beside it compared the literal against itself. A third
 *  event kind would have to revisit this predicate anyway. */
export function isMeetingEvent(
  props: CalendarEventProps | MeetingEventProps
): props is MeetingEventProps {
  return "kind" in props
}

/**
 * @param nowMs The instant `startable` is measured against. Only that one
 * field reads it — a meeting's start and end are stored instants and nothing
 * else here moves with the clock, which is what lets the panel hand this a
 * PINNED value rather than the once-a-second one. See `meetingClockMs` there.
 * @param running The running entry, if any — its id and start only, both of
 * which hold still while it runs, so the panel's memo stays put between ticks.
 */
export function meetingEvents(
  meetings: Array<Meeting>,
  nowMs: number,
  running: { entryId: Id<"timeEntries">; startedAt: number } | null = null
): Array<EventInput & { extendedProps: MeetingEventProps }> {
  const events: Array<EventInput & { extendedProps: MeetingEventProps }> = []

  for (const meeting of meetings) {
    /*
     * A MEETING THAT HAS BECOME AN ENTRY IS NOT DRAWN.
     *
     * FullCalendar packs overlapping events into side-by-side columns, so a
     * tracked meeting and the entry it produced would each take half the column
     * and show the same hour twice. The entry is the thing worth drawing: it is
     * editable, it counts toward the day's total, and it is what gets invoiced.
     *
     * So a meeting is a ghost right up to the moment it becomes real, and a
     * block on the grid means exactly one thing at a time.
     *
     * EXCEPT WHILE IT IS BEING RECORDED. A running entry's block starts at the
     * instant tracking began and grows with the clock, so swapping the meeting
     * for it made the block jump to another size the moment the meeting
     * started — and took the meeting's details with it. Until the timer stops,
     * the MEETING keeps its block and wears the running accent; the panel
     * leaves that entry out, so the hour is still drawn once. Once stopped, the
     * entry is the record and takes over as above.
     */
    const recording = running !== null && meeting.entryId === running.entryId
    if (meeting.entryId !== null && !recording) continue

    // No clock, and `allDaySlot={false}` means no rail to draw it on. The server
    // filters these too; this is the second half of one rule, kept here because
    // this function must be correct against any input it is handed.
    if (meeting.isAllDay) continue

    events.push({
      /*
       * NAMESPACED, because FullCalendar keys on `id` and this grid now carries
       * two populations. A Convex `_id` from `googleEvents` and one from
       * `timeEntries` cannot collide today, and relying on that is relying on an
       * implementation detail of someone else's id generator.
       */
      id: `meeting:${meeting.calendarId}:${meeting.eventId}`,
      title: meeting.title,
      /*
       * `Date`s from the stored instants, never ISO strings — the same rule
       * `calendarEvents` states at length. FullCalendar reads an offset-less
       * string as wall-clock time in the calendar's own zone, which agrees with
       * the instant today and stops agreeing the moment anything formats the
       * field differently.
       */
      start: new Date(meeting.startedAt),
      // The same one-minute floor an entry gets. FullCalendar drops an event
      // whose end equals its start, and a meeting that exists must be visible or
      // it cannot be read or ticked.
      end: new Date(
        Math.max(meeting.endedAt, meeting.startedAt + MIN_SPAN_MS)
      ),
      extendedProps: {
        kind: "meeting",
        calendarId: meeting.calendarId,
        eventId: meeting.eventId,
        startedAt: meeting.startedAt,
        endedAt: meeting.endedAt,
        trackOnStart: meeting.trackOnStart,
        // `>`, not `>=`: at the start instant itself the switch has already
        // fired, so there is nothing left for a tick to instruct.
        startable: meeting.startedAt > nowMs,
        recordingSince: recording ? running.startedAt : null,
      },
    })
  }

  return events
}
