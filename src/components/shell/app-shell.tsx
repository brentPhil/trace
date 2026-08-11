import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { TooltipProvider } from "@/components/ui/tooltip"
import { AppSidebar } from "@/components/shell/app-sidebar"
import { useHeightVar } from "@/hooks/use-height-var"
import { cn } from "@/lib/utils"
import type { ReactNode } from "react"

/**
 * The dashboard frame: sidebar, timer bar, content.
 *
 * The timer bar is passed in rather than constructed here, so this file stays
 * layout and the running-entry wiring stays in the route that owns the queries.
 *
 * `sidebarDefaultOpen` comes from the request cookie, read in _authed.tsx. It
 * is not optional-with-a-default on purpose: forgetting to thread it through is
 * exactly the bug that produces a 208px layout jump on every load, and a
 * required prop makes that a type error instead of a subtle regression.
 */
export function AppShell({
  children,
  email,
  name,
  onSignOut,
  sidebarDefaultOpen,
  timer,
}: {
  children: ReactNode
  email?: string
  name?: string
  onSignOut: () => void
  sidebarDefaultOpen: boolean
  timer: ReactNode
}) {
  /*
   * The bar's own height, published onto `<main>` so the PAGE below can stick
   * underneath it without either file naming a pixel. `<main>` is the nearest
   * element that is an ancestor of both the bar and the outlet — custom
   * properties inherit down, not sideways.
   */
  const { hostRef, measuredRef } = useHeightVar<HTMLElement>("--timer-bar-height")

  return (
    // Sets `delay={0}` for every Tooltip in the tree below — the icon-rail
    // tooltips in AppSidebar (rendered via SidebarMenuButton's `tooltip` prop)
    // are the reason this exists. Without a mounted provider they still work,
    // just with Base UI's default (non-zero) open delay.
    <TooltipProvider>
      <SidebarProvider defaultOpen={sidebarDefaultOpen}>
        <AppSidebar email={email} name={name} onSignOut={onSignOut} />

        <SidebarInset
          ref={hostRef}
          className={cn(
            "min-w-0",
            /*
              WHAT THE PAGE BELOW STICKS UNDER, expressed once, here.

              Below `md` the bar is pinned to the BOTTOM (see the comment on
              the bar itself), so it contributes NOTHING to a top offset and
              this is flat zero — a page's own sticky band then sticks to the
              top of the viewport, which is the whole of the screen it is not
              occupying. At `md` and up the bar is sticky at the top and its
              measured height IS the offset. Keeping the breakpoint in CSS
              rather than in the ResizeObserver means the mobile decision
              cannot be broken by a measurement.

              `--log-sticky-top` starts EQUAL to it, so a page that renders a
              log without a sticky band of its own still puts its day headers
              below the bar rather than under it — the `0px` on the derived
              properties in styles.css is a substitution guard, not a sensible
              default anywhere inside this shell. A page that does have a band
              overrides this on its own root (see `Page`, and its `sticky`),
              which is nearer the log and therefore wins.

              THE `,0px` FALLBACK IS THIS CONSUMER'S OWN GUARD, and is why the
              measurement itself carries no global default. It covers the frame
              between mount and the first write, and zero is the right answer
              for an OFFSET in that frame — a page opens at scroll 0, where
              `top` does nothing. It is the wrong answer for the spacer at the
              foot of this file, which reads the same measurement to reserve a
              HEIGHT and wants the bar's resting height instead. One global
              default could only have suited one of them, and it suited the
              wrong one.
            */
            "[--shell-sticky-top:0px] md:[--shell-sticky-top:var(--timer-bar-height,0px)]",
            "[--log-sticky-top:var(--shell-sticky-top)]"
          )}
        >
          {/*
            Below `md` the bar is pinned to the BOTTOM of the viewport rather
            than sitting at the top of the document.

            On a phone the start control belongs under the thumb, not behind a
            scroll — and the log is what you scroll, so the one control
            pressed twenty times a day must not scroll away with it. It is in
            the shell now, so that holds on every page rather than only on
            Timer.

            Toggl has publicly declined to fix its mobile web app. This is the
            surface the incumbent abandoned, and it costs one breakpoint.

            AT `md` AND UP it becomes sticky at the top instead of static —
            same reasoning, opposite edge. The bar is the one control that
            belongs to no page, and the log is what scrolls; pinning it means
            a timer can be started or read from anywhere in a two-thousand-row
            log. It keeps `bg-ground` there (the base class no longer drops it
            at `md`) because a transparent sticky element is a window onto the
            rows sliding under it. No bottom border: on /timer the band
            directly beneath supplies that hairline, and drawing both would be
            a 2px rule made of two different elements.
          */}
          <div
            ref={measuredRef}
            className={cn(
              "fixed inset-x-0 bottom-0 z-30 flex items-center gap-2",
              "border-t border-edge-soft bg-ground px-3 pt-2",
              "pb-[max(0.5rem,env(safe-area-inset-bottom))]",
              "md:sticky md:inset-x-auto md:top-0 md:bottom-auto md:border-t-0",
              "md:gap-3 md:px-4 md:pt-3 md:pb-3"
            )}
          >
            {/* The hamburger. Hidden on desktop, where the rail is always
                there and ⌘B toggles it. */}
            <SidebarTrigger className="shrink-0 md:hidden" />
            {/*
              Uncapped, like the log below it. The bar is the one control on
              screen that belongs to no page, so what matters is that it takes
              the SAME width as the rows beneath it — the title you type into
              and the title you read back are the same field, and they line up.
              Both are now full-bleed, so they still do.
            */}
            <div className="min-w-0 flex-1">{timer}</div>
          </div>

          {/*
            Full-bleed and unpadded, deliberately.

            This carried `mx-auto max-w-4xl` from before the sidebar existed,
            when the page was a centred column under a top nav and a reading
            measure was the right call. With a rail on the left, that same
            constraint puts the log in a narrow band with dead space to its
            right — and the log is a TABLE, not prose: the width goes to the
            title and the note, which are the two things a row has too little
            room for.

            THE ALIGNMENT CONTRACT, and where it lives. The shell caps and pads
            nothing here. Every page instead applies its own `px-4`, left-flush,
            and the timer bar above does the same — that shared gutter is what
            keeps the bar's title input, the totals, the filter band, the day
            labels and the entry titles on one left edge. An inset here would
            offset the pages by 8px against the bar, which is not in this
            container. EVERY page takes the full width — there is no page
            measure left (src/styles.css); prose is capped inside the one
            component that holds prose, not by narrowing a page around it.
            Backgrounds, borders and hover fills stay on the padded content's
            parents, so the log still reads as edge-to-edge bands.
          */}
          <div className="flex w-full flex-1 flex-col">{children}</div>

          {/*
            Reserves the fixed bar's height so the last row of a log can
            always be scrolled clear of it.

            THE MEASUREMENT, WITH 6.5rem AS ITS FALLBACK — not a `max()` of
            the two. It was noted here as a known limitation that a fixed
            spacer cannot chase `RunawayBanner`, which adds a further line to
            the same fixed container once a timer overruns, so recording AND
            overrunning could put the banner over the last log row. This file
            measures that container for the sticky offset above, so the answer
            is simply that measurement.

            `max()` was how the constant survived first paint, back when
            `--timer-bar-height` had a global `0px` default and a bare `var()`
            would therefore have resolved to a zero-height spacer rather than
            to the fallback. But `max()` is permanent, not a first-paint
            device, and it leaves the constant only two possible jobs in steady
            state: either it exceeds the measured bar and sizes the spacer
            itself — dead ground under every mobile log, for as long as that
            holds — or it never does and was no floor at all. Neither is what
            the comment here claimed. With the global default gone (styles.css)
            the fallback in the `var()` does the first-paint job exactly, and
            only until the observer answers.
          */}
          <div
            aria-hidden="true"
            className="h-(--timer-bar-height,6.5rem) shrink-0 md:hidden"
          />
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  )
}
