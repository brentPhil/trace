import { ExternalLinkIcon, MapPinIcon, VideoIcon } from "lucide-react"
import { Popover } from "@/components/ui/popover"
import { formatTimeRange } from "@/lib/format-time"
import { linkify, safeHref } from "@/lib/linkify"
import type { Meeting } from "@/lib/calendar-meetings"

/** How Google's RSVP strings read to a human. Google's own vocabulary is
 *  `needsAction`, which means nothing to anyone outside its API docs. */
const RESPONSE_LABEL: Record<string, string> = {
  accepted: "Accepted",
  declined: "Declined",
  tentative: "Maybe",
  needsAction: "No response",
}

/**
 * A guest list, counted.
 *
 * The counts are what the header line states, and they are also what lets the
 * ROWS stay quiet: an attendee who has not replied shows no label at all, and
 * the total of those people is said once, up here, instead of six times down
 * there. Before this, a seven-person invite printed "No response" six times in
 * a column — the same word, repeated, carrying no information after the first.
 */
function countResponses(attendees: Meeting["attendees"]) {
  let accepted = 0
  let declined = 0
  let tentative = 0
  let awaiting = 0

  for (const attendee of attendees) {
    if (attendee.response === "accepted") accepted += 1
    else if (attendee.response === "declined") declined += 1
    else if (attendee.response === "tentative") tentative += 1
    else awaiting += 1
  }

  return { accepted, declined, tentative, awaiting }
}

/**
 * The invite body, with its links made clickable.
 *
 * `linkify` SPLITS the text and this renders our own anchors around the runs it
 * found — the description is never interpreted as markup, because it was
 * written by whoever sent the invite. See the argument at the top of
 * `src/lib/linkify.ts`.
 *
 * `break-all` on the anchor and `overflow-wrap-anywhere` on the block are what
 * killed the HORIZONTAL scrollbar this used to grow: a Teams join URL is one
 * unbroken 60-character token with no space to wrap at, so the paragraph was
 * wider than the popover and the user got two scrollbars, one of which moved
 * the text sideways.
 */
