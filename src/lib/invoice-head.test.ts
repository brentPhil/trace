import { describe, expect, it } from "vitest"
import {
  changedHeadFields,
  commitHeadForm,
  editHeadForm,
  headOf,
  headPatch,
  liveCollisions,
  nameFields,
  reconcileHeadForm,
  refusedHeadField,
  seedHeadForm,
  takeNewerHeadForm,
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

/*
 * THE ONE BUTTON ON THIS PAGE THAT DISCARDS, and the reason it is a named
 * function rather than three lines inside a `<Button onClick>`.
 *
 * Written inline it was `draft = committed`, which reverts the whole head while
 * the sentence beside it names only the collided fields. Nothing on screen says
 * a word about the difference, the form goes clean so the unsaved-changes guard
 * stays quiet too, and there is no undo. That is a silent loss of typed work on
 * the page whose entire premise is that typed work can be lost.
 */
describe("takeNewerHeadForm", () => {
  /* THE TRACE. Two fields edited, ONE of them moved by another device — so the
   * banner names one, and exactly one may be reverted. */
  it("takes the server's value for the collided field and leaves the other edit alone", () => {
    const stored = head({ billedTo: "V", notes: "N" })
    const typing = {
      ...seedHeadForm(stored),
      draft: head({ billedTo: "MINE-B", notes: "MINE-N" }),
    }

    // Another device changed only `billedTo`.
    const collided = reconcileHeadForm(typing, head({ billedTo: "THEIRS-B", notes: "N" }))
    expect(collided.collided).toEqual(["billedTo"])

    const taken = takeNewerHeadForm(collided)

    expect(taken.draft.billedTo).toBe("THEIRS-B")
    // The edit nobody warned about, and nobody asked to drop.
    expect(taken.draft.notes).toBe("MINE-N")
    // Still dirty on Notes, so Save can still write it and the guard still
    // fires on the way out — the two things a whole-head revert also took away.
    expect(changedHeadFields(taken.draft, taken.committed)).toEqual(["notes"])
    expect(taken.collided).toEqual([])
  })

  it("clears the banner it answers", () => {
    const typing = { ...seedHeadForm(head()), draft: head({ notes: "mine" }) }
    const collided = reconcileHeadForm(typing, head({ notes: "theirs" }))

    const taken = takeNewerHeadForm(collided)
    expect(taken.draft.notes).toBe("theirs")
    expect(liveCollisions(taken)).toEqual([])
    expect(changedHeadFields(taken.draft, taken.committed)).toEqual([])
  })
})

/*
 * A SETTLED COLLISION MUST NOT COME BACK. `collided` records what the server
 * did, and only a commit or the banner's own button used to clear it — so a
 * field that collided, was typed back into agreement, and was then edited again
 * raised the banner a second time with nothing having arrived in between. A
 * warning that reappears for no reason is the one people learn to click past.
 */
describe("editHeadForm", () => {
  it("does not re-raise a collision the user already settled by typing", () => {
    const typing = { ...seedHeadForm(head()), draft: head({ notes: "mine" }) }
    const collided = reconcileHeadForm(typing, head({ notes: "theirs" }))
    expect(liveCollisions(collided)).toEqual(["notes"])

    // Typed into agreement with what arrived: nothing left to warn about.
    const settled = editHeadForm(collided, { notes: "theirs" })
    expect(settled.collided).toEqual([])

    // And editing on from there is an ordinary unsaved change, not a collision.
    const again = editHeadForm(settled, { notes: "theirs, plus a line" })
    expect(liveCollisions(again)).toEqual([])
    expect(changedHeadFields(again.draft, again.committed)).toEqual(["notes"])
  })

  /* An edit ELSEWHERE settles nothing. The collided field still disagrees, and
   * dropping it because some other box was typed into would silence a warning
   * the user never answered. */
  it("keeps a live collision while a different field is typed into", () => {
    const typing = { ...seedHeadForm(head()), draft: head({ notes: "mine" }) }
    const collided = reconcileHeadForm(typing, head({ notes: "theirs" }))

    expect(editHeadForm(collided, { payTo: "Me" }).collided).toEqual(["notes"])
  })

  it("applies the patch and leaves the rest of the draft alone", () => {
    const form = seedHeadForm(head())
    const edited = editHeadForm(form, { notes: "Thanks!" })

    expect(edited.draft.notes).toBe("Thanks!")
    expect(edited.draft.billedTo).toBe(form.draft.billedTo)
    expect(edited.committed).toBe(form.committed)
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
