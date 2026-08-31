import { Link } from "@tanstack/react-router"
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarRail, sidebarMenuButtonVariants } from "@/components/ui/sidebar"
import { Separator } from "@/components/ui/separator"
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import {
  Clock,
  FileText,
  FolderKanban,
  LogOut,
  Settings,
  Table2,
} from "lucide-react"
import { ThemeChoice } from "@/components/theme-toggle"
import { WhatsNewBanner } from "@/components/shell/whats-new-banner"
import { cn } from "@/lib/utils"
import { APP_NAME } from "@shared/brand"
import type { LucideIcon } from "lucide-react"

/**
 * The four destinations, as data.
 *
 * Exported so a test can assert the set without rendering, and so the count is
 * checkable at a glance. Adding a fifth should be an argument, not an edit:
 * Toggl's web app has a two-level nav with a dozen entries and the tracker
 * itself is one of them.
 *
 * WHAT IS LEFT IS THE SEQUENCE OF THE WORK — track, review, bill, and the
 * projects all three are filed under. Everything that is not a place the work
 * is has now left this list, and both departures were the same mistake made
 * twice: a permanent slot in the rail, at the same weight as the tracker, for
 * a destination a user visits once and then rarely again.
 *
 * SETTINGS LEFT on 2026-08-29, into the account menu with the theme and Sign
 * out — a drawer of preferences about the account that owns the work, which is
 * where every product with an account menu puts it, and one click either way.
 *
 * MUSIC LEFT the same day, into /settings. Its own docblock had argued for
 * keeping it: a library of files the account owns — uploaded, renamed, deleted,
 * counted against a storage cap — is not a preference, so folding it into
 * Settings would put a file manager inside a page of switches. That was a claim
 * about the CONTENT and the cost was in the RAIL, and it also left this feature
 * split in two, with the playback preferences already on /settings. Both halves
 * are now on one page, in two sections that say which is which.
 *
 * THE ARGUMENT FOR INVOICES, since this list stood at three and said so. An
 * invoice is not a view of a report. /reports answers "where did this period
 * go" and every control on it narrows a range; an invoice is a document that
 * outlives the range it was raised from, is numbered, is sent, and is later
 * looked up by its number rather than by its dates. Filing it as a mode of
 * Reports would mean the only way back to last quarter's invoice is
 * reconstructing the filter that produced it. It goes BETWEEN Reports and
 * Projects because that is the order of the work.
 */
export const NAV_ITEMS: Array<{
  to: "/timer" | "/reports" | "/invoices" | "/projects"
  label: string
  icon: LucideIcon
}> = [
  { to: "/timer", label: "Timer", icon: Clock },
  { to: "/reports", label: "Reports", icon: Table2 },
  { to: "/invoices", label: "Invoices", icon: FileText },
  { to: "/projects", label: "Projects", icon: FolderKanban },
]

/**
 * THE COLLAPSED RAIL'S GUTTER — 6px, on every region of it, written once.
 *
 * This is the fix for the seam. `SidebarHeader` and `SidebarFooter` ship with
 * `p-2`; `SidebarContent` ships with none, and neither `SidebarMenu` nor
 * `SidebarMenuItem` adds any — so the nav column ran flush to the rail's own
 * right edge while the wordmark and the footer sat 8px in from it. Measured on
 * a 256px rail: nav rows 0→255, header and footer children 8→247. The rail's
 * contour was inset at the top and bottom and not in the middle, and an active
 * row's Surface-Raised fill ran straight into the 1px divider with Ground
 * immediately beyond it — three tones meeting in one pixel with nothing
 * between them. On the left the same omission read as misalignment: three
 * different starting edges in one column (12px for the nav, 16px for the
 * wordmark and the email, 20px for the sign-out label), none of which was the
 * page's own 16px.
 *
 * 8px expanded puts every item in the rail on ONE left edge at 16px, which is
 * also `px-4` — the gutter the timer bar and every page take.
 *
 * 6px COLLAPSED, AND THE DERIVATION LIVES HERE, because two files were each
 * carrying their own arithmetic for it and had arrived at different numbers.
 * It is not a taste: the collapsed rail is 56px and the nav button inside it
 * is a 44px target (`size-11!` in the cva, the WCAG 2.5.5 floor), so the
 * gutter is what is left over, halved —
 *
 *     56 - 44 = 12, one gutter each side, so 6px = `p-1.5`
 *
 * — and 8px would take 4px off the target or 4px onto the rail. Nothing else
 * in this file or in sidebar.tsx should re-derive that; they cite this.
 *
 * THE COLLAPSED HALF IS THE CONSTANT because it is the one every region takes
 * on every side, and the one another file reasons about: `SidebarRail` in
 * sidebar.tsx sizes its collapsed width from what is left over here. It was
 * spelt out three times for two regions before this while a docblock here
 * claimed there was one of it — three chances for the seam to come back one
 * edit at a time.
 */
