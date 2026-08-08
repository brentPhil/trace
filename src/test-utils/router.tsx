import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router"
import type { ReactNode } from "react"

/**
 * Renders a component that contains TanStack `Link`s, at a chosen path.
 *
 * A `Link` reads the router from context and throws without one, so a component
 * with navigation in it cannot be rendered bare however pure it otherwise is.
 * The routes here are stubs — only their paths matter, because what is being
 * asserted is which link is marked current.
 */
export function renderWithRouter(ui: ReactNode, { path }: { path: string }) {
  const rootRoute = createRootRoute({ component: () => <>{ui}</> })
  const children = ["/timer", "/reports", "/projects", "/settings"].map((p) =>
    createRoute({ getParentRoute: () => rootRoute, path: p, component: () => null })
  )
  rootRoute.addChildren(children)

  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: [path] }),
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return <RouterProvider router={router as any} />
}
