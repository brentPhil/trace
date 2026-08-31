# Building with Chroneli's design system

Chroneli is a time tracker. These are its real shipped components — shadcn
primitives on Base UI, styled with Tailwind v4 utilities over the shadcn token
set. Compose them; do not restyle them.

## Setup

**No global provider is required.** Most components render standalone. Four
need their own wrapper, mounted around the subtree that uses them:

| Wrapper | Needed by | Without it |
|---|---|---|
| `SidebarProvider` | every `Sidebar*` part | open/collapsed context missing |
| `TooltipProvider` | `Tooltip`, `TooltipTrigger`, `TooltipContent` | tooltip never opens |
| `Toaster` (mount once, near the root) | `useToastManager()` callers | `useToastManager()` throws |
| `ChartContainer` | every chart | chart has no config or sizing |

**Theme.** The palette answers two things on `<html>`: the `dark` class for the
dark ramp, and `data-theme="<preset>"` for the alternative palettes — `amber`,
`blue`, `emerald`, `espresso`, `forest`, `fuchsia`, `indigo`, `ink`, `lime`,
`midnight`, `plum`, `rose`, `teal`, `violet`. No attribute is the default
preset. Never set a design-system colour with an inline `style` — an inline
declaration outranks both `:root` and `.dark`, so that element stops answering
the theme.

## The styling idiom

Tailwind utility classes inline, over the **closed shadcn token set**. There is
no second styling system and no custom colour vocabulary: a colour name outside
this list does not exist here, and inventing one produces an element that stays
the wrong colour when someone picks a theme. Need a shade in between? Compose it
at the call site — `bg-primary/15`, `color-mix(...)` — rather than naming it.

**Colour tokens** (usable as `bg-`, `text-`, `border-`, `ring-`, and with an
opacity suffix like `/15`):

```
background  foreground
card        card-foreground
popover     popover-foreground
primary     primary-foreground
secondary   secondary-foreground
muted       muted-foreground
accent      accent-foreground
destructive
border  input  ring
sidebar  sidebar-foreground  sidebar-primary  sidebar-accent
sidebar-border  sidebar-ring
chart-1 … chart-5
```

**`destructive-foreground` does not exist in this palette.** Destructive text is
`text-destructive`; the destructive button variant handles its own fill.

**Type.** DM Sans is the body default — you do not need `font-sans`. Reach for
`font-mono` (IBM Plex Mono) for durations, times and any figure that must align
in a column, and pair it with `tabular-nums`. Durations read `2:45`, `32:15`.

**Radius** comes off `--radius`: `rounded-md` for fields, `rounded-2xl` for
buttons and pills, `rounded-3xl` for floating popups, `rounded-4xl` for cards
and modal surfaces. Use the step the existing components use rather than a
fixed pixel value, so the radius setting keeps working.

## Component notes worth knowing

- **Icons** take `data-icon="inline-start"` / `"inline-end"` inside a `Button`;
  the padding compensation keys off those attributes.
- **Composition uses `render={<X />}`, not `asChild`** — this is Base UI:
  `<DialogClose render={<Button variant="ghost">Cancel</Button>} />`.
- **`DropdownMenuLabel` must sit inside a `DropdownMenuGroup`** (or
  `DropdownMenuRadioGroup`), or the menu throws and renders nothing.
- **`Avatar` sizes via its `size` prop** (`sm` / `default` / `lg`), never a
  `size-*` class — the prop is what scales the fallback text and badge.
- **Charts**: import `BarChart`, `Bar`, `XAxis`, `YAxis`, `CartesianGrid`,
  `LineChart`, `Line`, `AreaChart`, `Area`, `PieChart`, `Pie`, `Cell` and
  friends **from this design system**, not from `recharts` — a second copy of
  recharts renders an empty chart. Use `ChartTooltip` / `ChartLegend` rather
  than recharts' own `Tooltip` / `Legend`.

## Where the truth lives

- This design system's `styles.css` and the files it `@import`s — the real
  compiled stylesheet, carrying every token value, both ramps and all fourteen
  presets. Read it before inventing a colour.
- `guidelines/DESIGN.md` — the normative design system: the typography and
  elevation argument, the Named Rules, and which rules were retired.
- `components/<group>/<Name>/<Name>.prompt.md` — the per-component API and
  usage. Read it before using a component you have not used here before.

## An idiomatic example

```jsx
<Card className="max-w-sm">
  <CardHeader>
    <CardTitle>This week</CardTitle>
    <CardDescription>Monday 25 – Sunday 31 August</CardDescription>
    <CardAction>
      <Button size="sm" variant="outline">Export</Button>
    </CardAction>
  </CardHeader>
  <CardContent>
    <div className="flex items-baseline gap-2">
      <span className="font-mono text-3xl tabular-nums">32:15</span>
      <span className="text-muted-foreground">of 40:00 tracked</span>
    </div>
  </CardContent>
</Card>
```

The control is a library component; the layout glue around it is plain Tailwind
over the tokens above. That is the whole idiom.
