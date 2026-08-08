import {
  Link,
  Outlet,
  createFileRoute,
  redirect,
  useLocation,
} from "@tanstack/react-router"
import { ConvexError } from "convex/values"
import { useSuspenseQuery } from "@tanstack/react-query"
import { convexQuery } from "@convex-dev/react-query"
import { buttonVariants } from "@/components/ui/button"
import { Toast } from "@/components/ui/toast"
import { AuthShell } from "@/components/auth-shell"
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
import { useReplayPendingStart, useTabTitleClock } from "@/hooks/use-timer-effects"
import { cn } from "@/lib/utils"
import { api } from "../../convex/_generated/api"
import type { TimerBarActions } from "@/components/timer/timer-bar"
import { useMemo } from "react"

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
      context.queryClient.ensureQueryData(convexQuery(api.entries.getRunning, {})),
      context.queryClient.ensureQueryData(convexQuery(api.projects.list, {})),
      context.queryClient.ensureQueryData(convexQuery(api.tags.list, {})),
      context.queryClient.ensureQueryData(
        convexQuery(api.entries.titleSuggestions, { limit: 40 })
      ),
    ])
  },
  errorComponent: AuthedErrorBoundary,
  component: AuthedLayout,
})

/**
 * Every authed page hangs off this, which is why the settings seed lives here:
 * it needs to run once per session on the client, wherever the user landed.
 *
 * This also owns the running entry, its mutations and the classifier lists —
 * the timer bar sits above the outlet, so a timer can be started and stopped
 * from any page rather than only from Today.
 */
function AuthedLayout() {
  useEnsureSettings()

  const { sidebarOpen } = Route.useRouteContext()
  const { data: user } = useSuspenseQuery(
    convexQuery(api.auth.getAuthenticatedUser, {})
  )
  const { data: settings } = useSuspenseQuery(convexQuery(api.settings.get, {}))
  const { data: running } = useSuspenseQuery(convexQuery(api.entries.getRunning, {}))
  const { data: suggestions } = useSuspenseQuery(
    convexQuery(api.entries.titleSuggestions, { limit: 40 })
  )

  useTabTitleClock(running, settings.tabTitleClock)
  useReplayPendingStart(running)

  const entryMutations = useEntryMutations()
  const editMutations = useEntryEditMutations()
  const { projects, tags } = useClassifiers()
  const { createProject, ensureTag } = useClassifierMutations()

  const toasts = Toast.useToastManager()
  const report = (thrown: unknown) => {
    toasts.add({ title: errorMessage(thrown), priority: "high", timeout: 8_000 })
  }

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

  return (
    <AppShell
      email={user.email}
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
            onError={report}
          />
          <RunawayBanner
            running={running}
            thresholdMs={settings.runawayThresholdMs}
            onStop={() => void entryMutations.stop().catch(report)}
            onDiscard={() => void entryMutations.discard().catch(report)}
          />
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
