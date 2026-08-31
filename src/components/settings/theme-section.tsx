import { ThemeChoiceView } from "@/components/theme-toggle"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { SWATCH_TOKENS, THEME_PRESETS } from "@/lib/theme-presets"
import { cn } from "@/lib/utils"
import { SOLID_SIDEBAR_PRESET_IDS, THEME_RADII } from "@/lib/theme-preset-ids"
import type { ThemePresetId, ThemeRadiusId } from "@/lib/theme-preset-ids"
import type { ThemePreset } from "@/lib/theme-presets"
import type { ResolvedTheme, Theme } from "@/lib/theme"

/**
 * The Theme block on /settings: polarity, then palette.
 *
 * PRESENTATIONAL, the same shape `GoogleCalendarSection` and `MusicSection`
 * use, and for the reason `music-section.tsx` states in its own header — its
 * data and its writes both arrive as props, which is what lets it render
 * against fixtures with no provider anywhere near it. `useTheme()` throws
 * outside a `ThemeProvider` on purpose, so a section that reached for it would
 * take every test on this page red at once.
 *
 * IT IMPORTS NO CONVEX. The preset is device-local, so there is no `api`, no
 * `convexQuery` and no `useConvexMutation` here — `eslint.config.js`'s layering
 * rule for `src/components/**` is satisfied by construction.
 *
 * TWO CONTROLS, NOT ONE, because they are orthogonal: a preset ships BOTH ramps
 * and never states a polarity, and light/dark/system never states a palette.
 * Folding them into one list of twelve would multiply two independent choices
 * into a grid the reader has to decode.
 *
 * A SELECT, NOT A GRID OF CARDS. Six presets as cards is a wall in the middle of
 * a settings page that has fourteen other rows on it; the Shadcn-First Rule
 * points at `ui/select.tsx`, and a closed list of named options with a specimen
 * beside each is exactly what a select is for. The trigger keeps its swatch, so
 * the current palette is legible without opening anything.
 */
