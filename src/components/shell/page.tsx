import { Link } from "@tanstack/react-router"
import { useHeightVar } from "@/hooks/use-height-var"
import { cn } from "@/lib/utils"
import type { LinkProps } from "@tanstack/react-router"
import type { ReactNode } from "react"

/**
 * How a page is built in this product. There is one way, and this is it.
 *
 * WHY THIS EXISTS AT ALL. There used to be two. /timer and /reports each spelt
 * out a sticky band of their own — the measured custom property, the host and
 * measured refs paired by hand, `sticky top-… z-20 bg-ground`, and the calc
 * that adds the two heights — and neither had an `<h1>` at all; /projects,
 * /invoices, /settings and both invoice routes rendered no header at all and a
 * bare `<h1 className="text-sm font-semibold">` somewhere inside their own
 * layout. So the page-title treatment was written down five times, whether a
 * page had a heading at all was decided per file, and whether a header stuck
 * was an accident of which of the two shapes somebody had copied. None of that
 * is visible in a screenshot, which is why it drifted: nothing fails when the
 * sixth page invents a seventh shape.
 *
 * Every route now renders exactly one `<Page>`. The heading vocabulary, the
 * gutter under it, and the pinning decision are decided here once and argued at
 * the call site.
 *
 * THE PINNING RULE, stated once so it stops being per-file taste:
 *
 *   A header is pinned when it is a READOUT OF, OR A CONTROL OVER, what scrolls
 *   beneath it — something that stops being TRUE, or stops being REACHABLE, the
 *   moment it leaves the screen. A title is neither: it names the page, and the
 *   page is still that page after you have scrolled.
 *
 * By that rule /timer (week totals + the filter over the log) and /reports (the
 * date range, the filter, and the two things you do with the result) pin, and
 * the other five do not. Each call site says which side of the rule it is on;
 * `sticky` defaults to FALSE because pinning is the exception that has to be
 * argued, not the default that has to be opted out of.
 *
 * THE GUTTER, against DESIGN.md's "never inside a reusable component". That
 * rule is about a component carrying its CALLER's gutter — "a component that
 * carries the page's gutter forces its next caller to compensate". The `px-4`
 * below is on the title row, which is an element this component draws itself
 * and hands to nobody. Both slots that DO take caller content, `header` and
 * `children`, are full-bleed and unpadded, so every page still applies its own
 * `px-4` exactly as `app-shell.tsx`'s alignment contract requires. Nothing has
 * to compensate for anything.
 */
