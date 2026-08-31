"use client"

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

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

/*
 * RADIUS: `rounded-2xl`, corrected from the registry's `rounded-full`, on both
 * the list and the trigger.
 *
 * `rounded-full` is a fixed 9999px, so the track and cells stayed pills at
 * every radius the user can pick and the picker read as broken here. `2xl` is
 * `--radius * 1.6` — 16px at the default, which on this 36px track still
 * clamps to the identical pill, so the shipped look is unchanged — and it
 * releases one step down, exactly like the Button base (see DESIGN.md, Radius:
 * pick the smallest step that still clamps at the default). This correction
 * previously lived as seven `className` overrides across three call sites,
 * which is the copied-classes fork the Shadcn-First Rule warns about — fixed
 * here once instead. The registry's `group-data-vertical/tabs:rounded-2xl`
 * overrides became no-ops and were removed with it.
 */
const tabsListVariants = cva(
  "group/tabs-list inline-flex w-fit items-center justify-center rounded-2xl p-1 text-muted-foreground group-data-horizontal/tabs:h-9 group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col data-[variant=line]:rounded-none",
  {
    variants: {
      variant: {
        default: "bg-muted",
        line: "gap-1 bg-transparent",
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

/**
 * ONE CHARACTER REMOVED FROM THE REGISTRY: the `!` on `border-transparent`.
 *
 * With it, the base border is !important and the registry's own
 * `dark:data-active:border-input` three clauses later can never paint — so in
 * dark mode the active tab was `bg-accent` on a `bg-muted` track, two names for
 * the same value, with a dead border: no visible state at all. That the `line`
 * variant explicitly RESETS the active border in dark proves the registry meant
 * it to exist. Measured before/after: transparent -> oklch(1 0 0 / 0.35).
 */
function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        "relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-2 rounded-2xl border border-transparent px-3 py-1 text-sm font-medium whitespace-nowrap text-foreground/60 transition-all group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start group-data-vertical/tabs:px-3 group-data-vertical/tabs:py-1.5 hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 aria-disabled:pointer-events-none aria-disabled:opacity-50 dark:text-muted-foreground dark:hover:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        "group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-active:bg-transparent dark:group-data-[variant=line]/tabs-list:data-active:border-transparent dark:group-data-[variant=line]/tabs-list:data-active:bg-transparent",
        /* THE ACTIVE CELL IS `--card` — the theme's own panel surface, per
         * the product decision after two rejected treatments: the registry's
         * `bg-background`/`bg-accent` pair (in dark, accent equals muted, so
         * the fill vanished and a 35%-white hairline was the only marker) and
         * a `bg-primary/15` tint (theme-coloured, disliked). Card follows
         * every preset — a warm cell under Amber, white under Neutral light, a
         * step DOWN from the track in dark — and needs no border to be seen,
         * so the hairline is gone too. */
        "data-active:bg-card data-active:text-foreground",
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
