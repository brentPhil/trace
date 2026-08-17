import { v } from "convex/values"
import {
  clientFields,
  googleCalendarFields,
  googleConnectionFields,
  googleEventFields,
  googleEventTrackingFields,
  invoiceFields,
  invoiceLineFields,
  projectFields,
  tagFields,
  timeEntryFields,
} from "../schema"

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

export const clientDoc = v.object({
  _id: v.id("clients"),
  _creationTime: v.number(),
  ...clientFields,
})

export const invoiceDoc = v.object({
  _id: v.id("invoices"),
  _creationTime: v.number(),
  ...invoiceFields,
})

export const invoiceLineDoc = v.object({
  _id: v.id("invoiceLines"),
  _creationTime: v.number(),
  ...invoiceLineFields,
})

export const googleConnectionDoc = v.object({
  _id: v.id("googleConnections"),
  _creationTime: v.number(),
  ...googleConnectionFields,
})

export const googleCalendarDoc = v.object({
  _id: v.id("googleCalendars"),
  _creationTime: v.number(),
  ...googleCalendarFields,
})

export const googleEventDoc = v.object({
  _id: v.id("googleEvents"),
  _creationTime: v.number(),
  ...googleEventFields,
})

export const googleEventTrackingDoc = v.object({
  _id: v.id("googleEventTracking"),
  _creationTime: v.number(),
  ...googleEventTrackingFields,
})
