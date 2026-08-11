import { Menu as MenuPrimitive } from "@base-ui/react/menu"

import { cn } from "@/lib/utils"

function Menu(props: MenuPrimitive.Root.Props) {
  return <MenuPrimitive.Root {...props} />
}

function MenuTrigger({ className, ...props }: MenuPrimitive.Trigger.Props) {
  return (
    <MenuPrimitive.Trigger
      data-slot="menu-trigger"
      className={cn(className)}
      {...props}
    />
  )
}

function MenuContent({ className, ...props }: MenuPrimitive.Popup.Props) {
  return (
    <MenuPrimitive.Portal>
      {/*
        `z-50` BELONGS ON THE POSITIONER, and it was on the popup.

        `z-index` applies only to positioned elements. The popup is
        `position: static` — the Positioner is the `absolute` one — so a `z-50`
        written there was inert, and the whole portaled menu joined the body's
        stacking context at `auto`. That put it UNDER the sticky page header
        (`z-20`) and the timer bar (`z-30`), which is why the Export menu opened
        behind them. Raising the number would have changed nothing; moving it
        onto the element that can use it is the fix.

        `popover.tsx` already does it this way, which is why the profile popup
        and the pickers were never affected.
      */}
      <MenuPrimitive.Positioner sideOffset={6} align="end" className="z-50">
        <MenuPrimitive.Popup
          data-slot="menu-content"
          className={cn(
            // `border-edge-raised`, not `border-edge`: this popup sits on
            // Surface Raised, where Edge measures 2.60:1 and is under the
            // 3:1 floor. DESIGN.md states the distinction.
            "min-w-40 rounded-md border border-edge-raised bg-surface-raised p-1 text-sm shadow-lg outline-none",
            className
          )}
          {...props}
        />
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  )
}

function MenuItem({ className, ...props }: MenuPrimitive.Item.Props) {
  return (
    <MenuPrimitive.Item
      data-slot="menu-item"
      className={cn(
        "flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 outline-none select-none",
        "data-highlighted:bg-surface data-disabled:pointer-events-none data-disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export { Menu, MenuContent, MenuItem, MenuTrigger }
