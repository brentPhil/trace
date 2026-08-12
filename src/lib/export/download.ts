import { APP_NAME } from "@shared/brand"

/**
 * Getting a generated file out of the tab.
 *
 * Its own module because every writer ends here, and because the two
 * awkward parts — Safari's revoke timing and a filename that does not collide —
 * are worth stating once.
 */

/**
 * `chroneli-report-2026-07-13_2026-07-25.csv`.
 *
 * The range is in the name because a freelancer exports the same report for
 * consecutive fortnights and then has to tell two files apart in a downloads
 * folder six weeks later. A single-day range is not repeated, because
 * `…-2026-07-13_2026-07-13` reads as a defect.
 *
 * The prefix comes from `APP_NAME` rather than being spelled out here, so a
 * future rename cannot leave the exported files answering to the old name.
 */
export function exportFilename(from: string, to: string, extension: string): string {
  const range = from === to ? from : `${from}_${to}`
  return `${APP_NAME.toLowerCase()}-report-${range}.${extension}`
}

/**
 * `invoice-072726-0013-2026-07-27.pdf`.
 *
 * THE NUMBER FIRST, because that is what the document is called: a client
 * asking about "invoice 072726-0013" is asking about this file, and a name that
 * led with the date would sort a downloads folder by nothing anyone refers to.
 * The issue date follows it for the same reason `exportFilename` carries a
 * range — a file found six weeks later has to say when it was raised without
 * being opened — and the number already guarantees the name cannot collide, so
 * the date is orientation rather than identity.
 */
export function invoiceFilename(number: string, issuedOn: string): string {
  return `invoice-${number}-${issuedOn}.pdf`
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
