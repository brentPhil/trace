import { createRouter as createTanStackRouter } from "@tanstack/react-router"
import { QueryClient, notifyManager } from "@tanstack/react-query"
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query"
import { ConvexQueryClient } from "@convex-dev/react-query"
import { routeTree } from "./routeTree.gen"
import {
  MemorySnapshotStore,
  SNAPSHOT_MAX_AGE_MS,
  attachSnapshotWriter,
  createSnapshotStore,
  snapshotQueryFn,
} from "@/lib/offline/query-snapshots"

export function getRouter() {
  if (typeof document !== "undefined") {
    notifyManager.setScheduler(window.requestAnimationFrame)
  }

  const convexUrl = import.meta.env.VITE_CONVEX_URL
  if (!convexUrl) {
    throw new Error("VITE_CONVEX_URL is not set")
  }

  // expectAuth defers Convex calls until authentication is ready, which is what
  // makes the initial authenticated render seamless. It only applies before the
  // first authentication -- see the sign-out note in the design doc.
  const convexQueryClient = new ConvexQueryClient(convexUrl, {
    expectAuth: true,
  })

  const hashFn = convexQueryClient.hashFn()
  const snapshots = typeof document === "undefined" ? new MemorySnapshotStore() : createSnapshotStore()
  const queryClient: QueryClient = new QueryClient({
    defaultOptions: {
      queries: {
        queryKeyHashFn: hashFn,
        queryFn: snapshotQueryFn(
          convexQueryClient.queryFn(),
          snapshots,
          hashFn,
          () => convexQueryClient.convexClient.connectionState().isWebSocketConnected
        ),
      },
    },
  })
  convexQueryClient.connect(queryClient)
  if (typeof document !== "undefined") {
    attachSnapshotWriter(queryClient.getQueryCache(), snapshots)
    // Swallowed like every other store write in this layer: a refusing
    // IndexedDB must cost the app its durability, never its boot.
    void snapshots.prune(Date.now() - SNAPSHOT_MAX_AGE_MS).catch(() => undefined)
  }

  const router = createTanStackRouter({
    routeTree,

    context: { queryClient, convexQueryClient, snapshots },
    scrollRestoration: true,
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
  })

  setupRouterSsrQueryIntegration({
    router,
    queryClient,
  })

  return router
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
