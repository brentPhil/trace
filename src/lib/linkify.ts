/**
 * Finding the links in a block of plain text.
 *
 * A calendar invite's description is where the joining details live — a Teams
 * URL, a Meet link, an agenda doc — and until now they rendered as text a user
 * had to select and copy. This turns them into anchors.
 *
 * IT IS NOT RENDERING THE INVITE'S HTML, and the difference is the whole safety
 * argument. Google returns a description that may contain markup written by
 * whoever sent the invite — a stranger, in the general case — and putting that
 * through `dangerouslySetInnerHTML` would hand them script execution on this
 * page. What happens here instead: the text is treated as text, scanned for
 * URL-shaped runs, and OUR OWN anchor elements are built around the runs that
 * survive `safeHref`. Nothing the sender wrote is ever interpreted as markup.
 */

/**
 * A URL this app is willing to put in an `href`.
 *
 * An ALLOWLIST rather than a blocklist, for the reason allowlists always win:
 * the set of schemes a browser will honour is open-ended and grows, while the
 * set this app has any use for is exactly two. React already neutralises a
 * `javascript:` href and browsers already block a top-level `data:` navigation,
 * so this is defence in depth — it is here because the whole cost is one check
 * and the content is third-party.
 *
 * Lives here rather than in the popover because two callers now need the same
 * answer, and a second copy of a security check is a second place for it to
 * drift.
 */
export function safeHref(url: string | undefined): string | null {
  if (url === undefined) return null
  try {
    const parsed = new URL(url)
    return parsed.protocol === "https:" || parsed.protocol === "http:"
      ? url
      : null
  } catch {
    // Not a parseable absolute URL. A relative one would resolve against
    // Chroneli's own origin, which is not what a third-party link ever means.
    return null
  }
}

/** One run of the original text: either prose, or a link to draw. */
export type LinkifySegment =
  | { kind: "text"; value: string }
  | { kind: "link"; value: string; href: string }

/**
 * Only an explicit `http://` or `https://` run counts.
 *
 * A bare `www.example.com` is deliberately NOT matched. Turning it into a link
 * means inventing a scheme the sender did not write, and the guess is wrong
 * often enough to matter — `www.` is a convention, not a guarantee. Every
 * conferencing product that matters writes the scheme.
 *
 * The character class stops at whitespace and at the quote and angle characters
 * that would mean the URL was already inside some other construct.
 */
const URL_RUN = /https?:\/\/[^\s<>"'`]+/g

/**
 * Punctuation that ends a sentence rather than a URL.
 *
 * `https://example.com/agenda.` almost always means a link followed by a full
 * stop, not a path ending in one — and a trailing `)` is usually the close of
 * `(see https://example.com)`. Trimmed only when unbalanced, so a genuine
 * `…/wiki/Foo_(bar)` keeps its bracket.
 */
function trimTrailingPunctuation(url: string): string {
  let end = url.length

  while (end > 0) {
    const char = url[end - 1]
    if (".,;:!?".includes(char)) {
      end -= 1
      continue
    }
    if (char === ")") {
      const slice = url.slice(0, end)
      const opens = (slice.match(/\(/g) ?? []).length
      const closes = (slice.match(/\)/g) ?? []).length
      if (closes > opens) {
        end -= 1
        continue
      }
    }
    break
  }

  return url.slice(0, end)
}

/**
 * Split plain text into prose and links.
 *
 * Returns a single text segment when there is nothing to link, so a caller can
 * render the result the same way in both cases rather than branching.
 */
export function linkify(text: string): Array<LinkifySegment> {
  const segments: Array<LinkifySegment> = []
  let cursor = 0

  // `matchAll` rather than a `while (exec())` loop: the regex carries the `g`
  // flag and a shared `lastIndex`, which a re-entrant caller would corrupt.
  for (const match of text.matchAll(URL_RUN)) {
    const raw = match[0]
    const start = match.index

    const candidate = trimTrailingPunctuation(raw)
    const href = safeHref(candidate)

    // A run that fails the allowlist stays prose. It is still shown — the user
    // can read and copy it — it simply is not clickable.
    if (href === null) continue

    if (start > cursor) {
      segments.push({ kind: "text", value: text.slice(cursor, start) })
    }
    segments.push({ kind: "link", value: candidate, href })
    cursor = start + candidate.length
  }

  if (cursor < text.length) {
    segments.push({ kind: "text", value: text.slice(cursor) })
  }

  return segments
}
