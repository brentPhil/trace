import { useCallback, useEffect, useRef } from "react"
import { useLatest } from "@/hooks/use-latest"

/**
 * The one place in this product that touches `HTMLAudioElement`.
 *
 * It exists so that NO TEST EVER NEEDS REAL AUDIO. jsdom has no media stack —
 * `play()` is not implemented and returns undefined rather than a promise — so
 * every unit above this is written against `AudioHandle` and mocks this hook.
 *
 * The element is created imperatively rather than rendered as JSX, because a
 * rendered `<audio>` is subject to React reconciliation: a parent re-render
 * that changes its `src` prop restarts playback, and a key change unmounts it
 * mid-track.
 */
export type AudioHandle = {
  /** Loads a url and plays it. Resolves FALSE when the browser refused. */
  play: (url: string) => Promise<boolean>
  /** Resumes the loaded track. Resolves FALSE when the browser refused. */
  resume: () => Promise<boolean>
  pause: () => void
  /** Pause and forget the position — what "stop" means for music. */
  stop: () => void
  setVolume: (volume: number) => void
}

export function useAudioElement({
  onEnded,
  onError,
}: {
  onEnded: () => void
  onError: () => void
}): AudioHandle {
  const ref = useRef<HTMLAudioElement | null>(null)
  const ended = useLatest(onEnded)
  const errored = useLatest(onError)

  useEffect(() => {
    // SSR has no Audio constructor, and this hook is reached through the authed
    // layout, which renders on the server.
    if (typeof Audio === "undefined") return

    const element = new Audio()
    element.preload = "auto"
    ref.current = element

    const handleEnded = () => ended.current()
    const handleError = () => errored.current()
    element.addEventListener("ended", handleEnded)
    element.addEventListener("error", handleError)

    return () => {
      element.removeEventListener("ended", handleEnded)
      element.removeEventListener("error", handleError)
      element.pause()
      // Releases the decoder and any in-flight range request. Without it a
      // hot reload in development leaks one buffering element per reload.
      element.src = ""
      ref.current = null
    }
  }, [ended, errored])

  /**
   * `play()` REJECTS when the browser has seen no user gesture, and that is a
   * normal outcome rather than an error — a restored session or a programmatic
   * start hits it every time. Swallowing the rejection and reporting `false`
   * is what lets the caller show a "click to play" affordance instead of
   * failing silently, which is the single most likely way this feature ships
   * looking broken.
   */
  const attempt = useCallback(async (element: HTMLAudioElement): Promise<boolean> => {
    try {
      await element.play()
      return true
    } catch {
      return false
    }
  }, [])

  const play = useCallback(
    async (url: string): Promise<boolean> => {
      const element = ref.current
      if (element === null) return false
      if (element.src !== url) {
        element.src = url
        element.currentTime = 0
      }
      return await attempt(element)
    },
    [attempt]
  )

  const resume = useCallback(async (): Promise<boolean> => {
    const element = ref.current
    if (element === null || element.src === "") return false
    return await attempt(element)
  }, [attempt])

  const pause = useCallback(() => {
    ref.current?.pause()
  }, [])

  const stop = useCallback(() => {
    const element = ref.current
    if (element === null) return
    element.pause()
    element.currentTime = 0
  }, [])

  const setVolume = useCallback((volume: number) => {
    const element = ref.current
    if (element === null) return
    element.volume = Math.min(1, Math.max(0, volume))
  }, [])

  return { play, resume, pause, stop, setVolume }
}
