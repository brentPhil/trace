import { useState } from "react"
import { DollarSign, FolderClosed, Tag } from "lucide-react"
import { PickerList } from "@/components/classifiers/picker-list"
import { ProjectDot } from "@/components/classifiers/project-dot"
import { Popover } from "@/components/ui/popover"
import { errorMessage } from "@/lib/error-message"
import { cn } from "@/lib/utils"
import type { PickerOption } from "@/components/classifiers/picker-list"
import type { Doc, Id } from "../../../convex/_generated/dataModel"

/**
 * The classifier controls.
 *
 * Collapsed to icons because the title field is the only thing on this bar that
 * should attract the hands. A project or a tag is something you add to work
 * you have already started describing, and a control sized like the primary one
 * invites the user to classify first — which is the friction that makes people
 * stop tracking.
 *
 * Every one of these is reachable from the keyboard without the mouse, and the
 * timer bar additionally opens them by typing `@` or `#` inline.
 */

const triggerClass = cn(
  "rounded-md p-2 transition-colors",
  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
)

// ---------------------------------------------------------------------------

export function ProjectPicker({
  projects,
  value,
  onChange,
  onCreate,
  open,
  onOpenChange,
  className,
  nameClassName,
}: {
  projects: Array<Doc<"projects">>
  value: Id<"projects"> | null
  onChange: (projectId: Id<"projects"> | null) => void
  /** Passed in, not reached for — see TimerBarActions on why. */
  onCreate: (name: string) => Promise<{ projectId: Id<"projects"> }>
  open?: boolean
  onOpenChange?: (open: boolean) => void
  className?: string
  /** Hides the project NAME responsively while keeping its dot. */
  nameClassName?: string
}) {
  const [query, setQuery] = useState("")
  const [error, setError] = useState<string | null>(null)

  const selected = projects.find((p) => p._id === value) ?? null

  const options: Array<PickerOption> = projects.map((project) => ({
    id: project._id,
    label: project.name,
    selected: project._id === value,
    // Archived projects stay reachable by typing their name — a user
    // correcting an old entry needs them — but they are not offered by
    // default, which is the entire point of archiving.
    demoted: project.archived,
    render: <ProjectDot project={project} />,
  }))

  const close = () => {
    setQuery("")
    setError(null)
    onOpenChange?.(false)
  }

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setQuery("")
          setError(null)
        }
        onOpenChange?.(next)
      }}
    >
      <Popover.Trigger
        aria-label={selected === null ? "Project" : `Project: ${selected.name}`}
        className={cn(
          triggerClass,
          selected === null ? "text-muted-foreground hover:text-foreground" : "",
          className
        )}
      >
        {selected === null ? (
          <FolderClosed className="size-4" />
        ) : (
          <ProjectDot
            project={selected}
            className="max-w-[9rem]"
            nameClassName={nameClassName}
          />
        )}
      </Popover.Trigger>

      <Popover.Popup>
        <PickerList
          options={options}
          query={query}
          onQueryChange={setQuery}
          placeholder="Search projects"
          emptyLabel="No projects yet."
          onChoose={(id) => {
            onChange(id === value ? null : (id as Id<"projects">))
            close()
          }}
          createLabel={(name) => `Create project “${name}”`}
          onCreate={(name) => {
            void onCreate(name)
              .then((result) => {
                onChange(result.projectId)
                close()
              })
              .catch((thrown: unknown) => setError(errorMessage(thrown)))
          }}
          footer={
            <div className="flex flex-col gap-1">
              {error === null ? null : (
                <p role="alert" className="px-2 py-1 text-xs text-alarm">
                  {error}
                </p>
              )}
              {value === null ? null : (
                <button
                  type="button"
                  onClick={() => {
                    onChange(null)
                    close()
                  }}
                  className={cn(
                    "w-full rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground",
                    "hover:bg-surface hover:text-foreground",
                    "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  )}
                >
                  Clear project
                </button>
              )}
            </div>
          }
        />
      </Popover.Popup>
    </Popover.Root>
  )
}

// ---------------------------------------------------------------------------

export function TagPicker({
  tags,
  value,
  onChange,
  onCreate,
  open,
  onOpenChange,
  className,
}: {
  tags: Array<Doc<"tags">>
  value: Array<Id<"tags">>
  onChange: (tagIds: Array<Id<"tags">>) => void
  /** Get-or-create. Passed in, not reached for. */
  onCreate: (name: string) => Promise<{ tagId: Id<"tags"> }>
  open?: boolean
  onOpenChange?: (open: boolean) => void
  className?: string
}) {
  const [query, setQuery] = useState("")
  const [error, setError] = useState<string | null>(null)

  const selectedSet = new Set<string>(value)

  const options: Array<PickerOption> = tags.map((tag) => ({
    id: tag._id,
    label: tag.name,
    selected: selectedSet.has(tag._id),
  }))

  // Multi-select, so choosing does NOT close the popover — picking three tags
  // should not mean opening the same menu three times.
  const toggle = (id: string) => {
    const next = selectedSet.has(id)
      ? value.filter((t) => t !== id)
      : [...value, id as Id<"tags">]
    onChange(next)
  }

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setQuery("")
          setError(null)
        }
        onOpenChange?.(next)
      }}
    >
      <Popover.Trigger
        aria-label={value.length === 0 ? "Tags" : `Tags: ${value.length} selected`}
        className={cn(
          triggerClass,
          value.length === 0 ? "text-muted-foreground" : "text-foreground",
          "hover:text-foreground",
          className
        )}
      >
        <span className="flex items-center gap-1">
          <Tag className="size-4" />
          {value.length > 0 ? (
            <span className="text-xs tabular">{value.length}</span>
          ) : null}
        </span>
      </Popover.Trigger>

      <Popover.Popup>
        <PickerList
          options={options}
          query={query}
          onQueryChange={setQuery}
          placeholder="Search or add tags"
          emptyLabel="No tags yet."
          onChoose={toggle}
          createLabel={(name) => `Add tag “${name}”`}
          onCreate={(name) => {
            void onCreate(name)
              .then((result) => {
                if (!selectedSet.has(result.tagId)) {
                  onChange([...value, result.tagId])
                }
                setQuery("")
              })
              .catch((thrown: unknown) => setError(errorMessage(thrown)))
          }}
          footer={
            error === null ? undefined : (
              <p role="alert" className="px-2 py-1 text-xs text-alarm">
                {error}
              </p>
            )
          }
        />
      </Popover.Popup>
    </Popover.Root>
  )
}

// ---------------------------------------------------------------------------

/**
 * Billable.
 *
 * A toggle rather than a menu, because it has two states and lives beside two
 * controls that open panels — making it look the same would be a lie about what
 * clicking it does. Brass when on (The Two Temperatures Rule), and
 * `aria-pressed` carries the state for anyone not reading the colour.
 */
export function BillableToggle({
  value,
  onChange,
  className,
}: {
  value: boolean
  onChange: (billable: boolean) => void
  className?: string
}) {
  return (
    <button
      type="button"
      aria-pressed={value}
      aria-label={value ? "Billable" : "Not billable"}
      onClick={() => onChange(!value)}
      className={cn(
        triggerClass,
        value ? "text-brass" : "text-muted-foreground hover:text-foreground",
        className
      )}
    >
      <DollarSign className="size-4" />
    </button>
  )
}
