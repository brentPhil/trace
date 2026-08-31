import { createFileRoute } from "@tanstack/react-router"
import { convexQuery } from "@convex-dev/react-query"
import { pageTitle } from "@shared/brand"
import { api } from "../../../convex/_generated/api"
import { Settings } from "./-settings"

/*
 * The page itself is in ./-settings — see that file's header. The route file
 * holds the definition and the loader, so `component:` is an import from a
 * non-route file and the code-splitter can do its job.
 */
export const Route = createFileRoute("/_authed/settings")({
  head: () => ({ meta: [{ title: pageTitle("Settings") }] }),
  component: Settings,
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(convexQuery(api.settings.get, {})),
      context.queryClient.ensureQueryData(convexQuery(api.google.connection, {})),
      context.queryClient.ensureQueryData(convexQuery(api.google.listCalendars, {})),
      // The library moved onto this page from /music and brought its two
      // `useSuspenseQuery` reads with it. Without prefetching them here the
      // page suspends on a round trip AFTER this loader has already resolved —
      // the same reason /music's own loader warmed them, and the reason every
      // other read on this page is in this list.
      context.queryClient.ensureQueryData(convexQuery(api.music.listTracks, {})),
      context.queryClient.ensureQueryData(convexQuery(api.music.usage, {})),
    ])
  },
})
