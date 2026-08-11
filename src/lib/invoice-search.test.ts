import { describe, expect, it } from "vitest"
import { defaultParseSearch, defaultStringifySearch } from "@tanstack/react-router"
import { invoiceSearchOf, parseInvoiceSearch } from "./invoice-search"

/*
 * `/invoices/new`'s search params — the first in this app, and therefore the
 * pattern the next route copies.
 *
 * What is asserted here is almost entirely about MALFORMED input, because that
 * is the whole reason this is a function rather than a cast. Every one of these
 * URLs is reachable: a truncated paste, a link written before a param existed, a
 * hand-typed range, a repeated key. None of them may throw — the router would
 * answer a throw with an error screen — and none may produce a range the page
 * would then bill without being able to say where it came from.
 */

const FROM = Date.parse("2026-08-03T00:00:00Z")
const TO = Date.parse("2026-08-10T00:00:00Z")

describe("parseInvoiceSearch — the range", () => {
  it("takes a well-formed pair", () => {
    expect(parseInvoiceSearch({ from: FROM, to: TO })).toEqual({ from: FROM, to: TO })
  })

  /* A hand-typed URL, or a link from anywhere that is not TanStack's own
   * stringifier, arrives as strings. Refusing those would refuse the ordinary
   * case of somebody editing the address bar. */
  it("takes numeric strings", () => {
    expect(parseInvoiceSearch({ from: String(FROM), to: String(TO) })).toEqual({
      from: FROM,
      to: TO,
    })
  })

  /*
   * BOTH ENDS OR NEITHER. Half a period is not half an invoice — it is a period
   * whose end the page would have to invent, and an invoice raised over an
   * invented end bills a client for a span nobody chose.
   */
  it("drops both ends when only one is readable", () => {
    expect(parseInvoiceSearch({ from: FROM })).toEqual({})
    expect(parseInvoiceSearch({ to: TO })).toEqual({})
    expect(parseInvoiceSearch({ from: FROM, to: "next tuesday" })).toEqual({})
  })

  /*
   * `Number("")` is 0 and `Number(null)` is 0, which are the shapes an emptied
   * param arrives as — and a range of [0, 0) is the epoch, not an absence. This
   * is the case a bare `Number()` coercion gets silently wrong.
   */
  it("does not read an empty or null param as the epoch", () => {
    expect(parseInvoiceSearch({ from: "", to: "" })).toEqual({})
    expect(parseInvoiceSearch({ from: null, to: null })).toEqual({})
  })

  it("drops a non-finite instant", () => {
    expect(parseInvoiceSearch({ from: NaN, to: TO })).toEqual({})
    expect(parseInvoiceSearch({ from: FROM, to: Infinity })).toEqual({})
  })

  /* A reversed pair is a caller that has confused its own arguments. Quietly
   * swapping them would bill whatever that confusion produced. */
  it("drops a reversed pair rather than swapping it", () => {
    expect(parseInvoiceSearch({ from: TO, to: FROM })).toEqual({})
  })

  /* A single day is a legitimate range and is NOT reversed. */
  it("keeps a pair whose ends are equal", () => {
    expect(parseInvoiceSearch({ from: FROM, to: FROM })).toEqual({ from: FROM, to: FROM })
  })
})

