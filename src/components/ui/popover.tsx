import { Popover as BasePopover } from "@base-ui/react/popover"
import { cn } from "@/lib/utils"
import type { ComponentProps } from "react"

/**
 * Thin styled wrapper over Base UI's popover.
 *
 * The Positioner is not optional decoration: it is what keeps a picker opened
 * from the last row of a long log from being clipped by an `overflow` ancestor
 * or hanging off the bottom of a phone. It flips and shifts on its own.
 */
const Root = BasePopover.Root
const Trigger = BasePopover.Trigger
const Close = BasePopover.Close

function Popup({
  className,
  align = "start",
  sideOffset = 6,
  children,
  ...props
}: ComponentProps<typeof BasePopover.Popup> & {
  align?: "start" | "center" | "end"
  sideOffset?: number
}) {
  return (
    <BasePopover.Portal>
      <BasePopover.Positioner align={align} sideOffset={sideOffset} className="z-50">
        <BasePopover.Popup
          className={cn(
            "flex max-h-[min(22rem,60svh)] w-[17rem] flex-col overflow-hidden",
            "rounded-lg border border-edge-soft bg-surface-raised shadow-xl",
            "focus-visible:outline-none",
            "transition-[opacity,transform] duration-100 ease-out",
            "data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0",
            "data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0",
            "motion-reduce:transition-none",
            className
          )}
          {...props}
        >
          {children}
        </BasePopover.Popup>
      </BasePopover.Positioner>
    </BasePopover.Portal>
  )
}

export const Popover = { Root, Trigger, Popup, Close }
