/**
 * Getting a generated file out of the tab.
 *
 * Its own module because every writer ends here, and because the two
 * awkward parts — Safari's revoke timing and a filename that does not collide —
 * are worth stating once.
 */

/**
 * `trace-report-2026-07-13_2026-07-25.csv`.
 *
 * The range is in the name because a freelancer exports the same report for
 * consecutive fortnights and then has to tell two files apart in a downloads
 * folder six weeks later. A single-day range is not repeated, because
 * `…-2026-07-13_2026-07-13` reads as a defect.
 */
export function exportFilename(from: string, to: string, extension: string): string {
  const range = from === to ? from : `${from}_${to}`
  return `trace-report-${range}.${extension}`
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  // Appended before clicking: Firefox ignores a click on an anchor that is not
  // in the document.
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  /*
   * Revoked on a later task, not synchronously.
   *
   * Safari reads the object URL asynchronously after the click, so revoking in
   * the same tick cancels the download it was created for — and does it
   * silently, which is the worst version: the button appears to work and no
   * file arrives.
   */
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
