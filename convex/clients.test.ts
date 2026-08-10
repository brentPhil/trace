/// <reference types="vite/client" />
// Clients: who an invoice is billed to.
import { convexTest } from "convex-test"
import { describe, expect, it } from "vitest"
import schema from "./schema"
import { api, internal } from "./_generated/api"
import { traceErrorCode } from "./lib/codes"

const modules = import.meta.glob("./**/*.*s")

const setup = () => convexTest(schema, modules)

const ALICE = "user_alice"
const BOB = "user_bob"

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise
  } catch (error) {
    expect(traceErrorCode(error) ?? String(error)).toBe(code)
    return
  }
  throw new Error(`expected rejection with code ${code}, but it resolved`)
}

describe("clients", () => {
  it("rejects anonymous callers on every public function", async () => {
    const t = setup()
    // A REAL id belonging to a real user. A made-up string fails argument
    // validation before the handler runs, so the call never reaches the auth
    // check and the test would pass without proving anything about it.
    const { clientId } = await t.mutation(internal.clients.createAs, {
      userId: ALICE, name: "Acme", address: "",
    })

    // Named "every", and it means every. An earlier version of this test
    // covered two of them, which read as a complete sweep to anyone auditing
    // coverage by test name — the most expensive kind of gap, because it looks
    // closed.
    await expectCode(t.query(api.clients.list, {}), "UNAUTHENTICATED")
    await expectCode(
      t.mutation(api.clients.create, { name: "Acme", address: "" }),
      "UNAUTHENTICATED"
    )
    await expectCode(
      t.mutation(api.clients.update, { clientId, name: "Stolen" }),
      "UNAUTHENTICATED"
    )
    await expectCode(
      t.mutation(api.clients.setArchived, { clientId, archived: true }),
      "UNAUTHENTICATED"
    )
  })

  it("never returns another user's clients", async () => {
    const t = setup()
    await t.mutation(internal.clients.createAs, { userId: BOB, name: "Bob Co", address: "" })
    expect(await t.query(internal.clients.listAs, { userId: ALICE })).toEqual([])
  })

  it("refuses an empty name, because an invoice billed to nobody is not a document", async () => {
    const t = setup()
    await expectCode(
      t.mutation(internal.clients.createAs, { userId: ALICE, name: "  ", address: "" }),
      "TOO_LONG"
    )
  })

  /*
   * The address is a free-text block rendered verbatim on the document, so its
   * newlines are load-bearing — a normaliser that collapsed them would print a
   * three-line address on one line.
   */
  it("preserves the newlines in an address block", async () => {
    const t = setup()
    const address = "Vessel Vanguard LLC\nBonita Springs, FL\n34134, USA"
    const { clientId } = await t.mutation(internal.clients.createAs, {
      userId: ALICE, name: "Vessel Vanguard", address,
    })
    const found = (await t.query(internal.clients.listAs, { userId: ALICE })).find(
      (c) => c._id === clientId
    )
    expect(found?.address).toBe(address)
  })

  it("archives rather than deletes, so last year's invoices still render", async () => {
    const t = setup()
    const { clientId } = await t.mutation(internal.clients.createAs, {
      userId: ALICE, name: "Acme", address: "",
    })
    await t.mutation(internal.clients.setArchivedAs, { userId: ALICE, clientId, archived: true })
    const all = await t.query(internal.clients.listAs, { userId: ALICE })
    expect(all.find((c) => c._id === clientId)?.archived).toBe(true)
  })

  it("refuses to load a client belonging to someone else", async () => {
    const t = setup()
    const { clientId } = await t.mutation(internal.clients.createAs, {
      userId: BOB, name: "Bob Co", address: "",
    })
    await expectCode(
      t.mutation(internal.clients.updateAs, { userId: ALICE, clientId, name: "Stolen" }),
      "NOT_FOUND"
    )
  })
})
