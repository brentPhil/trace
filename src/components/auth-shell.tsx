import { useEffect, useRef } from "react"
import { cn } from "@/lib/utils"

/** Stable id so inputs can point at the error via aria-describedby. */
export const AUTH_ERROR_ID = "auth-form-error"

/**
 * Shared frame for the auth screens: wordmark, heading, then content.
 *
 * `focusHeading` moves focus to the heading on mount. Use it when a submission
 * replaces the form with a result screen — the control that had focus is
 * unmounted at that moment, and without this focus falls to <body>, so keyboard
 * and screen reader users lose their place and hear nothing about the outcome.
 * Leave it off for screens that open with a focused input.
 */
export function AuthShell({
  heading,
  focusHeading = false,
  children,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  heading: string
  focusHeading?: boolean
}) {
  const headingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    if (focusHeading) {
      headingRef.current?.focus()
    }
  }, [focusHeading])

  return (
    <div className={cn("rise flex flex-col gap-8", className)} {...props}>
      <div className="flex flex-col gap-2">
        <span className="text-base font-medium tracking-tight">Trace</span>
        <h1
          ref={headingRef}
          tabIndex={focusHeading ? -1 : undefined}
          className="text-2xl font-medium tracking-tight text-balance outline-none"
        >
          {heading}
        </h1>
      </div>
      {children}
    </div>
  )
}

/**
 * Error region for the auth forms.
 *
 * Rendered unconditionally, even when empty. A live region that mounts at the
 * same moment as its content is routinely missed by screen readers, which is
 * the common failure in conditionally-rendered error markup — including what
 * shadcn's own FieldError does, since it returns null with no children.
 *
 * `role="alert"` carries an implicit aria-live of "assertive". Adding
 * aria-live="polite" alongside it would downgrade that, so it is left off.
 */
export function AuthError({ message }: { message: string | null }) {
  return (
    <div
      id={AUTH_ERROR_ID}
      role="alert"
      // empty:sr-only, NOT empty:hidden. `display: none` would drop the region
      // out of the accessibility tree, so the announcement it exists to make
      // would never fire. sr-only keeps it in the tree while taking it out of
      // layout flow, so it adds no flex gap while empty.
      className="text-sm font-normal text-destructive empty:sr-only"
    >
      {message}
    </div>
  )
}
