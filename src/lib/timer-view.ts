export type TimerView = "calendar" | "list"

/** Namespaced, because `localStorage` is one flat map shared with everything
 *  else this origin ever stores. */
export const TIMER_VIEW_KEY = "trace.timer.view"

/** The second preference this page remembers: whether a note is clipped to one
 *  line or written out in full. Same namespace, same rules — see below. */
export const TIMER_NOTES_KEY = "trace.timer.notes"

/**
 * Whether /timer opens on the calendar or the log, remembered between visits.
 *
 * WHY THIS IS READ AFTER THE FIRST PAINT AND THE SIDEBAR'S IS NOT.
 *
 * `sidebar-cookie.ts` persists its preference in a COOKIE, and its comment says
 * why: the cookie travels with the request, so the server rendering the page
 * and the browser hydrating it observe the same value, and the sidebar can be
 * correct in the very first byte of HTML. It has to be — an expanded sidebar
 * collapsing on hydration moves every pixel of the page sideways.
 *
 * `localStorage` cannot do that. It does not exist on the server, so a
 * `useState(() => localStorage.getItem(...))` initializer renders one thing on
 * the server and another in the browser, and React's hydration either warns and
 * patches or (in the concurrent renderer) throws the whole tree away. So the
 * default renders first and the stored value is adopted in an effect. What that
 * costs is one frame of List before Calendar appears, and this is a tab swap
 * INSIDE the page rather than the shell around it, so nothing above it moves.
 *
 * A cookie would work here too and is deliberately not used: a preference that
 * belongs to one page has no business being attached to every request the app
 * makes, including the ones that upload files.
 *
 * `try`/`catch` around both, and not defensively-in-general: Safari's private
 * mode throws `QuotaExceededError` on `setItem`, and a browser configured to
 * block site data throws on ACCESS to `localStorage` itself. A time tracker
 * that white-screens because it could not read which tab you were last on is a
 * worse failure than one that forgets.
 */
export function readStoredView(): TimerView | null {
  if (typeof window === "undefined") return null
  try {
    const stored = window.localStorage.getItem(TIMER_VIEW_KEY)
    return stored === "calendar" || stored === "list" ? stored : null
  } catch {
    return null
  }
}

export function writeStoredView(view: TimerView): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(TIMER_VIEW_KEY, view)
  } catch {
    // Nothing to do and nothing to say: the preference is a convenience, and
    // the view the user just chose is already on screen.
  }
}

/*
 * WHETHER NOTES ARE WRITTEN OUT IN FULL, remembered the same way and for a
 * stronger reason than the view is.
 *
 * The log clips a note to one line, because a row is a row and fifty of them
 * have to be scannable. But the thing this product exists to capture is the
 * prose, and reading it back — at a standup, or writing an invoice line — is
 * the one moment where a clipped note is the wrong shape entirely. That is a
 * MODE the reader is in for the length of a meeting, not a per-row gesture, so
 * it has to survive a reload the way the view does.
 *
 * `"full"` / `"clipped"` rather than `"true"` / `"false"`: the same named-value
 * shape as the view above, which is what lets a value nobody wrote be REFUSED
 * rather than coerced. `Boolean("false")` is `true`, and a stray key would
 * otherwise pin the log open with no way to read what went wrong.
 *
 * Everything the view's own note says about `localStorage` — read after the
 * first paint, never in a state initializer, `try`/`catch` around both ends —
 * applies here unchanged.
 */
export function readStoredNotes(): boolean | null {
  if (typeof window === "undefined") return null
  try {
    const stored = window.localStorage.getItem(TIMER_NOTES_KEY)
    if (stored === "full") return true
    if (stored === "clipped") return false
    return null
  } catch {
    return null
  }
}

export function writeStoredNotes(full: boolean): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(TIMER_NOTES_KEY, full ? "full" : "clipped")
  } catch {
    // As above: a preference the user has already been given on screen.
  }
}
