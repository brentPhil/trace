import { expect } from "vitest"
import { screen } from "@testing-library/react"

/**
 * The page-heading assertion, once.
 *
 * Six route tests each spelt out the same three lines — `getAllByRole` at level
 * 1, a length of exactly 1, and the text — and two of them a fourth for
 * `sr-only`. That is the assertion that holds `Page`'s one rule: every route
 * has exactly one `<h1>`, and hiding it is a decision about SIGHT, never about
 * structure. Written six times, a seventh page gets a weaker copy of it, or
 * none — which is the shape of the gap it was written to close in the first
 * place.
 *
 * `getAllByRole` rather than `getByRole`, deliberately: `getByRole` throws on
 * more than one match with a message about ambiguity, which reads as a bad
 * query rather than as a page that has two `<h1>`s. The length check is the
 * point of the assertion, so it has to be an assertion.
 *
 * Returns the heading, so a page whose `<h1>` has a treatment of its OWN — the
 * invoice record's masthead — can go on to say so without re-querying.
 */
export function expectPageHeading(name: string, { hidden = false } = {}) {
  const headings = screen.getAllByRole("heading", { level: 1 })
  expect(headings.length).toBe(1)
  expect(headings[0].textContent).toBe(name)
  // jsdom applies no CSS, so the class is what carries the decision here; the
  // length check above is what says hiding it never became deleting it.
  if (hidden) expect(headings[0].className).toContain("sr-only")
  return headings[0]
}
