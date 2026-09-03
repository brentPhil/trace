import { useToastManager } from "@/components/ui/toast"
import { buttonVariants } from "@/components/ui/button"
import {
  Link,
  Outlet,
  createFileRoute,
  redirect,
  useLocation,
} from "@tanstack/react-router"
import { ConvexError } from "convex/values"
import { useQuery, useSuspenseQuery } from "@tanstack/react-query"
import { convexQuery, useConvexMutation } from "@convex-dev/react-query"
import { AuthShell } from "@/components/auth-shell"
import { useAnnounce } from "@/components/a11y/announcer"
import { AppShell } from "@/components/shell/app-shell"
import { TimerBar } from "@/components/timer/timer-bar"
import { RunawayBanner } from "@/components/timer/runaway-banner"
import { readSidebarOpen } from "@/lib/sidebar-cookie"
import { signOutAndLeave } from "@/lib/auth-client"
import { errorMessage } from "@/lib/error-message"
import { useEnsureSettings } from "@/hooks/use-ensure-settings"
import { useClassifierMutations, useClassifiers } from "@/hooks/use-classifiers"
import { useEntryEditMutations } from "@/hooks/use-entry-edit-mutations"
import { useEntryMutations } from "@/hooks/use-entry-mutations"
import { useTabTitleClock } from "@/hooks/use-timer-effects"
import { useMusicTracking } from "@/hooks/use-music-tracking"
import { useDesktopBridge } from "@/hooks/use-desktop-bridge"
import { useLatest } from "@/hooks/use-latest"
import { useSwitchUndo } from "@/lib/use-switch-undo"
import { MusicProvider, useMusic } from "@/components/music/music-provider"
import {
  OutboxProvider,
  usePendingCount,
  useOutboxEvents,
} from "@/lib/offline/outbox-provider"
import { useOnlineStatus } from "@/lib/offline/use-online-status"
import { OP_KINDS } from "@/lib/offline/op-kinds"
import { SyncStatus } from "@/components/shell/sync-status"
import { OfflinePending } from "@/components/shell/offline-pending"
import { MusicControls } from "@/components/music/music-controls"
import { cn } from "@/lib/utils"
import { api } from "../../convex/_generated/api"
import type { TimerBarActions } from "@/components/timer/timer-bar"
import { useCallback, useMemo } from "react"

/**
 * Pathless layout route. Anything nested under `_authed/` requires a session.
 *
 * This is a UX guard, not a security boundary: it decides what renders, and
 * nothing more. A direct call to a Convex function bypasses it entirely, so
 * every protected function must still call `requireUser` in convex/auth.ts.
 */
export const Route = createFileRoute("/_authed")({
  beforeLoad: ({ context, location }) => {
    if (!context.isAuthenticated) {
      throw redirect({
        to: "/login",
        // Where to return to once signed in. Validated on the way back out —
        // see safeRedirect in src/lib/redirect.ts.
        search: { redirect: location.href },
      })
    }
    // Read here, not in the shell: the value must be known before the first
    // render on the server, or the rail's width changes at hydration.
    return { sidebarOpen: readSidebarOpen() }
  },
  loader: async ({ context }) => {
    // Fetched once for the session rather than once per page, now that the
    // timer bar lives above the outlet and every page needs the same data.
    await Promise.all([
      context.queryClient.ensureQueryData(convexQuery(api.settings.get, {})),
      context.queryClient.ensureQueryData(
        convexQuery(api.auth.getAuthenticatedUser, {})
      ),
      context.queryClient.ensureQueryData(
        convexQuery(api.entries.getRunning, {})
      ),
      context.queryClient.ensureQueryData(convexQuery(api.projects.list, {})),
      context.queryClient.ensureQueryData(convexQuery(api.tags.list, {})),
      context.queryClient.ensureQueryData(
        convexQuery(api.entries.titleSuggestions, { limit: 40 })
      ),
    ])
  },
  errorComponent: AuthedErrorBoundary,
  pendingComponent: AuthedPending,
  component: AuthedLayout,
})

/** A route file may read connection state; components take it as a prop. */
function AuthedPending() {
  const online = useOnlineStatus()
  return <OfflinePending offline={!online} />
}

