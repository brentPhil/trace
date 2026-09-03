import { useEffect, useRef, useState } from "react"
import { CloudOff, RefreshCw, Check } from "lucide-react"
import { cn } from "@/lib/utils"

const SAVED_FOR_MS = 2_000

/**
 * The outbox, said out loud.
 *
 * Same register as `RunawayBanner`: `role="status"`, never colour alone — a
 * glyph and a sentence carry the state (The Over-Determined State Rule).
 * Not an error surface: being offline is ordinary, and a change waiting to
 * sync is the product working as promised, not failing.
 */
export function SyncStatus({ offline, pending }: { offline: boolean; pending: number }) {
  const [justSaved, setJustSaved] = useState(false)
  const previous = useRef(pending)

  useEffect(() => {
    if (previous.current > 0 && pending === 0 && !offline) {
      setJustSaved(true)
      const timer = setTimeout(() => setJustSaved(false), SAVED_FOR_MS)
      previous.current = pending
      return () => clearTimeout(timer)
    }
    previous.current = pending
  }, [pending, offline])

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
        "flex items-center gap-2 border-b border-border bg-card px-4 py-1.5 text-sm",
        "text-muted-foreground"
      )}
    >
      <Icon aria-hidden="true" className={cn("size-4", spin && "animate-spin motion-reduce:animate-none")} />
      <span>{text}</span>
    </div>
  )
}
