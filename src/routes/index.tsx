import { createFileRoute, redirect } from "@tanstack/react-router"
import {
  LANDING_DESCRIPTION,
  LandingPage,
} from "@/components/landing/landing-page"

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [{ name: "description", content: LANDING_DESCRIPTION }],
  }),
  /**
   * Signed in means straight to the app.
   *
   * This is the one place worth doing it, rather than changing where `/login`
   * sends people. Sign-in, sign-up, an old bookmark and a typed bare domain all
   * arrive here, and `safeRedirect` falls back to `/` whenever a `?redirect=`
   * is absent or rejected — so fixing the login route alone would still leave
   * four ways to land on a page whose only content is a link to the real one.
   *
   * `beforeLoad` rather than the component: redirecting from render means the
   * interstitial is painted first and then replaced, which is the flash this
   * removes.
   */
  beforeLoad: ({ context }) => {
    if (context.isAuthenticated) throw redirect({ to: "/timer" })
  },
  /**
   * The signed-OUT landing page, and only that — `beforeLoad` above sends an
   * authenticated visitor to `/timer` before this renders. Someone whose
   * session is not recognised sees this page, and "Sign in" is the way back.
   */
  component: LandingPage,
})
