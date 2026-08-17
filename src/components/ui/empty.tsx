import type { ReactNode } from "react"

/**
 * The empty state, as one treatment.
 *
 * Dashed rather than solid, because the border marks a space that WILL hold
 * something rather than a panel that holds nothing — the same distinction
 * `HATCH_EMPTY` (src/lib/hatch.ts) draws for a missing note.
 *
 * It is a component rather than a copied `className` because DESIGN.md asks
 * every empty state to teach the interface, and that only reads as one voice
 * if the frame around the sentence is literally one declaration. It had two
 * copies — /projects and /invoices — before it had a home.
 */
export function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="max-w-prose rounded-md border border-dashed border-edge-soft px-3 py-4 text-sm text-muted-foreground">
      {children}
    </p>
  )
}
