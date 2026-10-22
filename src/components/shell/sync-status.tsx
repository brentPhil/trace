import { useEffect, useRef, useState } from "react"
import { CloudOff, RefreshCw, Check } from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

const SAVED_FOR_MS = 2_000

/**
 * The outbox, said out loud.
 *
 * Same register as `RunawayBanner`: `role="status"`, never colour alone — a
 * glyph and a sentence carry the state (The Over-Determined State Rule).
 * Not an error surface: being offline is ordinary, and a change waiting to
 * sync is the product working as promised, not failing.
 *
 * A FLOATING GLYPH, NOT A ROW. This used to be a full-width band under the
 * timer bar, and it came and went with every write — so the log below it
 * jumped a line down and back up a second later, and a click aimed at a row
 * landed on the one beside it. Fixed to the corner it occupies no layout at
 * all. The sentence is still there: in the tooltip for a pointer, and inside
 * the `status` region for a screen reader, so the state is never glyph-only.
 *
 * Bottom-right, ABOVE the bar below `md` (the bar is pinned to the bottom of a
 * phone and measures itself into `--timer-bar-height`), in the bottom corner
 * at `md` and up. Bottom-left is the sidebar's account menu; toasts share this
 * corner but stack above it and are gone in seconds.
 */
export function SyncStatus({ offline, pending }: { offline: boolean; pending: number }) {
  const [justSaved, setJustSaved] = useState(false)
  const previous = useRef(pending)

  /*
   * Arming and clearing are separate effects, deliberately.
   *
   * With the timer armed inside this effect, a change to `offline` runs the
   * cleanup and clears it — and the re-run then sees `previous.current === 0`
   * and never re-arms. `justSaved` would stay true forever. That is not a
   * corner case: `isOffline` flips on the FIRST failed retry of a socket that
   * was connected, so a blip within the two-second window is ordinary, and
   * the result is "All changes saved." pinned to the shell until the next
   * time something syncs.
   */
  useEffect(() => {
    const settled = previous.current > 0 && pending === 0 && !offline
    previous.current = pending
    if (settled) setJustSaved(true)
  }, [pending, offline])

  useEffect(() => {
    if (!justSaved) return
    const timer = setTimeout(() => setJustSaved(false), SAVED_FOR_MS)
    return () => clearTimeout(timer)
  }, [justSaved])

  const changes = `${pending} ${pending === 1 ? "change" : "changes"}`

  let content: { Icon: typeof CloudOff; text: string; spin?: boolean } | null = null
  if (offline) {
    content = {
      Icon: CloudOff,
      text: pending === 0 ? "Offline. Changes will sync when you're back." : `Offline. ${changes} will sync when you're back.`,
    }
  } else if (pending > 0) {
    content = { Icon: RefreshCw, text: `Syncing ${changes}…`, spin: true }
  } else if (justSaved) {
    content = { Icon: Check, text: "All changes saved." }
  }

  if (content === null) return null
  const { Icon, text, spin } = content
  return (
    <div
      role="status"
      className={cn(
        "fixed right-3 z-40 bottom-[calc(var(--timer-bar-height,6.5rem)+0.5rem)]",
        "md:right-4 md:bottom-4"
      )}
    >
      <Tooltip>
        <TooltipTrigger
          render={<span />}
          className="flex size-8 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-sm"
        >
          <Icon aria-hidden="true" className={cn("size-4", spin && "animate-spin motion-reduce:animate-none")} />
          <span className="sr-only">{text}</span>
        </TooltipTrigger>
        <TooltipContent side="left">{text}</TooltipContent>
      </Tooltip>
    </div>
  )
}