/**
 * Just the provider boundary. `AuthedShell` below is the one that calls
 * `useMusic()`, and a component cannot call a hook that reads a context
 * value from a provider it renders itself — React resolves context by
 * position in the tree, not by execution order, so the provider has to be a
 * separate component sitting ABOVE `AuthedShell`, which is this one.
 *
 * `AuthedShell` itself does not unmount on navigation — it is what
 * `component: AuthedLayout` has always meant, one instance for the whole
 * authed session — so this split costs nothing on the persistence front
 * that the earlier, unsplit `AuthedLayout` did not already have. What
 * DOES matter for persistence is that `MusicProvider`, wherever it sits,
 * stays outside `<Outlet>`: TanStack Router unmounts a route component on
 * every navigation, and `MusicProvider` owns the single `<audio>` element
 * for the session, so an instance living below `<Outlet>` would tear the
 * audio down and rebuild it — cutting the music — on every page change.
 *
 * The toast manager is read HERE rather than reused from `AuthedShell`'s
 * `report` for the same positional reason: `report` is defined inside the
 * child, and a parent cannot reach into a component it renders. `ToastProvider`
 * lives in `__root.tsx`, above both, so `useToastManager` is legal at this
 * level — and the provider gets the app's ordinary error channel instead of
 * growing a toast import of its own.
 *
 * The uploads query is read HERE for the same class of reason, spelled out in
 * eslint.config.js and enforced by it: a component may not import `api`, so
 * the route runs the query and hands the rows down. This is the nearest legal
 * home for it — this component is the one that renders the provider — and the
 * furthest up it should go: `__root.tsx` covers /login too, and an unauthed
 * page has no player to feed.
 */
function AuthedLayout() {
  const toasts = useToastManager()
  // Not `useSuspenseQuery`, and deliberately absent from the route `loader`
  // above: the library is not worth blocking the authed shell on, and
  // `undefined` is a correct first render — the provider plays the compiled-in
  // catalog while this is in flight and flips `tracksReady` when it lands.
  const { data: uploads } = useQuery(convexQuery(api.music.listTracks, {}))
  return (
    <OutboxProvider>
      <MusicProvider
        // Passed through exactly as TanStack Query reports it, `undefined`
        // included. That `undefined` is the provider's only way to distinguish
        // "no answer yet" from "this account has uploaded nothing", and
        // defaulting it to `[]` here would quietly tell every consumer the
        // library had arrived empty — see `uploads` on `MusicProvider`.
        uploads={uploads}
        onError={(message) => {
          // `priority: "high"` and the 8s timeout match `AuthedShell`'s `report`
          // exactly. Music failing is not more urgent than a failed save, but it
          // must not be quieter either — a shorter, low-priority toast for the
          // one failure the user cannot see the cause of (audio that simply
          // stopped) is the one case where a lower priority would be wrong.
          toasts.add({ title: message, priority: "high", timeout: 8_000 })
        }}
      >
        <AuthedShell />
      </MusicProvider>
    </OutboxProvider>
  )
}

/**
 * Every authed page hangs off this, which is why the settings seed lives here:
 * it needs to run once per session on the client, wherever the user landed.
 *
 * This also owns the running entry, its mutations and the classifier lists —
 * the timer bar sits above the outlet, so a timer can be started and stopped
 * from any page rather than only from Today.
 */
