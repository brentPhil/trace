import { Check, RotateCw, TriangleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

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

export type UploadStatus = "queued" | "uploading" | "saving" | "done" | "failed"

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

/** Megabytes as `formatMb` writes them, kept identical so the queue row and
 *  the meter beneath it never disagree by a decimal. */
function mb(bytes: number): string {
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`
}

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

  if (running > 0) return `Uploading ${done + 1} of ${items.length}`
  if (failed > 0) return `${done} added · ${failed} failed`
  return `${done} added`
}

export function UploadQueuePanel({
  items,
  onRetry,
  onDismiss,
}: {
  items: Array<QueuedUpload>
  onRetry: (id: string) => void
  onDismiss: () => void
}) {
  if (items.length === 0) return null

  const settled = items.every(
    (item) => item.status === "done" || item.status === "failed"
  )

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
            </div>

            <span className="shrink-0 font-mono text-xs tracking-[-0.02em] text-muted-foreground tabular-nums">
              {item.status === "uploading"
                ? `${mb(item.sent)} of ${mb(item.bytes)}`
                : item.status === "saving"
                  ? "Saving…"
                  : mb(item.bytes)}
            </span>

            {item.status === "failed" ? (
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