const RAIL_GUTTER_COLLAPSED = "group-data-[collapsible=icon]:p-1.5"

/**
 * The same gutter for `SidebarContent` ALONE — the one region upstream ships
 * with no padding at all, where the header and the footer already come with
 * `p-2`. So it states the expanded 8px itself, and takes the collapsed number
 * from above rather than spelling it a second time. Named for its one consumer
 * because that is what it is: the rail-wide rule is the constant above.
 *
 * `py-0` puts the vertical half back: the nav column's air comes from the
 * header above it and the footer below it, and 6px of its own here would push
 * the first icon off the header's centre line without anything asking it to.
 */
const CONTENT_GUTTER = cn(
  "px-2",
  RAIL_GUTTER_COLLAPSED,
  "group-data-[collapsible=icon]:py-0"
)

/**
 * Centres a fixed-width collapsed item in the rail rather than left-aligning
 * it. Without this the 44px button sits at the gutter's left edge and the 1px
 * divider on the right leaves it half a pixel off the rail's centre line — the
 * whole reason the icons looked pinned to one side in the first place.
 * Collapsed only; expanded, the items stretch as usual.
 */
const RAIL_CENTRE = "group-data-[collapsible=icon]:items-center"

/**
 * Pure. Takes the identity it displays and the sign-out it calls, so it holds
 * no query and no mutation — the same rule every other component here follows.
 */
/**
 * THE DRAG RAIL, PULLED BACK INSIDE THE SIDEBAR — a call-site override, not an
 * edit to `ui/sidebar.tsx`.
 *
 * shadcn ships the rail centred ON the divider: `-right-4` plus
 * `-translate-x-1/2` puts a 16px strip half over the sidebar and half over the
 * page. Measured at 256px expanded it occupied x 247→263 against a divider at
 * 255, so the leftmost 8px of every entry row in the log showed an
 * `e-resize` cursor and swallowed the click. Nothing about that is visible,
 * which is why it survived the first time: the only trace is a click that does
 * not land.
 *
 * It lives HERE rather than in the vendored file because the vendored file is
 * meant to stay re-installable — `npx shadcn@latest add sidebar --overwrite`
 * has to be a safe thing to run. tailwind-merge resolves both pairs (same
 * variant, same class group), so this replaces the registry values rather than
 * racing them in the cascade.
 */
export const SIDEBAR_RAIL_INSIDE_EDGE =
  "group-data-[side=left]:-right-px ltr:translate-x-0 rtl:translate-x-0"

