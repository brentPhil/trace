import { describe, expect, it } from "vitest"
import {
  changedHeadFields,
  commitHeadForm,
  headOf,
  headPatch,
  liveCollisions,
  nameFields,
  reconcileHeadForm,
  refusedHeadField,
  seedHeadForm,
} from "@/lib/invoice-head"
import type { InvoiceHead } from "@/lib/invoice-head"

/*
 * The arithmetic behind the Save button.
 *
 * A buffered editor is only as good as its answer to "has anything changed?",
 * and the wrong answer is invisible in both directions: a form that thinks it is
 * clean loses work silently, and a form that thinks it is dirty warns about
 * nothing until people learn to click through the warning. Both failures are
 * cheap to assert here and expensive to notice on screen.
 */

const NOW = Date.parse("2026-08-05T12:00:00.000Z")

function head(over: Partial<InvoiceHead> = {}): InvoiceHead {
  return {
    billedTo: "Vessel Vanguard\nBonita Springs, FL",
    payTo: "",
    currency: "USD",
    issuedAt: NOW,
    dueAt: NOW + 30 * 24 * 3_600_000,
    purchaseOrder: "",
    paymentTerms: "",
    notes: "",
    ...over,
  }
}

describe("headOf", () => {
  /* The optional columns are ABSENT when unset — `invoices.update` clears them
   * rather than storing "" — while a form field's value is always a string. If
   * these two spellings met anywhere but here, an untouched invoice would read
   * as dirty from the moment it loaded. */
  it("spells an absent optional column as an empty string", () => {
    const form = headOf({
      billedTo: "A",
      payTo: "B",
      currency: "USD",
      issuedAt: NOW,
      dueAt: NOW,
    })
    expect(form.purchaseOrder).toBe("")
    expect(form.paymentTerms).toBe("")
    expect(form.notes).toBe("")
    expect(changedHeadFields(form, form)).toEqual([])
  })
})

describe("changedHeadFields", () => {
  it("finds nothing between a head and itself", () => {
    expect(changedHeadFields(head(), head())).toEqual([])
  })

  it("names only the fields that differ", () => {
    expect(changedHeadFields(head(), head({ notes: "Thanks!", dueAt: NOW }))).toEqual([
      "dueAt",
      "notes",
    ])
  })

  /* THE HEADLINE of this module. Typing over a value and typing it back is not
   * an edit, and a touched flag would call it one — then light Save and warn on
   * the way out about losing work that does not exist. */
  it("calls a value typed back to its original unchanged", () => {
    const stored = head()
    const typedAway = { ...stored, billedTo: "Acme" }
    expect(changedHeadFields(typedAway, stored)).toEqual(["billedTo"])

    const typedBack = { ...stored, billedTo: stored.billedTo }
    expect(changedHeadFields(typedBack, stored)).toEqual([])
  })

  /* Every string is trimmed by `invoices.update` before it is stored, so a
   * trailing space is a write that would change nothing — and comparing raw
   * would leave the form dirty over a keystroke nobody can see. */
  it("ignores whitespace the server would trim anyway", () => {
    expect(changedHeadFields(head({ notes: "  " }), head())).toEqual([])
    expect(changedHeadFields(head({ billedTo: " Vessel Vanguard\nBonita Springs, FL " }), head()))
      .toEqual([])
  })

  /* The newlines are the address's shape. Trimming the ENDS is what the server
   * does; collapsing the middle is what it deliberately does not. */
  it("treats a changed line break as a change", () => {
    expect(changedHeadFields(head({ billedTo: "Vessel Vanguard Bonita Springs, FL" }), head()))
      .toEqual(["billedTo"])
  })
})

describe("headPatch", () => {
  it("sends only the named fields, trimmed", () => {
    expect(headPatch(head({ notes: "  Thanks!  ", payTo: "  Me  " }), ["notes"])).toEqual({
      notes: "Thanks!",
    })
  })

  /* Clearing an optional field is how it is unset: `invoices.update` turns ""
   * into an absent column rather than storing a second spelling of "not set". */
  it("sends an emptied optional field as an empty string", () => {
    expect(headPatch(head({ purchaseOrder: "" }), ["purchaseOrder"])).toEqual({
      purchaseOrder: "",
    })
  })

  it("leaves the instants alone", () => {
    expect(headPatch(head(), ["issuedAt", "dueAt"])).toEqual({
      issuedAt: NOW,
      dueAt: NOW + 30 * 24 * 3_600_000,
    })
  })
})

