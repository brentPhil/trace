import { useEffect, useId, useRef, useState } from "react"
import { Check, Copy } from "lucide-react"
import { useAnnounce } from "@/components/a11y/announcer"
import { Button } from "@/components/ui/button"
import { Toast } from "@/components/ui/toast"
import { copyToClipboard } from "@/lib/copy-to-clipboard"

/** How long the button stays on "Copied", in ms. Long enough to be seen after
 *  the eye has left the button, short enough that a second copy is obviously a
 *  second copy rather than the first one still showing. */
const CONFIRM_MS = 2000

/**
 * The log, onto the clipboard — every record on screen and every note with it.
 *
 * PRESENTATIONAL ABOUT WHAT IT COPIES, which is the whole design. It is handed
 * a thunk rather than a string: the text is a full transcript of the log and
 * building it on every render, for a button nobody has pressed, would be a
 * scan of every entry on screen per keystroke in the search box. It is built
 * once, on the click, from whatever the caller's `build` closes over — which is
 * the same `groups` the log beside it is drawing, so "copy what I am looking
 * at" is true by construction rather than by two functions agreeing.
 *
 * WHY IT IS NOT PART OF `ExportMenu`. Those three produce a FILE for someone
 * else — a client, an accountant — and are disabled outright when the figures
 * on the page are a floor, because a wrong total in an emailed PDF is the worst
 * thing that feature can do. This produces text for the user's own next
 * sentence, carries no money, and is honest about a partial log by saying how
 * many records it copied. Folding it into that menu would inherit a refusal
 * written for a different risk.
 *
 * `count` IS A PROP, not derived from the built text, because the button has to
 * be able to refuse BEFORE building anything: an empty log gives a disabled
 * control with a reason on it rather than a button that copies a header and no
 * rows.
 */
/** Why an empty log cannot be copied. Stated here so the two places that read
 *  it — the control's `disabled` and its description — cannot disagree. */
const NOTHING_TO_COPY = "There are no records to copy."

export function CopyEntriesButton({
  count,
  build,
  disabledReason = null,
  className,
}: {
  /** Records the copy will contain — the number the announcement names, and
   *  what decides whether there is anything to copy at all. */
  count: number
  /** Called on click. Returns the whole clipboard text. */
  build: () => string
  /**
   * Non-null refuses the copy and is announced as the control's description.
   *
   * FOR "THESE ARE NOT ALL THE ROWS YET", which the button cannot see for
   * itself. `build` produces a header stating a record count and a total under
   * the range the caller named, and a caller whose log is half-paginated would
   * have that floor read as the answer for the whole range. Only the page
   * knows it is still loading, so only the page can say so — the same posture
   * `ExportMenu` takes with a truncated breakdown, and for the same reason: a
   * refusal on the control beats a wrong figure in someone's standup note.
   */
  disabledReason?: string | null
  className?: string
}) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const toasts = Toast.useToastManager()
  const announce = useAnnounce()
  const reasonId = useId()

  // Cleared on unmount: /reports swaps this whole tab out on a click of the
  // switcher, and a timer that fires afterwards is a setState on a component
  // that is gone.
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current)
    },
    []
  )

  /*
   * ONE REASON, and an empty log outranks the caller's.
   *
   * "Nothing to copy" is the more basic refusal — a caller that is still
   * loading has nothing on screen either, and naming the pagination in that
   * state would explain a button the reader has no rows behind yet.
   */
  const reason = count === 0 ? NOTHING_TO_COPY : disabledReason

  async function run() {
    const ok = await copyToClipboard(build())

    if (!ok) {
      /*
       * Said out loud, never swallowed. A clipboard write can be refused by the
       * browser (no secure context, the document not focused, a permission
       * denied) and the button gives no other sign — the reader would paste
       * whatever was on the clipboard before, into a message they are about to
       * send.
       */
      toasts.add({
        title: "Could not copy to the clipboard.",
        priority: "high",
      })
      return
    }

    setCopied(true)
    // The COUNT, not "Copied": a button whose label flips to a tick tells a
    // sighted reader it worked, and the number is the part that says what
    // "it" was — the same figure the sentence beside this control reports.
    announce(`Copied ${count} ${count === 1 ? "record" : "records"}`)
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), CONFIRM_MS)
  }

  return (
    <>
      <Button
        variant="outline"
        type="button"
        disabled={reason !== null}
        aria-describedby={reason === null ? undefined : reasonId}
        onClick={() => void run()}
        className={className}
      >
        {/*
          The icon swaps and the WORD swaps with it. State carried by an icon
          alone would be a tick against a label still reading "Copy", which is
          two claims at once; DESIGN.md's rule about colour applies to shape for
          the same reason. No transition, so there is nothing for
          `prefers-reduced-motion` to opt out of.
        */}
        {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        {copied ? "Copied" : "Copy"}
      </Button>
      {/*
        Rendered rather than put in `title`, the same as `ExportMenu`'s: a
        tooltip on a DISABLED control is unreachable by keyboard and invisible
        to a screen reader, which is exactly the reader who cannot see that the
        log below is empty or still filling.
      */}
      {reason === null ? null : (
        <span id={reasonId} className="sr-only">
          {reason}
        </span>
      )}
    </>
  )
}
