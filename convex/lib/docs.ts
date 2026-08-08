import { v } from "convex/values"
import { projectFields, tagFields, timeEntryFields } from "../schema"

/**
 * `returns` validators for the public queries that hand back whole documents.
 *
 * Spread from the schema's own field definitions rather than written out again,
 * because the failure mode of a hand-copied return validator is the worst kind:
 * it drifts the moment a column is added, and then rejects documents that are
 * perfectly correct — at runtime, in production, on a read path, for every user
 * at once. Spread from the source, adding a column cannot break the read.
 *
 * `_id` and `_creationTime` are added here because Convex stamps them on every
 * document and they are not part of a table definition.
 */

export const timeEntryDoc = v.object({
  _id: v.id("timeEntries"),
  _creationTime: v.number(),
  ...timeEntryFields,
})

export const projectDoc = v.object({
  _id: v.id("projects"),
  _creationTime: v.number(),
  ...projectFields,
})

export const tagDoc = v.object({
  _id: v.id("tags"),
  _creationTime: v.number(),
  ...tagFields,
})
