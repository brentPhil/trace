import {
  ClockIcon,
  ExternalLinkIcon,
  MapPinIcon,
  UserIcon,
  VideoIcon,
} from "lucide-react"
import { Avatar, AvatarFallback, AvatarGroup } from "@/components/ui/avatar"
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
 * Two letters standing for a person.
 *
 * Google sends no photo for an attendee — the Calendar API's attendee object
 * carries name, email and response, nothing more — so the avatar is initials,
 * which is also what Google's own UI falls back to. First and last word of the
 * name; first letter of the email when there is no name; `null` for the hidden
 * guest with neither, who gets a person glyph instead of an empty circle.
 */
function initials(attendee: Meeting["attendees"][number]): string | null {
  const name = attendee.name?.trim()
  if (name !== undefined && name !== "") {
    const words = name.split(/\s+/)
    const first = words[0][0] ?? ""
    const last = words.length > 1 ? (words[words.length - 1][0] ?? "") : ""
    const letters = (first + last).toUpperCase()
    return letters === "" ? null : letters
  }
  const email = attendee.email?.trim()
  if (email !== undefined && email !== "") return email[0].toUpperCase()
  return null
}

/** How many avatars the group shows before folding the rest behind "+N".
 *  Six overlapped circles read at a glance; past that the row is a texture,
 *  not a roster, and the count chip says the rest better. */
const VISIBLE_AVATARS = 6

/**
 * One guest as a circle.
 *
 * The name is in the tooltip and the aria-label, not on the surface — every
 * avatar states who it stands for, it just waits to be asked. `needsAction` is
 * the state everyone starts in, so the label names a reply only where somebody
 * actually replied; non-repliers are counted once, in the summary line.
 *
 * The green ring means accepted and only accepted. It is the one departure
 * from the Two Temperatures Rule, and the summary line restates the same fact
 * in words so the meaning never rests on the ring alone.
 */
