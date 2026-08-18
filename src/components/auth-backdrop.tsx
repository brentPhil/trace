/**
 * The ground behind the auth screens: the calendar's own hour rules.
 *
 * THE PRODUCT'S OWN MATERIAL, NOT ORNAMENT. The pitch is 48px, which is
 * `SLOT_MIN_HEIGHT` in `calendar-panel.tsx` — the height of one hour on the
 * grid this app is built around — and the colour is `edge-soft`, the same token
 * that draws those rules. So the sign-in screen is standing on a piece of the
 * instrument rather than on a decorated backdrop. Nothing here is invented: no
 * gradient, no illustration, no new token, and no colour the palette does not
 * already spend elsewhere.
 *
 * IT HAD TO BE THIS OR NOTHING. `enlarger` means *a timer is running* (the Cold
 * Light Rule) and `brass` means *money* (the Two Temperatures Rule), and on a
 * screen where nothing is running and no money is shown, both are lies. That
 * leaves the neutral ramp, which is why the only expressive move available is
 * texture — and why it has to be the product's texture.
 *
 * STATIC, deliberately. PRODUCT.md bans motion that conveys no state, and a
 * login screen has no state to convey. There is nothing here to give a
 * `prefers-reduced-motion` alternative to, which is the point.
 *
 * The mask is what keeps it a texture rather than a pattern: the rules are
 * legible directly behind the panel and gone by the edges of the viewport, so
 * the eye reads depth instead of wallpaper.
 */
export function AuthBackdrop() {
  return (
    <div
      aria-hidden
      className={[
        "pointer-events-none absolute inset-0 overflow-hidden",
        // One hairline every 48px. `0 1px` then `transparent 1px 48px` draws
        // the rule and the gap in one repeating stop list, so the line stays
        // exactly one pixel at any zoom rather than scaling into a band.
        "bg-[repeating-linear-gradient(to_bottom,var(--edge-soft)_0_1px,transparent_1px_48px)]",
        // 40% read as JPEG banding rather than ruling — the uncanny middle
        // where a viewer asks whether the screen is broken. edge-soft against
        // ground is only a 0.12 lightness delta at FULL strength, so 75% is
        // still quieter than the panel border it must sit behind, while being
        // unmistakably a drawn line.
        "opacity-75",
        // Fades to nothing before it reaches any edge, so the pattern never
        // meets a boundary and reads as a tiled background.
        "[mask-image:radial-gradient(ellipse_75%_60%_at_50%_45%,black,transparent)]",
      ].join(" ")}
    />
  )
}
