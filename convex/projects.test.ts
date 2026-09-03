/// <reference types="vite/client" />
// Projects: the idempotent create the offline outbox replays.
import { convexTest } from "convex-test"
import { describe, expect, it } from "vitest"
import schema from "./schema"
import { internal } from "./_generated/api"

const modules = import.meta.glob("./**/*.*s")
const setup = () => convexTest(schema, modules)

const ALICE = "user_alice"
const BOB = "user_bob"

describe("projects.create with a clientKey", () => {
  it("returns the same project when the same key is sent twice", async () => {
    const t = setup()
    const first = await t.mutation(internal.projects.createAs, {
      userId: ALICE,
      name: "Website",
      clientKey: "key-1",
    })
    const second = await t.mutation(internal.projects.createAs, {
      userId: ALICE,
      name: "Website (retry)",
      clientKey: "key-1",
    })
    expect(second.projectId).toBe(first.projectId)
    const rows = await t.query(internal.projects.listAs, { userId: ALICE })
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe("Website")
  })

  it("scopes the key to the user, so two users can share one by accident", async () => {
    const t = setup()
    const alice = await t.mutation(internal.projects.createAs, {
      userId: ALICE,
      name: "Website",
      clientKey: "shared",
    })
    const bob = await t.mutation(internal.projects.createAs, {
      userId: BOB,
      name: "Website",
      clientKey: "shared",
    })
    expect(bob.projectId).not.toBe(alice.projectId)
  })

  it("still creates without a key, as every existing caller does", async () => {
    const t = setup()
    const a = await t.mutation(internal.projects.createAs, { userId: ALICE, name: "A" })
    const b = await t.mutation(internal.projects.createAs, { userId: ALICE, name: "B" })
    expect(a.projectId).not.toBe(b.projectId)
  })
})