export function Page({
  title,
  titleHidden = false,
  above,
  actions,
  header,
  sticky = false,
  children,
}: {
  /**
   * The page's `<h1>`, as a string rather than a node — a heading is text, and
   * a slot taking arbitrary JSX is how the five spellings got here.
   *
   * OMITTING IT IS PERMITTED IN EXACTLY ONE CASE: the page's own content
   * already supplies the `<h1>`, because the content IS the page's subject.
   * `/invoices/$invoiceId` is the only such page — `InvoiceRecord` opens with
   * the word "Invoice" set as the document's masthead. A call site that leaves
   * this out must name the element that stands in for it, because "no heading"
   * and "the heading is somewhere else" look identical from here and only one
   * of them is a document-structure gap.
   */
  title?: string
  /**
   * Render the heading `sr-only`.
   *
   * FOR PAGES WHOSE HEADER IS ALREADY THE ANSWER. /timer opens on a running
   * timer, a week's totals and a filter band; /reports opens on a date range
   * and two charts. A `text-sm` word "Timer" above either of those is a label
   * on something that has already said what it is, and it would push the one
   * thing the page exists for down the screen.
   *
   * It is NOT permission to have no heading. Both pages had none at all, which
   * is a real gap: a screen reader's heading list is how a page is skimmed
   * without sight, and a document whose outline starts at `<h2>` — or at
   * nothing — cannot be. Hidden is a visual decision; absent is a structural
   * one, and only the first is ours to make.
   */
  titleHidden?: boolean
  /** Above the heading, inside the same gutter. Breadcrumbs, and so far only
   *  breadcrumbs — the two invoice routes are the only pages nested under
   *  another. */
  above?: ReactNode
  /** Beside the heading, right-aligned: the one page-level action, where a page
   *  has one. Baseline-aligned with the heading rather than top-aligned, so a
   *  36px control and a 14px title sit on one line of text. */
  actions?: ReactNode
  /**
   * Header content below the title row, FULL-BLEED — a filter band that reads
   * as a strip of the page, the way a day header does. It supplies its own
   * `px-4` on whatever inside it needs to line up with the rows below.
   *
   * It is part of what sticks, when the page sticks.
   */
  header?: ReactNode
  /** See THE PINNING RULE above. Default false: pinning is argued, not assumed. */
  sticky?: boolean
  /**
   * The rest of the page. It is a CHILD rather than a sibling because
   * `--log-sticky-top` is a custom property: it inherits down the tree and
   * never sideways, so the log has to sit inside the element that sets it.
   */
  children: ReactNode
}) {
  /*
   * Measured only when something reads the number.
   *
   * The property is consumed by exactly one thing — the `--log-sticky-top`
   * calc below — and that is written only when `sticky`. Six of the eight
   * pages are unpinned, so measuring unconditionally meant six ResizeObservers
   * running for the life of a page to publish a value nothing resolves, each
   * write invalidating the inherited custom properties of the subtree under it.
   *
   * The hook call stays unconditional (they always are) and the ARGUMENT
   * carries the decision instead: `null` means "measure nothing" — see
   * `use-height-var.ts`. One hook, one component, one shape, and no observer
   * where there is no reader.
   */
  const { hostRef, measuredRef } = useHeightVar(sticky ? "--page-header-height" : null)

  const heading =
    title === undefined ? null : (
      /*
       * THE ONE HEADING VOCABULARY: `text-sm font-semibold`.
       *
       * Small, deliberately, and inherited from the pages that already had a
       * heading rather than invented. This is an instrument, not a document —
       * a 30px page title would be the largest thing on a screen whose actual
       * subject is a list of durations, and DESIGN.md's Display size is
       * reserved for a running duration. Sentence case, no tracked-out eyebrow.
       */
      <h1 className={cn("text-sm font-semibold", titleHidden && "sr-only")}>{title}</h1>
    )

  /*
   * The visible title row, or nothing at all.
   *
   * A page with a hidden title and no breadcrumb or action has nothing to draw
   * here, and an empty padded row would put 40px of ground above /timer's
   * totals for the sake of a heading nobody can see. The `sr-only` heading is
   * emitted on its own instead — it is out of flow, so it costs no height
   * wherever it lands, and first in the band is where it should be read.
   *
   * So the row either renders or it does not, and the heading goes inside it
   * when it does. There is no third case where a hidden heading is PLACED
   * differently: `sr-only` is out of flow, so both positions are the same
   * picture, and steering placement on it read as though one of them mattered.
   */
  const showRow =
    above !== undefined || actions !== undefined || (title !== undefined && !titleHidden)

  return (
    <div
      ref={hostRef}
      className={cn(
        "flex flex-col",
        /*
         * WHY THE SUM IS COMPOSED IN CSS. Both halves are measured (see
         * `use-height-var.ts`, the primitive underneath this) and neither is a
         * constant — the timer bar grows a line while recording, this header
         * rewraps. A calc over two custom properties keeps the total true
         * without anything re-rendering to maintain it. `_+_` is Tailwind's
         * escape for the spaces `calc` requires.
         *
         * Unpinned, this is not set at all: the shell's own
         * `--log-sticky-top: var(--shell-sticky-top)` then stands, so a log on
         * an unpinned page still clears the timer bar rather than sliding
         * under it.
         */
        sticky &&
          "[--log-sticky-top:calc(var(--shell-sticky-top)_+_var(--page-header-height))]"
      )}
    >
      <div
        ref={measuredRef}
        className={cn(
          /*
           * THE Z-ORDER LADDER, argued once and here. The shell's timer bar is
           * `z-30`, this header is `z-20`, a day header inside the log is
           * `z-10` — the same order as their positions down the screen, so the
           * thing that is higher up is also the thing that passes over.
           * `bg-ground`, opaque: rows scroll UNDER this, and a transparent
           * sticky element is a window onto them.
           */
          sticky && "sticky top-(--shell-sticky-top) z-20 bg-ground"
        )}
      >
        {showRow ? (
          <div className="flex w-full items-baseline justify-between gap-3 px-4 pt-6 pb-4">
            {/* The breadcrumb and the heading are ONE column, so `actions`
                baseline-aligns with whichever of them comes first rather than
                with the bottom of a two-line stack. */}
            <div className="flex min-w-0 flex-col gap-2">
              {above}
              {heading}
            </div>
            {actions}
          </div>
        ) : (
          heading
        )}

        {header}
      </div>

      {children}
    </div>
  )
}

/**
 * What goes in `above`, for the pages that are nested under another.
 *
 * Written twice, verbatim, before this — the nav, the list, the parent link,
 * the decorative separator and the current crumb, ~15 lines of it, in
 * `/invoices/$invoiceId` and `/invoices/new`. Only the crumb's text ever
 * differed. A trail whose SEPARATOR is spelt per page is a trail that ends up
 * with two of them, and the `aria-hidden`/`aria-current` pairing is the part
 * nobody re-derives correctly on the third copy.
 *
 * `parentTo`, not a hard-coded "/invoices": both callers are invoice routes
 * today, and the moment a third page is nested somewhere else this component
 * should not be the reason it cannot use it. Two levels only, because that is
 * the whole depth of this product's routing — a crumb list that can grow
 * arbitrarily is a different component with a different argument.
 */
export function PageBreadcrumb({
  parentTo,
  parentLabel,
  current,
  currentClassName,
}: {
  parentTo: LinkProps["to"]
  parentLabel: string
  /** The page you are on. Not a link: `aria-current="page"` is the whole
   *  point, and a link to here is a control that does nothing. */
  current: string
  /** For a crumb that is a NUMBER rather than a name — `tabular` on
   *  "#1042" — and nothing else. */
  currentClassName?: string
}) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <li>
          <Link to={parentTo} className="underline-offset-2 hover:underline">
            {parentLabel}
          </Link>
        </li>
        {/* Decorative: the list is already ordered and the crumb below already
            says it is the current page, so a screen reader announcing "rsaquo"
            between them is noise. */}
        <li aria-hidden="true">›</li>
        <li aria-current="page" className={cn("text-foreground", currentClassName)}>
          {current}
        </li>
      </ol>
    </nav>
  )
}
