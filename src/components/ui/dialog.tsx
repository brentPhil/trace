import { Dialog as BaseDialog } from "@base-ui/react/dialog"
import { cn } from "@/lib/utils"
import type { ComponentProps } from "react"

/**
 * Thin styled wrappers over Base UI's dialog.
 *
 * Base UI keeps the focus trap, the initial-focus target, scroll locking, the
 * Escape handler and `aria-labelledby` wiring. Only the surface is ours.
 */
const Root = BaseDialog.Root
const Close = BaseDialog.Close
const Trigger = BaseDialog.Trigger

function Popup({ className, children, ...props }: ComponentProps<typeof BaseDialog.Popup>) {
  return (
    <BaseDialog.Portal>
      <BaseDialog.Backdrop
        className={cn(
          "fixed inset-0 z-40 bg-black/50",
          "transition-opacity duration-150 ease-out",
          "data-[starting-style]:opacity-0 data-[ending-style]:opacity-0",
          "motion-reduce:transition-none"
        )}
      />
      <BaseDialog.Popup
        className={cn(
          "fixed z-50 flex flex-col gap-4 border border-edge-soft bg-surface-raised",
          "p-5 shadow-xl focus-visible:outline-none",
          // A bottom sheet on a phone, a centred card on a desktop. Same
          // component, because a dialog pinned to the vertical centre of a
          // small screen puts its input under the keyboard.
          "inset-x-0 bottom-0 rounded-t-xl",
          "sm:inset-x-auto sm:bottom-auto sm:top-1/2 sm:left-1/2 sm:w-[28rem]",
          "sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl",
          "transition-[opacity,transform] duration-150 ease-out",
          "data-[starting-style]:translate-y-3 data-[starting-style]:opacity-0",
          "data-[ending-style]:translate-y-2 data-[ending-style]:opacity-0",
          "sm:data-[starting-style]:translate-y-[calc(-50%+0.5rem)]",
          "sm:data-[ending-style]:translate-y-[calc(-50%+0.25rem)]",
          "motion-reduce:transition-none",
          className
        )}
        {...props}
      >
        {children}
      </BaseDialog.Popup>
    </BaseDialog.Portal>
  )
}

function Title({ className, ...props }: ComponentProps<typeof BaseDialog.Title>) {
  return (
    <BaseDialog.Title
      className={cn("text-sm font-semibold tracking-tight", className)}
      {...props}
    />
  )
}

function Description({
  className,
  ...props
}: ComponentProps<typeof BaseDialog.Description>) {
  return (
    <BaseDialog.Description
      className={cn("text-xs text-muted-foreground", className)}
      {...props}
    />
  )
}

export const Dialog = { Root, Trigger, Popup, Title, Description, Close }
