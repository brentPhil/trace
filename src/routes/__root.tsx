/// <reference types="vite/client" />
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRouteWithContext,
  useRouteContext,
} from "@tanstack/react-router"
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools"
import { TanStackDevtools } from "@tanstack/react-devtools"
import { createServerFn } from "@tanstack/react-start"
import { ConvexBetterAuthProvider } from "@convex-dev/better-auth/react"
import type { AuthClient } from "@convex-dev/better-auth/react"
import type { ConvexQueryClient } from "@convex-dev/react-query"
import type { QueryClient } from "@tanstack/react-query"

import { Announcer } from "@/components/a11y/announcer"
import { ShortcutsOverlay } from "@/components/a11y/shortcuts-overlay"
import { Toast, ToastViewport } from "@/components/ui/toast"
import { authClient } from "@/lib/auth-client"
import { getToken } from "@/lib/auth-server"
import appCss from "../styles.css?url"

// Reads the session cookie on the server and exchanges it for a Convex token.
const getAuth = createServerFn({ method: "GET" }).handler(async () => {
  return await getToken()
})

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient
  convexQueryClient: ConvexQueryClient
}>()({
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      {
        title: "Trace",
      },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),
  beforeLoad: async (ctx) => {
    const token = await getAuth()

    // serverHttpClient only exists during SSR. Setting the token here is what
    // lets queries, mutations and actions run authenticated on the server, so
    // authenticated pages render with real data instead of a loading state.
    if (token) {
      ctx.context.convexQueryClient.serverHttpClient?.setAuth(token)
    }

    return {
      isAuthenticated: !!token,
      token,
    }
  },
  notFoundComponent: () => (
    <main className="container mx-auto p-4 pt-16">
      <h1>404</h1>
      <p>The requested page could not be found.</p>
    </main>
  ),
  component: RootComponent,
  shellComponent: RootDocument,
})

function RootComponent() {
  const context = useRouteContext({ from: Route.id })

  return (
    <ConvexBetterAuthProvider
      client={context.convexQueryClient.convexClient}
      // Upstream's exported AuthClient type is
      // createAuthClient<BetterAuthClientPlugin & { plugins }>, an intersection
      // that a client built per their own docs does not satisfy under `strict`.
      // Their example never runs tsc over src/, so this is unexercised upstream.
      // Runtime is unaffected. Revisit when @convex-dev/better-auth > 0.12.5.
      authClient={authClient as unknown as AuthClient}
      initialToken={context.token}
    >
      {/*
        App-wide rather than per-route: an undo has to outlive the surface that
        raised it. Deleting an entry from the log and navigating away must still
        leave the way back on screen for its six seconds.
      */}
      <Toast.Provider>
        {/*
          The live region and the shortcut list are app-wide because both are
          about reaching the product at all: an undo has to outlive the surface
          that raised it, a state change has to be announced wherever it
          happened, and "what can I press?" is never a per-route question.
        */}
        <Announcer>
          <Outlet />
          <ShortcutsOverlay />
        </Announcer>
        <ToastViewport />
      </Toast.Provider>
    </ConvexBetterAuthProvider>
  )
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    // The palette lives on :root, but shadcn components carry `dark:` variants
    // that only fire inside `.dark` (see the @custom-variant in styles.css).
    // Without this class those branches are dead code.
    <html lang="en" className="dark">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <TanStackDevtools
          config={{
            position: "bottom-right",
          }}
          plugins={[
            {
              name: "Tanstack Router",
              render: <TanStackRouterDevtoolsPanel />,
            },
          ]}
        />
        <Scripts />
      </body>
    </html>
  )
}
