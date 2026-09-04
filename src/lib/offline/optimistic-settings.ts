import { api } from "../../../convex/_generated/api"
import type { OptimisticLocalStore } from "convex/browser"
import type { FunctionArgs } from "convex/server"

type UpdateArgs = FunctionArgs<typeof api.settings.update>

export function optimisticSettingsUpdate(store: OptimisticLocalStore, args: UpdateArgs): void {
  const current = store.getQuery(api.settings.get, {})
  if (current === undefined) return
  const next: Record<string, unknown> = { ...current }
  for (const [key, value] of Object.entries(args) as Array<[string, unknown]>) {
    if (value === undefined) continue
    // `null` means clear — the three-state shape `settings.update` documents.
    if (value === null) delete next[key]
    else next[key] = value
  }
  store.setQuery(api.settings.get, {}, next as typeof current)
}
