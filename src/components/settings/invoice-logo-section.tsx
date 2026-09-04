import { useState } from "react"
import { Button, buttonVariants } from "@/components/ui/button"
import { Upload } from "lucide-react"
import { cn } from "@/lib/utils"
import { LOGO_INPUT_ACCEPT, MAX_LOGO_BYTES } from "@shared/logo"

/**
 * The invoice logo: a preview of the thing as it will actually print, plus the
 * two controls that change it.
 *
 * THE TILE IS TRANSPARENT, and that is a decision with a cost this comment is
 * going to keep stating.
 *
 * It was `bg-white` for one release, and the argument was good: an invoice is a
 * white PDF (`PAPER` in `src/lib/export/pdf/paper.ts`, every figure in it
 * measured against white), so a light wordmark — the common case, since most
 * marks are drawn for dark-on-light documents — looked correct on a dark tile
 * and arrived on the invoice invisible. A preview that agrees with the room
 * instead of with the artifact has failed at the one job it has.
 *
 * IT IS TRANSPARENT ANYWAY, by explicit request, because a white plate in a
 * column of dark controls is a hole in the page and reads as a bug before it
 * reads as paper. What is given up is precise: in the DARK ramp a white-on-
 * transparent mark now shows as white-on-near-black, which is legible here and
 * says nothing about how it will print. The lit ramp gives it back for free —
 * Surface is near-white there, so the preview is honest again without a plate.
 *
 * SO THE SENTENCE BELOW THE TILE CARRIES IT INSTEAD: "Prints on white paper."
 * That is the last remaining statement of the fact, which is why it is not
 * optional and why it names the paper rather than the tile.
 *
 * AND THERE IS NO TILE AT ALL ANY MORE. The mark is shown bare, at its own
 * aspect, bounded by a row height. It was `object-contain` inside a 25:8 box —
 * the proportions of `LOGO_BOX` in `src/lib/export/pdf/invoice-doc.ts` — so
 * that the preview showed the FIT: a tall square mark letterboxed into a wide
 * slot was discoverable here rather than on an invoice already sent. That is
 * given up, by explicit request, and the note on the `<img>` below records
 * exactly what was traded. The export is untouched; only the preview is.
 *
 * WHAT KEEPS A FRAME IS THE ABSENCE, not the mark: with no logo there is
 * nothing on the row to see or to aim at, so the empty state is a dashed
 * rectangle — the product's standard treatment for a space that will hold
 * something. It goes away the moment a logo exists.
 *
 * THE PICKER IS A LABEL STYLED AS A BUTTON wrapping an `sr-only` input, which
 * is the pattern `/music` settled on and wrote down: "the browser's own picker
 * chrome was the one control on this page drawn by the engine rather than by
 * the design system". This section was the last bare `<input type="file">` in
 * the product. It also permanently read "No file chosen" — beside a preview of
 * the logo that was very much chosen — because the input is reset after every
 * pick so the same file can be re-selected after a rejection.
 *
 * THE MARK'S OWN ROW IS THE DROP TARGET, and there is no dashed band while a
 * logo exists. /music argues that one out at length: a dedicated drop zone is a
 * second control for what the picker already does, and it costs a permanent
 * strip of the page to advertise a gesture people discover by trying it. The
 * row already exists to show the logo, so making it the target adds no chrome
 * at all — it is the thing you would drop onto anyway.
 *
 * Every write is a prop. The page owns the mutations; this stays renderable
 * against fixtures with no backend near it, the same invariant `TimerBar` and
 * `EntryRow` hold.
 */
