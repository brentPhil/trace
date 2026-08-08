import { expect } from "vitest"

// jsdom does not implement `window.matchMedia` — it has no CSS media-query
// evaluator, so the property is simply absent at runtime (TypeScript's DOM
// lib disagrees and declares it as always present, which is why there is no
// existence check here — the type checker would flag it as redundant).
// `useIsMobile` (src/hooks/use-mobile.ts), used by the vendored `Sidebar`,
// calls it unconditionally on mount. Without this shim every test that
// renders a `Sidebar` crashes with "window.matchMedia is not a function"
// before it gets anywhere near an assertion.
// Unconditional, not a `??=` guard: TypeScript's DOM lib declares
// `matchMedia` as always present, so any existence check on it reads as
// dead code to the type checker even though jsdom really does omit it.
window.matchMedia = function stubMatchMedia(query: string): MediaQueryList {
  return {
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  } as MediaQueryList
}

// `@testing-library/jest-dom` is not a dependency of this project — no other
// test file has needed a DOM-attribute matcher before. Rather than add a
// package (risky here: the default install cache lives on `C:`, which this
// environment has already flagged as full), this defines just the one
// matcher the app-sidebar test needs, in jest-dom's shape.
expect.extend({
  toHaveAttribute(received: unknown, name: string, value?: string) {
    if (!(received instanceof Element)) {
      return {
        pass: false,
        message: () => `expected an Element, got ${String(received)}`,
      }
    }
    const has = received.hasAttribute(name)
    const actual = received.getAttribute(name)
    const pass = value === undefined ? has : has && actual === value
    return {
      pass,
      message: () =>
        `expected element ${pass ? "not " : ""}to have attribute "${name}"` +
        (value === undefined ? "" : ` with value "${value}"`) +
        (has ? ` (found "${actual}")` : " (attribute not present)"),
    }
  },
})

interface DomMatchers<T = unknown> {
  toHaveAttribute: (name: string, value?: string) => T
}

declare module "vitest" {
  // `T = any`, matching vitest's own `Assertion` declaration exactly — a
  // merged interface's type parameters must agree with every other
  // declaration of it, including the one inside vitest's own types.
  interface Assertion<T = any> extends DomMatchers<T> {}
  interface AsymmetricMatchersContaining extends DomMatchers {}
}