function AuthedShell() {
  useEnsureSettings()

  const { sidebarOpen } = Route.useRouteContext()
  const { data: user } = useSuspenseQuery(
    convexQuery(api.auth.getAuthenticatedUser, {})
  )
  const { data: settings } = useSuspenseQuery(convexQuery(api.settings.get, {}))
  const { data: running } = useSuspenseQuery(
    convexQuery(api.entries.getRunning, {})
  )
  const { data: suggestions } = useSuspenseQuery(
    convexQuery(api.entries.titleSuggestions, { limit: 40 })
  )

  useTabTitleClock(running, settings.tabTitleClock)

  const toasts = useToastManager()

  const music = useMusic()
  useMusicTracking(running, {
    musicAutoplay: settings.musicAutoplay,
    musicOnStop: settings.musicOnStop,
  })

  /*
   * The way back from a switch nobody asked for — mounted HERE, beside the
   * other hook that watches `running`, and not on /timer.
   *
   * `googleTick` is a one-minute server cron, so a ticked meeting can take the
   * timer while the user is on /reports, on /invoices, or looking at nothing at
   * all. This shell is the one mount that survives navigation, so it is the
   * only place that can promise to announce EVERY switch; a toast on the timer
   * page would catch the ones that happened while that page was open and
   * silently miss the rest.
   *
   * `useLatest`-wrapped like every other raw mutation in this codebase:
   * `useConvexMutation` returns a fresh function per render and the hook holds
   * it in an effect's dependency array.
   */
  const undoSwitch = useLatest(useConvexMutation(api.googleTrack.undoSwitch))
  useSwitchUndo(running, toasts, undoSwitch)

  const entryMutations = useEntryMutations()
  const editMutations = useEntryEditMutations()
  const { projects, tags } = useClassifiers()
  const { createProject, ensureTag } = useClassifierMutations()

  const report = (thrown: unknown) => {
    toasts.add({
      title: errorMessage(thrown),
      priority: "high",
      timeout: 8_000,
    })
  }

  const online = useOnlineStatus()
  const pending = usePendingCount()
  useOutboxEvents(
    useCallback(
      (event) => {
        if (event.type === "failed") {
          // Not "offline": the queue stopped for a reason of its own, and
          // the status line's count would otherwise sit there implying it is
          // merely waiting for the network.
          toasts.add({
            title: "Syncing stopped unexpectedly. Your changes are saved on this device.",
            priority: "high",
            timeout: 8_000,
          })
          return
        }
        if (event.type !== "dropped") return
        // Not `as OpKindName`: `event.op.kind` is a plain string read back
        // from the journal (see `outbox.ts`'s own `Record<string, … |
        // undefined>`), so a kind this build no longer recognises is a real
        // runtime case, not one the type system can rule out.
        const label =
          (OP_KINDS as Record<string, { label: string } | undefined>)[event.op.kind]?.label ??
          "A change"
        // Each reads as a sentence after the kind's label, which is a gerund
        // phrase: "Starting the timer was skipped: …". The stale wording in
        // particular cannot be "was started more than a day ago" — the only
        // kind that can go stale is the start, so that composes to "Starting
        // the timer was started…".
        const why =
          event.reason === "stale"
            ? "was skipped: it had been waiting more than a day."
            : event.reason === "orphaned"
              ? "was skipped: something it depended on didn't save."
              : `didn't save: ${errorMessage(event.error)}`
        toasts.add({ title: `${label} ${why}`, priority: "high", timeout: 8_000 })
      },
      [toasts]
    )
  )

  // Mounted here rather than up with `useTabTitleClock` and the other
  // `running` watchers: it needs `entryMutations`, declared below that
  // block, and React only requires hooks to run unconditionally in the same
  // order every render — it does not care what plain declarations sit
  // between them. Same survives-navigation reasoning as `useSwitchUndo`
  // above: this is the one mount that outlives every page, so the tray never
  // goes stale because the user changed pages.
  //
  // No `report` passed: `start`/`stop` are optimistic by construction now —
  // they resolve as soon as the outbox journals the write — so a refusal is
  // the outbox's own `dropped` event to report, not this bridge's.
  useDesktopBridge(running, { start: entryMutations.start, stop: entryMutations.stop })

  const announce = useAnnounce()

  /**
   * Discarding says so, and says it AFTER the write lands.
   *
   * Discarding a timer changes almost nothing on screen — the banner and the
   * bar's accent simply stop being there — so for anyone not watching the
   * pixels the single most consequential action in the product happened in
   * silence. The bar's own Discard button used to say this sentence and went
   * with the control on 2026-08-12; `RunawayBanner`'s is the one that remains,
   * and it inherited the silence rather than the announcement.
   *
   * The announcement is optimistic by construction now: `discard` resolves as
   * soon as the outbox journals the write, before any round trip, so "after
   * the write lands" means after the local journal accepts it, not after the
   * server does. A refusal is no longer this function's problem to report —
   * the outbox surfaces it through its own `dropped` event.
   */
  const discardRunning = () => {
    void entryMutations
      .discard(running?._id)
      .then(() => announce("Timer discarded. Nothing was recorded."))
  }

  const timerActions: TimerBarActions = useMemo(
    () => ({
      start: entryMutations.start,
      stop: () => entryMutations.stop(running?._id),
      // No `discard`: the bar's Discard control went on 2026-08-12 and the
      // field went with it. `RunawayBanner` below takes its own `onDiscard`,
      // which is the only surviving caller of the mutation.
      setTitle: entryMutations.setTitle,
      classify: async (entryId, change) => {
        await editMutations.update({
          entryId,
          ...(change.projectId !== undefined
            ? { projectId: change.projectId }
            : {}),
          ...(change.tagIds !== undefined ? { tagIds: change.tagIds } : {}),
          ...(change.billable !== undefined
            ? { billable: change.billable }
            : {}),
        })
      },
      createProject: async (name) => await createProject({ name }),
      createTag: async (name) => await ensureTag(name),
      editTime: async (entryId, field, instantMs) => {
        await editMutations.editTime(entryId, field, instantMs)
      },
      // Spread straight through. `editMutations.create` already accepts the
      // title and the classification, and the bar is holding both by the time
      // it calls this — narrowing the parameter to the two instants here is
      // what silently dropped them.
      createCompleted: async (input) => await editMutations.create(input),
    }),
    [entryMutations, editMutations, createProject, ensureTag, running]
  )

  return (
    <AppShell
      email={user.email}
      // Better Auth stores a display name; it is empty for an account created
      // with an email and a password and never edited, so `undefined` rather
      // than `""` is what the sidebar has to branch on.
      name={user.name === "" ? undefined : user.name}
      onSignOut={() => signOutAndLeave()}
      sidebarDefaultOpen={sidebarOpen}
      timer={
        <>
          <TimerBar
            running={running}
            actions={timerActions}
            projects={projects}
            tags={tags}
            suggestions={suggestions}
            timeZone={settings.timezone}
            use12Hour={settings.timeFormat === "12"}
            weekStartDay={settings.weekStartDay}
            onError={report}
            onCreateManual={editMutations.create}
            music={<MusicControls value={music} />}
          />
          <RunawayBanner
            running={running}
            thresholdMs={settings.runawayThresholdMs}
            // No `.catch`: `stop` is optimistic by construction now, so a
            // refusal is the outbox's own `dropped` event to report.
            onStop={() => void entryMutations.stop(running?._id)}
            onDiscard={discardRunning}
          />
          <SyncStatus offline={!online} pending={pending} />
        </>
      }
    >
      <Outlet />
    </AppShell>
  )
}

