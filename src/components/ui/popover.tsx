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
  /* `side` is forwarded, and deliberately has NO default here: Base UI's
     positioner already defaults to "bottom", and repeating it would mean this
     wrapper owning a value it is not choosing — the next Base UI default to
     change would then be silently overridden by a copy of the old one.
     Forwarded at all because a popover anchored to the SIDEBAR has to open
     sideways: the rail is 56px wide when collapsed and pinned to the bottom of
     the viewport, where "below" is nowhere. The positioner still flips on its
     own when the chosen side has no room. */
  side,
  sideOffset = 6,
  /* WHAT THE POPUP HANGS OFF, when it is not a `Popover.Trigger`.
     A block on the calendar grid is drawn by FullCalendar, so there is no
     element of ours to make the trigger — the click hands us the block's own
     node and this is how it reaches the positioner. Everything else about the
     popup is unchanged: with no `anchor` Base UI falls back to the trigger, as
     every other caller relies on. */
  anchor,
  children,
  ...props
}: ComponentProps<typeof BasePopover.Popup> & {
  align?: "start" | "center" | "end"
  /* The positioner's own type, not a hand-written union: it also accepts the
     logical `inline-start`/`inline-end`, which a four-value union quietly
     took away. */
  side?: ComponentProps<typeof BasePopover.Positioner>["side"]
  sideOffset?: number
  anchor?: ComponentProps<typeof BasePopover.Positioner>["anchor"]
}) {
  return (
    <BasePopover.Portal>
      <BasePopover.Positioner
        align={align}
        side={side}
        sideOffset={sideOffset}
        anchor={anchor}
        className="z-50"
      >
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
