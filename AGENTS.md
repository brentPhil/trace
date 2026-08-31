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
and it is normative — colours, typography, elevation, motion and the component
vocabulary, each with the argument for why. Its Named Rules (The Cold Light
Rule, The Tabular Rule, The Falloff Rule, The Shadcn-First Rule, …) are the
shorthand to reason in.

**The Shadcn-First Rule — prefer a shadcn component over a native or
hand-rolled control.** Check `src/components/ui/` first. If the component is not
there, add it with `npx shadcn@latest add <name>` and then correct it to this
system; do not hand-roll one that shadcn ships, and do not leave a bare
`<select>`, `<input type="file">`, `<dialog>` or `<details>` in the product. A
native control renders the *engine's* chrome — its own radius, focus ring and
popup — in a column of controls drawn from this ramp, and it always looks it.

Correcting a vendored component is expected, not optional: base-luma ships this
system's named anti-patterns. See The Shadcn-First Rule in DESIGN.md §5 for the
three fixes every one of them has needed.

Style with Tailwind utilities inline. `src/styles.css` holds tokens and the
handful of at-rules Tailwind cannot express; it is not a second styling system.
