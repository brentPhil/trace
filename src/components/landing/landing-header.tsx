import { Link } from "@tanstack/react-router"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { APP_NAME } from "@shared/brand"

/**
 * A HEADER, NOT NAVIGATION. DESIGN.md §5 says navigation is a left rail and
 * never a top nav; that rule is about moving around inside the product. This
 * bar holds the wordmark and two ways in, and nothing that navigates within
 * the app, so it is not precedent for an app page.
 *
 * No theme control: `ThemeChoice` is a three-way tab strip built for the
 * sidebar popup, and a visitor gets the system preference, which is the app's
 * default anyway.
 */
export function LandingHeader() {
  return (
    <header className="flex h-14 items-center justify-between gap-4 border-b border-border px-4">
      <span className="text-base font-medium tracking-tight">{APP_NAME}</span>
      <div className="flex items-center gap-2">
        <Link
          to="/login"
          search={{ redirect: undefined }}
          className={cn(buttonVariants({ variant: "ghost" }))}
        >
          Sign in
        </Link>
        <Link
          to="/signup"
          search={{ redirect: undefined }}
          className={cn(buttonVariants())}
        >
          Create account
        </Link>
      </div>
    </header>
  )
}
