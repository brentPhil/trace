import { useEffect, useId, useMemo, useRef, useState } from "react"
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
  const [activeRow, setActive] = useState(0)
  const listRef = useRef<HTMLUListElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Generated, not hardcoded. `aria-activedescendant` resolves an id against the
  // whole document, so two pickers open at once — the timer bar tracks project
  // and tag open-state as independent booleans, so nothing prevents it — would
  // give every option a duplicate id and point the field at whichever came
  // first in the DOM.
  const listId = useId()

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
  //
  // Clamped DURING RENDER rather than in an effect. An effect runs after the
  // browser has the markup, so for one frame after a filter narrows the list,
  // `aria-activedescendant` names an id that is no longer in the document —
  // which a screen reader can read, and which is a broken reference by the
  // time it does. Deriving it here means the dangling state never exists.
  const active = rowCount === 0 ? 0 : Math.min(activeRow, rowCount - 1)

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
          aria-controls={listId}
          aria-activedescendant={rowCount === 0 ? undefined : `${listId}-option-${active}`}
          autoComplete="off"
          onKeyDown={(event) => {
            // Stepped from the CLAMPED `active`, not from the raw state, so a
            // move made right after the list narrowed starts from the row the
            // user can actually see highlighted.
            if (event.key === "ArrowDown") {
              event.preventDefault()
              setActive(rowCount === 0 ? 0 : (active + 1) % rowCount)
            } else if (event.key === "ArrowUp") {
              event.preventDefault()
              setActive(rowCount === 0 ? 0 : (active - 1 + rowCount) % rowCount)
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
        id={listId}
        ref={listRef}
        role="listbox"
        className="min-h-0 flex-1 overflow-y-auto p-1"
      >
        {/*
          `role="none"` on every <li>, here and below.

          A listbox must own `option` elements directly. Left as plain list
          items, the <li> keeps its implicit `listitem` role and sits BETWEEN
          the listbox and its options in the accessibility tree — so the listbox
          owns no options, and "2 of 5" either goes wrong or goes unsaid
          depending on the screen reader. The <li> is here for markup reasons
          only; stripping its role hands ownership straight to the buttons.
        */}
        {rowCount === 0 ? (
          <li role="none" className="px-2 py-3 text-center text-xs text-muted-foreground">
            {emptyLabel}
          </li>
        ) : null}

        {visible.map((option, index) => (
          <li role="none" key={option.id}>
            <button
              type="button"
              id={`${listId}-option-${index}`}
              role="option"
              aria-selected={option.selected ?? false}
              // Out of the tab order. The text field keeps DOM focus and drives
              // the list through `aria-activedescendant`; a focusable option
              // means Tab lands on a row the field does not know is active, so
              // the visual highlight and the announced position disagree and
              // Enter takes the wrong one.
              tabIndex={-1}
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
          <li role="none">
            <button
              type="button"
              id={`${listId}-option-${visible.length}`}
              role="option"
              aria-selected="false"
              tabIndex={-1}
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
