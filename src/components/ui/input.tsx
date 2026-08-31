import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@/lib/utils"

/**
 * FIELD RADIUS: `rounded-md`, corrected from the registry's `rounded-3xl`.
 *
 * Seven files in this app draw a text field or trigger by hand and every one is
 * `rounded-md` — so the registry's 24px pill made the two vendored fields
 * (this and `SelectTrigger`) the odd ones out on their own pages: a pill Select
 * beside an 8px-radius input on /settings. One step for every field-shaped
 * control; the pill look, where wanted, belongs to the 2xl-and-up steps that
 * clamp (see DESIGN.md, Radius).
 */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 py-1 text-base transition-[color,box-shadow,background-color] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Input }
