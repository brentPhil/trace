/**
 * What an entry, project, or invoice line with no assigned project is called,
 * on screen and on every printed document.
 *
 * Canonical here, not in `src/lib/report-series.ts` where this used to be the
 * only definition. `invoices.createFromRangeImpl` (convex/invoices.ts) needs
 * the same text for its unassigned-project line, and `src/` may only reach
 * into Convex through the `@shared` alias onto `convex/lib` — `convex/` may
 * never import `src/` at all, so the label had to move to whichever side both
 * can see. `report-series.ts` re-exports this constant under its existing
 * name rather than holding a second literal that could drift from it.
 */
export const NO_PROJECT_LABEL = "No project"
