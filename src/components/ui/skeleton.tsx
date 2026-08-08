import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      // `motion-reduce:animate-none`: this was written and unused until the
      // log's loading state (day-list.tsx) started rendering it for real.
      // `.animate-pulse` has no reduced-motion counterpart anywhere else in
      // the codebase, and a house rule says every animation this project ships
      // needs one.
      className={cn("animate-pulse rounded-2xl bg-muted motion-reduce:animate-none", className)}
      {...props}
    />
  )
}

export { Skeleton }
