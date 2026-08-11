"use client"

import { Separator as SeparatorPrimitive } from "@base-ui/react/separator"

import { cn } from "@/lib/utils"

function Separator({
  className,
  orientation = "horizontal",
  ...props
}: SeparatorPrimitive.Props) {
  return (
    <SeparatorPrimitive
      data-slot="separator"
      orientation={orientation}
      /*
       * `data-[orientation=…]`, not `data-horizontal:` / `data-vertical:`.
       *
       * Those two variants never matched anything. Base UI's separator declares
       * exactly one data attribute — `orientation = "data-orientation"`, see
       * `SeparatorDataAttributes` — and passes the value through as state
       * without a style-hook mapping, so the element carries
       * `data-orientation="horizontal"` and never a bare `data-horizontal`.
       * Every rule here was therefore inert and the component shipped with NO
       * height, which is invisible rather than obviously broken: a divider that
       * renders nothing looks like a divider nobody added.
       *
       * It was only noticed because a call site worked around it with its own
       * `h-px`. The other two consumers did not — `FieldSeparator`
       * (components/ui/field.tsx) and `SidebarSeparator` (components/ui/sidebar.tsx)
       * both set colour and margins and rely on this line for their thickness.
       */
      className={cn(
        "shrink-0 bg-border",
        "data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full",
        "data-[orientation=vertical]:w-px data-[orientation=vertical]:self-stretch",
        className
      )}
      {...props}
    />
  )
}

export { Separator }
