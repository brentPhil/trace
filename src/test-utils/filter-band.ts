import { expect } from "vitest"
import { screen } from "@testing-library/react"

/**
 * The band assertion, once — for the two pages that must draw the same one.
 *
 * WHAT IT HOLDS. /timer wrapped `FilterControls` in a Surface strip and
 * /reports put the identical component on bare ground, so the same three
 * filters looked like two different features. Nothing failed when that
 * happened: both pages rendered, both filtered correctly, and the only symptom
 * was a screenshot — which is exactly why it has to be an assertion. Sharing
 * one helper is the point as well as the convenience: the two pages assert the
 * same thing by construction rather than by two hand-written near-copies that
 * can drift the way the chrome itself did.
 *
 * jsdom applies no CSS, so the class list is what carries the decision here —
 * the same trade `expectPageHeading` makes for `sr-only`. It reads the fill and
 * both hairlines off the nearest banded ancestor of the search box, which is
 * the one control both pages have.
 */
export function expectFilterControlsInBand() {
  const search = screen.getByPlaceholderText("Search titles, notes and projects")
  const band = search.closest(".bg-surface")
  /*
   * The fallback string is the failure MESSAGE. `expect(band).not.toBe(null)`
   * reports "expected null not to be null", which says nothing about what
   * broke; standing a sentence in for the missing class list makes the
   * assertion print the defect.
   */
  const chrome = band?.className ?? "the filter controls are not in a band at all"
  expect(chrome).toContain("bg-surface")
  expect(chrome).toContain("border-y")
  expect(chrome).toContain("border-edge-soft")
  return band
}
