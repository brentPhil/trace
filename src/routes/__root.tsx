/// <reference types="vite/client" />
import { Toaster } from "@/components/ui/toast"
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
import type { SnapshotStore } from "@/lib/offline/query-snapshots"

import { Announcer } from "@/components/a11y/announcer"
import { ThemeProvider } from "@/components/theme-provider"
import { ShortcutsOverlay } from "@/components/a11y/shortcuts-overlay"
import { authClient } from "@/lib/auth-client"
import { THEME_INIT_SCRIPT } from "@/lib/theme"
import { getToken } from "@/lib/auth-server"
import { pageTitle } from "@shared/brand"
import appCss from "../styles.css?url"

// Reads the session cookie on the server and exchanges it for a Convex token.
const getAuth = createServerFn({ method: "GET" }).handler(async () => {
  return await getToken()
})

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient
  convexQueryClient: ConvexQueryClient
  snapshots: SnapshotStore
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
        title: pageTitle(),
      },
      /* The `theme-color` pair lives as literal JSX in RootDocument's <head>,
       * NOT here — TanStack's head builder dedupes meta by `name` alone
       * (headContentUtils.js: `metaByAttribute[m.name ?? m.property]`), so two
       * entries differing only by `media` collapse to one and the other is
       * silently dropped. Declared through this array, light-scheme users got
       * no theme-color at all. */
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      {
        rel: "manifest",
        href: "/manifest.json",
      },
      /* The mark, three ways, all rendered from public/logo.svg by
       * scripts/make-icons.mjs. The SVG is what a modern tab shows — crisp at
       * any pixel density — and the ICO sits beside it for the browsers and
       * the Windows pinned-site path that still want one; `sizes="any"` on
       * the SVG is what makes Chrome prefer it over the ICO listed first.
       * iOS Safari reads neither and only ever the apple-touch-icon. */
      {
        rel: "icon",
        href: "/favicon.ico",
        sizes: "48x48",
      },
      {
        rel: "icon",
        type: "image/svg+xml",
        href: "/logo.svg",
        sizes: "any",
      },
      {
        rel: "apple-touch-icon",
        href: "/apple-touch-icon.png",
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
        OUTSIDE the toast provider and the announcer, because the theme is not
        a feature of either: it governs the document element itself, which is
        the ancestor of every portal those two open. A provider mounted deeper
        would leave a menu or a toast portalled to <body> reading the ramp from
        a context it is not inside.
      */}
      <ThemeProvider>
        {/*
          App-wide rather than per-route: an undo has to outlive the surface
          that raised it. Deleting an entry from the log and navigating away
          must still leave the way back on screen for its six seconds.
        */}
        <Toaster>
          {/*
            The live region and the shortcut list are app-wide because both are
            about reaching the product at all: an undo has to outlive the
            surface that raised it, a state change has to be announced wherever
            it happened, and "what can I press?" is never a per-route question.
          */}
          <Announcer>
            <Outlet />
            <ShortcutsOverlay />
          </Announcer>
        </Toaster>
      </ThemeProvider>
    </ConvexBetterAuthProvider>
  )
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    /*
      `className="dark"` ON THE SERVER, still — but as a DEFAULT rather than as
      the only answer.

      The theme is a per-device choice in `localStorage`, which the server
      cannot read, so it has to render something and then be corrected. Dark is
      what it renders because dark is this system's home state, and the
      correction happens in `THEME_INIT_SCRIPT` below — before first paint, not
      on mount — so a light-mode user never sees a dark flash and a dark-mode
      user never sees a white one.

      `suppressHydrationWarning` is required here now: that script mutates
      `class`, `style` AND `data-theme` on this very element between the
      server's HTML and React's hydration, which is a mismatch by construction.
      Scoped to this element's own attributes, exactly like the one on <body>.

      `data-theme` is the theme PRESET, and it is deliberately absent from the
      server's markup rather than guessed: the default preset has no CSS block,
      so no attribute IS the default, and a wrong guess would paint one palette
      and then swap. The script writes it only when a non-default preset is
      stored.
    */
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        {/*
          BEFORE <HeadContent />, and before anything else that can paint.

          The one job is to put the right class AND the right `data-theme` on
          <html> while the parser is still in <head>, so the first paint is
          already correct in both axes. Moved after the stylesheet or into a
          component, this becomes the white-flash bug every theme
          implementation ships first — and with presets there are two of it,
          because a palette that arrives on mount is a full repaint rather than
          a polarity swap.
        */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        {/*
          The browser chrome around the page — Android's address bar, iOS
          Safari's, a PWA's title bar. TWO tags, one per scheme, because a
          single value is wrong half the time: this shipped as one hard-coded
          `#14110e` (the darkroom's ground) and a white page sat under a
          near-black address bar.

          LITERAL JSX, not entries in the route's `meta()` array, because
          TanStack's head builder dedupes meta by `name` alone — `media` is not
          part of the key — so a pair declared there collapses to one tag and
          the other is silently dropped. Verified against
          `headContentUtils.js` (`metaByAttribute[m.name ?? m.property]`).

          Hex `--background` values from each ramp, because a meta tag cannot
          read CSS variables. Keyed to `prefers-color-scheme` — the SYSTEM
          setting — so an in-app override does not move them: writing the meta
          from `ThemeProvider` at runtime would trade a correct first paint for
          a correct toggle, and a user whose app theme matches their OS (the
          default, and the common case) gets both.
        */}
        <meta
          name="theme-color"
          media="(prefers-color-scheme: light)"
          content="#ffffff"
        />
        <meta
          name="theme-color"
          media="(prefers-color-scheme: dark)"
          content="#0a0a0a"
        />
        <HeadContent />
      </head>
      {/*
        `suppressHydrationWarning` here is for BROWSER EXTENSIONS, not for our
        own markup.

        Grammarly and friends write attributes onto <body> before React
        hydrates — `data-gr-ext-installed`, `data-new-gr-c-s-check-loaded` — so
        the client body carries attributes the server never rendered, and React
        reports a mismatch on every single load. A warning that always fires is
        a warning nobody reads, which is expensive here: a real mismatch would
        appear in the same place and be dismissed as the usual noise.

        The scope is narrow on purpose. React applies this to THIS element's own
        attributes and text only — it does not extend to descendants — so
        nothing in the app tree is silenced by it. Genuine hydration bugs inside
        {children} still report normally.
      */}
      <body suppressHydrationWarning>
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
