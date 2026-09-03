export type Lock = <T>(fn: () => Promise<T>) => Promise<T>

/**
 * One sender across tabs.
 *
 * Two tabs both draining would hand the same op to two Convex clients. Ops
 * are idempotent, so that is waste rather than corruption, but it is also
 * two toasts for one refusal. The Web Locks API is in every engine this app
 * runs in (WebView2, WKWebView 15.4+); where it is absent the lock is a
 * no-op and single-tab behaviour is unchanged.
 */
export function webLock(name: string): Lock {
  return async (fn) => {
    // lib.dom's `Navigator.locks` is declared non-optional, which is a
    // promise the type system cannot keep on the engines this app actually
    // runs on — cast to the honest shape before asking whether it is there.
    const locks = typeof navigator === "undefined" ? undefined : (navigator as Partial<Navigator>).locks
    if (locks !== undefined) {
      return locks.request(name, fn)
    }
    return fn()
  }
}
