import { useEffect } from "react"
import { useBlocker } from "@tanstack/react-router"
import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"

/**
 * "You have unsaved changes" — for the two ways a person leaves a page.
 *
 * Only the invoice editor mounts this, and only because that editor is the one
 * surface in the product that buffers instead of saving on blur. Everywhere else
 * there is nothing to lose, and a product that asked "are you sure?" on the way
 * out of a settings row would be inventing a risk to warn about.
 *
 * TWO EXITS, TWO MECHANISMS, and neither covers the other:
 *
 *   - IN-APP navigation — the breadcrumb, the sidebar, any `Link` — never
 *     touches the browser's unload lifecycle, because the document is not
 *     unloading. TanStack's `useBlocker` is what sees it.
 *   - TAB CLOSE / RELOAD / a link out of the app never reaches the router.
 *     Only `beforeunload` sees that, and the browser draws its own generic
 *     string over it: the message cannot be customised, and every attempt to is
 *     ignored by design. That is the platform's answer to pages that begged.
 *
 * The prompt below is OURS rather than `confirm()`. `useBlocker` returns a
 * resolver when asked (`withResolver: true`) — a `status`, and `proceed` /
 * `reset` — which is precisely the hook needed to render a real dialog and
 * answer it later. `confirm()` would have been the fallback if it did not, and
 * it is a poor one: it cannot name the fields, it cannot be styled, it blocks
 * the main thread, and Chrome suppresses it outright in a background tab.
 *
 * The blocker's OWN `enableBeforeUnload` is turned off and the listener below is
 * registered instead. It does the same job, and the reason to prefer it is
 * lifetime: `disabled: !when` already means the router registers nothing while
 * the form is clean, and an effect keyed on the same `when` makes the unload
 * guard visibly the same condition rather than a second flag on a hook that
 * might be read as always-on. It is also directly assertable, which the
 * router's internal registration is not.
 */
export function UnsavedChangesGuard({
  when,
  what,
}: {
  /** Dirty. Nothing here registers, prompts, or fires when this is false — a
   *  guard on a clean form is a dialog nobody can explain. */
  when: boolean
  /** What is unsaved, named. "Billed to and Notes", not "changes": a person who
   *  is told which fields they are about to lose can decide in one read, and one
   *  of the two answers is "those, I don't want". */
  what: string
}) {
  const blocker = useBlocker({
    // The condition lives in `disabled`, not here. `shouldBlockFn` is consulted
    // per navigation and would answer from whatever `when` was captured when the
    // effect last ran; `disabled` is in the hook's dependency list, so toggling
    // it tears the registration down and puts it back with the current value.
    shouldBlockFn: () => true,
    disabled: !when,
    withResolver: true,
    enableBeforeUnload: false,
  })

  useEffect(() => {
    if (!when) return
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      // Both halves, deliberately. `preventDefault()` is the modern spec's
      // signal; `returnValue` is what older WebKit and Firefox still read, and
      // a page that sets only one of them silently fails to prompt on some
      // browsers — which is the failure nobody notices until they have lost
      // something.
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", onBeforeUnload)
    return () => window.removeEventListener("beforeunload", onBeforeUnload)
  }, [when])

  const blocked = blocker.status === "blocked"

  return (
    <Dialog.Root
      open={blocked}
      onOpenChange={(next) => {
        // Escape and a backdrop click both mean "no, I didn't mean to leave" —
        // the same answer as Stay. Dismissing the dialog must never be the path
        // that discards the edits, because dismissing is what a person does
        // when they are unsure.
        if (!next) blocker.reset?.()
      }}
    >
      <Dialog.Popup>
        <div className="flex flex-col gap-1">
          <Dialog.Title>Leave without saving?</Dialog.Title>
          <Dialog.Description>
            {what} {what.includes(" and ") ? "have" : "has"} unsaved changes. Leaving
            this page discards them — this invoice is only written when you press
            Save.
          </Dialog.Description>
        </div>

        <div className="flex items-center justify-end gap-2">
          {/*
            Stay is the DEFAULT and the affirmative-looking one, and Discard is
            the quiet destructive one beside it. The dialog exists because
            leaving is probably a mistake; making the mistake the prominent
            button would be a strange thing to have interrupted somebody for.
          */}
          <Button variant="destructive" size="sm" onClick={() => blocker.proceed?.()}>
            Discard changes
          </Button>
          <Button size="sm" onClick={() => blocker.reset?.()}>
            Keep editing
          </Button>
        </div>
      </Dialog.Popup>
    </Dialog.Root>
  )
}
