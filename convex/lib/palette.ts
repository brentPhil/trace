/**
 * The project palette.
 *
 * A fixed set of twelve keys rather than free-form colour, for three reasons:
 *
 *   Legibility is guaranteed. A user-chosen hex lands on a dark surface with no
 *   contrast check, and the one thing worse than an ugly project colour is an
 *   invisible one.
 *
 *   Colour is never the sole carrier of meaning (DESIGN.md). Every place a
 *   swatch appears, the project's NAME appears with it. The swatch is a
 *   fast-recognition aid for people who can see it, not the information.
 *
 *   Twelve is enough to tell a freelancer's client list apart and few enough
 *   that two projects rarely collide. Toggl offers a picker with hundreds of
 *   values, which produces palettes nobody chose.
 *
 * The two reserved hues are deliberately absent:
 *
 *   `--enlarger` (cold blue) means RUNNING and nothing else — The Cold Light
 *   Rule. A project tinted the same blue would read as a running timer.
 *
 *   `--brass` means MONEY. A project in brass would read as billable.
 *
 * Pure, and shared: the server validates against this list so a crafted
 * mutation cannot store a colour the client has no style for, which would
 * otherwise render as an unstyled swatch forever.
 */

export const PROJECT_COLORS = [
  "slate",
  "rose",
  "coral",
  "amber",
  "olive",
  "moss",
  "sage",
  "teal",
  "cyan",
  "indigo",
  "violet",
  "plum",
] as const

export type ProjectColor = (typeof PROJECT_COLORS)[number]

export const DEFAULT_PROJECT_COLOR: ProjectColor = "slate"

export function isProjectColor(value: string): value is ProjectColor {
  return (PROJECT_COLORS as ReadonlyArray<string>).includes(value)
}

/**
 * Picks the next colour for a new project, given the ones already in use.
 *
 * Least-used wins, ties broken by palette order, so the first twelve projects
 * a user creates are all different without them having to choose. Choosing is
 * still offered; this is only what happens when they do not.
 */
export function suggestProjectColor(used: ReadonlyArray<string>): ProjectColor {
  const counts = new Map<ProjectColor, number>()
  for (const color of PROJECT_COLORS) counts.set(color, 0)
  for (const color of used) {
    if (isProjectColor(color)) counts.set(color, (counts.get(color) ?? 0) + 1)
  }

  let best: ProjectColor = PROJECT_COLORS[0]
  let bestCount = Number.POSITIVE_INFINITY
  for (const color of PROJECT_COLORS) {
    const count = counts.get(color) ?? 0
    if (count < bestCount) {
      best = color
      bestCount = count
    }
  }
  return best
}
