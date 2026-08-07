import { useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useSuspenseQuery } from "@tanstack/react-query"
import { convexQuery } from "@convex-dev/react-query"
import { Archive, ArchiveRestore, Plus, Trash2 } from "lucide-react"
import { AppHeader } from "@/components/app-header"
import { InlineEdit } from "@/components/entries/inline-edit"
import { Button } from "@/components/ui/button"
import { Toast } from "@/components/ui/toast"
import { useClassifierMutations } from "@/hooks/use-classifiers"
import { errorMessage } from "@/lib/error-message"
import { cn } from "@/lib/utils"
import { PROJECT_COLORS } from "@shared/palette"
import { api } from "../../../convex/_generated/api"
import type { Doc } from "../../../convex/_generated/dataModel"

export const Route = createFileRoute("/_authed/projects")({
  head: () => ({ meta: [{ title: "Projects â€” Trace" }] }),
  component: Projects,
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(convexQuery(api.projects.list, {})),
      context.queryClient.ensureQueryData(convexQuery(api.tags.list, {})),
      context.queryClient.ensureQueryData(
        convexQuery(api.auth.getAuthenticatedUser, {})
      ),
    ])
  },
})

function Projects() {
  const { data: user } = useSuspenseQuery(
    convexQuery(api.auth.getAuthenticatedUser, {})
  )
  const { data: projects } = useSuspenseQuery(convexQuery(api.projects.list, {}))
  const { data: tags } = useSuspenseQuery(convexQuery(api.tags.list, {}))

  const live = projects.filter((p) => !p.archived)
  const archived = projects.filter((p) => p.archived)

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-4xl flex-col">
      <AppHeader email={user.email} />

      <main className="flex flex-1 flex-col gap-10 px-4 py-6">
        <section className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between gap-3">
            <h1 className="text-sm font-semibold">Projects</h1>
            <NewProject />
          </div>
          {live.length === 0 ? (
            <Empty>
              No projects yet. A project is who the work is for â€” a client, or a
              product. You can also make one straight from the timer bar.
            </Empty>
          ) : (
            <ul className="flex flex-col rounded-md border border-edge-soft">
              {live.map((project) => (
                <ProjectRow key={project._id} project={project} />
              ))}
            </ul>
          )}
        </section>

        {archived.length === 0 ? null : (
          <section className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <h2 className="text-sm font-semibold">Archived</h2>
              <p className="max-w-prose text-xs text-muted-foreground">
                Not offered for new work. Their entries keep every hour and still
                show the project&apos;s name, which is why archiving is the answer
                for a finished client rather than deleting.
              </p>
            </div>
            <ul className="flex flex-col rounded-md border border-edge-soft">
              {archived.map((project) => (
                <ProjectRow key={project._id} project={project} />
              ))}
            </ul>
          </section>
        )}

        <section className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="text-sm font-semibold">Tags</h2>
            <p className="max-w-prose text-xs text-muted-foreground">
              Flat by design. Tags cut across projects â€” â€œdeep-workâ€, â€œmeetingâ€,
              â€œreworkâ€ â€” which is the one thing a project cannot tell you.
            </p>
          </div>
          {tags.length === 0 ? (
            <Empty>
              No tags yet. Type <Kbd>#</Kbd> in the timer bar to make one.
            </Empty>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {tags.map((tag) => (
                <TagRow key={tag._id} tag={tag} />
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  )
}

// ---------------------------------------------------------------------------

function ProjectRow({ project }: { project: Doc<"projects"> }) {
  const { updateProject, setArchived, removeProject } = useClassifierMutations()
  const toasts = Toast.useToastManager()

  const report = (thrown: unknown) => {
    // IN_USE lands here: "3 entries use this project. Archive it instead."
    // The message already says what to do, so the toast is the whole response.
    toasts.add({ title: errorMessage(thrown), priority: "high", timeout: 8_000 })
  }

  return (
    <li
      className={cn(
        "group flex items-center gap-3 px-3 py-2",
        "border-b border-edge-soft last:border-b-0"
      )}
    >
      <ColorPicker
        project={project}
        onPick={(color) => {
          void updateProject({ projectId: project._id, color }).catch(report)
        }}
      />

      <InlineEdit<string>
        display={<span className="block truncate text-sm">{project.name}</span>}
        initialInput={project.name}
        ariaLabel={`Project name: ${project.name}`}
        className="-mx-1 min-w-0 flex-1 px-1 py-0.5 text-sm"
        grow
        parse={(raw) =>
          raw.trim() === ""
            ? { ok: false, message: "A project needs a name." }
            : { ok: true, value: raw }
        }
        onCommit={async (name) => {
          await updateProject({ projectId: project._id, name })
        }}
      />

      {/*
        Billable-by-default is a checkbox rather than a toggle icon, because
        unlike the per-entry control this one is a SETTING and needs its own
        label. It applies at creation only â€” changing it never rewrites work
        that has already been recorded, let alone invoiced.
      */}
      <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={project.billableByDefault}
          onChange={(event) => {
            void updateProject({
              projectId: project._id,
              billableByDefault: event.target.checked,
            }).catch(report)
          }}
          className="size-3.5 accent-[var(--brass)]"
        />
        <span className="hidden sm:inline">Billable by default</span>
        <span className="sm:hidden">$</span>
      </label>

      <div className="flex shrink-0 items-center gap-0.5">
        <IconButton
          label={project.archived ? `Unarchive ${project.name}` : `Archive ${project.name}`}
          onClick={() => {
            void setArchived(project._id, !project.archived).catch(report)
          }}
        >
          {project.archived ? (
            <ArchiveRestore className="size-4" />
          ) : (
            <Archive className="size-4" />
          )}
        </IconButton>
        <IconButton
          label={`Delete ${project.name}`}
          destructive
          onClick={() => {
            void removeProject(project._id).catch(report)
          }}
        >
          <Trash2 className="size-4" />
        </IconButton>
      </div>
    </li>
  )
}

/**
 * Twelve swatches, no free-form colour.
 *
 * A hex field lands arbitrary values on a dark surface with no contrast check,
 * and the one thing worse than an ugly project colour is an invisible one.
 */
function ColorPicker({
  project,
  onPick,
}: {
  project: Doc<"projects">
  onPick: (color: string) => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        aria-label={`Colour for ${project.name}: ${project.color}`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        data-project-color={project.color}
        className={cn(
          "size-4 rounded-full bg-[var(--project-color)]",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        )}
      />
      {open ? (
        <>
          {/* Click-away. A plain overlay rather than a document listener, so it
              cannot leak past unmount. */}
          <div
            className="fixed inset-0 z-40"
            aria-hidden="true"
            onClick={() => setOpen(false)}
          />
          <div
            className={cn(
              "absolute top-full left-0 z-50 mt-1 grid grid-cols-6 gap-1 rounded-lg",
              "border border-edge-soft bg-surface-raised p-2 shadow-xl"
            )}
          >
            {PROJECT_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                aria-label={color}
                aria-pressed={color === project.color}
                data-project-color={color}
                onClick={() => {
                  onPick(color)
                  setOpen(false)
                }}
                className={cn(
                  "size-5 rounded-full bg-[var(--project-color)]",
                  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                  color === project.color && "ring-2 ring-foreground ring-offset-2 ring-offset-surface-raised"
                )}
              />
            ))}
          </div>
        </>
      ) : null}
    </div>
  )
}

function NewProject() {
  const { createProject } = useClassifierMutations()
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState("")
  const [error, setError] = useState<string | null>(null)

  if (!adding) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setAdding(true)}>
        <Plus className="size-4" />
        New project
      </Button>
    )
  }

  const submit = () => {
    if (name.trim() === "") {
      setAdding(false)
      return
    }
    void createProject({ name: name.trim() })
      .then(() => {
        setName("")
        setAdding(false)
        setError(null)
      })
      .catch((thrown: unknown) => setError(errorMessage(thrown)))
  }

  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <input
        autoFocus
        value={name}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault()
            setAdding(false)
            setName("")
            setError(null)
          }
        }}
        placeholder="Client or product"
        aria-label="New project name"
        aria-invalid={error !== null}
        className={cn(
          "w-48 rounded-md border bg-ground px-2 py-1 text-sm",
          error === null ? "border-edge-soft" : "border-alarm",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        )}
      />
      <Button type="submit" size="sm">
        Add
      </Button>
      {error === null ? null : (
        <span role="alert" className="text-xs text-alarm">
          {error}
        </span>
      )}
    </form>
  )
}

