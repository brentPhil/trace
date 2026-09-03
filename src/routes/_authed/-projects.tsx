/*
 * /projects — THE PAGE, NOT THE ROUTE. The route definition stays in
 * projects.tsx; the `-` prefix keeps this file out of the route tree, the same
 * convention the tests beside it already use.
 *
 * The component lives here because it has to be EXPORTED — -projects.test.tsx
 * renders it against a seeded query client — and an export of a route file is
 * something the router's code-splitter refuses to split: every page shipped in
 * the eager bundle, with a [tanstack-router] warning per route saying so.
 * Imported from a non-route file, `component:` splits as normal.
 */
import { Button } from "@/components/ui/button"
import { Empty } from "@/components/ui/empty"
import { useRef, useState } from "react"
import { useSuspenseQuery } from "@tanstack/react-query"
import { convexQuery } from "@convex-dev/react-query"
import { Archive, ArchiveRestore, Plus, Trash2 } from "lucide-react"
import { InlineEdit } from "@/components/entries/inline-edit"
import { Page } from "@/components/shell/page"
import { useClassifierMutations } from "@/hooks/use-classifiers"
import { formatRate, rateHelp } from "@/lib/format-money"
import { projectColorVar } from "@/lib/project-color"
import { cn } from "@/lib/utils"
import { PROJECT_COLORS } from "@shared/palette"
import { parseMoney } from "@shared/money"
import { api } from "../../../convex/_generated/api"
import type { CSSProperties } from "react"
import type { Doc } from "../../../convex/_generated/dataModel"

export function Projects() {
  const { data: projects } = useSuspenseQuery(convexQuery(api.projects.list, {}))
  const { data: tags } = useSuspenseQuery(convexQuery(api.tags.list, {}))
  const { data: settings } = useSuspenseQuery(convexQuery(api.settings.get, {}))

  const live = projects.filter((p) => !p.archived)
  const archived = projects.filter((p) => p.archived)

  return (
    /*
      NOT PINNED, and that is the rule rather than an omission — see `Page`.
      A header is pinned when it is a readout of, or a control over, what
      scrolls beneath it. This one is a title and a create button: "New
      project" adds a row, it does not DESCRIBE the rows, and it is reachable
      from the top of a page nobody scrolls far. The page also runs three
      sections deep — Projects, Archived, Tags — so a pinned "Projects" would
      hang over the Tags list claiming to name it, which is worse than not
      being there.

      The heading and the action move OUT of the first section and onto the
      page, where they always belonged: "Projects" was doing double duty as the
      page's `<h1>` and as the live list's section label, which is why the two
      sections beneath it are `<h2>`s of a heading that was sitting inside a
      sibling of theirs. The live list is now the page's primary content
      directly under its own `<h1>`, which is what it always was.
    */
    <Page title="Projects" actions={<NewProject currency={settings.currency} />}>
      {/*
        FULL WIDTH, like every other page.

        This was capped at `max-w-form` on the argument that it is "a
        settings-shaped list of forms, not a table" — and the argument was
        wrong about its own rows. A `ProjectRow` is a swatch, a name, a
        billable checkbox, a rate and two icons: the trailing cluster is all
        `shrink-0` and the NAME is `flex-1`, which is exactly the entry row's
        shape. So the width goes to the name, not to a gap — the 1196px hole
        the old comment described is what happens to a row whose middle is
        empty, and this row's middle is its rate.

        `pb-6` and no `pt`: the top padding is the title row's, above, which is
        the whole point of there being one place that draws it.
      */}
      <div className="flex flex-1 flex-col gap-10 px-4 pb-6">
        {/* `aria-label` rather than a heading: the live list IS the page, so its
            label is the `<h1>` above it, and a second visible "Projects" under
            the first is the double duty this page was untangled from. The
            sections below name themselves with their own `<h2>`. */}
        <section className="flex flex-col gap-3" aria-label="Projects">
          {live.length === 0 ? (
            <Empty>
              No projects yet. A project is who the work is for — a client, or a
              product. You can also make one straight from the timer bar.
            </Empty>
          ) : (
            <ProjectList>
              {live.map((project) => (
                <ProjectRow key={project._id} project={project} currency={settings.currency} />
              ))}
            </ProjectList>
          )}
        </section>

        {archived.length === 0 ? null : (
          <section className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <SectionHeading count={archived.length}>Archived</SectionHeading>
              <p className="max-w-prose text-xs text-muted-foreground">
                Not offered for new work. Their entries keep every hour and still
                show the project&apos;s name, which is why archiving is the answer
                for a finished client rather than deleting.
              </p>
            </div>
            <ProjectList>
              {archived.map((project) => (
                <ProjectRow key={project._id} project={project} currency={settings.currency} />
              ))}
            </ProjectList>
          </section>
        )}

        <section className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <SectionHeading count={tags.length}>Tags</SectionHeading>
            <p className="max-w-prose text-xs text-muted-foreground">
              Flat by design. Tags cut across projects — “deep-work”, “meeting”,
              “rework” — which is the one thing a project cannot tell you.
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
      </div>
    </Page>
  )
}

