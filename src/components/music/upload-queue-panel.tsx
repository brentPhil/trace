import { Check, RotateCw, TriangleAlert, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { formatBytes } from "@shared/audio"

/*
 * What an upload looks like while it is happening.
 *
 * This panel exists because the page's only report was `report(thrown)` — a
 * toast carrying the backend's sentence and nothing else. The backend's
 * sentences are written about tracks in general ("A track needs a name."),
 * never about THIS file, so a folder drop with three bad files produced three
 * identical eight-second toasts and no way to tell which three. A row that
 * persists, names its file, and offers a retry is the fix; a nicer toast is not.
 *
 * Presentational only. The page owns the queue and every transition in it.
 */

export type UploadStatus =
  | "queued"
  | "uploading"
  | "saving"
  | "done"
  | "failed"
  /** Its OWN state rather than a `failed` with a friendly reason: a
   *  cancellation is something the user chose, and drawing it in `alarm`
   *  beside a warning triangle would be the interface treating their decision
   *  as a problem. It still offers Retry, because "wrong file" is the usual
   *  reason to cancel and starting over is the usual next step. */
  | "cancelled"

export type QueuedUpload = {
  id: string
  /** Retained so Retry can re-send without asking for the file again. */
  file: File
  name: string
  bytes: number
  sent: number
  status: UploadStatus
  reason?: string
}

/** The shared spelling, so a queue row and the meter beneath it cannot
 *  disagree by a decimal — or by a unit, now that a track can be large enough
 *  for the two to differ on whether to say MB or GB at all. */
const mb = formatBytes

/**
 * The one sentence a screen reader hears.
 *
 * ONLY this line is a live region. A row per file would announce thirty times
 * for a folder drop, at a rate no one can follow; the count carries the same
 * information at a rate a person can.
 */
function summarise(items: Array<QueuedUpload>): string {
  const done = items.filter((item) => item.status === "done").length
  const failed = items.filter((item) => item.status === "failed").length
  const running = items.filter(
    (item) => item.status === "uploading" || item.status === "saving"
  ).length

  const cancelled = items.filter((item) => item.status === "cancelled").length

  if (running > 0) return `Uploading ${done + 1} of ${items.length}`
  // Cancellations are counted separately from failures, so a batch the user
  // deliberately stopped does not report itself back to them as broken.
  const tail = [
    failed > 0 ? `${failed} failed` : null,
    cancelled > 0 ? `${cancelled} cancelled` : null,
  ].filter((part) => part !== null)
  return [`${done} added`, ...tail].join(" · ")
}

/** The three states a row can end in, and so the ones a Dismiss can clear. */
function isFinished(status: UploadStatus): boolean {
  return status === "done" || status === "failed" || status === "cancelled"
}

export function UploadQueuePanel({
  items,
  onRetry,
  onCancel,
  onDismiss,
}: {
  items: Array<QueuedUpload>
  onRetry: (id: string) => void
  onCancel: (id: string) => void
  onDismiss: () => void
}) {
  if (items.length === 0) return null

  const settled = items.every((item) => isFinished(item.status))

  return (
    <section
      aria-label="Uploads"
      className="flex flex-col rounded-md border border-edge-soft"
    >
      <header className="flex items-center justify-between gap-3 border-b border-edge-soft px-3 py-2">
        <p aria-live="polite" className="text-sm text-muted-foreground">
          {summarise(items)}
        </p>
        {settled ? (
          <Button type="button" variant="quiet" size="xs" onClick={onDismiss}>
            Dismiss
          </Button>
        ) : null}
      </header>

      <ul className="flex flex-col">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex items-center gap-3 border-b border-edge-soft px-3 py-2 last:border-b-0"
          >
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex items-center gap-2">
                {item.status === "done" ? (
                  <Check className="size-3.5 shrink-0 text-muted-foreground" />
                ) : null}
                {item.status === "failed" ? (
                  <TriangleAlert className="size-3.5 shrink-0 text-alarm" />
                ) : null}
                <span
                  className={cn(
                    "min-w-0 truncate text-sm",
                    item.status === "queued" && "text-muted-foreground"
                  )}
                >
                  {item.name}
                </span>
              </div>

              {item.status === "uploading" ? (
                <div
                  aria-hidden="true"
                  className="h-1 overflow-hidden rounded-full bg-surface-raised"
                >
                  <div
                    className="h-full rounded-full bg-ink-muted transition-[width]"
                    style={{
                      width: `${((item.sent / Math.max(1, item.bytes)) * 100).toFixed(1)}%`,
                    }}
                  />
                </div>
              ) : null}

              {item.status === "failed" ? (
                <p className="text-xs text-alarm">{item.reason}</p>
              ) : null}

              {item.status === "cancelled" ? (
                <p className="text-xs text-muted-foreground">Cancelled</p>
              ) : null}
            </div>

            <span className="shrink-0 font-mono text-xs tracking-[-0.02em] text-muted-foreground tabular-nums">
              {item.status === "uploading"
                ? `${mb(item.sent)} of ${mb(item.bytes)}`
                : item.status === "saving"
                  ? "Saving…"
                  : mb(item.bytes)}
            </span>

            {/* Cancel is offered while there is still something to stop. The
                `saving` step is deliberately NOT cancellable: the bytes have
                already been paid for and `addTrack` is a short call, so an
                abort there would orphan a stored blob to save nothing. */}
            {item.status === "queued" || item.status === "uploading" ? (
              <Button
                type="button"
                variant="quiet"
                size="icon-row"
                aria-label={`Cancel ${item.name}`}
                onClick={() => onCancel(item.id)}
              >
                <X className="size-4" />
              </Button>
            ) : null}

            {item.status === "failed" || item.status === "cancelled" ? (
              <Button
                type="button"
                variant="quiet"
                size="icon-row"
                aria-label={`Retry ${item.name}`}
                onClick={() => onRetry(item.id)}
              >
                <RotateCw className="size-4" />
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  )
}
