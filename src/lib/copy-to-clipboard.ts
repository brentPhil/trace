/**
 * Getting text onto the clipboard, and admitting it when that fails.
 *
 * Its own module for the same reason `export/download.ts` is: every copy
 * control ends here, and the awkward part — that the modern API is not always
 * there — is worth stating once rather than being rediscovered per button.
 *
 * ANSWERS `false` RATHER THAN THROWING. A copy that silently did nothing is the
 * worst version of this feature: the button depresses, the reader tabs into
 * Slack, and pastes whatever was on the clipboard from twenty minutes ago into
 * a standup note. Every caller is expected to say so out loud.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  /*
   * `navigator.clipboard` is undefined outside a secure context — plain `http`
   * on a LAN address, which is how this app gets opened on a phone against a
   * dev machine — and `writeText` rejects when the document is not focused or
   * the permission is refused. Both are ordinary, neither is exceptional, and
   * the fallback below handles the first.
   */
  // The cast is the point, not laziness: lib.dom types `navigator.clipboard` as
  // always present, which is a lie outside a secure context — and without the
  // widening, the guard below reads as dead code to the type checker.
  const clipboard = navigator.clipboard as Clipboard | undefined

  if (clipboard !== undefined) {
    try {
      await clipboard.writeText(text)
      return true
    } catch {
      // Fall through: `execCommand` still works in some of the cases the async
      // API refuses, and a second attempt costs a few milliseconds.
    }
  }

  /*
   * The deprecated path, kept deliberately.
   *
   * `document.execCommand("copy")` is the only thing that works without a
   * secure context, and it is synchronous — which is also why the textarea has
   * to be in the document and selected before the call. It is positioned off
   * the top-left and given `readOnly` so no keyboard can open on a phone and
   * nothing scrolls to it.
   */
  const area = document.createElement("textarea")
  area.value = text
  area.readOnly = true
  area.setAttribute("aria-hidden", "true")
  area.style.position = "fixed"
  area.style.top = "0"
  area.style.left = "0"
  area.style.opacity = "0"

  /*
   * WHERE FOCUS WAS, captured before the textarea takes it.
   *
   * `area.select()` below has to move focus — that is how `execCommand("copy")`
   * knows what to copy — and removing the element then drops focus to <body>,
   * so the next Tab restarts from the top of the document. A keyboard user who
   * pressed the Copy button loses their place in the log for a control that
   * changed nothing on screen. `InlineEdit.returnFocus` exists for exactly this
   * failure one level up.
   *
   * Re-focused only if it is still IN the document: this path is synchronous,
   * but the caller is free to render on the strength of the answer, and
   * focusing a detached node is a no-op that silently leaves focus on <body>
   * anyway.
   */
  const previous = document.activeElement
  document.body.appendChild(area)

  try {
    area.select()
    return document.execCommand("copy")
  } catch {
    return false
  } finally {
    area.remove()
    if (previous instanceof HTMLElement && previous.isConnected) {
      previous.focus()
    }
  }
}
