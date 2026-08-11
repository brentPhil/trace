import { parseDayString } from "@shared/day"

/**
 * `2026-07-13` as `07/13/2026` — the one date format this product PRINTS.
 *
 * Its own module because both renderings of a document need it and neither owns
 * it. It began inside the PDF report's own file, which made
 * `invoice-document.ts` — the deliberately neutral module the screen and the
 * paper both ask, containing no geometry and no markup — import from a
 * pdf-lib-shaped one. The dependency pointed backwards from what that file's
 * comment claims, and the next person moving a page-layout constant would have
 * been dragging the record page along with it.
 *
 * A DAY STRING in, never an instant: a day only exists once a zone has been
 * chosen, that choice is the user's stored one, and it is made before anything
 * gets here (see `InvoiceDoc`). So there is no clock in this file and no
 * `Intl.DateTimeFormat` — the format is fixed rather than locale-derived,
 * because the two documents this product prints are read side by side by the
 * same client, and a report dated `07/13/2026` beside an invoice dated
 * `13/07/2026` is a pair of documents nobody can tell apart on a July 13th.
 */
export function usDate(day: string): string {
  const { year, month, day: date } = parseDayString(day)
  return `${String(month).padStart(2, "0")}/${String(date).padStart(2, "0")}/${year}`
}
