import {
  createCsrfMiddleware,
  createMiddleware,
  createStart,
} from "@tanstack/react-start"

/**
 * The one place every request into this app passes through.
 *
 * `src/start.ts` is not an arbitrary filename: TanStack Start's Vite plugin
 * resolves `<srcDirectory>/start.{ts,tsx,…}` as the "start entry" and reads the
 * `startInstance` export from it. Because it is resolved rather than imported
 * by anything in the app, `pnpm dev` and the wrangler production build load the
 * SAME module through the SAME handler — which is the whole reason the header
 * below lives here rather than in `wrangler.jsonc`, a `public/_headers` file or
 * the Cloudflare dashboard. A header configured in any of those places is not
 * exercised by the dev server (and `public/_headers` does not cover SSR
 * document responses at all), so the first time anyone would find out it had
 * regressed is in production.
 */

/**
 * DENY FRAMING ON EVERY PAGE THIS APP SERVES.
 *
 * `/desktop-login` rests its entire security argument on a single deliberate
 * click. The URL that lands there is authored by whoever opened the browser and
 * names BOTH the loopback port and the `state` nonce, so there is nothing in
 * the request itself that distinguishes a handoff the user started from one a
 * local process started for them. RFC 8252's loopback redirect is only safe
 * because PKCE binds the response to the client that began the exchange; this
 * flow has no verifier anywhere, and the human pressing "Continue to the
 * desktop app" is what stands in its place (see `src/routes/desktop-login.tsx`
 * and Addendum 2 of the external-browser-login design).
 *
 * A CLICK THAT CAN BE FRAMED IS A CLICK THAT CAN BE STOLEN. With no
 * `frame-ancestors` and no `X-Frame-Options`, any origin could load
 * `https://chroneli.com/desktop-login?port=<mine>&state=<mine>` in a
 * transparent iframe under a decoy button and harvest the one press the design
 * depends on — turning the mitigation back into the zero-click session export
 * it was written to prevent. The attacker in this threat model already opens
 * the user's default browser at a page of its own choosing, so this is not a
 * hypothetical second attacker; it is the same one, one step further.
 *
 * SITE-WIDE rather than scoped to that route. `/login` and `/desktop-callback`
 * carry the same character — credentials on one, a one-time token on the other
 * — and nothing on chroneli.com is ever legitimately embedded in a frame, so a
 * per-route allowlist would be a list of exceptions with no members and one
 * more thing for a new route to forget to join. `X-Frame-Options: DENY` rides
 * along for engines that predate `frame-ancestors`; where both are understood
 * the CSP directive wins, and they say the same thing.
 *
 * HTML DOCUMENTS ONLY, AND THAT IS NOT AN AESTHETIC CHOICE. Setting the header
 * on every response unconditionally — which reads as the simpler, more uniform
 * thing — BREAKS `/api/auth/*`. That route proxies to Better Auth, which hands
 * back the `Response` it got from `fetch()`, and per the Fetch standard such a
 * response carries an IMMUTABLE headers guard: `headers.set()` on it throws
 * `TypeError: immutable`, the middleware rejects, and every auth call 500s.
 * Found by curling `/api/auth/get-session` against the dev server, not
 * reasoned about. Documents are also the entire attack surface here — framing
 * a JSON body achieves nothing — so the narrower rule is both the safe one and
 * the honest one.
 *
 * Redirects (`/timer` → `/login?redirect=…` for a signed-out visitor) fall
 * outside it and are fine outside it: a 307 renders nothing to click, and the
 * page it lands on gets the header on its own way out.
 */
const denyFramingMiddleware = createMiddleware({ type: "request" }).server(
  async ({ next }) => {
    const result = await next()
    const contentType = result.response.headers.get("content-type")
    if (contentType?.toLowerCase().startsWith("text/html")) {
      result.response.headers.set(
        "Content-Security-Policy",
        "frame-ancestors 'none'"
      )
      result.response.headers.set("X-Frame-Options", "DENY")
    }
    return result
  }
)

/**
 * Re-declared, not added.
 *
 * Start applies its built-in CSRF middleware ONLY while no start instance
 * exists — `createStartHandler` falls back to it exactly when
 * `startInstance` is undefined. The moment this file exports one, that fallback
 * stops, and `requestMiddleware` here becomes the complete list. Omitting this
 * would therefore have silently unprotected every server function as a side
 * effect of adding a header, which is the kind of trade nobody would ever make
 * on purpose. The filter matches Start's own default: server functions are
 * same-origin RPC endpoints, document requests are not.
 */
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
})

export const startInstance = createStart(() => ({
  // Outermost first: the framing denial wraps everything, so even a response
  // the CSRF middleware refuses outright still carries the header.
  requestMiddleware: [denyFramingMiddleware, csrfMiddleware],
}))
