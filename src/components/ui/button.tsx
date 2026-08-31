import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  /* `rounded-2xl`, corrected from the registry's `rounded-4xl`, and the reason
   * is ARITHMETIC rather than taste: border-radius clamps at half the
   * element's height, so on the h-8/h-9 controls this class actually styles,
   * everything above ~16px paints the identical pill. `4xl` is
   * `--radius * 3.2` — 32px at the default and still 19px at the Small step —
   * which meant the radius picker visibly did nothing to any button until the
   * value fell to Sharp. `2xl` is 16px at the default: within a pixel or two
   * of the clamp, so the shipped look is unchanged, and it crosses under the
   * clamp one step sooner, so Small reads as the rounded rectangle it says it
   * is. Same clamp-aware reasoning as the `chip` size below. */
  "group/button inline-flex shrink-0 items-center justify-center rounded-2xl border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/80",
        outline:
          /* `dark:hover:bg-accent/50`, not the registry's `bg-input/30`: dark
           * `--input` is a 35%-white BOUNDARY tone since The Boundary Split
           * (DESIGN.md §2), so a fill derived from it hovers ~2.3x hotter than
           * the ~4.5% overlay the registry designed. Same move `ui/tabs.tsx`
           * and `ui/field.tsx` already made — DESIGN.md §5 ex. 6 documents the
           * sweep, and this was the spot it missed. */
          "border-input bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:bg-transparent dark:hover:bg-accent/50",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        ghost:
          "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
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

        /* FOUR SIZES SHADCN DOES NOT SHIP, and they are the only thing in this
         * file that is not the registry's. They are ADDITIVE — no variant, no
         * base class and no colour above is overridden — and every one is
         * GEOMETRY: a height, a padding, a minimum width. A theme picked in
         * settings changes none of them, which is the test for whether
         * something belongs here now.
         *
         * They exist because their controls sit inside a box whose height is
         * load-bearing and is measured elsewhere, so a `h-9` default would push
         * the box past a number another file derives. Dropping them does not
         * restore a default look, it breaks a layout. */

        // The log's row-action size. 28px, not `icon-sm`'s 32px, and the four
        // pixels are load-bearing: the row's action column is 4rem holding two
        // of these side by side with no gap, so `icon-sm` fills it to the pixel
        // and the pair overflows the moment anything gains a border.
        "icon-row": "size-7",

        // A filter pill.
        //
        // `rounded-2xl`, NOT `rounded-full`, and the difference is the whole
        // reason the radius control feels broken without it: `rounded-full` is
        // a fixed 9999px, so a chip stays a pill at every radius the user can
        // pick and the setting appears not to apply. `--radius-2xl` is
        // `--radius * 1.6` — 16px at the default, which on a ~22px chip still
        // clamps to a pill, so nothing moves for anyone who never opens the
        // picker. At Small it eases off; at Square it is square.
        chip: "h-auto rounded-2xl px-2.5 py-1 text-xs font-normal",

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
