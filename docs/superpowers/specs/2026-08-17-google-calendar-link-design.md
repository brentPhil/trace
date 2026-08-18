# Linking Google Calendar to the calendar view

**Date:** 2026-08-17
**Builds on:** [2026-08-11-timer-calendar-view-design.md](2026-08-11-timer-calendar-view-design.md)

## The job to be done

Two jobs, and they are not the same job.

**Stop retyping meetings.** A meeting is a block of time whose start, end and
title are already written down somewhere else. Copying them into the tracker by
hand is the most mechanical work this product still asks of its user.

**Stop opening Google Calendar.** The other half is purely informational: who is
in this, what is the agenda, where is the link. Today that means leaving the
tracker, finding the tab, finding the event. The calendar view already draws the
day; it can draw the meetings on it and answer those questions in place.

## The principle this feature must not break

**Nothing seizes the timer that the user did not personally point at.**

The first shape of this design had a per-calendar "auto-track" switch: every
eligible meeting on a nominated calendar would interrupt whatever was running.
That was replaced by a checkbox on the meeting itself, and the replacement is
what makes the rest of the design defensible — because the tick *is* the
consent. There is no accepted-RSVP heuristic, no sole-attendee test, no grace
window, and no rule anywhere that decides on the user's behalf whether a meeting
was worth interrupting for. Every one of those was in an earlier draft and every
one of them is a guess. PRODUCT.md: the product "never silently rounds, merges,
or guesses on the user's behalf."

## Decisions

| Question | Decision |
| --- | --- |
| Direction of sync | Read-only. Nothing is ever written to Google |
| OAuth scope | `calendar.readonly`, nothing wider |
| How Google data reaches the grid | Mirrored into Convex by a server cron; the grid reads the mirror through an ordinary reactive query |
| Which calendars are drawn | Per-calendar `show`, set in Settings |
| Which meetings become entries | Only ones the user ticked. Nothing else, ever |
| When a ticked meeting becomes an entry | At its start instant: the running entry is closed there and a new running entry opens there |
| What stops the meeting entry | The user, or the next ticked meeting. Never a scheduled end |
| A ticked meeting that missed its switch | Backfilled as a completed entry over the event's window on the next sync |
| Backfill over time already tracked | Skipped. A live entry covering the window wins |
| Entry classification | Title from the event; project from the calendar's default project; billable from that project's `billableByDefault` |
| The entry's note | Left empty. The event description is **never** copied into it |
| After an entry exists | The event never rewrites it again. Snapshot, like every other figure this product bills from |
| Ineligible meetings | All-day and cancelled. Both are mechanical impossibilities, not judgements |
| `timeEntries` schema change | None. A fourth legal `source` value, `"calendar"` |
| Detail popover | Read-only. Title, times, location, organiser, attendees with RSVP, description, conference link, link out to Google |
| Grid treatment | Unfilled block with a soft border and muted text. Fill means recorded; outline means scheduled |
| A meeting that has produced an entry | Not drawn. The entry is drawn instead |
| Stored event detail | Full detail, in a rolling window: 60 days back, 90 days forward, pruned by the same cron |

## Not in scope

- Writing anything to Google. No entries published as events, no RSVP changes.
- Editing a Google event from inside Chroneli.
- Drag-to-create on the grid. The calendar view's "read, not draw" decision
  stands; the checkbox and the popover are the only new controls.
- Any provider other than Google.
- Push notifications (`events.watch`). Google requires a verified domain for the
  webhook endpoint, and a watch channel needs renewing every seven days. Polling
  is enough for a per-user calendar and has no renewal to forget.

## Identity and tokens

`convex/auth.ts` gains a Google social provider:

```ts
socialProviders: {
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    // BOTH of these, or Google issues an access token with no refresh token
    // and the link is dead in an hour with nothing to say why.
    accessType: "offline",
    prompt: "consent",
    scope: ["https://www.googleapis.com/auth/calendar.readonly"],
  },
},
```

`better-auth/minimal` — which this project imports — omits only the Kysely
adapter; `socialProviders` is core config and is accepted there. Verified
against `better-auth@1.6.26`.

**Linking, not signing in.** Existing accounts are email-and-password. The
connect button calls the client's `linkSocial()` so the Google account is added
to the identity rather than replacing it: the password login keeps working, and
`revokeSessionsOnPasswordReset` keeps meaning what it means.

**Tokens stay where Better Auth puts them** — the component's own `account`
table, which already carries `refreshToken`, `accessTokenExpiresAt` and `scope`.
The sync action asks Better Auth for an access token per run rather than caching
one of ours. One token store, so revoking access actually revokes it.

`GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set on the deployment, never
in `.env.local` — Convex functions cannot read that file, as `.env.example`
already states for `BETTER_AUTH_SECRET`.

## Data model

Three tables, and the split between the first two is the load-bearing part.

### `googleCalendars` — one row per calendar Google reports

| Field | Why |
| --- | --- |
| `userId: string` | Leads every index. Ownership is a key prefix, not a filter someone can forget |
| `googleId: string` | Google's calendar id, e.g. `primary` or an address |
| `summary: string` | Display name, refreshed from Google |
| `show: boolean` | Whether this calendar's meetings are drawn and synced at all |
| `defaultProjectId: v.optional(v.id("projects"))` | What an entry made from this calendar's meetings is classified as |
| `syncToken: v.union(v.string(), v.null())` | What makes polling cheap. `null` means the next fetch is a full window fetch |
| `lastSyncedAt: v.union(v.number(), v.null())` | Surfaced in Settings, so a stale mirror is visible rather than mysterious |

Index: `by_user_googleId`, plus `by_user_show` for the sync's fan-out.

A calendar with `show: false` is not fetched. There is no point mirroring a
calendar nothing may draw and nothing may materialise from.

**Turning `show` off suspends that calendar's pending ticks**, because its
meetings stop being mirrored and `googleTick` reads the mirror. The
`googleEventTracking` rows survive untouched, so turning it back on restores
every tick that has not yet passed. A calendar you have hidden cannot seize your
timer, which is the behaviour to want: you can only be interrupted by something
you can see.

### `googleEvents` — Google's facts, and only Google's facts

Every field here is a copy of something Google said. **This table is
replaceable at will**: the sync upserts rows wholesale and prunes them on a
window, and nothing the user did is stored here, so nothing the user did can be
lost by either.

| Field | Notes |
| --- | --- |
| `userId: string` | |
| `calendarId: string` | The `googleCalendars.googleId` this came from, not a `v.id()` — it is Google's key |
| `eventId: string` | Google's event id. Unique per calendar, not globally |
| `title: string` | Google's `summary`. `""` is legal; a nameless event is drawn as "Untitled", the same fallback `titleOf` already applies to entries |
| `startedAt: number` / `endedAt: number` | **Absolute instants.** Google returns RFC3339 with an offset, so `Date.parse` is lossless. Never a wall-clock string — the failure `calendar-events.ts` documents for entries applies identically here |
| `isAllDay: boolean` | True when Google returned `date` rather than `dateTime`. Such an event has no clock and cannot produce a defensible span |
| `status: string` | `"confirmed" \| "tentative" \| "cancelled"` |
| `myResponse: string` | The signed-in user's RSVP, read off the attendee Google marks `self: true`, or `"none"` when there is no such attendee. **Stored and displayed, never acted on** — the checkbox is the only thing that decides whether a meeting is tracked |
| `location`, `description`, `conferenceUrl`, `htmlLink` | All optional. What the popover exists to show |
| `organizer` | `{ name?: string, email?: string }` |
| `attendees` | `Array<{ name?: string, email?: string, response: string }>` |
| `updatedAt: number` | Google's own `updated`, so a change is detectable without diffing every field |

Indexes: `by_user_calendar_event` (the upsert's key), `by_user_started` (the
grid's range read and the prune's scan).

**`myResponse` is stored and never branched on.** It is worth writing down
because the field looks exactly like a gate and an earlier draft used it as one.
It is popover content.

### `googleEventTracking` — our facts about an event

| Field | Why |
| --- | --- |
| `userId: string` | |
| `calendarId: string` / `eventId: string` | The same pair that keys the mirror |
| `trackOnStart: boolean` | The checkbox |
| `entryId: v.union(v.id("timeEntries"), v.null())` | Which entry this meeting produced. Also what suppresses the ghost |
| `interruptedEntryId: v.union(v.id("timeEntries"), v.null())` | Which entry the switch closed, so undo can reopen it |

Index: `by_user_calendar_event`.

**Why this is a separate table and not three columns on the mirror.** Two
writers with different rights. Sync owns the mirror and must be free to replace
a row without reading it first; the user owns the tick. Put them together and
every upsert has to be field-selective forever, and the day someone writes a
whole-row `replace` the user's ticks disappear with no error.

It also **is never pruned**, which the mirror is. A tick set on a meeting eight
months out survives the 90-day forward window and is still there when the event
scrolls back into it. This is the same argument `entryTags` makes for existing
beside `tagIds` rather than replacing it: derived and user-owned state have
different lifetimes.

### No change to `timeEntries`

`source` gains a fourth legal value, `"calendar"`. Nothing else.

**The dedupe key is `clientKey`.** An entry materialised from a meeting is
created with

```
clientKey = `gcal:${calendarId}:${eventId}`
```

`clientKey` exists for exactly this purpose — the schema calls it what "makes a
create idempotent, so a retry after a lost response returns the existing row
instead of duplicating the entry" — and `by_user_clientKey` is already indexed.
So:

- "have I already made an entry for this meeting?" is one indexed read;
- the live switch and the backfill cannot both create an entry for one meeting,
  whichever fires first;
- and the guarantee **survives `googleEventTracking` being wrong or absent**,
  which is the property a random UUID would not have.

A recurring meeting is a series of instances and Google gives each instance its
own `eventId`, so daily standups do not collide.

### What an entry made from a meeting contains

| Field | Value |
| --- | --- |
| `title` | The event's title, verbatim |
| `note` | **Absent.** See below |
| `projectId` | The calendar's `defaultProjectId`, or absent |
| `billable` | That project's `billableByDefault`; `false` with no project |
| `tagIds` | `[]` |
| `source` | `"calendar"` |
| `clientKey` | `gcal:{calendarId}:{eventId}` |

**The description is never copied into the note.** The note is prose the user
wrote about how the work actually went — PRODUCT.md calls it the reason the
product exists — and a pasted meeting invite is not that. This product already
refuses to copy a note forward in three separate places (`resume`,
`onDuplicate`, title autocomplete), each saying why: it would put a false
account on a block of time. An agenda somebody else wrote before the meeting
happened is the same mistake with an extra author. The description stays in the
popover, where it is a fact about the meeting rather than a claim about the work.

## The three jobs

All server-side. None of them requires a tab to be open, which is the whole
reason the mirror exists rather than a client-side fetch.

### `googleSync` — every 15 minutes

1. Page over accounts with a linked Google provider; schedule one action per
   account so a slow or failing account cannot starve the others.
2. Ask Better Auth for an access token.
3. Refresh the calendar list at most once a day (`calendarList.list`). New
   calendars arrive with `show: false` — a calendar appearing on the grid
   because Google added it is a surprise, and surprises here cost billable data.
4. For each `show: true` calendar, `events.list` with `syncToken` when present,
   otherwise the full window with `singleEvents: true` so recurrences arrive as
   instances.
5. **Write the rows and the new `syncToken` in one mutation.** See failure
   modes; this is the one ordering in the feature that can lose data silently.
6. Prune mirror rows outside 60 days back / 90 days forward.
7. Run the backfill pass below.

### `googleTick` — every minute

The switch. Deliberately a cron reading the mirror, **not** a
`scheduler.runAt` per meeting: a per-meeting job goes stale the moment the
meeting moves, needs cancellation bookkeeping, and leaves orphans behind when a
calendar is unticked. A cron that asks "is a ticked meeting starting?" is
self-healing and holds no state.

For each user:

1. Find eligible meetings with `trackOnStart: true`, `startedAt` in
   `[now - 10min, now]`, and no entry yet.
2. If more than one, take the latest `startedAt`; tie-break on `eventId` so the
   outcome is deterministic.
3. In one mutation: close the running entry at the meeting's `startedAt` (via
   `entryTimes.ts`, the sole writer of `durationMs`), create a running entry
   starting at that same instant, and record `entryId` and
   `interruptedEntryId`.

No gap and no overlap: one entry ends on the instant the next begins.

**The write may land up to 60 seconds late and the data is still exact**,
because both instants come from the event, not from `Date.now()`. What is late
is the screen, not the record.

**The 10-minute lookback is the blast radius.** It is what makes a missed tick
recover itself, and it is what stops a meeting that started three hours ago from
seizing the timer when a deployment comes back up. Anything older falls to
backfill, where it becomes a completed entry over its own window instead of
stealing the present.

There is no race against the user stopping the timer at 09:59:58. Convex
mutations are transactions: the tick reads the running entry and writes its
replacement atomically, and if nothing is running it simply opens the meeting
entry.

**The undo.** The switch is the one write in this feature that happens at a
moment the user did not choose, so it gets a way back. The client offers an undo
toast ([undo-toast.ts](../../../src/lib/undo-toast.ts)) while the running entry
has `source: "calendar"` and is **less than 5 minutes old** — long enough to
notice a wrong interruption, short enough that the toast is not still on screen
an hour into the call. Undo deletes the meeting entry and reopens
`interruptedEntryId` with `endedAt` and `durationMs` back to `null`. When
`interruptedEntryId` is `null` nothing was running, so undo simply deletes.

### Backfill — on `googleSync`'s tail

For ticked meetings that **ended** within the last 7 days and produced no entry:
create a completed entry over `[startedAt, endedAt]`.

This is the path for a meeting ticked after it had already passed, and for a
switch missed while the deployment was down. It is bounded at 7 days so that a
full resync cannot resurrect months of history as new entries.

**The overlap rule lives here and only here.** If any live entry overlaps the
event's window, skip it — the tracker's own record of what happened wins over
the calendar's plan for it. A running entry counts as spanning
`[startedAt, now]` for that test, which is what stops a long-running timer from
being shadowed by every meeting inside it.

The live switch needs no overlap test: it *closes* the running entry, so it
cannot create an overlap.

### Eligibility, in full

A meeting is ineligible if it is **all-day** or **cancelled**. That is the whole
list, and both are mechanical:

- an all-day event has no clock, so it has no defensible span — and the grid has
  no all-day rail (`allDaySlot={false}`), so one is never drawn or tickable
  anyway;
- a cancelled meeting did not happen.

Declined, tentative and unanswered meetings are all eligible, because the tick
already said what the user wanted and re-deciding it from an RSVP would be the
guess this design exists to remove.

## The grid

### Fill means recorded; outline means scheduled

DESIGN.md leaves one axis free, and it is the right one anyway. `enlarger` means
*a timer is running* (the Cold Light Rule) and may not be spent on a meeting.
Hue means money under the Two Temperatures Rule and blocks take none. Dashes
plus hatch are the Hatch Rule's midnight continuation. What is left is **fill**,
and an unfilled block is a true statement about a meeting: it is scheduled time,
not recorded time.

So a meeting is drawn with no fill, a soft border, and muted text — one class
list beside the two `columnEventClass` already branches on, taking no new token.

### A meeting that produced an entry is not drawn

FullCalendar packs overlapping events into side-by-side columns, so a ticked
meeting and the entry it produced would each take half the column and show the
same hour twice.

So the ghost is drawn only while `googleEventTracking.entryId` is `null`. A
ticked meeting is a ghost right up to its start instant and a real, editable
block from then on. The grid never draws an hour twice.

The surviving case is a shown-but-unticked meeting, which will pack beside time
tracked during it. That is kept deliberately: it is the honest picture of
working through a meeting. `eventOrder` puts entries first so the recorded thing
holds the primary column.

### The checkbox

Top-left of the block, before the title, on meetings that have not started.

- It **stops propagation**, or ticking a meeting opens the popover on top of it
  — the nested-interactive-control problem
  [selection-checkbox.tsx](../../../src/components/entries/selection-checkbox.tsx)
  already solves for entry rows.
- It costs about 20px of the title's first line, so `blockFit` must account for
  it. A block with `titleLines === 0` has no room for a control either and gets
  none.
- Every meeting therefore also carries the tick **in the popover**, which is the
  path for a 5-minute block and the only path for a past one.
- A past meeting's popover shows **Track this** instead — the same
  materialisation the backfill runs, on demand.

### The detail popover

The mechanism the block editor already uses: a Base UI positioner anchored to
FullCalendar's `info.el` from `eventClick`
([calendar-panel.tsx:554](../../../src/components/calendar/calendar-panel.tsx:554)).

Read-only, and every time in it goes through `formatTimeRange` so a meeting is
spelled like everything else in the product. Content: title, time range,
location, organiser, attendees with their RSVP, description, a conference-link
button, a link out to Google, and the tick or **Track this**.

### Settings

A Google Calendar block in `src/routes/_authed/settings.tsx`: connect,
disconnect, last-synced time, a re-consent banner when the token has been
revoked, and one row per calendar with **Show** and a project picker.

There is no auto-track switch. That is the point.

## Failure modes

| Failure | Response |
| --- | --- |
| Rows written, `syncToken` committed first, then a crash | **Cannot happen by construction** — one mutation writes both. Committing the token before the rows would make Google never mention those changes again: a permanently missing meeting, with no error anywhere |
| `410 GONE` on a `syncToken` | Routine, not an error. Clear it and refetch the window |
| `invalid_grant` / revoked access | Flag the connection as needing re-consent, surface the banner in Settings, and **stop** syncing that account. Retrying a revoked grant forever is how a quiet failure becomes a loud one |
| Quota / `429` | Back off. The mirror stays stale-but-present, which is why it is a mirror |
| Action dies mid-page | Upserts are keyed on `(calendarId, eventId)`, so a rerun is a no-op. The token only advances with the rows |
| Two ticked meetings start in one minute | Latest start wins, `eventId` breaks the tie. One running entry, always — the product's oldest invariant |
| Meeting moves after its entry exists | Nothing happens. Snapshot on creation, by decision |
| Meeting cancelled after its entry exists | Nothing happens. The user deletes the entry if they want it gone |
| Ticked meeting drifts outside the mirror window | The tick is in `googleEventTracking`, which is never pruned. It survives |
| Meeting entry left running after the call | The existing runaway warning ([_authed.tsx:187](../../../src/routes/_authed.tsx:187)) fires at `runawayThresholdMs`, like any other long timer. No new machinery |
| Undo after a switch | Delete the meeting entry, reopen `interruptedEntryId` with `endedAt` and `durationMs` back to `null` |

## Testing

The shape this codebase already uses: the logic lives in pure functions and the
tests are on those.

- **`google-events.ts`** — Google JSON to mirror row. Fixtures for all-day,
  cancelled, declined, tentative, unanswered, recurring instances, an event with
  no `summary`, and an offset that is not the user's zone.
- **Eligibility and overlap predicates** — pure, in the manner of
  `lib/entryFilter.ts` and `lib/entryTimes.ts`. The overlap one is tested
  against a running entry specifically, since that is the case with no `endedAt`
  to compare.
- **`convex-test` on the mutations** — the tick closes the previous entry at the
  event's exact instant and opens the next there; a double fire is a no-op
  through `clientKey`; backfill skips a covered window; backfill does not fire
  for an unticked meeting; undo restores the interrupted entry.
- **HTTP mocked at the fetch boundary.** No network in tests.
- **`calendar-panel.test.tsx` extended** — ghost drawn when untracked, absent
  once `entryId` is set, checkbox toggles without opening the popover, and no
  checkbox on a block too short for text.

## Accepted trade-offs

1. **A ticked meeting cuts your work off mid-flow.** That is the feature. The
   tick is the consent, the undo toast is the way back, and the entry it closed
   is reopened exactly as it was.
2. **A meeting entry runs until stopped.** A call you left after five minutes
   runs all afternoon unless you stop it. Chosen over an auto-stop at the
   scheduled end, which would silently truncate a call that ran long — and the
   runaway warning already exists for the other side.
3. **Other people's email addresses are at rest in the deployment**, for the
   length of the rolling window. It is what the popover is for. The window and
   the prune are the bound.
4. **Up to 60 seconds of visual lag** on a switch. The record is exact; the
   screen catches up on the next tick.
5. **Polling, not push.** Up to 15 minutes of staleness on a meeting created or
   moved in Google. A ticked meeting created less than 15 minutes before it
   starts may miss its live switch and be backfilled instead.

## Implementation order

Two phases, and the split is chosen so the first one is independently useful and
touches nothing that writes billable data.

**Phase 1 — read.** The Google provider and the connect flow, the three tables,
`googleSync`, the Settings block, the ghost blocks, and the detail popover. At
the end of this phase the second job is done: the meetings are on the grid and
you stop opening Google Calendar. Nothing creates or modifies an entry, so
nothing here can put a wrong number on an invoice.

**Phase 2 — write.** The checkbox, `googleTick`, the backfill pass, **Track
this**, and the undo toast. Every risk in this design lives in this phase, and
it lands on a mirror that has already been proven correct by phase 1.

## Files

**New**

- `convex/google.ts` — the crons' actions and the mutations they call
- `convex/googleEvents.ts` — the pure mapper and predicates. At the convex root
  and **not** under `convex/lib`, for the reason `schema.ts` gives about
  `entryTags.ts`: `convex/lib` is aliased `@shared` and compiled into the client
  bundle, and nothing in here is needed in a browser
- `convex/crons.ts` — `googleSync` at 15 minutes, `googleTick` at 1 minute
- `src/components/calendar/calendar-meeting-popover.tsx`
- `src/lib/calendar-meetings.ts` — mirror rows to FullCalendar events
- `src/components/settings/google-calendar-section.tsx`

**Changed**

- `convex/schema.ts` — three tables; no change to `timeEntries`
- `convex/auth.ts` — the Google social provider
- `src/components/calendar/calendar-panel.tsx` — a second events array, the
  meeting class list, the checkbox, `blockFit`, `eventOrder`
- `src/routes/_authed/timer.tsx` — the meetings query, passed down
- `src/routes/_authed/settings.tsx` — the Google Calendar block
- `.env.example` — the two Google variables, documented as deployment-set
