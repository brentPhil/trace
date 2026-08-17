import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva } from "class-variance-authority"
import type { VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  // rounded-md, not base-luma's rounded-4xl. At --radius 0.45rem the 4xl step
  // is ~1.17rem, which on a 36px control is effectively a pill — the
  // "rounded-everything" look DESIGN.md rejects by name.
  "group/button inline-flex shrink-0 items-center justify-center rounded-md border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/80",
        outline:
          "border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:bg-transparent dark:hover:bg-input/30",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        ghost:
          "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
        // The log's own button language, and the most common one in the app:
        // a muted mark that warms to full ink on hover, with NO fill behind
        // it. `ghost` is the near miss — its `hover:bg-muted` puts a plate
        // behind every row action, which in a table of 50 rows reads as the
        // row itself lighting up rather than the control under the cursor.
        // This was hand-rolled at ~10 call sites before it was a variant.
        quiet: "text-muted-foreground hover:text-foreground",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-9 gap-1.5 px-3 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5",
        xs: "h-6 gap-1 px-2.5 text-xs has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1 px-3 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        lg: "h-10 gap-1.5 px-4 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        icon: "size-9",
        "icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
        // The log's row-action size. 28px, not `icon-sm`'s 32px, and the four
        // pixels are load-bearing: `.entry-log-actions` is a 4rem column
        // holding two of these side by side with no gap, so `icon-sm` fills it
        // to the pixel and the pair overflows the moment anything gains a
        // border.
        "icon-row": "size-7",

        /* Three sizes below exist because their controls sit INSIDE something
         * whose height is load-bearing, so none of them may state a height of
         * their own. Every one is `h-auto`, overriding the h-9 default. */

        // A filter pill. `rounded-full` beats the base `rounded-md` through
        // tailwind-merge, which is why the pill shape lives here rather than
        // at the call site.
        chip: "h-auto rounded-full px-2.5 py-1 text-xs font-normal",

        // An inline trigger in an entry row — a time stamp, a note, a title, a
        // classifier. The row is `--entry-row-height` and its content sits
        // exactly on that floor, so this is padding-only. It states no text
        // size on purpose: these sit inside running prose at four different
        // sizes, and every call site already names its own. Pair it with the
        // `after:` hit-area utilities to reach SC 2.5.8's 24px without growing
        // the box.
        "row-trigger": "h-auto rounded-sm px-1 py-0.5 font-normal",

        // A count badge that has to fit a 6px-taller row but grow with its
        // digits — `icon-xs` is `size-6`, square and fixed, which clips at
        // three digits.
        badge: "h-6 min-w-6 w-auto px-1.5 text-xs font-normal",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