export function ThemeSection({
  theme,
  resolved,
  hydrated,
  preset,
  radius,
  actions,
}: {
  theme: Theme
  resolved: ResolvedTheme
  hydrated: boolean
  preset: ThemePresetId
  radius: ThemeRadiusId
  actions: {
    setTheme: (theme: Theme) => void
    setPreset: (preset: ThemePresetId) => void
    setRadius: (radius: ThemeRadiusId) => void
  }
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <ThemeChoiceView
        theme={theme}
        resolved={resolved}
        hydrated={hydrated}
        onChange={actions.setTheme}
      />

      <Select
        // Before the provider has adopted the stored value its idea of the
        // preset is a guess, and /settings renders on the server — so the
        // trigger shows its placeholder for one tick rather than the wrong
        // palette's name. Same gate the polarity control uses.
        // `null`, which is Base UI's "nothing selected" — the one value the
        // wrapper in `ui/select.tsx` swallows on the way OUT and still accepts
        // on the way in.
        value={hydrated ? preset : null}
        onValueChange={actions.setPreset}
      >
        <SelectTrigger aria-label="Colour theme" className="w-44">
          {/*
            A FORMATTER, because the value is an id and the label is a word —
            the one trap `ui/select.tsx` documents in its own header. Bare, this
            would put "emerald" on the trigger.
          */}
          <SelectValue placeholder="Colour theme">
            {/*
              THE FORMATTER RUNS FOR THE NULL VALUE TOO, so it has to render the
              placeholder itself — children win over the `placeholder` prop, and
              a lookup that falls back to the default would put "Neutral" on the
              trigger before hydration, which is the wrong answer dressed as a
              confident one.
            */}
            {(value) => {
              const found = THEME_PRESETS.find((entry) => entry.id === value)
              return found === undefined ? (
                "Colour theme"
              ) : (
                <PresetOption preset={found} />
              )
            }}
          </SelectValue>
        </SelectTrigger>
        {/*
          TWO GROUPS, split on what a preset does to the RAIL. The tinted
          presets recolour the whole surface set in step; the solid-sidebar
          ones additionally paint the rail dark in both ramps, and their
          swatches carry a dark chip the tinted rows do not. Without the label
          that chip reads as five oddly-broken swatches rather than a family.
          Only the second group is labelled: a heading over the default set
          would name a distinction nobody has met yet.
        */}
        <SelectContent>
          <SelectGroup>
            {THEME_PRESETS.filter(
              (entry) => !SOLID_SIDEBAR_PRESET_IDS.includes(entry.id)
            ).map((entry) => (
              <SelectItem key={entry.id} value={entry.id}>
                <PresetOption preset={entry} />
              </SelectItem>
            ))}
          </SelectGroup>
          <SelectGroup>
            <SelectLabel>Solid sidebar</SelectLabel>
            {THEME_PRESETS.filter((entry) =>
              SOLID_SIDEBAR_PRESET_IDS.includes(entry.id)
            ).map((entry) => (
              <SelectItem key={entry.id} value={entry.id}>
                <PresetOption preset={entry} />
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>

      {/* THE THIRD AXIS, and it states neither a colour nor a polarity — so all
          three controls compose without any pair of them contradicting. */}
      <Select
        value={hydrated ? radius : null}
        onValueChange={actions.setRadius}
      >
        <SelectTrigger aria-label="Corner radius" className="w-32">
          <SelectValue placeholder="Corners">
            {/* Same as above: the null case is the placeholder, not the first
                option. */}
            {(value) => {
              const found = THEME_RADII.find((entry) => entry.id === value)
              return found === undefined ? (
                "Corners"
              ) : (
                <span className="flex min-w-0 items-center gap-2">
                  <RadiusMark id={found.id} />
                  <span className="truncate">{found.label}</span>
                </span>
              )
            }}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {THEME_RADII.map((entry) => (
            <SelectItem key={entry.id} value={entry.id}>
              <span className="flex min-w-0 items-center gap-2">
                <RadiusMark id={entry.id} />
                <span className="truncate">{entry.label}</span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/*
        Only in forced-colors mode, where it is the whole story: the UA
        overrides author `background-color` — inline styles included — so every
        swatch collapses to one system Canvas fill and the options become
        indistinguishable. Saying so beats a picker that silently does nothing.
        `hidden forced-colors:block` is the pattern `project-dot.tsx` and
        `hatch.ts` already use.
      */}
      <p className="hidden w-full text-xs text-muted-foreground forced-colors:block">
        Your operating system&apos;s colours override the theme, so these
        previews all look alike here.
      </p>
    </div>
  )
}

/** A swatch and a name, used identically on the trigger and in the list, so the
 *  closed state is a specimen of the open one. */
function PresetOption({ preset }: { preset: ThemePreset }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <Swatch preset={preset} />
      <span className="truncate">{preset.label}</span>
    </span>
  )
}

/**
 * Three chips of a preset the page is NOT currently wearing.
 *
 * INLINE LITERALS FROM THE TS OBJECT, never `var(--primary)`. A `var()` inside
 * this page resolves against the ACTIVE theme, so every option would preview
 * whatever is already applied and the list would be six identical strips. That
 * is the reason `theme-presets.ts` exists at all, and why a drift test compares
 * it against the CSS.
 *
 * BOTH RAMPS ARE RENDERED AND THE CASCADE CHOOSES between the two strips. Not
 * `preset[resolved][token]` — `resolved` is `"dark"` on the server and on the
 * first client render, so a specimen keyed off it would paint the dark ramp and
 * then snap. These strips are descendants of `<html class="dark">`, so
 * `@custom-variant dark (&:is(.dark *))` matches them and the right one is
 * already showing at first paint.
 */
function Swatch({ preset }: { preset: ThemePreset }) {
  return (
    <>
      <Strip preset={preset} ramp="light" className="flex dark:hidden" />
      <Strip preset={preset} ramp="dark" className="hidden dark:flex" />
    </>
  )
}

function Strip({
  preset,
  ramp,
  className,
}: {
  preset: ThemePreset
  ramp: "light" | "dark"
  className: string
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        // `--input`, not `--border`: a white chip on a white surface needs an
        // edge that clears 3:1, which is the control half of The Boundary Split
        // (DESIGN.md §2). The dividers between chips are the same tone for the
        // same reason — two of the three are frequently near-identical.
        "shrink-0 divide-x divide-input overflow-hidden rounded-sm border border-input",
        "forced-colors:border-[currentColor]",
        className
      )}
    >
      {SWATCH_TOKENS.map((token) => (
        <span
          key={token}
          className="size-3.5 forced-colors:bg-[Canvas]"
          style={{ background: preset[ramp][token] }}
        />
      ))}
    </span>
  )
}

/**
 * A corner, drawn at the radius it names.
 *
 * The literal value from `THEME_RADII` rather than `rounded-md`, for the same
 * reason the colour swatches carry literals: a utility resolves against the
 * ACTIVE radius, so every option would show the current one and the list would
 * be four identical squares.
 */
function RadiusMark({ id }: { id: ThemeRadiusId }) {
  const value = THEME_RADII.find((entry) => entry.id === id)?.value ?? "0rem"
  return (
    <span
      aria-hidden="true"
      className="size-3.5 shrink-0 border-2 border-foreground/70 border-r-transparent border-b-transparent"
      style={{ borderTopLeftRadius: value }}
    />
  )
}