/**
 * Catches the case where the client believes it is authenticated but the server
 * disagrees — an expired session, or a Convex token that no longer verifies
 * (see convex/maintenance.ts for how a BETTER_AUTH_SECRET change causes that).
 *
 * Without this, `requireUser` throwing inside a loader puts the user on a raw
 * error screen with no way back. That reads as "the app is broken" mid-session,
 * which is exactly what PRODUCT.md's "never lose time" principle rules out.
 *
 * This renders a route back rather than redirecting automatically: if the
 * server keeps rejecting the session, an automatic redirect would bounce
 * between here and /login indefinitely.
 */
function AuthedErrorBoundary({ error }: { error: Error }) {
  const location = useLocation()

  const isAuthError =
    error instanceof ConvexError &&
    typeof error.data === "object" &&
    error.data !== null &&
    (error.data as { code?: unknown }).code === "UNAUTHENTICATED"

  if (!isAuthError) {
    throw error
  }

  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <AuthShell
        heading="Your session has ended"
        focusHeading
        className="w-full max-w-sm"
      >
        <p className="text-sm text-muted-foreground">
          Sign in again to pick up where you left off.
        </p>
        <div>
          <Link
            to="/login"
            search={{ redirect: location.href }}
            className={cn(buttonVariants())}
          >
            Sign in
          </Link>
        </div>
      </AuthShell>
    </main>
  )
}
