import { Monitor, Moon, Sun } from "lucide-react"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useTheme } from "@/components/theme-provider"
import { cn } from "@/lib/utils"
import type { ResolvedTheme, Theme } from "@/lib/theme"

const CHOICES: ReadonlyArray<{
  value: Theme
  label: string
  Icon: typeof Sun
}> = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
]

/**
 * Light / Dark / System, as one segmented control.
 *
 * THREE EXPLICIT CHOICES, not a two-state switch. A switch can only say "dark:
 * on/off", which makes "follow the OS" unreachable — and following the OS is
 * the option most people actually want, because it is the one that tracks
 * sunset without being asked.
 *
 * SEGMENTED RATHER THAN A MENU, because it lives inside a popup that is already
 * a menu. A submenu to reach three mutually exclusive states would be a second
 * layer of chrome over a setting that fits on one row — and this way all three
 * states are visible at once, so "System" is discoverable rather than hidden
 * behind a disclosure.
 */
export function ThemeChoice({ className }: { className?: string }) {
  const { theme, resolved, setTheme, hydrated } = useTheme()
  return (
    <ThemeChoiceView
      theme={theme}
      resolved={resolved}
      hydrated={hydrated}
      onChange={setTheme}
      className={className}
    />
  )
}

/**
 * The control itself, taking its state as PROPS — split from the context
 * wrapper above so `/settings` can render it inside a presentational section
 * with no provider anywhere near it (`useTheme` throws outside one by design).
 *
 * IT IS `ui/tabs.tsx`, NOT A COPY OF IT. This went through three shapes: a
 * hand-built radiogroup with its own fills (`bg-popover` — white-on-white in
 * the light ramp; then `bg-primary` — legible everywhere and loud everywhere),
 * then the same radiogroup wearing TabsTrigger's classes copied out by hand.
 * Copied classes are still a fork — the tabs' dark active-border fix landed in
 * `ui/tabs.tsx` and the copy would never have received it. The Shadcn-First
 * Rule's whole argument is that the registry component is the one that keeps
 * getting corrected, so this is now literally `Tabs`, the same component
 * Calendar/List and Summary/Detailed already are. /timer proves the
 * panel-less usage: a `Tabs` with a `TabsList` and no `TabsContent` is a
 * value selector, which is exactly what this is.
 *
 * WHAT THE TRADE COSTS, stated: a `tablist` role instead of a `radiogroup`, so
 * a screen reader hears "tab, one of three" rather than "radio". Both are
 * legible one-of-N idioms; sharing the component so the two segmented controls
 * cannot drift is worth the less-precise role.
 *
 * State is never colour alone: the active cell is the tabs' fill-plus-border
 * treatment plus `aria-selected`, and the icons differ per cell.
 */
export function ThemeChoiceView({
  theme,
  resolved,
  hydrated,
  onChange,
  className,
}: {
  theme: Theme
  resolved: ResolvedTheme
  hydrated: boolean
  onChange: (theme: Theme) => void
  className?: string
}) {
  return (
    <Tabs
      /*
       * `null` until the provider has adopted the stored value: it starts at
       * `system` and reads localStorage in a mount effect, and /settings
       * renders server-side — so before hydration its idea of the choice is a
       * guess. No cell selected for one tick is honest; the WRONG cell
       * selected is a control that lies, on the control whose whole job is to
       * report the theme. The pixels are never wrong either way —
       * `THEME_INIT_SCRIPT` already put the real class on <html>.
       */
      value={hydrated ? theme : null}
      onValueChange={(next) => onChange(next as Theme)}
      className={className}
    >
      <TabsList aria-label="Theme" className="w-full">
        {CHOICES.map(({ value, label, Icon }) => (
          <TabsTrigger
            key={value}
            value={value}
            /*
             * TIGHTER THAN THE REGISTRY'S `gap-2 px-3`, because this control
             * lives in a 240px popup and the default does not fit: the three
             * cells measured 228px of content inside a 216px track, so the
             * last one ("System", the longest word) was pressed past the
             * track's padding and read as overlapping. `gap-1.5 px-2` brings
             * the row to 200px with room to spare. Sized to the narrowest
             * place it ships, which is also /settings' widest.
             */
            className="gap-1.5 px-2 text-xs"
            /* The accessible name resolves the OS answer on the one cell where
               that is a live question — "System" alone cannot tell you whether
               you are about to get light or dark. Gated on `hydrated` because
               `resolved` is a guessed "dark" until the client has actually
               asked the OS. */
            aria-label={
              value === "system" && hydrated
                ? `System — currently ${resolved}`
                : label
            }
          >
            <Icon
              className={cn("size-3.5 shrink-0")}
              aria-hidden="true"
              data-icon="inline-start"
            />
            {label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}
