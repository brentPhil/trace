import { useEffect, useRef } from "react"
import { cn } from "@/lib/utils"
import type { SelectionState } from "@/lib/entry-selection"

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
        "size-4 shrink-0 rounded-sm border border-edge-raised bg-ground accent-current",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        "transition-opacity motion-reduce:transition-none",
        contextual && state === "unchecked" && "entry-selection-contextual",
        className
      )}
    />
  )
}
