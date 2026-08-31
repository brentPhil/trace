import { fireEvent, screen } from "@testing-library/react"

/**
 * Driving a `ui/select.tsx` Select from a test.
 *
 * A native `<select>` took `fireEvent.change(el, { target: { value } })`, and
 * every test that touched one did exactly that. A Base UI Select is a button
 * plus a portalled listbox, so `change` fires on nothing and the assertion
 * after it reads a `.value` that does not exist. These helpers are the
 * replacement, written once so the swap does not scatter the same four lines
 * through five test files.
 *
 * The trigger keeps `role="combobox"` and its accessible name, so
 * `getByRole("combobox", { name })` still finds it — what changes is that its
 * current selection is TEXT on the trigger rather than a `value` property.
 *
 * `mouseDown` before `click`, because Base UI opens on pointer-down (so
 * press-drag-release onto an option reads as one gesture) and a bare `click` in
 * jsdom does not imply the pointer-down that would precede it in a browser.
 */
function openSelect(name: RegExp | string): HTMLElement {
  const trigger = screen.getByRole("combobox", { name })
  fireEvent.mouseDown(trigger)
  fireEvent.click(trigger)
  return trigger
}

/**
 * Opens the Select and picks the option with the given accessible name.
 *
 * The full POINTER sequence, and it has to be pointer events specifically:
 * measured against this component, `click` alone commits nothing, and so does
 * `mouseDown`+`mouseUp`+`click`. Base UI's item listens on
 * `pointerdown`/`pointerup`, which jsdom does not synthesise from mouse events.
 * A test that fired only `click` here would open the list, select nothing, and
 * then assert against a mutation that was never called — passing only if the
 * assertion were also wrong.
 */
export function chooseOption(
  selectName: RegExp | string,
  optionName: RegExp | string
): void {
  openSelect(selectName)
  const option = screen.getByRole("option", { name: optionName })
  fireEvent.pointerDown(option)
  fireEvent.pointerUp(option)
  fireEvent.click(option)
}

/**
 * The option labels the Select is offering, in order.
 *
 * Queried globally rather than within the trigger: the list is portalled to the
 * end of `document.body`, so it is not a descendant of anything this helper was
 * handed. Only one Select can be open at a time, which is what makes a global
 * query unambiguous here.
 */
export function optionLabels(selectName: RegExp | string): Array<string> {
  openSelect(selectName)
  return screen
    .queryAllByRole("option")
    .map((option) => option.textContent.trim())
}

/**
 * What the trigger is currently displaying, with Base UI's chevron stripped.
 *
 * THE STRIP IS LOAD-BEARING, and it does not look it. `SelectTrigger` renders a
 * lucide `ChevronDownIcon` — an SVG, which contributes no `textContent` — so
 * the obvious reading is that this `.replace` guards against a glyph that is
 * not there, and `grep` for `▼` across `src/` finds nothing to contradict it.
 * Base UI's own `Select.Icon` supplies a `▼` as TEXT underneath, and removing
 * this turns every `selectedLabel` assertion into `'Stop the music▼'`.
 */
export function selectedLabel(selectName: RegExp | string): string {
  return screen
    .getByRole("combobox", { name: selectName })
    .textContent.replace(/[▼▾]/g, "")
    .trim()
}
