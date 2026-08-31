import { useEffect, useState } from "react"
import { ArrowRight, Sparkles, X } from "lucide-react"
import { Link } from "@tanstack/react-router"
import { Button } from "@/components/ui/button"

/**
 * The current announcement, and the WHOLE feed: one entry, replaced in place
 * when the next feature ships. A single object rather than a list because the
 * banner shows one update and dismissing it dismisses that update by `id` —
 * shipping a new feature means writing a new `id` here, which is exactly what
 * makes the banner reappear for people who dismissed the previous one.
 *
 * In code rather than in Convex: an announcement changes when the CODE
 * changes — it describes the build the user is running, so it ships with it.
 * A table would let an announcement outrun the deploy it describes.
 */
export const WHATS_NEW = {
  id: "2026-08-theme-presets",
  title: "New: colour themes",
  body: "Give the app a new look — fifteen palettes, bold solid sidebars included, and corners cut to your taste.",
  // A phrase, not a destination: "Open Settings" describes the mechanism,
  // this describes the reward. The link still goes to /settings.
  cta: "Pick yours",
} as const

const WHATS_NEW_STORAGE_KEY = "chroneli:whats-new-dismissed"

/** Wrapped like `theme.ts`'s readers: `localStorage` THROWS in some contexts
 *  (storage disabled, some private windows) rather than returning null. */
export function readDismissedUpdate(): string | null {
  try {
    return window.localStorage.getItem(WHATS_NEW_STORAGE_KEY)
  } catch {
    return null
  }
}

function writeDismissedUpdate(id: string) {
  try {
    window.localStorage.setItem(WHATS_NEW_STORAGE_KEY, id)
  } catch {
    // Nowhere to write means the banner returns next session — an
    // acceptable nag, and strictly better than a crash.
  }
}

/**
 * The "what's new" card in the sidebar footer.
 *
 * CLOSED UNTIL PROVEN OPEN: it renders nothing on the server and on the first
 * client tick, then opens in a mount effect if the stored dismissal names an
 * older update (or none). The other order — open until the effect closes it —
 * flashes an already-dismissed banner at every returning visitor, and the
 * people who dismissed it are exactly the people who did not want it. Same
 * hydration stance as the theme controls' `hydrated` gate.
 *
 * DEVICE-LOCAL, like the theme: dismissal is a flick of the wrist, not a
 * preference worth a round-trip, and a Convex row per dismissal would put the
 * banner's state a network hop away from the click that closes it.
 *
 * SIDEBAR-FAMILY TOKENS THROUGHOUT, because it lives on the rail: with the
 * solid-sidebar presets the rail is dark while the content ramp is light, so
 * a `bg-accent` or `focus-visible:border-ring` here would paint light-ramp
 * values onto a dark surface. The overrides on `Button` re-point its hover
 * and focus treatment at the rail's own tokens for the same reason.
 */
export function WhatsNewBanner({ className }: { className?: string }) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    setOpen(readDismissedUpdate() !== WHATS_NEW.id)
  }, [])

  if (!open) {
    return null
  }
  return (
    <aside
      aria-label="What's new"
      className={
        // Hidden when the rail collapses to icons: a banner has no icon form,
        // and the collapsed rail is the user saying "less chrome".
        "rounded-md border border-sidebar-border bg-sidebar-accent p-2.5 group-data-[collapsible=icon]:hidden " +
        (className ?? "")
      }
    >
      {/* The dismiss button sits IN the header row, not absolutely over the
          card: `icon-row` is 28px tall, and floated over a 16px text-xs line
          it overlapped the body's first line. In-flow it can overlap nothing,
          and the negative margins fold its hit area into the card's padding
          so the row does not read as taller than its text. */}
      <div className="flex items-start justify-between gap-2">
        {/* A lucide Sparkles, not a literal emoji: emoji glyphs come from the
            OS, so they ignore the theme entirely and render a different
            picture on every platform. The icon takes `--sidebar-primary` —
            the one saturated accent the rail owns, measured in every preset —
            so the "new" marker wears the theme it announces. */}
        <p className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-sidebar-foreground">
          <Sparkles
            aria-hidden="true"
            className="size-3.5 shrink-0 text-sidebar-primary"
          />
          {WHATS_NEW.title}
        </p>
        <Button
          variant="ghost"
          size="icon-row"
          aria-label="Dismiss what's new"
          onClick={() => {
            setOpen(false)
            writeDismissedUpdate(WHATS_NEW.id)
          }}
          className="-mt-1 -mr-1 size-6 text-sidebar-foreground/70 hover:bg-sidebar-foreground/10 hover:text-sidebar-foreground focus-visible:border-sidebar-ring focus-visible:ring-sidebar-ring/30"
        >
          <X aria-hidden="true" className="size-3.5" />
        </Button>
      </div>
      <p className="mt-1 text-xs text-sidebar-foreground/70">{WHATS_NEW.body}</p>
      {/* RIGHT-ALIGNED, where a card's "go" action conventionally lives —
          reading order ends bottom-right, and the arrow pointing off the
          card's edge is pointing the way the click goes. */}
      <div className="mt-1 flex justify-end">
        <Link
          to="/settings"
          className="group/whats-new-link inline-flex items-center gap-1 rounded-sm text-xs font-medium text-sidebar-foreground underline underline-offset-2 outline-none hover:no-underline focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        >
          {WHATS_NEW.cta}
          {/* Decoration on a link whose text carries the meaning, so it is
              hidden from the accessible name — and its hover nudge sits
              behind `motion-reduce` like every other motion here. */}
          <ArrowRight
            aria-hidden="true"
            className="size-3 shrink-0 transition-transform group-hover/whats-new-link:translate-x-0.5 motion-reduce:transition-none motion-reduce:group-hover/whats-new-link:translate-x-0"
          />
        </Link>
      </div>
    </aside>
  )
}
