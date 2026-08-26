import { errorMessage } from "@/lib/error-message"
import type { useToastManager } from "@base-ui/react/toast"

/**
 * The undo vocabulary, stated once.
 *
 * Every reversible write in this product reports itself the same way: a toast
 * that names what just happened, an Undo that performs the inverse write, and
 * an alarm if that inverse write is itself refused. It was hand-rolled three
 * times — delete and re-date in `entry-log.tsx`, and a note dialog's
 * save-on-dismissal, since deleted along with the dialog — with the window tied
 * together only by a comment saying the numbers matched. They are the same shape because they are the same promise to
 * the user, so they live in one place and drift together or not at all.
 *
 * Deliberately not a hook and deliberately not a component: the manager is
 * passed in, so this stays a plain function that anything holding a manager can
 * call, and nothing here has an opinion about where that manager came from.
 */

/** Long enough to notice and reach, short enough not to linger. */
export const UNDO_MS = 6_000

type ToastManager = ReturnType<typeof useToastManager>

/**
 * Reports a write that has ALREADY happened, and offers the way back.
 *
 * `undo` is the inverse write, run on click. Its rejection is caught here
 * rather than left to the caller — an unhandled rejection from an Undo button
 * is the one failure the user is least able to explain, because they pressed
 * the recovery control and nothing at all changed. The alarm it raises carries
 * no timeout of its own: a failed undo is not something to glance at.
 */
export function toastWithUndo(
  toasts: ToastManager,
  {
    title,
    description,
    undo,
  }: {
    title: string
    description?: string
    undo: () => Promise<unknown>
  }
): void {
  toasts.add({
    title,
    description,
    timeout: UNDO_MS,
    actionProps: {
      children: "Undo",
      onClick: () => {
        void undo().catch((thrown: unknown) => {
          toasts.add({ title: errorMessage(thrown), priority: "high" })
        })
      },
    },
  })
}
