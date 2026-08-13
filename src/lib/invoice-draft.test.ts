import { describe, expect, it } from "vitest"
import {
  DEFAULT_TERM_DAYS,
  REFUSAL_FIELD_OF,
  draftArgs,
  dueBeforeIssue,
  newInvoiceDraft,
  refusedField,
  singleClientId,
} from "./invoice-draft"
import { startOfDay } from "@shared/day"
import { SUMMARY_LABEL } from "@shared/labels"
import type { InvoiceDraft } from "./invoice-draft"

/*
 * The document a person types on /invoices/new, before it is a document.
 *
 * An invoice is write-once, so every default here is permanent the moment the
 * button is pressed — there is no editor to correct a prefill in. That is what
 * makes these worth asserting as rules rather than leaving to a page test: a
 * wrong due date is one line of a form component and a real invoice.
 */

/** Noon UTC on a Wednesday, which is already Thursday in Auckland — the fixture
 *  that separates "the stored zone" from "whatever the machine is set to". */
const NOON = Date.parse("2026-08-05T12:00:00.000Z")

function draftOf(over: Partial<InvoiceDraft> = {}): InvoiceDraft {
  return {
    ...newInvoiceDraft({
      nowMs: NOON,
      timeZone: "UTC",
      currency: "USD",
      client: null,
      mergeInvoiceLines: true,
    }),
    ...over,
  }
}

describe("newInvoiceDraft", () => {
  it("opens on today, net thirty, and the account's currency", () => {
    expect(
      newInvoiceDraft({
        nowMs: NOON,
        timeZone: "UTC",
        currency: "EUR",
        client: null,
        mergeInvoiceLines: true,
      })
    ).toEqual({
      billedTo: "",
      payTo: "",
      purchaseOrder: "",
      paymentTerms: "",
      summaryDescription: SUMMARY_LABEL,
      notes: "",
      currency: "EUR",
      issuedOn: "2026-08-05",
      dueOn: "2026-09-04",
      mergeLines: true,
    })
    expect(DEFAULT_TERM_DAYS).toBe(30)
  })

  /* The user's STORED zone, never the browser's. A freelancer raising an
   * invoice from an airport must not date it a day either side of what they
   * think — and the due date has to move with it, not stay pinned to a UTC
   * reading of the same instant. */
  it("dates the document in the stored zone, both ends", () => {
    const draft = newInvoiceDraft({
      nowMs: NOON,
      timeZone: "Pacific/Auckland",
      currency: "USD",
      client: null,
      mergeInvoiceLines: true,
    })
    expect(draft.issuedOn).toBe("2026-08-06")
    expect(draft.dueOn).toBe("2026-09-05")
  })

  /*
   * The billed-to block is the SAME text the mutation would snapshot, through
   * the same `partyBlockOf`. It matters that it is byte-identical: the form
   * always sends what is in the box, so a prefill that differed by a newline
   * would store a different address from the one the user read and approved.
   */
  it("prefills the range's client exactly as the mutation would snapshot it", () => {
    // No client, no guess: an empty box, and the server's own fallback is what
    // the form then overrides with that same empty string.
    expect(draftOf().billedTo).toBe("")
    expect(
      newInvoiceDraft({
        nowMs: NOON,
        timeZone: "UTC",
        currency: "USD",
        client: {
          name: "Vessel Vanguard",
          address: "Bonita Springs, FL\n34134",
        },
        mergeInvoiceLines: true,
      }).billedTo
    ).toBe("Vessel Vanguard\nBonita Springs, FL\n34134")
  })

  it("leaves a client with no address as its name alone, with no trailing gap", () => {
    expect(
      newInvoiceDraft({
        nowMs: NOON,
        timeZone: "UTC",
        currency: "USD",
        client: { name: "Acme", address: "   " },
        mergeInvoiceLines: true,
      }).billedTo
    ).toBe("Acme")
  })

  /*
   * PAY TO IS EMPTY, and it is the field this whole page exists for. Nothing in
   * a range of time entries says who the freelancer is and there is no setting
   * to read one from, so every invoice raised before this form existed went out
   * without telling the client where to send the money.
   */
  it("leaves pay to empty, because nothing in the product knows it", () => {
    expect(draftOf().payTo).toBe("")
  })

  it("prefills the shared summary label and follows the account merge setting", () => {
    expect(draftOf().summaryDescription).toBe(SUMMARY_LABEL)
    expect(draftOf().mergeLines).toBe(true)
    expect(
      newInvoiceDraft({
        nowMs: NOON,
        timeZone: "UTC",
        currency: "USD",
        client: null,
        mergeInvoiceLines: false,
      }).mergeLines
    ).toBe(false)
  })
})

describe("draftArgs", () => {
  /*
   * EVERY FIELD IS SENT, including the empty ones. The mutation reads
   * `undefined` as "nobody said" and falls back — `billedTo` to the range's
   * client — while `""` is a block the user cleared on purpose. This form has
   * shown the user every value, so a fallback that put an address back onto an
   * invoice they had just emptied would be permanent.
   */
  it("sends an emptied block as an empty string, never as absent", () => {
    const args = draftArgs(draftOf({ billedTo: "" }), "UTC")
    expect("billedTo" in args).toBe(true)
    expect(args.billedTo).toBe("")
  })

  /* The instants the mutation stores are the FIRST MOMENT of the chosen day in
   * the stored zone, so reading them back with `dayOf` lands on the date the
   * picker showed rather than the day before. */
  it("converts the two days to instants in the stored zone", () => {
    const args = draftArgs(draftOf(), "Pacific/Auckland")
    expect(args.issuedAt).toBe(startOfDay("2026-08-05", "Pacific/Auckland"))
    expect(args.dueAt).toBe(startOfDay("2026-09-04", "Pacific/Auckland"))
  })

  it("sends the per-invoice merge choice and summary description", () => {
    const args = draftArgs(
      draftOf({ mergeLines: false, summaryDescription: "Retainer services" }),
      "UTC"
    )
    expect(args.mergeLines).toBe(false)
    expect(args.summaryDescription).toBe("Retainer services")
  })
})