// ---------------------------------------------------------------------------

function TagRow({ tag }: { tag: Doc<"tags"> }) {
  const { renameTag, removeTag } = useClassifierMutations()
  const toasts = Toast.useToastManager()

  return (
    <li className="flex items-center gap-1 rounded-md border border-edge-soft px-2 py-1">
      <InlineEdit<string>
        display={<span className="text-xs">{tag.name}</span>}
        initialInput={tag.name}
        ariaLabel={`Tag: ${tag.name}`}
        className="-mx-1 px-1 py-0.5 text-xs"
        inputClassName="w-32 text-xs"
        parse={(raw) =>
          raw.trim() === ""
            ? { ok: false, message: "A tag needs a name." }
            : { ok: true, value: raw }
        }
        onCommit={async (name) => {
          await renameTag(tag._id, name)
        }}
      />
      <button
        type="button"
        aria-label={`Delete tag ${tag.name}`}
        onClick={() => {
          void removeTag(tag._id).catch((thrown: unknown) => {
            toasts.add({ title: errorMessage(thrown), priority: "high", timeout: 8_000 })
          })
        }}
        className={cn(
          "rounded-sm p-0.5 text-muted-foreground transition-colors hover:text-alarm",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        )}
      >
        <Trash2 className="size-3" />
      </button>
    </li>
  )
}

// ---------------------------------------------------------------------------

function IconButton({
  label,
  onClick,
  destructive = false,
  children,
}: {
  label: string
  onClick: () => void
  destructive?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn(
        "rounded-md p-1.5 text-muted-foreground transition-colors",
        "opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100",
        "focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring",
        "focus-visible:outline-none motion-reduce:transition-none",
        destructive ? "hover:text-alarm" : "hover:text-foreground"
      )}
    >
      {children}
    </button>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="max-w-prose rounded-md border border-dashed border-edge-soft px-3 py-4 text-sm text-muted-foreground">
      {children}
    </p>
  )
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-edge-soft px-1 py-px font-mono text-[0.7rem]">
      {children}
    </kbd>
  )
}