export function AppSidebar({
  email,
  name,
  onSignOut,
}: {
  email?: string
  name?: string
  onSignOut: () => void
}) {
  return (
    /*
      THE RAIL TAKES BOTH A RAMP STEP AND A HAIRLINE — the one place in the
      product that does — and the hairline is `border-sidebar-border`.

      The Tonal Depth Rule is to step the ramp OR add an edge, and the rail is
      the one place that needs both. In the dark ramp `--sidebar` and the page
      are close enough that contrast ratios compress to almost nothing between
      them — the tonal step is real to the eye and barely measurable by the
      instrument — so a hairline is what makes the boundary unambiguous rather
      than merely probable.

      It is the SIDEBAR's own boundary token rather than `--input`, because
      `--input` is the weight of a control's own edge (The Boundary Split, §2)
      and using it here would make the one hairline the eye reads first the one
      belonging to no content. Everything the sidebar is made of is a sidebar
      token — which is also what lets it stay one object in both
      themes without a single `dark:` at this call site or the footer's below.

      What was actually wrong here was never the edge. It was that nothing
      inside the rail was inset from it — see RAIL_GUTTER_COLLAPSED, and the
      per-region padding on the three regions below.
    */
    <Sidebar collapsible="icon" className="border-sidebar-border">
      {/* The only way to re-expand a collapsed rail with a mouse on desktop —
          without it ⌘B/Ctrl+B is the sole path back, and that is a shortcut
          people hit by accident reaching for bold. */}
      <SidebarRail className={SIDEBAR_RAIL_INSIDE_EDGE} />

      <SidebarHeader className={cn(RAIL_GUTTER_COLLAPSED, RAIL_CENTRE)}>
        {/* `to={NAV_ITEMS[0].to}`, not a `"/timer"` literal, so the header
            link always points at whatever the first nav destination is.

            `aria-label` rather than letting the glyphs below name it: the
            wordmark collapses to its initial, and "C" is not a destination
            anybody can act on. Both spans are decorative here, which also
            makes the name identical in jsdom (no CSS) and in a browser. */}
        <Link
          to={NAV_ITEMS[0].to}
          aria-label={APP_NAME}
          // The nav button's own geometry, not a second copy of it: the 36px
          // row, the 44px collapsed target and the centring that puts it on
          // the rail's centre line are all decided once, in the cva, and were
          // being re-derived here down to the pixel. `px-2` on top of the
          // header's own `p-2` is the rail's one 16px left edge (see
          // RAIL_GUTTER_COLLAPSED's docblock for that edge); the cva's `px-3`
          // is upstream's, and the nav buttons below override it for the same
          // reason.
          className={cn(
            sidebarMenuButtonVariants(),
            "px-2 text-base font-medium tracking-tight"
          )}
        >
          {/* The collapsed initial FIRST, so the full wordmark is the last
              child: the cva sends that one `sr-only` when the rail collapses,
              which is right for a nav label and would otherwise delete the
              one glyph a collapsed rail has to keep. Only ever one of the two
              is displayed, so the order is invisible. */}
          <span
            aria-hidden="true"
            className="hidden group-data-[collapsible=icon]:inline"
          >
            {APP_NAME[0]}
          </span>
          <span
            aria-hidden="true"
            className="group-data-[collapsible=icon]:hidden"
          >
            {APP_NAME}
          </span>
        </Link>
      </SidebarHeader>

      <SidebarContent className={CONTENT_GUTTER}>
        {/* The deleted AppHeader provided the `navigation` landmark; nothing
            replaced it when the nav moved into the rail. */}
        <nav aria-label="Main">
          {/* `gap-1` over the vendored `gap-0.5`: at 2px the rows read as one
              block and the hover fill of one touches the next. */}
          <SidebarMenu className={cn("gap-1", RAIL_CENTRE)}>
            {NAV_ITEMS.map((item) => (
              <SidebarMenuItem key={item.to}>
                {/* `tooltip` is what makes the collapsed rail usable; it is
                    rendered only when the sidebar is collapsed.

                    The vendored SidebarMenuButton is Base UI, not Radix — it
                    composes via `render` (Base UI's useRender convention), not
                    `asChild`. `render` takes the element to clone its own props
                    onto, so the rendered DOM node stays the real `<a>` from
                    TanStack `Link`.

                    `text-sidebar-foreground/70` at rest, the full sidebar
                    foreground when active or hovered. Space and weight before
                    colour: the active row already has the accent fill and
                    `font-medium` from the variant, so the hierarchy here is a
                    step down the sidebar's own ramp for everything you are NOT
                    on, never a hue.

                    THE SIDEBAR'S OWN TOKEN, not the page's. This used to be a
                    long argument about a rail that was near-black in BOTH
                    themes and therefore needed inks of its own; that rail went
                    with the darkroom palette. `--sidebar-foreground` follows
                    the theme like every other surface now, so the pairing is
                    correct by construction rather than by measurement. */}
                <SidebarMenuButton
                  tooltip={item.label}
                  className="px-2 text-sidebar-foreground/70"
                  render={
                    <Link
                      to={item.to}
                      activeProps={{
                        "aria-current": "page",
                        "data-active": true,
                      }}
                    >
                      <item.icon />
                      <span>{item.label}</span>
                    </Link>
                  }
                />
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </nav>
      </SidebarContent>

      {/* `border-t` here and nowhere else in the rail. The footer is the one
          region that is not navigation, and a hairline is cheaper than the
          40px of dead space it would otherwise take to say so. */}
      <SidebarFooter
        className={cn(
          "border-t border-sidebar-border p-2",
          RAIL_GUTTER_COLLAPSED,
          RAIL_CENTRE
        )}
      >
        {/* Straight into the footer, with no `SidebarMenu`/`SidebarMenuItem`
            around it. Those are a `<ul>` and an `<li>`, and one control inside
            them is announced as "list, 1 item" — the same false promise about
            a list of commands that ProfileMenu's own docblock refuses `role`
            for. `SidebarMenuButton` needs no `li` parent, and the footer is
            already the flex column the centring class was landing on. */}
        {/* Above the account row: the footer reads bottom-up as "who am I,
            what changed" — and the banner disappears (dismissed or collapsed)
            without moving the row people aim for by muscle memory. No margin
            of its own: the footer's gap-2 is the spacing, and a margin on
            top of it was the doubled gap this once shipped with. */}
        <WhatsNewBanner />
        <ProfileMenu email={email} name={name} onSignOut={onSignOut} />
      </SidebarFooter>
    </Sidebar>
  )
}

/**
 * Who you are signed in as, and what you can do about it.
 *
 * POPOVER, NOT MENU, deliberately. The popup's primary content is an identity
 * block — avatar, name, email — and only then an action. `role="menu"` makes a
 * promise about its contents that this breaks: a menu is a list of commands
 * with roving focus, and a screen reader announcing "menu, 1 item" over a panel
 * whose largest element is not an item is a worse description than "dialog".
 * Base UI's Menu would also want that identity block to be a `Menu.Item` or to
 * sit outside the popup entirely. `Popover` gives the Escape dismissal, the
 * outside-press dismissal, the focus trap and the focus RETURN to the trigger
 * for free, which is the whole of what this needs.
 *
 * WHAT IS HERE, AND WHY IT ALL ARRIVED AT ONCE. This docblock used to argue
 * that a theme toggle and a /settings link were deliberately absent, and both
 * arguments expired on 2026-08-29 rather than being overruled:
 *
 *   - THE THEME TOGGLE was refused while `styles.css` was dark-only, on the
 *     grounds that a control switching between dark and slightly-different-dark
 *     advertises a capability the product does not have. The light ramp now
 *     exists and is measured against the same floors, so the control is real.
 *     The slot it went into is the one that docblock named.
 *   - THE /settings LINK was refused because Settings was the sixth item in the
 *     nav, permanently on screen, and a second door to a destination that never
 *     left view is furniture. Settings has since left the rail (see NAV_ITEMS),
 *     so this is now the only door rather than a second one.
 *
 * What is STILL deliberately not here is anything about an account that is not
 * about THIS account: no workspace switcher, no billing shortcut, no help menu.
 */
function ProfileMenu({
  email,
  name,
  onSignOut,
}: {
  email?: string
  name?: string
  onSignOut: () => void
}) {
  /*
   * WHO YOU ARE, resolved once for both places that show it.
   *
   * The name if there is one, the email if not: the rail is 240px of usable
   * width, and an email is what actually identifies the account, so it is the
   * headline's fallback rather than a permanent second line under it. The email
   * is a SUBTITLE only when it is not already the headline — which, since
   * `_authed.tsx` maps an empty name to `undefined`, is the uncommon case.
   *
   * Both the trigger and the popup take these two strings. They used to pick
   * for themselves and had drifted apart: with no display name the trigger
   * showed the email as a `text-sm font-medium` headline while the popup showed
   * the same email as a muted `text-xs` line with no headline above it, and
   * with neither the popup drew an empty column beside a "?" avatar.
   */
  const primary = name ?? email ?? "Account"
  const secondary = name === undefined ? undefined : email

  return (
    <Popover>
      <PopoverTrigger
        render={
          <SidebarMenuButton
            size="lg"
            /* `h-12`, not the `lg` size's own height: the height belongs to
               this one consumer (see the `lg` variant in sidebar.tsx, which is
               otherwise upstream's). Two lines of text at 20px and 16px plus
               the row's padding is 48px; 56px is a menu row in a product with
               larger type than this one.

               `px-2` sits on the rail's 16px left edge — the footer around
               this supplies the other 8px with its own `p-2`. `px-0` collapsed
               because the button is then exactly the avatar. */
            className="h-12 px-2 group-data-[collapsible=icon]:px-0"
          >
            {/*
              Collapsed, the cva sends this block's last child `sr-only` — NOT
              `hidden`.

              That replaces a bespoke `aria-label` hack that existed because
              the old footer swapped "Sign out" for a "⎋" glyph with
              `hidden`/`inline`, which left the collapsed control named after
              a symbol — and, because jsdom applies no CSS, named after both
              strings at once in a test. Taking the text out of FLOW instead
              of out of the TREE means the accessible name is the same
              sentence in both states and in both environments, and there is
              no second source of truth to keep in sync with the visible text.
            */}
            <Identity label={primary} sublabel={secondary} />
          </SidebarMenuButton>
        }
      />

      {/*
        `side="right"` because the rail is on the left and, collapsed, is 56px
        of it — there is no "below" for a control sitting at the bottom of the
        viewport. `align="end"` lines the popup's bottom up with the trigger's,
        so it opens upward into the empty rail rather than off the screen.
      */}
      {/*
        `gap-0`, overriding the registry's `gap-4` on this call site only.

        That 16px is right for a popover holding PROSE — two paragraphs need
        air between them — and wrong for one holding a MENU, where the
        separators already carry the spacing. The two compounded: every
        divider sat in a 20px trough (16px gap + its own `my-1` on each side)
        and the popup ran 295px tall for four rows of content. With the gap
        gone the separator's 4px margins are the whole story, which is the
        rhythm every other menu in the product keeps.

        At the call site rather than in `ui/popover.tsx`: the base is not
        wrong, it is wrong HERE (DESIGN.md §5 — override, do not correct the
        vendored file).
      */}
      <PopoverContent
        side="right"
        align="end"
        sideOffset={8}
        className="w-[15rem] gap-0 p-1"
      >
        {/* The identity, first and largest — this is what the control is FOR.
            The email used to occupy a permanent line of the rail to say it.
            The same block as the trigger's, from the same two strings: a popup
            that describes the account differently from the control that opened
            it reads as two accounts. */}
        <div className="flex items-center gap-3 px-2 py-2">
          <Identity label={primary} sublabel={secondary} />
        </div>

        {/* `bg-border`, deliberately: this is a divider between passive
            content, which is what `--border` is for. The control-boundary
            token is `--input` (The Boundary Split, DESIGN.md §2) and would be
            wrong here — nothing on either side of this line is pressable.

            No `h-px` here any more. This call site used to carry one because
            the vendored `Separator`'s height rules were written against a
            `data-horizontal:` variant Base UI does not emit — so the base had
            no height and every consumer was invisible unless it said so
            itself. That is fixed in the component (components/ui/separator.tsx)
            rather than worked around here, which also un-breaks the two
            consumers that never knew to work around it.

            `data-horizontal:w-auto` IS THE SECOND HALF OF THAT SAME STORY, and
            the one that was visible. The registry's base is
            `data-horizontal:w-full` — 100% of the popup's CONTENT box — and
            `mx-2` then adds 8px of margin on top of a line that is already the
            full width. Measured: the divider ran 4px PAST the popup's right
            edge, out through a 38px rounded corner and across the ring. Any
            horizontal margin on this component overflows it by exactly that
            margin; `w-auto` in a stretch flex column resolves to
            "content box minus my margins", which is what an inset rule wants.

            It is a call-site override rather than a fix to the vendored file
            because `w-full` is RIGHT for a separator with no margins, which is
            every other consumer in the app — the three here are the only ones
            that inset. Same variant on both sides so tailwind-merge replaces
            rather than races: a bare `w-auto` loses to `data-horizontal:w-full`
            on specificity. */}
        <Separator className="mx-2 my-1 data-horizontal:w-auto bg-border" />

        {/* Settings, where it belongs: a drawer about the account, opened
            from the control that names the account. `PopoverClose` wraps it
            for the same reason it wraps Sign out — the popup should be gone
            before the navigation starts, not unmounted underneath it. */}
        {/*
          `nativeButton={false}` TWICE, once per layer, and the duplication is
          the point: `PopoverClose` and `Button` each run Base UI's `useButton`
          against the SAME final DOM element — the <a> that `Link` renders — and
          each checks its own flag (useButton.js warns per instance). Setting it
          on the inner Button alone silenced half the warning.

          False is also the honest description: this control navigates, so it is
          a link, and it should keep a link's semantics — middle-click,
          open-in-new-tab, the status bar showing where it goes — rather than
          have button semantics forced over the top.
        */}
        <PopoverClose
          nativeButton={false}
          render={
            <Button
              variant="ghost"
              size="sm"
              nativeButton={false}
              render={<Link to="/settings" />}
              className="w-full justify-start gap-2 px-2"
            />
          }
        >
          <Settings aria-hidden="true" className="size-4 text-muted-foreground" />
          Settings
        </PopoverClose>

        <Separator className="mx-2 my-1 data-horizontal:w-auto bg-border" />

        {/* THE THEME LIVES WITH THE ACCOUNT, not on /settings — which is where
            every product that has one puts it, and for a good reason: it is the
            one preference you change on impulse, when the light in the room
            changes, and making that a page visit is three clicks for something
            that should be one. It is also the only preference in the product
            that is per-DEVICE rather than per-account, so a page full of
            account settings was the wrong neighbourhood for it besides. */}
        <div className="px-2 py-1.5">
          <ThemeChoice className="w-full" />
        </div>

        <Separator className="mx-2 my-1 data-horizontal:w-auto bg-border" />

        {/* `PopoverClose` wrapping the button rather than a close call inside
            the handler: Base UI merges its own dismissal with ours, so the
            popup is gone before the sign-out navigation starts rather than
            being unmounted underneath it. */}
        <PopoverClose
          render={
            /* `Button`, not a hand-written one. `ghost` is the step DOWN to
               Surface on a Surface-Raised popup that this used to spell out,
               derived once — and, more to the point, `Button` carries the
               focus treatment DESIGN.md argues for at length: a border shift
               to `--ring` (3.95:1 light / 4.18:1 dark, and what actually
               satisfies SC 2.4.11)
               plus a 3px halo at 30% (decoration). A 2px solid ring is the
               halo's weight applied to the indicator's job.

               It composes at all because `Button` is Base UI's own
               `ButtonPrimitive` — so `PopoverClose` merges onto it exactly as
               `PopoverTrigger` does onto `SidebarMenuButton` above.

               `px-2` over the size's `px-3`: the identity block above sits on
               this popup's 8px gutter and the label has to start on the same
               pixel as the name does. */
            <Button
              variant="ghost"
              size="sm"
              onClick={onSignOut}
              className="w-full justify-start gap-2 px-2"
            >
              <LogOut aria-hidden="true" className="size-4 text-muted-foreground" />
              Sign out
            </Button>
          }
        />
      </PopoverContent>
    </Popover>
  )
}

/**
 * The account, said once: an avatar and one or two lines beside it.
 *
 * A FRAGMENT rather than a wrapper, because the two places that show it space
 * it differently — the trigger is the cva's flex row at `gap-2`, the popup's
 * own row is `gap-3` — and a wrapper would have to take a className to say so,
 * which is the seam this closes reopened one prop wider.
 *
 * Spans, not divs: the trigger is a `<button>`, whose content model is phrasing
 * content. The text column being the LAST child is also load-bearing there —
 * that is what the cva's collapsed `sr-only` rule selects.
 *
 * NEITHER LINE NAMES A COLOUR, and that is a fix rather than an omission.
 *
 * They used to be `text-foreground` and `text-muted-foreground`, and this
 * component renders in TWO places — inside the sidebar trigger and inside the
 * account popup — which sit on different surfaces with different foregrounds.
 * No one pair of colour classes is right in both.
 *
 * A `tone` prop was the obvious answer and it was WRONG for a reason worth
 * recording: THE TRIGGER'S OWN COLOUR IS NOT CONSTANT EITHER.
 * `sidebarMenuButtonVariants` flips the button to
 * `--sidebar-accent-foreground` on hover and while the popup is open, because
 * the row fills underneath it. A colour pinned on these two spans does not
 * participate in that flip — a child's explicit colour does not cascade — so
 * the account name kept the resting colour and sat on the hover fill,
 * invisible, exactly when it was being pointed at.
 *
 * So the label INHERITS: the sidebar's foreground in the rail, the popover's in
 * the popup, and the accent's the moment the row flips, all without this
 * component knowing where it is. The sublabel inherits too and takes
 * `opacity-80` for its step down, which is the one thing a colour cannot
 * express — "one step below whatever I am on". Every one of those pairings is a
 * shadcn `<token>` / `<token>-foreground` pair, so a picked theme keeps them
 * legible without this file being re-measured.
 */
function Identity({ label, sublabel }: { label: string; sublabel?: string }) {
  return (
    <>
      <Avatar label={label} />
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-medium">{label}</span>
        {sublabel === undefined ? null : (
          <span className="truncate text-xs opacity-80">{sublabel}</span>
        )}
      </span>
    </>
  )
}

/**
 * Initials on a well, not a photo.
 *
 * `bg-sidebar-accent` is a step DOWN from the rail, chosen over the obvious step up
 * because the row's own hover fill IS Surface Raised — an avatar tinted the
 * same colour would vanish exactly when it is being pointed at. Stepping down
 * instead makes it more distinct on hover, not less.
 *
 * IT IS A TOKEN RATHER THAN `bg-background` BECAUSE "DOWN" MOVED. In the darkroom
 * the ground WAS the step below the rail, so `bg-background` was that step spelled
 * as a room token. The rail is its own material in both themes now (The Recessed
 * Chrome Rule), and in the lit one `bg-background` is near-WHITE — a leap up, past
 * the accent fill, i.e. straight into the failure this comment was written to
 * avoid. The direction relative to the hover is the invariant; which room you
 * are in is irrelevant, which is why the token is the rail's.
 *
 * IT KEEPS THE SIDEBAR'S COLOURS IN THE POPUP TOO, where it lands on
 * `--popover` rather than on the rail. That is deliberate: the alternative is
 * an avatar that changes colour between the control and the panel that control
 * opens — which is exactly the "two accounts" reading ProfileMenu's own
 * docblock refuses. The initials are `--sidebar-foreground` on
 * `--sidebar-accent` in both places, so the chip is the same object wherever it
 * appears.
 *
 * `rounded-md`, not a circle: crisp, not pill.
 *
 * `aria-hidden`, because the name beside it already says whose account this
 * is and "BO" read aloud is noise.
 */
function Avatar({ label }: { label: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-md",
        "border border-sidebar-border bg-sidebar-accent text-xs font-medium text-sidebar-foreground"
      )}
    >
      {initialsOf(label)}
    </span>
  )
}

/**
 * Two letters from a name, one from anything else.
 *
 * An email is deliberately NOT split on its punctuation: "brent.agetro@…"
 * would give "BA", which looks like a surname that is not there.
 */
function initialsOf(label: string) {
  const words = label.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return "?"
  // `charAt`, not `[0]`: it returns "" for an index that is not there rather
  // than `undefined`, so a one-word label needs no second branch.
  return (
    words[0].charAt(0) + (words.length > 1 ? words[1].charAt(0) : "")
  ).toUpperCase()
}
