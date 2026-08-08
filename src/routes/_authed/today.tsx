import { useEffect, useMemo, useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useSuspenseQuery } from "@tanstack/react-query"
import { convexQuery, useConvexMutation } from "@convex-dev/react-query"
import { Toast } from "@/components/ui/toast"
import { errorMessage } from "@/lib/error-message"
import { AppHeader } from "@/components/app-header"
import { TimerBar } from "@/components/timer/timer-bar"
import { EntryLog } from "@/components/entries/entry-log"
import { ManualEntryDialog } from "@/components/entries/manual-entry-dialog"
import { NoteSheet } from "@/components/entries/note-sheet"
import { TotalsRow } from "@/components/entries/totals-row"
import { RecapPanel } from "@/components/recap/recap-panel"
import { RunawayBanner } from "@/components/timer/runaway-banner"
import { useSecond } from "@/hooks/use-clock"
import { useClassifierMutations, useClassifiers } from "@/hooks/use-classifiers"
import { useEntryEditMutations } from "@/hooks/use-entry-edit-mutations"
import { useEntryMutations } from "@/hooks/use-entry-mutations"
import { useReplayPendingStart, useTabTitleClock } from "@/hooks/use-timer-effects"
import { groupByDay, sumRange } from "@/lib/group-entries"
import { cn } from "@/lib/utils"
import { addDays, dayOf, dayWindow, weekWindow } from "@shared/day"
import { api } from "../../../convex/_generated/api"
import type { TimerBarActions } from "@/components/timer/timer-bar"
import type { Doc } from "../../../convex/_generated/dataModel"

/** How far back the log reaches before pagination lands. */
const LOG_DAYS = 30

export const Route = createFileRoute("/_authed/today")({
  head: () => ({ meta: [{ title: "Today — Trace" }] }),
  component: Today,
  loader: async ({ context }) => {
    // Settings first and awaited: every day boundary below depends on the
    // stored timezone. It is loaded here rather than in a parent loader
    // because TanStack Router runs loaders in PARALLEL across matched routes,
    // so a child cannot assume a parent's loader has resolved.
    const settings = await context.queryClient.ensureQueryData(
      convexQuery(api.settings.get, {})
    )

    const now = Date.now()
    const from = dayWindow(addDays(dayOf(now, settings.timezone), -LOG_DAYS), settings.timezone)
    const to = dayWindow(dayOf(now, settings.timezone), settings.timezone)

    await Promise.all([
      context.queryClient.ensureQueryData(convexQuery(api.auth.getAuthenticatedUser, {})),
      context.queryClient.ensureQueryData(convexQuery(api.entries.getRunning, {})),
      context.queryClient.ensureQueryData(
        convexQuery(api.entries.listRange, { fromMs: from.fromMs, toMs: to.toMs })
      ),
      context.queryClient.ensureQueryData(
        convexQuery(api.recap.get, { day: dayOf(now, settings.timezone) })
      ),
      // The three below are read with `useSuspenseQuery` during render — via
      // `useClassifiers()` and the suggestions query. Left out of the loader
      // they do not simply arrive later: the component SUSPENDS on each in
      // turn, so the app's primary page paid three sequential server round
      // trips after the loader had already finished. `/history` and `/projects`
      // both prefetch their classifiers; this was the outlier.
      context.queryClient.ensureQueryData(convexQuery(api.projects.list, {})),
      context.queryClient.ensureQueryData(convexQuery(api.tags.list, {})),
      context.queryClient.ensureQueryData(
        convexQuery(api.entries.titleSuggestions, { limit: 40 })
      ),
    ])
  },
})