describe("parseInvoiceSearch — the filter", () => {
  /* `""` is the "entries with NO project" sentinel (`NO_PROJECT_FILTER`), not
   * an absence, and dropping it would silently WIDEN what gets billed. */
  it("keeps the no-project sentinel and distinguishes it from an absent filter", () => {
    expect(parseInvoiceSearch({ from: FROM, to: TO, projectId: "" }).projectId).toBe("")
    expect(parseInvoiceSearch({ from: FROM, to: TO }).projectId).toBeUndefined()
  })

  it("drops a projectId that is not a string", () => {
    expect(parseInvoiceSearch({ projectId: ["a", "b"] }).projectId).toBeUndefined()
  })

  /* An empty needle and an absent one are the same filter, and keeping the
   * empty spelling would put `?text=` on every link from an unfiltered range. */
  it("treats an empty search needle as no needle", () => {
    expect(parseInvoiceSearch({ text: "" }).text).toBeUndefined()
    expect(parseInvoiceSearch({ text: "audit" }).text).toBe("audit")
  })

  it("normalises the presets the way the mutation records them", () => {
    expect(
      parseInvoiceSearch({ presets: ["no-note", "no-project", "no-note"] }).presets
    ).toEqual(["no-note", "no-project"])
  })

  /* A link written by a newer build carrying a fourth chip should still bill
   * the three this one understands. Dropping the whole array instead would
   * silently widen the range. */
  it("drops an unknown preset without discarding the known ones", () => {
    expect(parseInvoiceSearch({ presets: ["no-note", "invented"] }).presets).toEqual([
      "no-note",
    ])
    expect(parseInvoiceSearch({ presets: ["invented"] }).presets).toBeUndefined()
  })

  /* `?presets=no-note` — the most likely hand-written link. */
  it("accepts a single preset written as a bare string", () => {
    expect(parseInvoiceSearch({ presets: "no-note" }).presets).toEqual(["no-note"])
  })

  it("survives a URL with nothing on it at all", () => {
    expect(parseInvoiceSearch({})).toEqual({})
  })

  /* The one property the router depends on: `validateSearch` must not throw,
   * because the router answers a throw with this route's error component
   * instead of the page. */
  it("never throws, whatever arrives", () => {
    for (const raw of [
      { from: {}, to: [] },
      { presets: 7 },
      { text: null, projectId: 3 },
      { from: "1e309", to: "1e309" },
    ]) {
      expect(() => parseInvoiceSearch(raw)).not.toThrow()
    }
  })
})

/*
 * The builder and the parser are two halves of ONE contract: a key added to one
 * and forgotten in the other is a filter the button drops on the way to the
 * page, and the invoice then bills a superset of the rows the user was looking
 * at. That is the exact failure `createFromRange` grew its filter arguments to
 * close, so the round trip is asserted through the router's real serialiser
 * rather than by comparing two objects that never touched a URL.
 */
describe("invoiceSearchOf", () => {
  const range = { fromMs: FROM, toMs: TO }

  function roundTrip(search: ReturnType<typeof invoiceSearchOf>) {
    return parseInvoiceSearch(defaultParseSearch(defaultStringifySearch(search)))
  }

  it("carries a plain range and nothing else", () => {
    const search = invoiceSearchOf(range, { projectId: null, text: "", presets: [] })
    expect(search).toEqual({ from: FROM, to: TO })
    expect(roundTrip(search)).toEqual({ from: FROM, to: TO })
  })

  it("carries every filter through a real URL unchanged", () => {
    const search = invoiceSearchOf(range, {
      projectId: "p1",
      text: "audit & review",
      presets: ["no-note", "no-project"],
    })
    expect(roundTrip(search)).toEqual({
      from: FROM,
      to: TO,
      projectId: "p1",
      text: "audit & review",
      presets: ["no-note", "no-project"],
    })
  })

  /* The sentinel has to survive the round trip too — it is the difference
   * between billing the unassigned bucket and billing everything. */
  it("carries the no-project sentinel through a URL", () => {
    const search = invoiceSearchOf(range, { projectId: "", text: "", presets: [] })
    expect(roundTrip(search).projectId).toBe("")
  })

  /* Sorted, so two links naming the same chips in two orders are one filter —
   * and one query key, and one cached breakdown. */
  it("sorts the presets so two orderings are one filter", () => {
    expect(
      invoiceSearchOf(range, {
        projectId: null,
        text: "",
        presets: ["under-a-minute", "no-note"],
      }).presets
    ).toEqual(["no-note", "under-a-minute"])
  })
})
