import { useCallback, useMemo } from "react"
import { convexQuery, useConvexMutation } from "@convex-dev/react-query"
import { useSuspenseQuery } from "@tanstack/react-query"
import { useLatest } from "@/hooks/use-latest"
import { api } from "../../convex/_generated/api"
import type { Doc, Id } from "../../convex/_generated/dataModel"

/**
 * Projects and tags, read once and shared.
 *
 * Both lists are small, bounded by how many clients a freelancer has, and are
 * needed by the timer bar, every row in the log, and the Reports filters.
 * A single reactive query per list is cheaper and — more importantly —
 * cannot disagree with itself across those surfaces.
 */
export function useClassifiers() {
  const { data: projects } = useSuspenseQuery(convexQuery(api.projects.list, {}))
  const { data: tags } = useSuspenseQuery(convexQuery(api.tags.list, {}))

  /*
   * Memoised for REFERENTIAL stability, not for the build cost — both lists
   * are bounded by how many clients a freelancer has, so rebuilding a Map of
   * them is genuinely nothing.
   *
   * A fresh `Map` on every render is what made every downstream `useMemo`
   * keyed on one of these miss on every render. /timer re-renders once a
   * second, so its filter pass over the whole paginated log was rebuilt per
   * tick; /reports rebuilds the same pass on every render of a page whose
   * result set is a hundred rows at a time.
   */
  const projectsById = useMemo(
    () => new Map(projects.map((p) => [p._id as string, p])),
    [projects]
  )
  const tagsById = useMemo(() => new Map(tags.map((t) => [t._id as string, t])), [tags])

  return { projects, tags, projectsById, tagsById }
}

export type ClassifierData = ReturnType<typeof useClassifiers>

/** Resolves an entry's stored ids to rows, dropping any that no longer exist. */
export function resolveClassifiers(
  entry: Pick<Doc<"timeEntries">, "projectId" | "tagIds">,
  data: Pick<ClassifierData, "projectsById" | "tagsById">
) {
  const project =
    entry.projectId === undefined ? null : (data.projectsById.get(entry.projectId) ?? null)
  const tags = entry.tagIds
    .map((id) => data.tagsById.get(id))
    .filter((tag): tag is Doc<"tags"> => tag !== undefined)
  return { project, tags }
}

export function useClassifierMutations() {
  const createProjectMutation = useLatest(useConvexMutation(api.projects.create))
  const updateProjectMutation = useLatest(useConvexMutation(api.projects.update))
  const setArchivedMutation = useLatest(useConvexMutation(api.projects.setArchived))
  const removeProjectMutation = useLatest(useConvexMutation(api.projects.remove))
  const ensureTagMutation = useLatest(useConvexMutation(api.tags.ensure))
  const renameTagMutation = useLatest(useConvexMutation(api.tags.rename))
  const removeTagMutation = useLatest(useConvexMutation(api.tags.remove))

  const createProject = useCallback(
    async (input: {
      name: string
      color?: string
      billableByDefault?: boolean
      hourlyRateCents?: number
    }) => await createProjectMutation(input),
    [createProjectMutation]
  )

  const updateProject = useCallback(
    async (input: {
      projectId: Id<"projects">
      name?: string
      color?: string
      billableByDefault?: boolean
      // `null`, not just omission, means "clear it" — see projects.update.
      hourlyRateCents?: number | null
    }) => await updateProjectMutation(input),
    [updateProjectMutation]
  )

  const setArchived = useCallback(
    async (projectId: Id<"projects">, archived: boolean) =>
      await setArchivedMutation({ projectId, archived }),
    [setArchivedMutation]
  )

  const removeProject = useCallback(
    async (projectId: Id<"projects">) => await removeProjectMutation({ projectId }),
    [removeProjectMutation]
  )

  /** Get-or-create. The picker's flow is "type a word, press Enter". */
  const ensureTag = useCallback(
    async (name: string) => await ensureTagMutation({ name }),
    [ensureTagMutation]
  )

  const renameTag = useCallback(
    async (tagId: Id<"tags">, name: string) => await renameTagMutation({ tagId, name }),
    [renameTagMutation]
  )

  const removeTag = useCallback(
    async (tagId: Id<"tags">) => await removeTagMutation({ tagId }),
    [removeTagMutation]
  )

  return {
    createProject,
    updateProject,
    setArchived,
    removeProject,
    ensureTag,
    renameTag,
    removeTag,
  }
}

