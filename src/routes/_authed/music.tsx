import { createFileRoute } from "@tanstack/react-router"
import { convexQuery } from "@convex-dev/react-query"
import { pageTitle } from "@shared/brand"
import { api } from "../../../convex/_generated/api"
import { Music } from "./-music"

/*
 * The page itself is in ./-music — see that file's header. The route file
 * holds the definition and the loader, so `component:` is an import from a
 * non-route file and the code-splitter can do its job.
 */
export const Route = createFileRoute("/_authed/music")({
  head: () => ({ meta: [{ title: pageTitle("Music") }] }),
  component: Music,
  loader: async ({ context }) => {
    // Both reads are `useSuspenseQuery` below. Without prefetching them the
    // page suspends on a round trip AFTER this loader has already resolved —
    // the same reason /timer's loader warms the week it is about to draw.
    await Promise.all([
      context.queryClient.ensureQueryData(
        convexQuery(api.music.listTracks, {})
      ),
      context.queryClient.ensureQueryData(convexQuery(api.music.usage, {})),
    ])
  },
})