// ---------------------------------------------------------------------------

/**
 * The bordered box the rows live in, said once for both lists.
 *
 * `overflow-hidden` is the load-bearing part: the rows below fill on hover, and
 * a square fill inside a `rounded-md` border pokes out at all four corners of
 * the first and last row. Clipping the box is how the fill learns the radius
 * without every row having to know which end of the list it is on.
 */
function ProjectList({ children }: { children: React.ReactNode }) {
  return (
    <ul className="flex flex-col overflow-hidden rounded-md border border-border">
      {children}
    </ul>
  )
}

/**
 * A section heading with the size of what is under it.
 *
 * The count is the one thing the prose beneath cannot say — "Archived" and
 * "Tags" are the same two words whether there are three or thirty — and it is
 * the number a person actually scans for on a page whose lists have no other
 * summary. Mono and tabular per The Tabular Rule: it is a digit the user reads.
 *
 * Not an eyebrow, and not a badge: sentence-case heading, hairline figure
 * beside it, both on the page's own ground.
 */
function SectionHeading({ count, children }: { count: number; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2">
      <h2 className="text-sm font-semibold">{children}</h2>
      <span className="font-mono text-xs tracking-[-0.02em] text-muted-foreground tabular-nums">
        {count}
      </span>
    </div>
  )
}

