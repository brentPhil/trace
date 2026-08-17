import { projectColorVar } from "@/lib/project-color"
import { cn } from "@/lib/utils"
import type { CSSProperties } from "react"
import type { Doc } from "../../../convex/_generated/dataModel"

/**
 * A project, shown as a coloured dot and its name.
 *
 * The dot is never alone. Colour is a fast-recognition aid for the people who
 * can see it and nothing more — the NAME is the information, so removing the
 * colour must lose speed and never meaning.
 *
 * `--project-color` is set INLINE from `projectColorVar`, the same function
 * /reports' charts paint SVG with, so a project is one hue everywhere or
 * neither. It used to be thirteen `[data-project-color="…"]` rules in
 * styles.css. The attribute stays as a hook for tests and for the forced-colors
 * variant below; only the painting moved.
 */
export function ProjectDot({
  project,
  className,
  nameClassName,
  showName = true,
}: {
  project: Pick<Doc<"projects">, "name" | "color" | "archived"> | null
  className?: string
  /** Lets a caller hide the NAME responsively while keeping the dot. */
  nameClassName?: string
  showName?: boolean
}) {
  if (project === null) return null

  return (
    <span
      data-project-color={project.color}
      style={{ "--project-color": projectColorVar(project.color) } as CSSProperties}
      className={cn(
        "inline-flex min-w-0 items-center gap-1.5 text-xs",
        // The project's own hue as text, not a generic muted grey: at this size
        // a 6px dot alone is easy to miss, and the tint is what makes the name
        // scannable down a column.
        "text-[color-mix(in_oklch,var(--project-color)_82%,var(--ink))]",
        // Forced colours drop the hue entirely and the NAME carries it alone —
        // which was always the contract this component's doc comment states.
        "forced-colors:text-[currentColor]",
        className
      )}
    >
      <span
        aria-hidden="true"
        className="size-1.5 shrink-0 rounded-full bg-(--project-color) forced-colors:bg-[currentColor]"
      />
      {showName ? (
        <span className={cn("truncate", nameClassName)}>
          {project.name}
          {project.archived ? (
            // Stated in words. An archived project still names old work, and
            // the user needs to know why it is not in the picker any more.
            <span className="text-muted-foreground"> (archived)</span>
          ) : null}
        </span>
      ) : (
        <span className="sr-only">{project.name}</span>
      )}
    </span>
  )
}

/** The tag list on a row. Flat, quiet, and never a colour. */
export function TagChips({
  tags,
  className,
}: {
  tags: Array<Pick<Doc<"tags">, "_id" | "name">>
  className?: string
}) {
  if (tags.length === 0) return null

  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1", className)}>
      {tags.map((tag) => (
        <span
          key={tag._id}
          className={cn(
            "truncate rounded-sm border border-edge-soft px-1 py-px",
            "text-[0.65rem] leading-4 text-muted-foreground"
          )}
        >
          {tag.name}
        </span>
      ))}
    </span>
  )
}
