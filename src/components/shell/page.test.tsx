import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render } from "@testing-library/react"
import { Page } from "@/components/shell/page"

afterEach(cleanup)

/*
 * ASSERTED ON THE CLASS LIST where the assertion is about layout, for the same
 * reason `sidebar.test.tsx` gives: jsdom has no layout engine and no Tailwind at
 * test time, so every `getBoundingClientRect` here is zeroes and a geometric
 * assertion would pass against any markup at all. What the class list can still
 * carry is whether the page asked to be pinned.
 */
function stickyBand(container: HTMLElement) {
  /*
   * `~=`, matching the whole class token, NOT `*=` matching a substring. The
   * host element carries `[--log-sticky-top:calc(…)]`, which contains the
   * letters "sticky" — so a substring selector finds the HOST, reports "yes,
   * something is sticky", and never looks at the band at all. It also finds it
   * on an UNPINNED page the moment that variable is set for any reason, which
   * is the direction that matters: this assertion has to be able to fail.
   */
  return container.querySelector('[class~="sticky"]')
}

describe("Page — the heading", () => {
  it("renders the title as the page's ONE h1, in the one heading vocabulary", () => {
    const { container } = render(
      <Page title="Projects">
        <p>body</p>
      </Page>
    )

    const headings = container.querySelectorAll("h1")
    expect(headings.length).toBe(1)
    expect(headings[0].textContent).toBe("Projects")
    // The vocabulary itself, pinned here rather than in five route files —
    // which is the whole reason this component exists.
    expect(headings[0].className).toContain("text-sm")
    expect(headings[0].className).toContain("font-semibold")
    expect(headings[0].className).not.toContain("sr-only")
  })

  /*
   * The gap /timer and /reports actually had: NO `<h1>` anywhere on the page.
   * `titleHidden` is a decision about sight, never about structure, so the
   * heading has to survive it — a screen reader's heading list is how a page is
   * skimmed without sight, and "hidden" and "absent" are the same thing to a
   * test that only looks at what is painted.
   */
  it("keeps a hidden title in the accessibility tree rather than dropping it", () => {
    const { container } = render(
      <Page title="Timer" titleHidden sticky header={<div>totals</div>}>
        <p>log</p>
      </Page>
    )

    const heading = container.querySelector("h1")
    expect(heading).not.toBeNull()
    expect(heading?.textContent).toBe("Timer")
    expect(heading?.className).toContain("sr-only")
  })

  /*
   * A hidden title with no breadcrumb and no action has nothing to draw, and an
   * empty padded row would put ~40px of ground above /timer's totals for a
   * heading nobody can see. `sr-only` is out of flow, so the heading itself
   * costs nothing wherever it lands — but the WRAPPER would not have been.
   */
  it("draws no title row at all when the title is hidden and there is nothing beside it", () => {
    const { container } = render(
      <Page title="Timer" titleHidden sticky header={<div data-testid="band">band</div>}>
        <p>log</p>
      </Page>
    )

    // `pt-6` is the title row's own top padding and appears nowhere else in
    // this component, so its absence IS the row's absence.
    expect(container.innerHTML).not.toContain("pt-6")
  })

  /*
   * The one documented escape: `/invoices/$invoiceId`, whose `<h1>` is the
   * document's own masthead inside `InvoiceRecord`. Omitting the title must
   * emit no heading rather than an empty one — an `<h1></h1>` in the outline is
   * worse than no `<h1>` here, because it claims a section that has no name.
   */
  it("emits no heading when the page's own content supplies it", () => {
    const { container } = render(
      <Page above={<nav>crumbs</nav>} actions={<button>Export</button>}>
        <h1>Invoice</h1>
      </Page>
    )

    // Exactly the one the CONTENT rendered, and none from Page itself.
    const headings = container.querySelectorAll("h1")
    expect(headings.length).toBe(1)
    expect(headings[0].textContent).toBe("Invoice")
    // …and the row is still drawn, because the breadcrumb and the action need it.
    expect(container.textContent).toContain("crumbs")
    expect(container.textContent).toContain("Export")
  })
})

describe("Page — the pinning rule", () => {
  /*
   * PINNING IS OPT-IN. The rule (see `Page`) is that a header pins when it is a
   * readout of, or a control over, what scrolls beneath it — so the default has
   * to be the common case, and a page that merely names itself must not acquire
   * a sticky band by inheriting one. /projects, /invoices, /settings and both
   * invoice routes all rely on this default.
   */
  it("does not pin a header by default", () => {
    const { container } = render(
      <Page title="Settings">
        <p>sections</p>
      </Page>
    )

    expect(stickyBand(container)).toBeNull()
    // Nor does it claim an offset for a log that is not sticking to it.
    expect(container.innerHTML).not.toContain("--log-sticky-top")
  })

  it("pins the header, and publishes the log's offset, only when asked", () => {
    const { container } = render(
      <Page title="Reports" titleHidden sticky header={<div>filters</div>}>
        <p>rows</p>
      </Page>
    )

    const band = stickyBand(container)
    expect(band).not.toBeNull()
    // The z-order ladder: the shell's timer bar is z-30, this is z-20, a day
    // header inside the log is z-10.
    expect(band?.className).toContain("z-20")
    // Opaque, because rows scroll under it and a transparent sticky element is
    // a window onto them.
    expect(band?.className).toContain("bg-ground")
    // The sum is composed in CSS over two MEASURED heights — see
    // `use-height-var.ts`. A constant here is right in exactly one state.
    expect(container.innerHTML).toContain("--log-sticky-top:calc(")
    expect(container.innerHTML).toContain("--page-header-height")
  })

  /*
   * `--log-sticky-top` inherits DOWN the tree and never sideways, which is why
   * the body is a CHILD of this component rather than a sibling of the band.
   * Render the log outside it and the day headers resolve their `top` from the
   * shell's value instead, sliding under the page's own band.
   */
  it("renders the body inside the element that sets the offset", () => {
    const { container } = render(
      <Page title="Timer" titleHidden sticky header={<div>band</div>}>
        <p data-testid="log">log</p>
      </Page>
    )

    const host = container.querySelector('[style*="--log-sticky-top"], [class*="--log-sticky-top"]')
    expect(host).not.toBeNull()
    expect(host?.querySelector('[data-testid="log"]')).not.toBeNull()
  })
})

/*
 * THE ALIGNMENT CONTRACT from `app-shell.tsx`: the shell pads nothing, and every
 * page applies its own `px-4` so the timer bar's input, the totals, the filter
 * band, the day labels and the entry titles land on one left edge.
 *
 * `Page` pads the title row it draws ITSELF, which DESIGN.md permits — the rule
 * is against a component carrying its CALLER's gutter, because "a component
 * that carries the page's gutter forces its next caller to compensate". So the
 * two slots that take caller content must stay bare, and that is what this pins.
 */
describe("Page — the gutter", () => {
  it("leaves the header and body slots unpadded, so callers keep their own px-4", () => {
    const { container } = render(
      <Page title="Timer" titleHidden sticky header={<div data-testid="band">band</div>}>
        <div data-testid="body">body</div>
      </Page>
    )

    const band = container.querySelector('[data-testid="band"]')
    const body = container.querySelector('[data-testid="body"]')
    // Page wraps neither slot in a padded element: each is a direct child of an
    // unpadded container, so what the caller writes is what lands.
    expect(band?.parentElement?.className ?? "").not.toContain("px-")
    expect(body?.parentElement?.className ?? "").not.toContain("px-")
  })
})
