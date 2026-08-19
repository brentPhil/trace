import { describe, expect, it } from "vitest"
import { withInheritedBillable } from "@/lib/inherit-billable"
import type { Id } from "../../convex/_generated/dataModel"

const PROJECT_ID = "p_1" as Id<"projects">
const billableProject = { billableByDefault: true }
const ordinaryProject = { billableByDefault: false }

describe("withInheritedBillable", () => {
  it("ticks billable when a billable-by-default project is assigned", () => {
    expect(
      withInheritedBillable({ projectId: PROJECT_ID }, false, billableProject)
    ).toEqual({ projectId: PROJECT_ID, billable: true })
  })

  it("leaves the change alone for a project without the default", () => {
    expect(
      withInheritedBillable({ projectId: PROJECT_ID }, false, ordinaryProject)
    ).toEqual({ projectId: PROJECT_ID })
  })

  it("never demotes: an already-billable entry keeps its tick", () => {
    // Switching a billable entry to ANY project — billable or not — leaves the
    // flag untouched. A demotion would silently reverse a billing decision,
    // which is the exact thing the server's no-derivation rule protects.
    expect(
      withInheritedBillable({ projectId: PROJECT_ID }, true, ordinaryProject)
    ).toEqual({ projectId: PROJECT_ID })
    expect(
      withInheritedBillable({ projectId: PROJECT_ID }, true, billableProject)
    ).toEqual({ projectId: PROJECT_ID })
  })

  it("lets an explicit billable in the same change win", () => {
    // The user just said the word; the project's default may not talk over
    // them, in either direction.
    expect(
      withInheritedBillable(
        { projectId: PROJECT_ID, billable: false },
        false,
        billableProject
      )
    ).toEqual({ projectId: PROJECT_ID, billable: false })
  })

  it("does nothing when the project is cleared", () => {
    expect(withInheritedBillable({ projectId: null }, false, null)).toEqual({
      projectId: null,
    })
  })

  it("does nothing when the change carries no project at all", () => {
    expect(withInheritedBillable({ tagIds: [] }, false, undefined)).toEqual({
      tagIds: [],
    })
  })

  it("survives a project the client cannot resolve", () => {
    // A stale cache can briefly hold an id the projects list no longer has.
    expect(withInheritedBillable({ projectId: PROJECT_ID }, false, undefined)).toEqual({
      projectId: PROJECT_ID,
    })
  })
})
