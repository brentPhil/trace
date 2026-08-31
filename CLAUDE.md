<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->

## Frontend

**Read `DESIGN.md` before changing anything visual.** It is the design system
and it is normative — typography, elevation, motion and the component
vocabulary, each with the argument for why. Its Named Rules (The Tabular Rule,
The Over-Determined State Rule, The Hatch Rule, The Shadcn-First Rule, …) are
the shorthand to reason in, and §2 lists the ones that were RETIRED so an old
comment mentioning `--safelight` or The Falloff Rule does not send you looking
for tokens that no longer exist.

**The palette is shadcn's default with four measured repairs, and that set is
closed.** `src/styles.css` holds it and nothing else colour-shaped. The theme
picker in Settings ships, and a preset sets the standard shadcn variables and
nothing else — so a token this product invents is a surface that stays the wrong
colour when someone picks a theme. Need a shade the set does not have? Compose
it at the call site (`bg-primary/15`, `color-mix`) rather than naming it.

**A preset is CSS, applied by one `data-theme` attribute — never by
`documentElement.style.setProperty`.** An inline declaration outranks both
`:root` and `.dark`, so a token written that way stops answering the light/dark
toggle. See DESIGN.md §2 "Presets"; `src/lib/theme.test.tsx` asserts it.

**The Shadcn-First Rule — prefer a shadcn component over a native or
hand-rolled control.** Check `src/components/ui/` first. If the component is not
there, add it with `npx shadcn@latest add <name>`; do not hand-roll one that
shadcn ships, and do not leave a bare `<select>`, `<input type="file">`,
`<dialog>` or `<details>` in the product. A native control renders the
*engine's* chrome — its own radius, focus ring and popup — in a column of
controls drawn from this ramp, and it always looks it.

**Do not correct a vendored component — override at the call site.** Everything
in `src/components/ui/` is the registry's output and has to stay re-installable;
hand-edits are what made `npx shadcn@latest add --overwrite` unrunnable last
time. Pass a `className` and let tailwind-merge replace the registry's value.
DESIGN.md §5 lists the five standing exceptions and why each is behaviour rather
than styling.

Style with Tailwind utilities inline. `src/styles.css` holds tokens and the
handful of at-rules Tailwind cannot express; it is not a second styling system.