function Description({ text }: { text: string }) {
  return (
    <p className="max-h-36 overflow-x-hidden overflow-y-auto text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground [overflow-wrap:anywhere]">
      {linkify(text).map((segment, index) =>
        segment.kind === "link" ? (
          <a
            key={index}
            href={segment.href}
            target="_blank"
            rel="noreferrer"
            className="break-all text-foreground underline underline-offset-2 hover:text-foreground/80"
          >
            {segment.value}
          </a>
        ) : (
          // Index as key is safe: this list is derived fresh from one string on
          // every render and is never reordered or filtered.
          <span key={index}>{segment.value}</span>
        )
      )}
    </p>
  )
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
  const conferenceHref = safeHref(meeting.conferenceUrl)
  const htmlHref = safeHref(meeting.htmlLink)
  const counts = countResponses(meeting.attendees)
  const organiser = meeting.organizer?.name ?? meeting.organizer?.email

  /*
   * The guest-list summary, in words rather than in marks.
   *
   * Only the states that actually occur are named, so a fully-accepted meeting
   * says "3 guests · 3 accepted" and never mentions the four states that did
   * not happen. "awaiting reply" rather than "no response": the same fact, said
   * as something still open rather than as an absence.
   */
  const summary = [
    counts.accepted === 0 ? null : `${counts.accepted} accepted`,
    counts.declined === 0 ? null : `${counts.declined} declined`,
    counts.tentative === 0 ? null : `${counts.tentative} maybe`,
    counts.awaiting === 0 ? null : `${counts.awaiting} awaiting reply`,
  ].filter((part) => part !== null)

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
        {/*
          SECTIONS DIVIDED BY HAIRLINES, not by gaps alone.

          This popover carries four unrelated kinds of thing — when, where, who,
          and what the sender wrote — and at a uniform gap they ran together into
          one column of small grey text that had to be read start to finish. A
          rule per section is what lets the eye jump to the one being looked for.
          `edge-soft` throughout: these divide passive content, where no contrast
          floor applies.
        */}
        <div className="divide-y divide-edge-soft">
          <header className="grid gap-1 p-3">
            <h2 className="text-sm leading-snug font-medium text-balance text-foreground">
              {title}
            </h2>
            {/* Through `formatTimeRange`, never a local format: a meeting must be
                spelled exactly like the same window on an entry, or one screen
                carries two clocks. The Tabular Rule applies to every digit. */}
            <span className="font-mono text-xs tracking-[-0.02em] tabular-nums text-muted-foreground">
              {formatTimeRange(
                meeting.startedAt,
                meeting.endedAt,
                timeZone,
                use12Hour
              )}
            </span>
          </header>

          {conferenceHref === null && meeting.location === undefined ? null : (
            <div className="grid gap-2 p-3">
              {conferenceHref === null ? null : (
                /*
                 * THE PRIMARY ACTION, and given the weight of one.
                 *
                 * It was a small underlined phrase among four other small
                 * underlined phrases. Joining the call is the single most
                 * likely reason somebody opens this popover during the working
                 * day, so it reads as a control: a full-width target with a
                 * border, at the top, where the eye lands first.
                 *
                 * Still an anchor rather than a button — it navigates.
                 */
                <a
                  href={conferenceHref}
                  target="_blank"
                  rel="noreferrer"
                  className="flex h-8 items-center justify-center gap-1.5 rounded-md border border-edge-raised text-xs font-medium text-foreground transition-colors hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  <VideoIcon className="size-3.5" aria-hidden />
                  Join the call
                </a>
              )}

              {meeting.location === undefined ? null : (
                <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
                  <MapPinIcon
                    className="mt-0.5 size-3.5 shrink-0"
                    aria-hidden
                  />
                  <span className="[overflow-wrap:anywhere]">
                    {meeting.location}
                  </span>
                </div>
              )}
            </div>
          )}

          {listed === 0 && organiser === undefined ? null : (
            <div className="grid gap-2 p-3">
              {listed === 0 ? null : (
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-medium text-foreground">
                    {meeting.attendeeCount}{" "}
                    {meeting.attendeeCount === 1 ? "guest" : "guests"}
                  </span>
                  {summary.length === 0 ? null : (
                    <span className="truncate text-xs text-muted-foreground">
                      {summary.join(" · ")}
                    </span>
                  )}
                </div>
              )}

              {organiser === undefined ? null : (
                <span className="text-xs text-muted-foreground">
                  Organised by {organiser}
                </span>
              )}

              {listed === 0 ? null : (
                <ul className="grid max-h-32 gap-1 overflow-x-hidden overflow-y-auto">
                  {meeting.attendees.map((attendee, index) => (
                    <li
                      key={index}
                      className="flex items-baseline justify-between gap-3 text-xs"
                    >
                      <span className="truncate text-foreground">
                        {/* Index as key is safe here: this list is not
                            reorderable or filterable, and is always re-rendered
                            fresh from a query result. */}
                        {attendee.name ?? attendee.email ?? "Guest"}
                        {/* An attendee with no name and no email is either a
                            resource room or a guest hidden by the organiser's
                            "guests cannot see each other" setting. "Guest" is
                            what Google itself calls such an attendee. */}
                      </span>
                      {/*
                        A LABEL ONLY WHERE SOMEBODY ACTUALLY REPLIED.
                        `needsAction` is the state everyone starts in, so
                        printing it per row repeats one word down the column and
                        drowns the two answers a user is scanning for. The count
                        of non-repliers is stated once in the summary above, so
                        nothing is hidden — it is said in the place where saying
                        it once is enough. Text, never colour alone.
                      */}
                      {attendee.response === "needsAction" ? null : (
                        <span className="shrink-0 text-muted-foreground">
                          {RESPONSE_LABEL[attendee.response] ??
                            attendee.response}
                        </span>
                      )}
                    </li>
                  ))}
                  {unlisted === 0 ? null : (
                    <li className="text-xs text-muted-foreground">
                      and {unlisted} more
                    </li>
                  )}
                </ul>
              )}
            </div>
          )}

          {meeting.description === undefined ? null : (
            <div className="p-3">
              <Description text={meeting.description} />
            </div>
          )}

          {htmlHref === null ? null : (
            <div className="p-3">
              <a
                href={htmlHref}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground"
              >
                Open in Google Calendar
                <ExternalLinkIcon className="size-3" aria-hidden />
              </a>
            </div>
          )}
        </div>
      </Popover.Popup>
    </Popover.Root>
  )
}
