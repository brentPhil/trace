import { useState } from "react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Button, buttonVariants } from "@/components/ui/button"
import { DollarSign, FolderClosed, Tag } from "lucide-react"
import { PickerList } from "@/components/classifiers/picker-list"
import { ProjectDot } from "@/components/classifiers/project-dot"
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

/* `buttonVariants`, not a `<Button>`: two of the three controls wearing this
 * are `PopoverTrigger`s, which bring their own element and take a className.
 * `text-[length:inherit]` because a classifier sits inline in a row that has
 * already chosen a size — the base variant's `text-sm` would override it. */
const triggerClass = cn(
  buttonVariants({ variant: "ghost", size: "row-trigger" }),
  "rounded-md px-2 py-0 text-[length:inherit]"
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

  /*
   * Open state is held here even when the caller controls it.
   *
   * The timer bar drives `open` (so typing `@` can raise the picker), but the
   * entry row uses this uncontrolled — and there, `onOpenChange?.(false)` was a
   * no-op, so picking a project left the popover sitting open over the row it
   * had just changed. Tracking both means one code path closes it either way.
   */
  const [selfOpen, setSelfOpen] = useState(false)
  const isOpen = open ?? selfOpen

  const setOpen = (next: boolean) => {
    setSelfOpen(next)
    onOpenChange?.(next)
    if (!next) setQuery("")
  }

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

  const close = () => setOpen(false)

  return (
    <Popover open={isOpen} onOpenChange={setOpen}>
      <PopoverTrigger
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
            className="max-w-36"
            nameClassName={nameClassName}
          />
        )}
      </PopoverTrigger>

      <PopoverContent>
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
            // `onCreate` is `createProject`, optimistic by construction now —
            // it resolves as soon as the outbox journals the write, so a
            // refusal is the outbox's own `dropped` event to report, not
            // this picker's.
            void onCreate(name).then((result) => {
              onChange(result.projectId)
              close()
            })
          }}
          footer={
            value === null ? undefined : (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  onChange(null)
                  close()
                }}
                className="w-full justify-start px-2 font-normal hover:bg-card"
              >
                Clear project
              </Button>
            )
          }
        />
      </PopoverContent>
    </Popover>
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

  // Same controlled/uncontrolled handling as ProjectPicker. Tags differ in one
  // respect only: choosing does NOT close, because picking three tags should
  // not mean opening the same menu three times.
  const [selfOpen, setSelfOpen] = useState(false)
  const isOpen = open ?? selfOpen

  const setOpen = (next: boolean) => {
    setSelfOpen(next)
    onOpenChange?.(next)
    if (!next) setQuery("")
  }

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
    <Popover open={isOpen} onOpenChange={setOpen}>
      <PopoverTrigger
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
            <span className="text-xs font-mono tabular-nums tracking-[-0.02em]">{value.length}</span>
          ) : null}
        </span>
      </PopoverTrigger>

      <PopoverContent>
        <PickerList
          options={options}
          query={query}
          onQueryChange={setQuery}
          placeholder="Search or add tags"
          emptyLabel="No tags yet."
          onChoose={toggle}
          createLabel={(name) => `Add tag “${name}”`}
          onCreate={(name) => {
            // `onCreate` is `ensureTag`, optimistic by construction now — it
            // resolves as soon as the outbox journals the write, so a
            // refusal is the outbox's own `dropped` event to report.
            void onCreate(name).then((result) => {
              if (!selectedSet.has(result.tagId)) {
                onChange([...value, result.tagId])
              }
              setQuery("")
            })
          }}
        />
      </PopoverContent>
    </Popover>
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
    <Button
      type="button"
      variant="ghost"
      size="row-trigger"
      aria-pressed={value}
      aria-label={value ? "Billable" : "Not billable"}
      onClick={() => onChange(!value)}
      className={cn(
        "rounded-md px-2 py-0 text-[length:inherit]",
        value && "text-foreground",
        className
      )}
    >
      <DollarSign className="size-4" />
    </Button>
  )
}
