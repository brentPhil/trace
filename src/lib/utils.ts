import { clsx } from "clsx"
import type { ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

/**
 * Stock `twMerge` over `clsx` — the shadcn default, and it is the default again
 * on purpose.
 *
 * It used to be `extendTailwindMerge` with a `bg-image` class group, taught
 * that `bg-wash-room` / `bg-wash-rail` / `bg-wash-raised` set background-IMAGE
 * rather than background-colour: they were `--background-image-*` theme
 * entries, so stock tailwind-merge saw an unrecognised `bg-<name>`, filed it
 * under background-colour, and silently dropped the fill underneath.
 *
 * The three washes went with the darkroom palette, so the extension has nothing
 * left to describe. If a gradient utility is ever added back, this is where it
 * has to be registered — the failure is invisible in a browser (the gradient is
 * opaque and covers the same box) and only shows up as a missing fallback.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
