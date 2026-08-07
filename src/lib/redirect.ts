const FALLBACK = "/"

// Control characters and whitespace are used to smuggle a value past a naive
// check — a newline can truncate it in one parser while another keeps reading.
// Scanned by code point rather than by regex: control characters in a regex
// literal are both hard to read and flagged by eslint's no-control-regex.
function hasUnsafeChars(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code <= 0x20 || code === 0x7f) {
      return true
    }
  }
  return false
}

/**
 * Normalises a `?redirect=` value into a safe same-origin path.
 *
 * A post-login redirect that trusts its input is an open redirect: an attacker
 * sends `/login?redirect=https://evil.example` and the victim is bounced to a
 * convincing fake straight after authenticating, which is exactly when they are
 * most likely to trust what they see.
 *
 * Only same-origin absolute paths are allowed through. Everything else falls
 * back to the app root rather than erroring, because a malformed redirect
 * should never block a legitimate sign-in.
 */
export function safeRedirect(target: unknown, fallback = FALLBACK): string {
  if (typeof target !== "string" || target === "") {
    return fallback
  }

  // Must be an absolute path on this origin.
  if (!target.startsWith("/")) {
    return fallback
  }

  // "//evil.example" is protocol-relative and leaves the origin. "/\evil" is
  // normalised the same way by several browsers.
  if (target.startsWith("//") || target.startsWith("/\\")) {
    return fallback
  }

  if (hasUnsafeChars(target)) {
    return fallback
  }

  return target
}