function ProjectRow({
  project,
  currency,
}: {
  project: Doc<"projects">
  currency: string
}) {
  const { updateProject, setArchived, removeProject } = useClassifierMutations()

  // No local `report`: every write below is outbox-wrapped and optimistic by
  // construction now, so a refusal — IN_USE included: "3 entries use this
  // project. Archive it instead." — is the outbox's own `dropped` event to
  // report (see `_authed.tsx`), not a catch here.

  return (
    <li
      className={cn(
        // `gap-2` below `sm`: a 375px row is a swatch, a name, a mark, a rate
        // and two icons, and everything except the name is `shrink-0` — so
        // every pixel spent on a gutter comes out of the one field that is
        // actually words. Four gaps at 12px is a third of what the name has.
        "group flex items-center gap-2 px-3 py-2 sm:gap-3",
        "border-b border-border last:border-b-0",
        /*
          THE SAME ROW THE LOG DRAWS. An entry row is `hover:bg-card/60`,
          and a project row is the same object — a line of fields you edit in
          place — so it fills the same way. Before this the only response to a
          pointer was two icons fading in at the far right of a 1600px row,
          which asks the reader to notice a change 1400px from the cursor.
        */
        "transition-colors hover:bg-card/60 motion-reduce:transition-none"
      )}
    >
      <ColorPicker
        project={project}
        onPick={(color) => {
          void updateProject({ projectId: project._id, color })
        }}
      />

      <InlineEdit<string>
        display={<span className="block w-full truncate text-sm">{project.name}</span>}
        initialInput={project.name}
        ariaLabel={`Project name: ${project.name}`}
        /*
          `justify-start`, and it is not optional. InlineEdit's trigger is a
          `Button`, whose base is `inline-flex … justify-center` — right for a
          button with a word in it, wrong for one that is `flex-1` across the
          empty middle of a row. The name was being centred in whatever width
          was left over, so every project sat at a different left edge and the
          column of names read as a ragged stripe down the page instead of a
          list. `text-left` on the trigger cannot fix it: the span is a flex
          ITEM, and `justify-center` places the box before the text inside it
          has any say.

          `w-full` on the span is the other half — a centred flex item was
          shrink-to-fit, so `truncate` had its own content's width to measure
          against rather than the column's, and a long name would push the row
          rather than ellipse.
        */
        className="-mx-1 min-w-0 flex-1 justify-start px-1 py-0.5 text-sm"
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
        label. It applies at creation only — changing it never rewrites work
        that has already been recorded, let alone invoiced.

        THE VISIBLE LABEL IS ONE WORD. "Billable by default" is the accurate
        name of the field and the wrong thing to print on every line of a list:
        four words, repeated once per project, reading as a paragraph down the
        middle of the page rather than as a column of states. The qualifier
        moves to the ACCESSIBLE name, which is said once per row to the people
        who cannot see that this is /projects — and it starts with the visible
        word, which is what SC 2.5.3 asks of a control whose label is spoken.
        The name also carries the project, so a screen reader's list of
        checkboxes is a list of distinguishable ones.

        Brass when on — the billable MARK keeps brass (§2, Secondary) — and the
        word wears it too, so the state reads down the column at a glance. The
        checkbox is what carries it for anyone not reading colour.

        `sm:w-20` fixes the column so the rate beside it starts at the same x on
        every row; below `sm` the word is dropped for the mark alone and the
        column collapses to what the box needs.
      */}
      <label
        className={cn(
          "flex shrink-0 items-center gap-1.5 rounded-sm px-0.5 py-1 text-xs sm:w-20 sm:px-1",
          "transition-colors hover:bg-popover/70 motion-reduce:transition-none",
          /*
            THE INDICATOR IS ON THE LABEL, because the thing being focused is
            the pair — a 14px box and the word that says what ticking it does —
            and a ring around the box alone points at half of it.

            An OUTLINE rather than a ring, which is the answer §5 already
            reaches for when a wrapper carries the focus of an input inside it:
            a ring is a box-shadow, and box-shadows are dropped entirely in
            forced-colors mode, so the input's own outline would have been
            suppressed here in exchange for nothing. `outline-offset-2` puts
            the row's fill on both sides of it, which is what keeps the figure
            clear of the 3:1 floor whether the row is hovered or not.
          */
          "has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-ring",
          project.billableByDefault ? "text-foreground" : "text-muted-foreground"
        )}
      >
        <input
          type="checkbox"
          checked={project.billableByDefault}
          aria-label={`Billable by default for ${project.name}`}
          onChange={(event) => {
            void updateProject({
              projectId: project._id,
              billableByDefault: event.target.checked,
            })
          }}
          className="size-3.5 shrink-0 accent-foreground focus-visible:outline-none"
        />
        {/* `aria-hidden`: the input above names itself, and a bare "$" — which
            is all that is left of this label below `sm` — is not a name. */}
        <span aria-hidden="true" className="hidden sm:inline">
          Billable
        </span>
        <span aria-hidden="true" className="sm:hidden">
          $
        </span>
      </label>

      {/*
        Same InlineEdit affordance as the name above — click to edit, Enter or
        blur to commit — not a separate modal or a different control for this
        one field. Seeded with the bare number (no currency symbol) so the
        input round-trips through `parseMoney` cleanly; the DISPLAY is where
        the currency's own symbol and placement (via `formatMoney`) show up.
      */}
      <InlineEdit<number | null>
        display={
          <span
            className={cn(
              "font-mono tabular-nums tracking-[-0.02em]",
              /*
                BRASS, because a rate is a currency amount and §2 says a brass
                figure is exactly that. It was Ink Muted, which put the one
                number on this page — the number the invoices are built out of
                — at the dimness reserved for timestamps and hints. The
                unpriced case stays muted and italic: "No rate set" is an
                absence, not an amount, and it must not read as one.
              */
              project.hourlyRateCents === undefined
                ? "italic text-muted-foreground"
                : "text-foreground"
            )}
          >
            {formatRate(project.hourlyRateCents, currency)}
          </span>
        }
        initialInput={
          project.hourlyRateCents === undefined
            ? ""
            : (project.hourlyRateCents / 100).toFixed(2)
        }
        ariaLabel={`Hourly rate for ${project.name}`}
        placeholder="No rate"
        /*
          A FIXED, RIGHT-ALIGNED COLUMN — from `sm` up, where there is room for
        one. Below it the width is released: a phone row has ~66px of name left
        after the fixed cluster, and a column that is straight at 375px is not
        worth a project called "Northwi…". The alignment is a wide-screen
        affordance, and this is the width where the page stops pretending.

        The Tabular Rule asks that history
          columns align on the decimal without effort, and a rate that starts
          wherever the previous field ended cannot: "No rate set" and
          "$1,200.00/hr" are 30px apart, so three rows put three figures at
          three different x positions. Width plus `justify-end` puts every
          decimal point over the one above it.

          `className` reaches BOTH branches of InlineEdit (see its editing
          return), which is what keeps the box the same width while it is being
          typed into — the field does not jump when it opens. Colour is left to
          the display span above, so the text being typed is Ink rather than
          the muted tone the figure rests at.
        */
        className="w-auto shrink-0 justify-end px-1 py-0.5 text-right text-xs sm:w-32"
        inputClassName="font-mono tabular-nums tracking-[-0.02em]"
        parse={(raw) => {
          // `currency` is passed so the user's OWN sign and ISO code are
          // strippable noise rather than a parse failure — an SGD user pasting
          // "S$10" or "SGD 10.00" straight back out of the display above.
          const parsed = parseMoney(raw, currency)
          return parsed.ok
            ? { ok: true, value: parsed.cents }
            : { ok: false, message: rateHelp(currency) }
        }}
        onCommit={async (cents) => {
          await updateProject({ projectId: project._id, hourlyRateCents: cents })
        }}
      />

      <div className="flex shrink-0 items-center gap-0.5">
        <IconButton
          label={project.archived ? `Unarchive ${project.name}` : `Archive ${project.name}`}
          onClick={() => {
            void setArchived(project._id, !project.archived)
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
            void removeProject(project._id)
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
  const triggerRef = useRef<HTMLButtonElement>(null)

  /**
   * Closes and hands focus back to the swatch that opened it.
   *
   * Without it the popup's buttons unmount under the user's own focus and it
   * falls to <body>, so the next Tab restarts at the top of the page — from a
   * settings screen that is entirely a list of controls.
   */
  const close = () => {
    setOpen(false)
    requestAnimationFrame(() => triggerRef.current?.focus())
  }

  return (
    <div
      className="relative shrink-0"
      // Escape is handled here rather than on each swatch, so it works wherever
      // focus is inside the popup.
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault()
          event.stopPropagation()
          close()
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-label={`Colour for ${project.name}: ${project.color}`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        data-project-color={project.color}
        style={{ "--project-color": projectColorVar(project.color) } as CSSProperties}
        className={cn(
          "size-4 rounded-full bg-(--project-color) forced-colors:bg-[currentColor]",
          /*
            WCAG 2.2 SC 2.5.8: a 16px dot is a 16px target. The row's height is
            not load-bearing here, but growing the dot is — it is sized to sit
            beside 14px text without becoming the loudest thing in the row — so
            the target grows instead of the box, with the pseudo-element the
            rest of the product uses for the same problem. `-inset-1` is -4px a
            side: 16 + 4 + 4 = 24 exactly.
          */
          "relative after:absolute after:-inset-1 after:content-['']",
          /*
            It is a BUTTON, and it looked like a bullet. A ring on hover and
            while the palette is open is the whole affordance: the dot itself
            cannot change colour to signal anything, because its colour is the
            information.
          */
          "transition-[box-shadow] motion-reduce:transition-none",
          "hover:ring-2 hover:ring-input hover:ring-offset-2 hover:ring-offset-transparent",
          open && "ring-2 ring-input ring-offset-2 ring-offset-transparent",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-transparent focus-visible:outline-none"
        )}
      />
      {open ? (
        <>
          {/* Click-away. A plain overlay rather than a document listener, so it
              cannot leak past unmount. */}
          <div
            className="fixed inset-0 z-40"
            aria-hidden="true"
            onClick={close}
          />
          <div
            className={cn(
              /*
                `w-max` IS LOAD-BEARING, and without it this palette was
                unusable. `grid-cols-6` is `repeat(6, minmax(0, 1fr))`, and a
                `1fr` track needs a definite width to divide up. This element is
                `absolute` with no width, so it shrink-to-fits — and the
                shrink-to-fit contribution of a `minmax(0, …)` track is its
                MINIMUM, which is zero. Every column resolved to 0px and all
                twelve 20px swatches stacked on top of each other inside a 38px
                box: one blob of overlapping circles, in the control whose whole
                job is to let you tell twelve colours apart.
                `w-max` makes the box size to its content first, so the tracks
                have something real to divide. Nothing catches this in a test —
                the swatches are all present, all labelled, and all clickable by
                `aria-label`; they are simply drawn on top of one another.
              */
              "absolute top-full left-0 z-50 mt-1 grid w-max grid-cols-6 gap-1 rounded-lg",
              "border border-border bg-popover p-2 shadow-xl",
              /*
                The same 100ms scale-and-fade `PopoverContent` gives every other
                floating panel in the product. This one is hand-rolled — twelve
                swatches do not need a positioner — but "hand-rolled" is not a
                reason for it to appear differently from its neighbours, and an
                un-animated popup beside animated ones reads as a glitch rather
                than as restraint. `origin-top-left` because that is the corner
                it grows from, under the swatch that opened it.
              */
              "origin-top-left animate-in fade-in-0 zoom-in-95 duration-100",
              "motion-reduce:animate-none"
            )}
          >
            {PROJECT_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                aria-label={color}
                aria-pressed={color === project.color}
                data-project-color={color}
                style={{ "--project-color": projectColorVar(color) } as CSSProperties}
                onClick={() => {
                  onPick(color)
                  close()
                }}
                className={cn(
                  "size-5 rounded-full bg-(--project-color) forced-colors:bg-[currentColor]",
                  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                  /*
                    A GRID OF TWELVE DOTS WITH NO POINTER FEEDBACK. Focus and
                    the selected ring were both here; hover and press were not,
                    so a mouse moving across the palette got nothing back until
                    it had already committed to a colour.
                    The swatch cannot indicate anything with its FILL — the fill
                    is the information, which is the same argument the trigger
                    above makes for its own ring. So it grows instead: a scale
                    is the one channel a colour chip has spare. The ring below
                    still marks the current choice, and hover never draws one,
                    so "hovered" and "chosen" stay distinguishable.
                  */
                  "transition-[scale] duration-100 ease-out motion-reduce:transition-none",
                  "hover:scale-110 active:scale-100",
                  color === project.color && "ring-2 ring-foreground ring-offset-2 ring-offset-popover"
                )}
              />
            ))}
          </div>
        </>
      ) : null}
    </div>
  )
}

function NewProject({ currency }: { currency: string }) {
  const { createProject } = useClassifierMutations()
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState("")
  const [rate, setRate] = useState("")
  const [error, setError] = useState<string | null>(null)

  if (!adding) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setAdding(true)}>
        <Plus className="size-4" />
        New project
      </Button>
    )
  }

  const reset = () => {
    setAdding(false)
    setName("")
    setRate("")
    setError(null)
  }

  const submit = () => {
    if (name.trim() === "") {
      reset()
      return
    }
    // A rejected rate keeps the form OPEN with what was typed still in it —
    // same rule InlineEdit follows elsewhere: a parse failure never silently
    // discards input or falls back to a guess.
    const parsedRate = parseMoney(rate, currency)
    if (!parsedRate.ok) {
      setError(rateHelp(currency))
      return
    }
    // `createProject` is optimistic by construction now: it resolves as
    // soon as the outbox journals the write, so a refusal is the outbox's
    // own `dropped` event to report, not this form's.
    void createProject({
      name: name.trim(),
      hourlyRateCents: parsedRate.cents ?? undefined,
    }).then(reset)
  }

  return (
    /*
      A COLUMN, so the refusal has somewhere to go. The error used to be the
      form's fourth flex child: a full sentence of it — "Try 10, 10.50, or
      $10.50 — or leave it blank to clear the rate." — landing to the right of
      the Add button, inside the page header's own title row, which then wrapped
      and pushed the `<h1>` beside it around. It now sits UNDER the fields it is
      about, right-aligned with them, where it can be as long as it needs to be.
    */
    <form
      className="flex flex-col items-end gap-1.5"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <div className="flex items-center gap-2">
      <input
        autoFocus
        value={name}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault()
            reset()
          }
        }}
        placeholder="Client or product"
        aria-label="New project name"
        aria-invalid={error !== null}
        className={cn(
          "w-48 rounded-md border bg-background px-2 py-1 text-sm",
          error === null ? "border-border" : "border-destructive",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        )}
      />
      <input
        value={rate}
        onChange={(event) => setRate(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault()
            reset()
          }
        }}
        placeholder={`Rate (${currency}, optional)`}
        aria-label={`Hourly rate in ${currency}, optional`}
        aria-invalid={error !== null}
        className={cn(
          "w-32 rounded-md border bg-background px-2 py-1 text-sm font-mono tabular-nums tracking-[-0.02em]",
          error === null ? "border-border" : "border-destructive",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        )}
      />
        <Button type="submit" size="sm">
          Add
        </Button>
      </div>
      {error === null ? null : (
        <span role="alert" className="max-w-xs text-right text-xs text-destructive">
          {error}
        </span>
      )}
    </form>
  )
}

