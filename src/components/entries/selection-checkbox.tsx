import { useEffect, useRef } from "react"
import { cn } from "@/lib/utils"
import type { SelectionState } from "@/lib/entry-selection"

export type SelectionTarget = {
  label: string
  state: SelectionState
  onToggle: (origin: HTMLInputElement) => void
}

export function SelectionCheckbox({
  label,
  state,
  onToggle,
  contextual = false,
  className,
}: {
  label: string
  state: SelectionState
  onToggle: (origin: HTMLInputElement) => void
  contextual?: boolean
  className?: string
}) {
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (ref.current !== null) ref.current.indeterminate = state === "indeterminate"
  }, [state])

  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label={label}
      aria-checked={state === "indeterminate" ? "mixed" : undefined}
      checked={state === "checked"}
      onChange={(event) => onToggle(event.currentTarget)}
      className={cn(
        "size-4 shrink-0 rounded-sm border border-input bg-background accent-current",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        "transition-opacity motion-reduce:transition-none",
        /*
         * QUIET ONLY WHERE THERE IS A REAL POINTER.
         *
         * Hidden at rest and revealed on hover, focus-within or its own focus
         * — but only on a device that can hover with a precise pointer. On a
         * phone there is no hover, so a hover-revealed checkbox is not subtle,
         * it is unreachable: the media query is what keeps it visible there.
         *
         * The arbitrary variant spells that media query inline. It was
         * `.entry-selection-contextual` in styles.css; `_` is Tailwind's escape
         * for the spaces `and` needs.
         */
        contextual &&
          state === "unchecked" && [
            "[@media(hover:hover)_and_(pointer:fine)]:opacity-0",
            "[@media(hover:hover)_and_(pointer:fine)]:group-hover:opacity-100",
            "[@media(hover:hover)_and_(pointer:fine)]:group-focus-within:opacity-100",
            "[@media(hover:hover)_and_(pointer:fine)]:focus-visible:opacity-100",
          ],
        className
      )}
    />
  )
}
