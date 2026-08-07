import { Toast } from "@base-ui/react/toast"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * The undo surface.
 *
 * Bottom-anchored and centred, against the convention of a top-right corner,
 * because the only toast this product raises carries an ACTION — and an action
 * the user has six seconds to take belongs where the thumb already is on a
 * phone and where the eye already is after clicking a row on a desktop. A
 * top-right toast is fine for announcements nobody has to answer.
 *
 * Base UI owns the hard parts: the live region and its politeness, pausing the
 * dismiss timer on hover and on focus, and the F6 hotkey that moves focus into
 * the toast. Reimplementing any of that by hand is how an undo becomes
 * unreachable from a keyboard.
 */
export function ToastViewport() {
  return (
    <Toast.Portal>
      <Toast.Viewport
        className={cn(
          "fixed bottom-0 left-1/2 z-50 w-full max-w-[26rem] -translate-x-1/2",
          "flex flex-col gap-2 p-4",
          // Not a click shield: the viewport spans the width, and swallowing
          // pointer events across it would block the row underneath.
          "pointer-events-none"
        )}
      >
        <ToastList />
      </Toast.Viewport>
    </Toast.Portal>
  )
}

function ToastList() {
  const { toasts } = Toast.useToastManager()

  return toasts.map((toast) => (
    <Toast.Root
      key={toast.id}
      toast={toast}
      className={cn(
        "pointer-events-auto flex items-center gap-3 rounded-lg px-4 py-3",
        "border border-edge-soft bg-surface-raised shadow-lg",
        // Tonal depth, not a glow: the toast sits above the page because it is
        // a lighter surface with a real edge, not because it emits light.
        "transition-[opacity,transform] duration-200 ease-out",
        "data-[starting-style]:translate-y-2 data-[starting-style]:opacity-0",
        "data-[ending-style]:translate-y-1 data-[ending-style]:opacity-0",
        "motion-reduce:transition-none motion-reduce:data-[starting-style]:translate-y-0",
        "motion-reduce:data-[ending-style]:translate-y-0"
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col">
        <Toast.Title className="truncate text-sm font-medium" />
        <Toast.Description className="truncate text-xs text-muted-foreground" />
      </div>

      {toast.actionProps ? (
        <Toast.Action
          className={cn(
            "shrink-0 rounded-md px-2.5 py-1 text-sm font-medium",
            "border border-edge text-foreground",
            "transition-colors hover:bg-surface",
            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          )}
        />
      ) : null}

      <Toast.Close
        aria-label="Dismiss"
        className={cn(
          "shrink-0 rounded-md p-1 text-muted-foreground",
          "transition-colors hover:text-foreground",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        )}
      >
        <X className="size-4" />
      </Toast.Close>
    </Toast.Root>
  ))
}

export { Toast }