export function InvoiceLogoSection({
  logoUrl,
  busy,
  online,
  onFile,
  onRemove,
}: {
  /** `null` is "no logo set", which is a real state and the default. */
  logoUrl: string | null
  /** An upload or a removal is in flight. Both controls go inert. */
  busy: boolean
  /** Offline, the picker and the Remove button are inert too — this section
   *  is wrapped in a disabled `<fieldset>` by its caller for that half, but
   *  the drop target below bypasses that wrapper entirely (a drop never
   *  passes through the disabled elements) and has to be told directly, the
   *  same reasoning `/music`'s drop handler already carries. Rendered from a
   *  prop, like every other piece of state a component in this repo takes,
   *  rather than reading connection state itself. */
  online: boolean
  onFile: (file: File) => void
  onRemove: () => void
}) {
  const [dragging, setDragging] = useState(false)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start gap-3">
        <div
          onDragOver={(event) => {
            event.preventDefault()
            setDragging(true)
          }}
          // Cleared on leave as well as on drop: a drag that ends outside the
          // window fires neither `drop` nor `dragend` on this element, and a
          // tile left ringed is a control claiming to be armed when it is not.
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault()
            setDragging(false)
            // Repeated here even though both controls are disabled while busy
            // or offline: a drop bypasses the disabled elements entirely, so
            // the guard has to exist on this path too. Same reasoning
            // `/music` records.
            if (busy || !online) return
            // `length`, not `files[0] !== undefined`: the index signature is
            // typed `File` rather than `File | undefined`, so the undefined
            // check is dead to the type checker while the empty drop it guards
            // against is entirely real.
            if (event.dataTransfer.files.length === 0) return
            onFile(event.dataTransfer.files[0])
          }}
          className={cn(
            // NO FRAME. See the note above: this element exists to catch a drop
            // and to position the busy scrim, and it draws nothing of its own —
            // `h-20` is the only size it imposes, and the mark keeps its own
            // aspect inside that height.
            "relative flex h-20 shrink-0 items-center",
            "rounded-md transition-[box-shadow] duration-100 ease-out motion-reduce:transition-none",
            dragging && "ring-2 ring-ring"
          )}
        >
          {logoUrl === null ? (
            /*
              THE EMPTY STATE KEEPS A FRAME, and it is the one thing here that
              still has one. Without a logo there is nothing on this row at all
              — no shape, no target, and no way to know a drop is possible — so
              the dashed rectangle IS the control in that state. It is the same
              `Empty` treatment the rest of the product uses: dashed marks a
              space that will hold something, solid marks a panel that holds
              nothing.

              It disappears the moment a logo exists, which is the whole point:
              the frame belonged to the absence, never to the mark.

              `--muted-foreground`, not `text-neutral-500`. That was correct
              for exactly as long as this sat on a white plate — a string
              coloured for paper rather than for the surface it is on — and
              wrong the moment the plate went. A literal Tailwind grey is also a
              colour no theme can reach.
            */
            <span
              className={cn(
                "flex h-full w-52 items-center justify-center px-2",
                "rounded-md border border-dashed border-input",
                "text-center text-xs text-muted-foreground"
              )}
            >
              Drop an image here
            </span>
          ) : (
            /*
              THE MARK, AND NOTHING AROUND IT. `max-h-full` with `w-auto` so it
              keeps its own aspect at whatever width that implies, bounded only
              by the row's height and a sane maximum width.

              THIS IS NO LONGER A FIT PREVIEW, and that is worth being explicit
              about because it used to be one. The image was `object-contain`
              inside a 25:8 box — the proportions of `LOGO_BOX` in
              `src/lib/export/pdf/invoice-doc.ts` — and anchored
              `object-right-top` because that is where `drawImageOp` puts it
              (`x + width - w`, `y + height - h`; `render-image.test.ts` is
              named for that anchoring). A tall square mark letterboxed into a
              wide slot was a thing you could discover here rather than on an
              invoice you had already sent.

              What is shown now is the FILE, not its placement. The fit and the
              anchoring are still exactly as they were in the PDF — nothing
              about the export changed — they are simply no longer previewed,
              and `render-image.test.ts` is the only remaining guard on them.
            */
            <img
              src={logoUrl}
              alt=""
              className="max-h-full w-auto max-w-52 object-contain"
            />
          )}

          {/*
            BUSY IS SAID, not just enforced. `busy` used to only disable the
            controls, so an upload of a 1 MB file over a slow link looked
            exactly like a click that had not registered — and the one thing
            worse than a slow upload is one you cannot tell is happening.
          */}
          {busy ? (
            <div
              className={cn(
                "absolute inset-0 flex items-center justify-center",
                // The room's own scrim, for the same reason the empty state
                // above went back to the room's own muted ink.
                "bg-background/80 text-xs font-medium text-foreground"
              )}
            >
              Uploading…
            </div>
          ) : null}
        </div>

        <div className="flex flex-col items-start gap-2">
          {/*
            A LABEL STYLED AS A BUTTON around an `sr-only` input — /music's
            pattern, and the reason the browser's own "Choose File / No file
            chosen" chrome is gone. The `aria-label` is unchanged, so this is
            still the same control to a screen reader and to every test that
            finds it by that name.
          */}
          <label
            className={cn(
              buttonVariants({ variant: "outline", size: "sm" }),
              "cursor-pointer",
              (busy || !online) && "pointer-events-none opacity-50"
            )}
          >
            <Upload className="size-4" aria-hidden="true" />
            {logoUrl === null ? "Choose image" : "Replace"}
            <input
              type="file"
              accept={LOGO_INPUT_ACCEPT}
              disabled={busy || !online}
              aria-label="Invoice logo file"
              onChange={(event) => {
                const file = event.target.files?.[0]
                // Cleared so choosing the SAME file again still fires `change`
                // — what a person does after a rejection they have since
                // fixed, and the one case a file input swallows silently.
                event.target.value = ""
                if (file !== undefined) onFile(file)
              }}
              className="sr-only"
            />
          </label>

          {logoUrl === null ? null : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy || !online}
              onClick={onRemove}
            >
              Remove logo
            </Button>
          )}
        </div>
      </div>

      {/*
        The bound the BACKEND enforces, stated where the choice is made rather
        than discovered by rejection — and the paper is stated here because
        nothing else states it any more. The preview used to sit on a white
        plate that said "this prints on paper" without words; the plate is gone
        by request, so the sentence carries it alone.
      */}
      <p className="text-xs text-muted-foreground">
        PNG or JPEG, up to {MAX_LOGO_BYTES / (1024 * 1024)} MB. Prints on white
        paper, so a white mark will not show.
      </p>
    </div>
  )
}