describe("refusedHeadField", () => {
  /* Read from `meta.field`, never from the sentence. Matching on the prose
   * would work today and break silently the first time somebody improved the
   * wording — the refusal would simply stop appearing beside its field. */
  it("reads the field out of the error's meta", () => {
    expect(
      refusedHeadField({
        data: { code: "TOO_LONG", message: "Keep the pay-to block under 601 characters.", meta: { field: "payTo" } },
      })
    ).toBe("payTo")
  })

  it("answers null for anything it does not recognise", () => {
    expect(refusedHeadField(new Error("network"))).toBeNull()
    expect(refusedHeadField({ data: { code: "TOO_LONG", message: "x" } })).toBeNull()
    expect(
      refusedHeadField({ data: { code: "TOO_LONG", message: "x", meta: { field: "userId" } } })
    ).toBeNull()
  })
})

/*
 * THE LIVE QUERY. Convex pushes; the stored document can change while somebody
 * is typing into it, and neither obvious answer is acceptable — see
 * `reconcileHeadForm` for the argument. What is asserted here is that both
 * halves actually happen.
 */
describe("reconcileHeadForm", () => {
  it("does nothing at all when the server has not moved", () => {
    const form = seedHeadForm(head())
    expect(reconcileHeadForm(form, head())).toBe(form)
  })

  it("adopts a field the user has not touched, silently", () => {
    const form = seedHeadForm(head())
    const next = reconcileHeadForm(form, head({ payTo: "Me\nSomewhere" }))

    expect(next.draft.payTo).toBe("Me\nSomewhere")
    expect(next.committed.payTo).toBe("Me\nSomewhere")
    expect(next.collided).toEqual([])
    expect(changedHeadFields(next.draft, next.committed)).toEqual([])
  })

  /* The one that matters: a live push must never delete what is being typed. */
  it("keeps a touched field's text and records the collision", () => {
    const typing = { ...seedHeadForm(head()), draft: head({ notes: "Bank transfer to…" }) }
    const next = reconcileHeadForm(typing, head({ notes: "Somebody else's note" }))

    expect(next.draft.notes).toBe("Bank transfer to…")
    expect(next.collided).toEqual(["notes"])
    // Dirty against what is STORED now, not against what was stored when the
    // page loaded — otherwise Save would send nothing and the collision would
    // be unresolvable.
    expect(next.committed.notes).toBe("Somebody else's note")
    expect(liveCollisions(next)).toEqual(["notes"])
  })

  /* One push can move two fields, and only the touched one is contentious. */
  it("adopts and collides in the same push", () => {
    const typing = { ...seedHeadForm(head()), draft: head({ notes: "mine" }) }
    const next = reconcileHeadForm(typing, head({ notes: "theirs", payTo: "Me" }))

    expect(next.draft).toMatchObject({ notes: "mine", payTo: "Me" })
    expect(next.collided).toEqual(["notes"])
  })

  /* Self-resolving: if what arrived happens to be what the user typed, there is
   * no disagreement left to report. */
  it("stops reporting a collision the arriving value agrees with", () => {
    const typing = { ...seedHeadForm(head()), draft: head({ notes: "same" }) }
    const next = reconcileHeadForm(typing, head({ notes: "same" }))
    expect(liveCollisions(next)).toEqual([])
  })
})

describe("commitHeadForm", () => {
  /*
   * A save is acknowledged before the subscription redelivers the row. For that
   * window the query still answers with the OLD document, so a form comparing
   * against it would call itself dirty a moment after saving — lighting Save
   * again and arming the unsaved-changes guard over an edit already written.
   */
  it("leaves the form clean before the query has caught up", () => {
    const typing = { ...seedHeadForm(head()), draft: head({ notes: "  Thanks!  " }) }
    const saved = commitHeadForm(typing, ["notes"])

    expect(changedHeadFields(saved.draft, saved.committed)).toEqual([])
    // And when the push finally arrives carrying what was written, the field
    // counts as untouched — the draft only differs by whitespace the server
    // dropped — so it is adopted rather than reported as somebody else's edit.
    // The box quietly loses the spaces it was never going to keep.
    const settled = reconcileHeadForm(saved, head({ notes: "Thanks!" }))
    expect(settled.draft.notes).toBe("Thanks!")
    expect(settled.collided).toEqual([])
  })

  it("settles a collision on the field it just wrote over", () => {
    const collided = {
      ...seedHeadForm(head()),
      draft: head({ notes: "mine" }),
      collided: ["notes" as const],
    }
    expect(commitHeadForm(collided, ["notes"]).collided).toEqual([])
  })
})

describe("nameFields", () => {
  /* Named, not counted: "3 fields have unsaved changes" tells somebody deciding
   * whether to discard them nothing they can decide on. */
  it("writes a list a sentence can contain", () => {
    expect(nameFields([])).toBe("")
    expect(nameFields(["notes"])).toBe("Notes")
    expect(nameFields(["billedTo", "notes"])).toBe("Billed to and Notes")
    expect(nameFields(["issuedAt", "billedTo", "notes"])).toBe(
      "Invoice date, Billed to and Notes"
    )
  })
})