function AttendeeAvatar({
  attendee,
}: {
  attendee: Meeting["attendees"][number]
}) {
  const who = attendee.name ?? attendee.email ?? "Guest"
  const label =
    attendee.response === "needsAction"
      ? who
      : `${who} — ${RESPONSE_LABEL[attendee.response] ?? attendee.response}`
  const letters = initials(attendee)
  return (
    <Avatar
      title={label}
      aria-label={label}
      role="img"
      className={
        attendee.response === "accepted"
          ? "after:border-2 after:border-[oklch(0.72_0.13_150)]"
          : undefined
      }
    >
      <AvatarFallback className="bg-ground text-[11px] font-medium text-muted-foreground">
        {letters ?? <UserIcon className="size-3.5" aria-hidden />}
        {/* An attendee with no name and no email is either a resource room or
            a guest hidden by the organiser's "guests cannot see each other"
            setting; a person glyph rather than an empty circle. */}
      </AvatarFallback>
    </Avatar>
  )
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
    <p className="max-h-[26rem] overflow-x-hidden overflow-y-auto text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground [overflow-wrap:anywhere]">
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
  nowMs,
  onSetTrack,
  onTrackNow,
}: {
  meeting: Meeting
  anchor: HTMLElement
  onClose: () => void
  timeZone: string
  use12Hour: boolean
  /**
   * The clock, for the one question this popover asks of it: has the meeting
   * started? Passed in rather than read from `Date.now()` so the answer is the
   * panel's answer — a popover that decided this for itself could draw a tick
   * for a meeting whose block is already showing none.
   */
  nowMs: number
  /**
   * Tick or untick — `api.googleTrack.setTrackOnStart`, handed down.
   *
   * OPTIONAL, and its absence draws NO CONTROL AT ALL. This component is
   * rendered in tests and stories with no mutations behind it, and an inert
   * tick is worse than no tick: the user ticks it, nothing happens, and the
   * meeting quietly does not start.
   */
  onSetTrack?: (calendarId: string, eventId: string, track: boolean) => void
  /** **Track this** — `api.googleTrack.trackNow`. Same optionality, same
   *  reason. */
  onTrackNow?: (calendarId: string, eventId: string) => void
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
   * The fold. Folding exactly one avatar behind a "+1" would spend the same
   * space saying less, so the group only folds when at least two go behind
   * the chip. `overflow` also carries the attendees Google never listed
   * (`unlisted`, past the MAX_ATTENDEES cap) — the chip's number is the true
   * count of people not shown, whichever of the two reasons hid them.
   */
  const folds = listed > VISIBLE_AVATARS + 1
  const shown = folds ? meeting.attendees.slice(0, VISIBLE_AVATARS) : meeting.attendees
  const folded = folds ? meeting.attendees.slice(VISIBLE_AVATARS) : []
  const overflow = folded.length + unlisted

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
        /*
         * Wider and much taller than the Popup default: this one carries a
         * roster and an invite body, and at 21×22rem the description was a
         * keyhole and the Google Calendar link below it was clipped clean off
         * by the Popup's `overflow-hidden`. The cap is the viewport's, not a
         * number: a Teams invite body is the length it is, and the popover
         * gives it the height the screen actually has. The body scrolls as a
         * whole when the viewport beats the cap, so the link out is always
         * reachable.
         */
        className="max-h-[min(56rem,90svh)] w-[26rem] gap-0 p-0"
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
        <div className="min-h-0 divide-y divide-edge-soft overflow-y-auto">
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

          {onSetTrack === undefined && onTrackNow === undefined ? null : (
            <div className="p-3">
              {meeting.startedAt > nowMs ? (
                /*
                 * THE TICK IS THE CONSENT, and this is its second home.
                 *
                 * The block carries one too, but a fifteen-minute meeting has
                 * no room for a control and a meeting on a crowded column may
                 * be two millimetres wide. This is the path that always works,
                 * which is why the label spells out what will happen rather
                 * than trusting a bare checkbox to imply it.
                 */
                <label className="flex cursor-pointer items-start gap-2 text-xs text-foreground">
                  <input
                    type="checkbox"
                    aria-label="Track this meeting when it starts"
                    checked={meeting.trackOnStart}
                    onChange={(event) =>
                      onSetTrack?.(
                        meeting.calendarId,
                        meeting.eventId,
                        event.currentTarget.checked
                      )
                    }
                    className="mt-0.5 size-3.5 shrink-0 rounded-[3px] border border-edge-raised bg-ground accent-current focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  />
                  <span>
                    Track this when it starts
                    <span className="block text-muted-foreground">
                      Stops whatever is running and starts this instead.
                    </span>
                  </span>
                </label>
              ) : (
                /*
                 * A meeting that has already begun has no future switch left,
                 * so the honest offer is the one the backfill makes: record it
                 * now, over its own window.
                 */
                <button
                  type="button"
                  onClick={() =>
                    onTrackNow?.(meeting.calendarId, meeting.eventId)
                  }
                  className="flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-edge-raised text-xs font-medium text-foreground transition-colors hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  <ClockIcon className="size-3.5" aria-hidden />
                  Track this
                </button>
              )}
            </div>
          )}

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
                /*
                  AN OVERLAPPED STACK RATHER THAN A COLUMN OF NAMES.

                  The separation ring between circles is repainted from the
                  shadcn default (`ring-background`, the page's ground) to the
                  popover's own surface, or every avatar would wear a dark halo
                  cut from a background this popover does not sit on.

                  Index as key is safe throughout: the roster is never
                  reordered or filtered, and is re-rendered fresh from a query
                  result.
                */
                <AvatarGroup className="*:data-[slot=avatar]:ring-surface-raised">
                  {shown.map((attendee, index) => (
                    <AttendeeAvatar key={index} attendee={attendee} />
                  ))}
                  {overflow === 0 ? null : (
                    /*
                      THE "+N" IS A CONTROL, so it dresses like one: same
                      circle as its neighbours but with the raised border every
                      interactive boundary in this app wears. Pressing it opens
                      the rest of the roster rather than making the popover
                      taller than the meeting is important.
                    */
                    <Popover.Root>
                      <Popover.Trigger
                        title={`Show ${overflow} more`}
                        className="relative flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full border border-edge-raised bg-ground text-[11px] font-medium text-muted-foreground ring-2 ring-surface-raised transition-colors hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                      >
                        +{overflow}
                      </Popover.Trigger>
                      <Popover.Popup
                        side="bottom"
                        align="start"
                        aria-label={`${overflow} more ${overflow === 1 ? "guest" : "guests"}`}
                        className="max-h-[min(18rem,50svh)] w-auto max-w-[21rem] p-2"
                      >
                        {folded.length === 0 ? null : (
                          /* Avatar AND name, per row: the chip's popup is
                             where somebody goes to find out who exactly is
                             behind the fold, so the answer is printed, not
                             left in a tooltip. */
                          <ul className="grid min-h-0 gap-1 overflow-y-auto">
                            {folded.map((attendee, index) => (
                              <li
                                key={index}
                                className="flex items-center gap-2 text-xs"
                              >
                                <AttendeeAvatar attendee={attendee} />
                                <span className="truncate text-foreground">
                                  {attendee.name ?? attendee.email ?? "Guest"}
                                </span>
                                {attendee.response === "needsAction" ? null : (
                                  <span className="ml-auto shrink-0 pl-2 text-muted-foreground">
                                    {RESPONSE_LABEL[attendee.response] ??
                                      attendee.response}
                                  </span>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                        {unlisted === 0 ? null : (
                          /* Honesty about the MAX_ATTENDEES cap: these people
                             exist, Google was not asked for them, and a roster
                             that looks complete would be lying. */
                          <p className="p-1 text-xs text-muted-foreground">
                            and {unlisted} more not listed
                          </p>
                        )}
                      </Popover.Popup>
                    </Popover.Root>
                  )}
                </AvatarGroup>
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
