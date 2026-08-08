import * as React from "react"

// 768 MUST equal Tailwind's `md` breakpoint. src/components/ui/sidebar.tsx
// hides the desktop sidebar with `hidden md:block` and shows the Sheet when
// this hook is true; if the two numbers drift apart, one viewport range gets
// neither, and the sidebar silently disappears with no error anywhere.
const MOBILE_BREAKPOINT = 768

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }
    mql.addEventListener("change", onChange)
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return !!isMobile
}
