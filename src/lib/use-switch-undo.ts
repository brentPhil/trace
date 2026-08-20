import { useEffect, useRef } from "react"
import { toastWithUndo } from "@/lib/undo-toast"
import type { Id } from "../../convex/_generated/dataModel"

/**
 * Noticing that the timer changed without being asked.
 *
 * The switch is the one write in this feature that happens at a moment the user
 * did not choose. They may have been mid-sentence, or on another tab, or not at
 * the machine at all — so the app has to SAY what it did and offer the way
 * back, rather than leaving them to discover that the running title is not the
 * one they typed.
 *
 * It lives in the SHELL, not on /timer. The switch is made by a one-minute
 * server cron, so it lands wherever the user happens to be — /reports,
 * /invoices, or a tab left open on nothing. A toast mounted on the timer page
 * would announce only the switches that happened while that page was open and
 * silently miss the rest, which is worse than no toast at all: it teaches
 * people the app tells them, and then it doesn't.
 *
 * The decision is a pure function so it can be tested against its own table of
 * cases; the hook underneath is only plumbing.
 */

/** Matches `UNDO_WINDOW_MS` in `convex/googleTrack.ts`. Both copies exist on
 *  purpose: this one decides whether to OFFER, that one decides whether to
 *  ALLOW, and a stale tab must not be able to reverse this morning's switch. */
export const SWITCH_UNDO_MS = 5 * 60 * 1_000

/**
 * Structural rather than `Doc<"timeEntries">`: the decision reads four fields
 * and the test builds them by hand, which is what keeps this file in the pure
 * `unit` project instead of needing a Convex document to say anything.
 */
export type RunningLike = {
  _id: string
  title: string
  startedAt: number
  source: string
} | null

export type SwitchAnnouncement = { entryId: string; title: string }

export function switchToAnnounce(
  running: RunningLike,
  lastAnnouncedId: string | null,
  nowMs: number
): SwitchAnnouncement | null {
  if (running === null) return null
  if (running.source !== "calendar") return null
  if (nowMs - running.startedAt > SWITCH_UNDO_MS) return null
  // THE SEEN-ID, and the reason this is not just a freshness check. The running
  // query is reactive and re-fires on every unrelated update — a title edit, a
  // tag, the next sync — so without this the same switch would be announced
  // again on each one, for as long as the window stayed open.
  if (running._id === lastAnnouncedId) return null
  return { entryId: running._id, title: running.title }
}

type ToastManager = Parameters<typeof toastWithUndo>[0]

export function useSwitchUndo(
  running: RunningLike,
  toasts: ToastManager,
  undo: (args: { entryId: Id<"timeEntries"> }) => Promise<unknown>
): void {
  // A ref, not state: announcing must not itself cause a render, or the effect
  // re-runs on the render it caused and the toast stutters.
  const announced = useRef<string | null>(null)

  useEffect(() => {
    const next = switchToAnnounce(running, announced.current, Date.now())
    if (next === null) return
    announced.current = next.entryId
    toastWithUndo(toasts, {
      title: `Switched to ${next.title === "" ? "a meeting" : next.title}`,
      description: "Your calendar started this.",
      // The branded id exists only on the value Convex's validator checks at
      // the wire, never on the plain `string` the pure decision above works
      // in. The cast belongs at THIS seam — the same one
      // `toPreferenceTrackRef` in use-music-tracking.ts sits on — rather than
      // dragging generated ids into a module built to run without them.
      undo: async () =>
        await undo({ entryId: next.entryId as Id<"timeEntries"> }),
    })
  }, [running, toasts, undo])
}