/*
 * ADVISORY, NOT A REFUSAL. `createFromRange` deliberately does not compare the
 * dates — "due on receipt" is real and back-dating a document is ordinary — so
 * the only thing standing between a mistyped year and a permanent record is a
 * sentence on the form, computed from the values as typed.
 */
describe("dueBeforeIssue", () => {
  it("says nothing about the ordinary case, or about same-day terms", () => {
    expect(dueBeforeIssue(draftOf())).toBe(false)
    expect(dueBeforeIssue(draftOf({ dueOn: "2026-08-05" }))).toBe(false)
  })

  it("catches a due date before the invoice date", () => {
    expect(dueBeforeIssue(draftOf({ dueOn: "2026-08-04" }))).toBe(true)
    // The mistyped year, which is the one an eye slides over.
    expect(dueBeforeIssue(draftOf({ dueOn: "2025-09-04" }))).toBe(true)
  })
})

describe("refusedField", () => {
  const refusal = (field?: unknown) => ({
    data: {
      code: "TOO_LONG",
      message: "Too long.",
      meta: field === undefined ? undefined : { field },
    },
  })

  it("reads the field the mutation named", () => {
    expect(refusedField(refusal("payTo"))).toBe("payTo")
    expect(refusedField(refusal("dueAt"))).toBe("dueAt")
    expect(refusedField(refusal("summaryDescription"))).toBe(
      "summaryDescription"
    )
  })

  /*
   * A refusal this build does not recognise falls through to null and is shown
   * as a page-level message. Attaching it to a control would put a sentence
   * beside a box that is not the one at fault, which is worse than a sentence
   * beside the button.
   */
  it("answers null for a refusal that named no field, or an unknown one", () => {
    expect(refusedField(refusal())).toBe(null)
    expect(refusedField(refusal("someFutureField"))).toBe(null)
    expect(refusedField(new Error("network"))).toBe(null)
    expect(refusedField(undefined)).toBe(null)
  })

  /* The two dates are the reason this map exists: the draft holds days and the
   * mutation refuses instants, so a refusal about the due date would otherwise
   * arrive keyed to a field the form has no box for and render nowhere. */
  it("maps the form's day fields onto the arguments the mutation refuses", () => {
    expect(REFUSAL_FIELD_OF.issuedOn).toBe("issuedAt")
    expect(REFUSAL_FIELD_OF.dueOn).toBe("dueAt")
    expect(REFUSAL_FIELD_OF.summaryDescription).toBe("summaryDescription")
  })
})

/*
 * Which client to PREFILL, and deliberately not which client is allowed. The
 * server refuses `MIXED_CLIENTS` over the rows it will actually bill and has to,
 * because only it can name both. This answers the narrower question: is there
 * one unambiguous block to put in the box.
 */
describe("singleClientId", () => {
  const clientOf = (map: Record<string, string | null>) => (id: string) =>
    map[id] ?? null

  it("finds the one client the range's billable work belongs to", () => {
    expect(
      singleClientId(
        [
          { projectId: "p1", billableMs: 3_600_000 },
          { projectId: "p2", billableMs: 60_000 },
        ],
        clientOf({ p1: "c1", p2: "c1" })
      )
    ).toBe("c1")
  })

  it("answers null when the range touches two, rather than picking one", () => {
    expect(
      singleClientId(
        [
          { projectId: "p1", billableMs: 3_600_000 },
          { projectId: "p2", billableMs: 60_000 },
        ],
        clientOf({ p1: "c1", p2: "c2" })
      )
    ).toBe(null)
  })

  /* A project with no client set does not count against it — the same rule the
   * server's own loop follows. */
  it("ignores a project with no client", () => {
    expect(
      singleClientId(
        [
          { projectId: "p1", billableMs: 3_600_000 },
          { projectId: "p2", billableMs: 60_000 },
        ],
        clientOf({ p1: "c1", p2: null })
      )
    ).toBe("c1")
  })

  /* A bucket with no billable time is not work this range bills, so it cannot
   * make the range ambiguous. The unassigned bucket has no client at all. */
  it("ignores a bucket with no billable time, and the unassigned one", () => {
    expect(
      singleClientId(
        [
          { projectId: "p1", billableMs: 3_600_000 },
          { projectId: "p2", billableMs: 0 },
          { projectId: null, billableMs: 60_000 },
        ],
        clientOf({ p1: "c1", p2: "c2" })
      )
    ).toBe("c1")
  })

  /*
   * An UNRATED project still counts. Its hours earn nothing, but the range
   * genuinely touched that client's work, and a range spanning two clients is
   * exactly as ambiguous whether or not one side has a rate yet — which is the
   * basis the server's refusal uses, so the prefill must not be more generous
   * than the check that follows it.
   */
  it("counts a project whose time is unpriced", () => {
    expect(
      singleClientId(
        [
          { projectId: "p1", billableMs: 3_600_000 },
          { projectId: "unrated", billableMs: 7_200_000 },
        ],
        clientOf({ p1: "c1", unrated: "c2" })
      )
    ).toBe(null)
  })

  it("answers null for a range with no client anywhere in it", () => {
    expect(
      singleClientId([{ projectId: "p1", billableMs: 60_000 }], clientOf({}))
    ).toBe(null)
  })
})
