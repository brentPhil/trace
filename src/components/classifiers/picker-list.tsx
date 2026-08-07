import { useEffect, useMemo, useRef, useState } from "react"
import { cn } from "@/lib/utils"

export type PickerOption = {
  id: string
  label: string
  /** Rendered instead of the bare label when present. */
  render?: React.ReactNode
  selected?: boolean
  /** Excluded from the list unless the user has typed something matching. */
  demoted?: boolean
}

/**
 * The searchable list inside every classifier picker.
 *
 * One component for projects and tags, because the interaction has to be
 * identical: type to filter, arrows to move, Enter to take, Escape to leave.
 * Two hand-written lists drift, and the moment `@` behaves differently from `#`
 * the user has to remember which is which.
 *
 * Implemented as a listbox with a roving `aria-activedescendant` rather than
 * moving DOM focus, so the text field keeps focus and typing never stops
 * working — which is the entire point of a type-ahead.
 */
export function PickerList({
  options,
  query,
  onQueryChange,
  onChoose,
  onCreate,
  createLabel,
  placeholder,
  emptyLabel,
  footer,
}: {
  options: Array<PickerOption>
  query: string
  onQueryChange: (value: string) => void
  onChoose: (id: string) => void
  /** Offered when the typed text matches nothing exactly. */
  onCreate?: (name: string) => void
  createLabel?: (name: string) => string
  placeholder: string
  emptyLabel: string
  footer?: React.ReactNode
}) {
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLUListElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const trimmed = query.trim()

  const visible = useMemo(() => {
    const needle = trimmed.toLowerCase()
    return options.filter((option) => {
      if (needle === "") return option.demoted !== true || option.selected === true
      return option.label.toLowerCase().includes(needle)
    })
  }, [options, trimmed])

  // Offered only when nothing matches EXACTLY. An inexact match still shows the
  // create row, because "Acme" and "Acme Corp" are different projects and the
  // user may well want the second one.
  const canCreate =
    onCreate !== undefined &&
    trimmed !== "" &&
    !options.some((option) => option.label.toLowerCase() === trimmed.toLowerCase())

  const rowCount = visible.length + (canCreate ? 1 : 0)

  // Clamped rather than reset, so filtering does not throw the highlight back
  // to the top on every keystroke — which would make arrow-then-type unusable.
  useEffect(() => {
    setActive((current) => (rowCount === 0 ? 0 : Math.min(current, rowCount - 1)))
  }, [rowCount])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('[data-active="true"]')
    el?.scrollIntoView({ block: "nearest" })
  }, [active])

  const take = (index: number) => {
    if (canCreate && index === visible.length) {
      // `canCreate` already proves onCreate is defined.
      onCreate(trimmed)
      return
    }
    // Guarded because `active` can point past the end for a frame after the
    // filter narrows, before the clamping effect runs.
    const option = visible.at(index)
    if (option !== undefined) onChoose(option.id)
  }

  return (
    <div className="flex min-h-0 flex-col">
      <div className="border-b border-edge-soft p-2">
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          role="combobox"
          aria-expanded="true"
          aria-controls="picker-list"
          aria-activedescendant={rowCount === 0 ? undefined : `picker-option-${active}`}
          autoComplete="off"
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault()
              setActive((c) => (rowCount === 0 ? 0 : (c + 1) % rowCount))
            } else if (event.key === "ArrowUp") {
              event.preventDefault()
              setActive((c) => (rowCount === 0 ? 0 : (c - 1 + rowCount) % rowCount))
            } else if (event.key === "Enter") {
              event.preventDefault()
              take(active)
            }
            // Escape is deliberately NOT handled: the popover owns it, and
            // intercepting it here would leave the popup open with no way out.
          }}
          className={cn(
            "w-full rounded-md border border-edge-soft bg-ground px-2 py-1.5 text-sm",
            "placeholder:text-muted-foreground",
            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          )}
        />
      </div>

      <ul
        id="picker-list"
        ref={listRef}
        role="listbox"
        className="min-h-0 flex-1 overflow-y-auto p-1"
      >
        {rowCount === 0 ? (
          <li className="px-2 py-3 text-center text-xs text-muted-foreground">
            {emptyLabel}
          </li>
        ) : null}

        {visible.map((option, index) => (
          <li key={option.id}>
            <button
              type="button"
              id={`picker-option-${index}`}
              role="option"
              aria-selected={option.selected ?? false}
              data-active={index === active}
              onMouseEnter={() => setActive(index)}
              onClick={() => take(index)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
                "data-[active=true]:bg-surface",
                "focus-visible:outline-none"
              )}
            >
              <span className="min-w-0 flex-1 truncate">
                {option.render ?? option.label}
              </span>
              {option.selected ? (
                // A glyph, not a colour or a highlight — the row is already
                // highlighted for a different reason (keyboard position), and
                // two meanings on one visual channel is how a list stops being
                // readable.
                <span aria-hidden="true" className="shrink-0 text-xs">
                  ✓
                </span>
              ) : null}
            </button>
          </li>
        ))}

        {canCreate ? (
          <li>
            <button
              type="button"
              id={`picker-option-${visible.length}`}
              role="option"
              aria-selected="false"
              data-active={visible.length === active}
              onMouseEnter={() => setActive(visible.length)}
              onClick={() => take(visible.length)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
                "text-muted-foreground data-[active=true]:bg-surface",
                "focus-visible:outline-none"
              )}
            >
              <span className="truncate">
                {createLabel?.(trimmed) ?? `Create “${trimmed}”`}
              </span>
            </button>
          </li>
        ) : null}
      </ul>

      {footer === undefined ? null : (
        <div className="border-t border-edge-soft p-1">{footer}</div>
      )}
    </div>
  )
}
