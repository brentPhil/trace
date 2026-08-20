import { createFileRoute } from "@tanstack/react-router"
import { convexQuery } from "@convex-dev/react-query"
import { pageTitle } from "@shared/brand"
import { dayOf, weekWindow } from "@shared/day"
import { api } from "../../../convex/_generated/api"
import { Timer } from "./-timer"

/*
 * The page itself is in ./-timer — see that file's header. The route file
 * holds the definition and the loader, so `component:` is an import from a
 * non-route file and the code-splitter can do its job.
 */
export const Route = createFileRoute("/_authed/timer")({
  head: () => ({ meta: [{ title: pageTitle("Timer") }] }),
  component: Timer,
  loader: async ({ context }) => {
    // Settings first and awaited: every day boundary below depends on the
    // stored timezone. It is loaded here rather than in a parent loader
    // because TanStack Router runs loaders in PARALLEL across matched routes,
    // so a child cannot assume a parent's loader has resolved.
    const settings = await context.queryClient.ensureQueryData(
      convexQuery(api.settings.get, {})
    )

    // The component reads this exact range with `useSuspenseQuery` for the
    // week totals. Without prefetching it here, the page suspends on a
    // round trip AFTER this loader has already resolved — the deleted
    // today.tsx prefetched its own range for the same reason.
    const today = dayOf(Date.now(), settings.timezone)
    const week = weekWindow(today, settings.timezone, settings.weekStartDay)
    await context.queryClient.ensureQueryData(
      convexQuery(api.entries.listRange, { fromMs: week.fromMs, toMs: week.toMs })
    )
  },
})
