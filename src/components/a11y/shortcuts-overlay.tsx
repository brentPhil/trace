import { useEffect, useState } from "react"
import { Dialog } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

/**
 * The `?` overlay.
 *
 * Every shortcut in the product, in one place, reachable from anywhere. The
 * alternative is a set of bindings only the person who wrote them knows about,
 * which is the same as not having them.
 *
 * Opened by `?` — deliberately a key that requires Shift on most layouts, so it
 * cannot be hit while typing a note. Suppressed inside any text field anyway,
 * because "?" is a character people write.
 */
const SHORTCUTS: Array<{ group: string; items: Array<[string, string]> }> = [
  {
    group: "Tracking",
    items: [
      ["Enter", "Start or stop the timer, from the title field"],
      ["Esc", "Dismiss a picker, a suggestion list, or an editor"],
    ],
  },
  {
    group: "Editing an entry",
    items: [
      ["Click", "Edit any field in place — title, times, duration"],
      ["Enter", "Commit the edit"],
      ["Esc", "Revert it and return focus to where it was"],
      ["⌘ / Ctrl + Enter", "Save the note sheet"],
    ],
  },
  {
    group: "History",
    items: [
      ["←", "Previous period, keeping every filter"],
      ["→", "Next period"],
    ],
  },
  {
    group: "Anywhere",
    items: [
      ["?", "This list"],
      ["F6", "Move focus into a toast, to reach Undo"],
    ],
  },
]

export function ShortcutsOverlay() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "?") return
      const target = event.target
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
      ) {
        return
      }
      event.preventDefault()
      setOpen((o) => !o)
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [])

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Popup className="sm:w-[32rem]">
        <Dialog.Title>Keyboard shortcuts</Dialog.Title>
        <div className="flex flex-col gap-4">
          {SHORTCUTS.map((group) => (
            <div key={group.group} className="flex flex-col gap-1.5">
              <h3 className="text-xs font-medium text-muted-foreground">
                {group.group}
              </h3>
              <dl className="flex flex-col gap-1">
                {group.items.map(([key, description]) => (
                  <div key={key} className="flex items-baseline gap-3 text-sm">
                    <dt className="w-32 shrink-0">
                      <kbd
                        className={cn(
                          "rounded border border-edge-soft bg-ground px-1.5 py-0.5",
                          "font-mono text-[0.7rem]"
                        )}
                      >
                        {key}
                      </kbd>
                    </dt>
                    <dd className="min-w-0 flex-1 text-muted-foreground">
                      {description}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      </Dialog.Popup>
    </Dialog.Root>
  )
}
