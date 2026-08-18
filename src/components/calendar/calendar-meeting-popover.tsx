import { Popover } from "@/components/ui/popover"
import { formatTimeRange } from "@/lib/format-time"
import type { Meeting } from "@/lib/calendar-meetings"

/** How Google's RSVP strings read to a human. Google's own vocabulary is
 *  `needsAction`, which means nothing to anyone outside its API docs. */
const RESPONSE_LABEL: Record<string, string> = {
  accepted: "Accepted",
  declined: "Declined",
  tentative: "Maybe",
  needsAction: "No response",
}

export function CalendarMeetingPopover({
  meeting,
  anchor,
  onClose,
  timeZone,
  use12Hour,
}: {
  meeting: Meeting
  anchor: HTMLElement
  onClose: () => void
  timeZone: string
  use12Hour: boolean
}) {
  /*
   * READ-ONLY, and that is the whole design of this component.
   *
   * It exists so the user stops leaving the tracker to look a meeting up. Every
   * value in it is Google's, none of it is editable here, and the link out is
   * what handles "actually I need to change this". Phase 2 adds exactly one
   * control — the track-on-start tick — and nothing else in here will ever
   * write.
   */
  const title = meeting.title.trim() === "" ? "Untitled" : meeting.title
  const listed = meeting.attendees.length
  const unlisted = Math.max(0, meeting.attendeeCount - listed)

  return (
    <Popover.Root
      open
      onOpenChange={(next) => {
        // Escape, an outside press and the × below all arrive here. The panel
        // above drops its selection, which unmounts this — so there is one way
        // closed rather than a local flag that could disagree with it.
        if (!next) onClose()
      }}
    >
      <Popover.Popup
        anchor={anchor}
        side="right"
        align="start"
        aria-label={`Meeting: ${title}`}
        className="w-[21rem] gap-0 p-0"
      >
        <div className="grid gap-3 p-3">
          <div className="grid gap-1">
            <span className="text-sm font-medium text-foreground">{title}</span>
            {/* Through `formatTimeRange`, never a local format: a meeting must be
                spelled exactly like the same window on an entry, or one screen
                carries two clocks. The Tabular Rule applies to every digit. */}
            <span className="font-mono tabular-nums tracking-[-0.02em] text-xs text-muted-foreground">
              {formatTimeRange(
                meeting.startedAt,
                meeting.endedAt,
                timeZone,
                use12Hour
              )}
            </span>
          </div>

          {meeting.location === undefined ? null : (
            <span className="text-xs text-muted-foreground">
              {meeting.location}
            </span>
          )}

          {meeting.conferenceUrl === undefined ? null : (
            <a
              href={meeting.conferenceUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-foreground underline underline-offset-2"
            >
              Join the call
            </a>
          )}

          {meeting.organizer?.name === undefined &&
          meeting.organizer?.email === undefined ? null : (
            <span className="text-xs text-muted-foreground">
              Organised by {meeting.organizer.name ?? meeting.organizer.email}
            </span>
          )}

          {listed === 0 ? null : (
            <ul className="grid gap-1">
              {meeting.attendees.map((attendee) => (
                <li
                  key={attendee.email ?? attendee.name}
                  className="flex items-baseline justify-between gap-3 text-xs"
                >
                  <span className="truncate text-foreground">
                    {attendee.name ?? attendee.email}
                  </span>
                  {/* The RSVP as TEXT, never as a colour alone — PRODUCT.md's rule
                      that meaning is never encoded in hue, which matters here
                      because "declined" and "accepted" are the two a user scans
                      for. */}
                  <span className="shrink-0 text-muted-foreground">
                    {RESPONSE_LABEL[attendee.response] ?? attendee.response}
                  </span>
                </li>
              ))}
              {unlisted === 0 ? null : (
                <li className="text-xs text-muted-foreground">
                  and {unlisted} more
                </li>
              )}
            </ul>
          )}

          {meeting.description === undefined ? null : (
            // `whitespace-pre-wrap`, like a party block on an invoice: this is
            // prose a human wrote, newlines and all. Never parsed, never linkified
            // — rendering someone else's HTML from a calendar invite is not a thing
            // this app is going to do.
            <p className="max-h-40 overflow-y-auto whitespace-pre-wrap text-xs text-muted-foreground">
              {meeting.description}
            </p>
          )}

          {meeting.htmlLink === undefined ? null : (
            <a
              href={meeting.htmlLink}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-muted-foreground underline underline-offset-2"
            >
              Open in Google Calendar
            </a>
          )}
        </div>
      </Popover.Popup>
    </Popover.Root>
  )
}
