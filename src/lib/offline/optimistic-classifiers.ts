import { optimisticIdFor } from "@/lib/optimistic-id"
import { DEFAULT_PROJECT_COLOR } from "@shared/palette"
import { api } from "../../../convex/_generated/api"
import type { OptimisticLocalStore } from "convex/browser"
import type { Doc, Id } from "../../../convex/_generated/dataModel"

type Project = Doc<"projects">
type Tag = Doc<"tags">

const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name)

/** The tag placeholder is keyed by the normalised name, because `ensure` is
 *  get-or-create by name and two ensures of "ops" must mint ONE placeholder. */
export function tagPlaceholder(name: string): string {
  return optimisticIdFor(`tag:${name.trim().toLowerCase()}`)
}

export function optimisticProjectCreate(
  store: OptimisticLocalStore,
  args: { clientKey: string; name: string; color?: string; billableByDefault?: boolean; hourlyRateCents?: number }
): void {
  const list = store.getQuery(api.projects.list, {})
  if (list === undefined) return
  const _id = optimisticIdFor(args.clientKey) as unknown as Id<"projects">
  if (list.some((p) => p._id === _id)) return
  const now = Date.now()
  const row: Project = {
    _id,
    _creationTime: now,
    userId: "",
    clientKey: args.clientKey,
    name: args.name.trim(),
    color: args.color ?? DEFAULT_PROJECT_COLOR,
    archived: false,
    billableByDefault: args.billableByDefault ?? false,
    hourlyRateCents: args.hourlyRateCents,
    updatedAt: now,
    deletedAt: null,
  }
  store.setQuery(api.projects.list, {}, [...list, row].sort(byName))
}

/** Undoes `optimisticProjectCreate`'s placeholder, for a create op `drop`
 *  has decided will now never be sent. Filtering the list is enough — there
 *  is no running slot or paginated cache to also touch, unlike an entry. */
export function unmintProjectCreate(
  store: OptimisticLocalStore,
  args: { clientKey: string }
): void {
  const list = store.getQuery(api.projects.list, {})
  if (list === undefined) return
  const _id = optimisticIdFor(args.clientKey) as unknown as Id<"projects">
  store.setQuery(api.projects.list, {}, list.filter((p) => p._id !== _id))
}

export function optimisticProjectUpdate(
  store: OptimisticLocalStore,
  args: { projectId: Id<"projects">; name?: string; color?: string; billableByDefault?: boolean; hourlyRateCents?: number | null }
): void {
  const list = store.getQuery(api.projects.list, {})
  if (list === undefined) return
  store.setQuery(
    api.projects.list,
    {},
    list
      .map((p) =>
        p._id !== args.projectId
          ? p
          : {
              ...p,
              ...(args.name !== undefined ? { name: args.name.trim() } : {}),
              ...(args.color !== undefined ? { color: args.color } : {}),
              ...(args.billableByDefault !== undefined ? { billableByDefault: args.billableByDefault } : {}),
              ...(args.hourlyRateCents !== undefined
                ? { hourlyRateCents: args.hourlyRateCents ?? undefined }
                : {}),
            }
      )
      .sort(byName)
  )
}

export function optimisticProjectSetArchived(
  store: OptimisticLocalStore,
  args: { projectId: Id<"projects">; archived: boolean }
): void {
  const list = store.getQuery(api.projects.list, {})
  if (list === undefined) return
  store.setQuery(
    api.projects.list,
    {},
    list.map((p) => (p._id === args.projectId ? { ...p, archived: args.archived } : p))
  )
}

export function optimisticProjectRemove(
  store: OptimisticLocalStore,
  args: { projectId: Id<"projects"> }
): void {
  const list = store.getQuery(api.projects.list, {})
  if (list === undefined) return
  store.setQuery(api.projects.list, {}, list.filter((p) => p._id !== args.projectId))
}

export function optimisticTagEnsure(store: OptimisticLocalStore, args: { name: string }): void {
  const list = store.getQuery(api.tags.list, {})
  if (list === undefined) return
  const clean = args.name.trim()
  if (list.some((t) => t.name.toLowerCase() === clean.toLowerCase())) return
  const now = Date.now()
  const row: Tag = {
    _id: tagPlaceholder(clean) as unknown as Id<"tags">,
    _creationTime: now,
    userId: "",
    name: clean,
    updatedAt: now,
    deletedAt: null,
  }
  store.setQuery(api.tags.list, {}, [...list, row].sort(byName))
}

/** Undoes `optimisticTagEnsure`'s placeholder, for the same reason
 *  `unmintProjectCreate` undoes `optimisticProjectCreate`'s — see there. */
export function unmintTagEnsure(store: OptimisticLocalStore, args: { name: string }): void {
  const list = store.getQuery(api.tags.list, {})
  if (list === undefined) return
  const _id = tagPlaceholder(args.name) as unknown as Id<"tags">
  store.setQuery(api.tags.list, {}, list.filter((t) => t._id !== _id))
}

export function optimisticTagRename(
  store: OptimisticLocalStore,
  args: { tagId: Id<"tags">; name: string }
): void {
  const list = store.getQuery(api.tags.list, {})
  if (list === undefined) return
  store.setQuery(
    api.tags.list,
    {},
    list.map((t) => (t._id === args.tagId ? { ...t, name: args.name.trim() } : t)).sort(byName)
  )
}

export function optimisticTagRemove(store: OptimisticLocalStore, args: { tagId: Id<"tags"> }): void {
  const list = store.getQuery(api.tags.list, {})
  if (list === undefined) return
  store.setQuery(api.tags.list, {}, list.filter((t) => t._id !== args.tagId))
}
