import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      // `bg-skeleton`, not `bg-muted`: `--muted` resolves to `--surface`,
      // which is 1.09:1 against the ground the log sits on — and
      // `animate-pulse` halves that again at the trough. The loading state was
      // a blank page with an invisible pulse on it. See src/styles.css.
      //
      // `rounded-sm`, not `rounded-2xl`: at `--radius: 0.45rem` that computed
      // to ~0.81rem, a full pill on the `h-4` bars this actually draws. The
      // log's own controls are `rounded-sm`, and DESIGN.md rejects
      // rounded-everything by name.
      //
      // `motion-reduce:animate-none`: this was written and unused until the
      // log's loading state (day-list.tsx) started rendering it for real.
      // `.animate-pulse` has no reduced-motion counterpart anywhere else in
      // the codebase, and a house rule says every animation this project ships
      // needs one.
      className={cn(
        "animate-pulse rounded-sm bg-skeleton motion-reduce:animate-none",
        className
      )}
      {...props}
    />
  )
}

export { Skeleton }
