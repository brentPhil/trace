import { useEffect, useLayoutEffect, useRef, useState } from "react"

/**
 * `static`  — draw the finished state and animate nothing.
 * `pending` — below the fold and waiting; the call site may hide its parts.
 * `in`      — scrolled into view; the call site plays its entrance, once.
 */
export type Reveal = "static" | "pending" | "in"

/**
 * One-shot scroll reveal that ENHANCES a finished default, never gates it.
 *
 * `static` is the server render, the first client render, and the permanent
 * answer wherever a reveal cannot be trusted or is not wanted: no
 * `IntersectionObserver` (jsdom, old engines), `prefers-reduced-motion`, or an
 * element that is already on screen when the page hydrates — hiding that one
 * to replay its entrance would be a flash, not a reveal. Only an element that
 * starts below the fold ever becomes `pending`, so nothing a visitor has
 * already seen disappears, and a page whose script never runs is complete.
 *
 * `useLayoutEffect`, so the switch to `pending` lands before the first paint
 * after hydration rather than one frame into it.
 */
export function useReveal<T extends Element>(): [
  React.RefObject<T | null>,
  Reveal,
] {
  const ref = useRef<T>(null)
  const [reveal, setReveal] = useState<Reveal>("static")

  useLayoutEffect(() => {
    const el = ref.current
    if (el === null || typeof IntersectionObserver === "undefined") return
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    if (el.getBoundingClientRect().top < window.innerHeight) return

    setReveal("pending")
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setReveal("in")
          observer.disconnect()
        }
      },
      // A fifth of the way up the screen, so the entrance plays where the eye
      // is rather than at the very bottom edge.
      { rootMargin: "0px 0px -20% 0px" }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return [ref, reveal]
}

/** Stagger, as a style prop: `animation-delay` for the i-th sibling. */
export function staggerDelay(index: number, stepMs: number, baseMs = 0) {
  return { animationDelay: `${baseMs + index * stepMs}ms` }
}

/**
 * Types `text` out once `active`, a character at a time, and reports when it
 * has finished. Returns "" until it starts, so the caller keeps drawing its
 * untouched state — the point of the effect is the change FROM that state.
 */
export function useTyped(
  text: string,
  active: boolean,
  { startMs = 900, stepMs = 34 } = {}
): { typed: string; done: boolean } {
  const [count, setCount] = useState(0)

  useEffect(() => {
    if (!active) return
    let interval: ReturnType<typeof setInterval> | undefined
    const start = setTimeout(() => {
      interval = setInterval(() => {
        setCount((c) => {
          if (c + 1 >= text.length && interval) clearInterval(interval)
          return Math.min(c + 1, text.length)
        })
      }, stepMs)
    }, startMs)
    return () => {
      clearTimeout(start)
      if (interval) clearInterval(interval)
    }
  }, [active, text, startMs, stepMs])

  return { typed: text.slice(0, count), done: count >= text.length }
}

/**
 * 0 → 1 over `durationMs` once the reveal is `in`, eased out (quart) so a
 * counting figure lands softly on its real value. `static` is 1 and `pending`
 * is 0, so the finished number is what a reader without motion sees.
 *
 * `requestAnimationFrame` never fires in a hidden tab, which is fine here and
 * only here: `pending` needs an IntersectionObserver callback to become `in`,
 * and those do not fire in a hidden tab either.
 */
export function useCountProgress(reveal: Reveal, durationMs = 1100): number {
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    if (reveal !== "in") return
    let frame = 0
    const startedAt = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - startedAt) / durationMs)
      setProgress(1 - (1 - t) ** 4)
      if (t < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [reveal, durationMs])

  if (reveal === "static") return 1
  if (reveal === "pending") return 0
  return progress
}
