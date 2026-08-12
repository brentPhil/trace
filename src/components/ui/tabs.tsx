import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"
import { cva } from "class-variance-authority"

import { cn } from "@/lib/utils"
import type { VariantProps } from "class-variance-authority"

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      className={cn(
        "group/tabs flex gap-2 data-horizontal:flex-col",
        className
      )}
      {...props}
    />
  )
}

/**
 * Three looks, and the third is not a restyling of the first.
 *
 * `default` is shadcn's stock pill — `rounded-full`, `bg-muted`,
 * `data-active:bg-background` — and those are stock tokens rather than this
 * system's: `--muted` and `--background` are not the ground/surface ramp
 * DESIGN.md builds depth out of. `segmented` is the same IDEA in Chroneli's
 * vocabulary: a hairline group sitting on the GROUND with the selected tab
 * filled to `--surface-raised`, which is the tonal step this system uses for
 * "in front of" everywhere else.
 *
 * Selection is never colour alone (DESIGN.md): the fill is a fill, and Base UI
 * puts `aria-selected` on the tab regardless.
 *
 * The `data-[variant=…]` overrides live in the BASE rather than in the variant
 * strings because cva concatenates and CSS does not care about class order —
 * an attribute-qualified selector is how one of two same-property utilities is
 * made to win. `line` already relies on exactly this.
 */
const tabsListVariants = cva(
  "group/tabs-list inline-flex w-fit items-center justify-center rounded-full p-1 text-muted-foreground group-data-horizontal/tabs:h-9 group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col group-data-vertical/tabs:rounded-2xl data-[variant=line]:rounded-none data-[variant=segmented]:rounded-md data-[variant=segmented]:p-0.5",
  {
    variants: {
      variant: {
        default: "bg-muted",
        line: "gap-1 bg-transparent",
        segmented: "border border-edge-raised bg-ground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function TabsList({
  className,
  variant = "default",
  ...props
}: TabsPrimitive.List.Props & VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  )
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        "relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-2 rounded-full border border-transparent! px-3 py-1 text-sm font-medium whitespace-nowrap text-foreground/60 transition-all group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start group-data-vertical/tabs:rounded-2xl group-data-vertical/tabs:px-3 group-data-vertical/tabs:py-1.5 hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 aria-disabled:pointer-events-none aria-disabled:opacity-50 dark:text-muted-foreground dark:hover:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        "group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-active:bg-transparent dark:group-data-[variant=line]/tabs-list:data-active:border-transparent dark:group-data-[variant=line]/tabs-list:data-active:bg-transparent",
        // The `dark:` twins are not redundant: the stock rules this overrides
        // include `dark:data-active:bg-input/30`, whose selector carries the
        // same weight as the plain group form, and the app renders with `.dark`
        // on the html element at all times. Same pairing the `line` row above
        // needs, for the same reason.
        "group-data-[variant=segmented]/tabs-list:rounded-sm group-data-[variant=segmented]/tabs-list:px-3 group-data-[variant=segmented]/tabs-list:py-1 group-data-[variant=segmented]/tabs-list:text-sm group-data-[variant=segmented]/tabs-list:text-muted-foreground",
        "group-data-[variant=segmented]/tabs-list:data-active:bg-surface-raised group-data-[variant=segmented]/tabs-list:data-active:text-foreground dark:group-data-[variant=segmented]/tabs-list:data-active:bg-surface-raised dark:group-data-[variant=segmented]/tabs-list:data-active:text-foreground",
        "data-active:bg-background data-active:text-foreground dark:data-active:border-input dark:data-active:bg-input/30 dark:data-active:text-foreground",
        "after:absolute after:bg-foreground after:opacity-0 after:transition-opacity group-data-horizontal/tabs:after:inset-x-0 group-data-horizontal/tabs:after:bottom-[-5px] group-data-horizontal/tabs:after:h-0.5 group-data-vertical/tabs:after:inset-y-0 group-data-vertical/tabs:after:-right-1 group-data-vertical/tabs:after:w-0.5 group-data-[variant=line]/tabs-list:data-active:after:opacity-100",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn("flex-1 text-sm outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
