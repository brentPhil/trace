import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react"

/**
 * The live region.
 *
 * Starting and stopping a timer changes almost nothing visually — a button's
 * icon, a colour, a number that was already there. For anyone not watching the
 * pixels, the single most important state in the product would change with no
 * feedback at all. This is that feedback.
 *
 * `polite`, not `assertive`: the user pressed the button, so they are not being
 * interrupted with news, only told the thing they asked for happened.
 *
 * The message is re-set with a zero-width suffix when it repeats, because a
 * live region whose text does not change is not re-announced — so stopping two
 * identical timers in a row would announce once and stay silent the second
 * time, exactly when the user most needs to know it worked.
 */
const AnnouncerContext = createContext<(message: string) => void>(() => {})

export function useAnnounce(): (message: string) => void {
  return useContext(AnnouncerContext)
}

export function Announcer({ children }: { children: React.ReactNode }) {
  const [message, setMessage] = useState("")
  const toggle = useRef(false)

  const announce = useCallback((text: string) => {
    // A zero-width space, written as an escape so it is visible in the source.
    // It makes the string differ from the previous one without changing a
    // single spoken character.
    toggle.current = !toggle.current
    setMessage(toggle.current ? text : `${text}\u200B`)
  }, [])

  const value = useMemo(() => announce, [announce])

  return (
    <AnnouncerContext.Provider value={value}>
      {children}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {message}
      </div>
    </AnnouncerContext.Provider>
  )
}