// ---------------------------------------------------------------------------

function TagRow({ tag }: { tag: Doc<"tags"> }) {
  const { renameTag, removeTag } = useClassifierMutations()

  return (
    // `border-border`: this pill is the boundary of an
    // editable, deletable control (an inline-edit field plus a delete
    // button), the same job a filter chip does — not a passive divider.
    //
    // `group` and the fill: a tag cloud is a list of NAMES, and twelve of them
    // each carrying a permanently-lit bin icon reads as a row of delete
    // buttons that happen to have words in them. The bin now arrives with the
    // pointer (see below), and the fill is what says the pill under the cursor
    // is the one it would belong to.
    <li
      className={cn(
        "group flex items-center gap-1 rounded-md border border-input px-2 py-1",
        "transition-colors hover:bg-card/60 motion-reduce:transition-none"
      )}
    >
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
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={`Delete tag ${tag.name}`}
        // `removeTag` is optimistic by construction now: it resolves as
        // soon as the outbox journals the write, so a refusal is the
        // outbox's own `dropped` event to report, not a catch here.
        onClick={() => void removeTag(tag._id)}
        className={cn(
          // Same rule as the project row's actions: revealed by pointer or
          // focus where there is a pointer, and permanently visible below `sm`,
          // where hover does not exist and a hidden control is no control.
          "opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100",
          "transition-opacity focus-visible:opacity-100 motion-reduce:transition-none",
          "hover:text-destructive"
        )}
      >
        <Trash2 className="size-3" />
      </Button>
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
    <Button
      type="button"
      variant="ghost"
      size="icon-row"
      aria-label={label}
      onClick={onClick}
      className={cn(
        "opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100",
        "focus-visible:opacity-100 motion-reduce:transition-none",
        destructive && "hover:text-destructive"
      )}
    >
      {children}
    </Button>
  )
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-border px-1 py-px font-mono text-[0.7rem]">
      {children}
    </kbd>
  )
}