function Today() {
  const { data: user } = useSuspenseQuery(
    convexQuery(api.auth.getAuthenticatedUser, {})
  )
  const { data: settings } = useSuspenseQuery(convexQuery(api.settings.get, {}))
  const { data: running } = useSuspenseQuery(convexQuery(api.entries.getRunning, {}))

  // The range is pinned to the current second, not to Date.now() at render, so
  // the query key is stable across re-renders and the subscription is not torn
  // down and rebuilt on every tick.
  const second = useSecond()
  const nowMs = (second ?? Math.floor(Date.now() / 1000)) * 1000

  // A day string, so it changes once a day rather than once a second — which
  // is what keeps the query key below stable and stops the subscription being
  // torn down and rebuilt on every tick.
  const today = dayOf(nowMs, settings.timezone)

  const range = useMemo(
    () => ({
      fromMs: dayWindow(addDays(today, -LOG_DAYS), settings.timezone).fromMs,
      toMs: dayWindow(today, settings.timezone).toMs,
    }),
    [today, settings.timezone]
  )

  const { data: entries } = useSuspenseQuery(
    convexQuery(api.entries.listRange, { fromMs: range.fromMs, toMs: range.toMs })
  )

  useTabTitleClock(running, settings.tabTitleClock)
  useReplayPendingStart(running)

  const [stopped, setStopped] = useState<Doc<"timeEntries"> | null>(null)
  const [noteOpen, setNoteOpen] = useState(false)

  // The live writes. This is the only place in the tracking surface that has
  // them; the bar and the rows receive what they are allowed to do.
  const entryMutations = useEntryMutations()
  const editMutations = useEntryEditMutations()
  const { projects, tags } = useClassifiers()
  const { createProject, ensureTag } = useClassifierMutations()

  const { data: suggestions } = useSuspenseQuery(
    convexQuery(api.entries.titleSuggestions, { limit: 40 })
  )
  const { data: recap } = useSuspenseQuery(convexQuery(api.recap.get, { day: today }))
  const setRecapFields = useConvexMutation(api.recap.setFields)

  const toasts = Toast.useToastManager()

  /**
   * The one place a failed timer write becomes visible.
   *
   * Start, stop and discard were all fired with a bare `void`, so a rejection
   * was an unhandled promise with nothing on screen. Because stop and discard
   * carry an optimistic update that clears the running entry, the failure mode
   * was worse than silence: the timer vanished, then reappeared on rollback,
   * with no explanation for either.
   */
  const report = (thrown: unknown) => {
    toasts.add({ title: errorMessage(thrown), priority: "high", timeout: 8_000 })
  }

  // Which entry a recap bullet was drilled into. Cleared when the day changes,
  // since the id would then point at a row no longer on screen.
  const [highlighted, setHighlighted] = useState<string | null>(null)
  useEffect(() => setHighlighted(null), [today])

  // Assembled once here rather than inline in JSX, so the bar's props are a
  // stable object and the identity of every callback is the hook's, not a new
  // arrow per render.
  const timerActions: TimerBarActions = useMemo(
    () => ({
      start: entryMutations.start,
      stop: entryMutations.stop,
      discard: entryMutations.discard,
      setTitle: entryMutations.setTitle,
      classify: async (entryId, change) => {
        await editMutations.update({
          entryId,
          ...(change.projectId !== undefined ? { projectId: change.projectId } : {}),
          ...(change.tagIds !== undefined ? { tagIds: change.tagIds } : {}),
          ...(change.billable !== undefined ? { billable: change.billable } : {}),
        })
      },
      createProject: async (name) => await createProject({ name }),
      createTag: async (name) => await ensureTag(name),
    }),
    [entryMutations, editMutations, createProject, ensureTag]
  )

  const groups = useMemo(
    () => groupByDay(entries, settings.timezone, nowMs),
    [entries, settings.timezone, nowMs]
  )

  const todayGroup = groups.find((group) => group.day === today)
  const week = weekWindow(today, settings.timezone, settings.weekStartDay)
  const weekTotals = sumRange(
    groups.filter((group) => group.day >= week.firstDay && group.day <= week.lastDay)
  )

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-4xl flex-col">
      <AppHeader email={user.email} />

      {/*
        Below `md` the bar is pinned to the BOTTOM of the viewport rather than
        sitting at the top of the document.

        On a phone the start control belongs under the thumb, not behind a
        scroll — and the log is what you scroll, so the one control you press
        twenty times a day must not scroll away with it. `pb-safe` clears the
        home indicator; the spacer below reserves the height so the last entry
        in the log is never hidden underneath.

        Toggl has publicly declined to fix its mobile web app. This is the
        surface the incumbent abandoned, and it costs one breakpoint.
      */}
      <div
        className={cn(
          "fixed inset-x-0 bottom-0 z-30 border-t border-edge-soft bg-ground px-3 pt-2",
          "pb-[max(0.5rem,env(safe-area-inset-bottom))]",
          "md:static md:z-auto md:border-t-0 md:bg-transparent md:px-4 md:pt-0 md:pb-0"
        )}
      >
        <TimerBar
          running={running}
          actions={timerActions}
          projects={projects}
          tags={tags}
          suggestions={suggestions}
          onStopped={(entry) => {
            setStopped(entry)
            setNoteOpen(true)
          }}
          onError={report}
        />
      </div>

      <RunawayBanner
        running={running}
        thresholdMs={settings.runawayThresholdMs}
        onStop={() => void entryMutations.stop().catch(report)}
        onDiscard={() => void entryMutations.discard().catch(report)}
      />

      <div className="flex items-center justify-between gap-3 pr-2">
        <TotalsRow
          className="py-3"
          todayMs={todayGroup?.totalMs ?? 0}
          weekMs={weekTotals.totalMs}
          billableMs={weekTotals.billableMs}
          display={settings.durationDisplay}
        />
        <ManualEntryDialog
          today={today}
          timeZone={settings.timezone}
          onCreate={editMutations.create}
        />
      </div>

      <RecapPanel
        doc={recap}
        onSaveFields={async (fields) => {
          await setRecapFields({ day: today, ...fields })
        }}
        onFocusEntry={setHighlighted}
      />

      <main className="flex-1">
        <EntryLog
          groups={groups}
          timeZone={settings.timezone}
          use12Hour={settings.timeFormat === "12"}
          weekStartDay={settings.weekStartDay}
          highlightedEntryId={highlighted}
          display={settings.durationDisplay}
        />
      </main>

      {/*
        Reserves the fixed bar's height so the last row of the log can always
        be scrolled clear of it. Sized generously — the bar grows a second line
        while recording — because a too-small spacer hides the newest entry,
        which is the one being worked on.
      */}
      <div aria-hidden="true" className="h-[6.5rem] shrink-0 md:hidden" />

      {/*
        The stop-time note sheet is owned here rather than inside the log,
        because the entry it asks about has just left the timer bar and may not
        be in the log's data yet. It reads the frozen snapshot the stop returned.
      */}
      <NoteSheet
        entry={stopped}
        open={noteOpen}
        onOpenChange={setNoteOpen}
        onSave={editMutations.setNote}
      />
    </div>
  )
}



