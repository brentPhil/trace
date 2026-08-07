/**
 * Rendering a RecapDoc.
 *
 * Two renderers, one document. Both walk the SAME assembled structure, so they
 * cannot disagree about what the day contained — only about how it is marked
 * up. A renderer that did its own grouping would eventually produce a Slack
 * message and a plain-text message describing different days, and the user
 * would have no way to know which was right.
 *
 * Pure. No Convex, no DOM.
 */

import { recapDuration } from "./recap"
import type { RecapBlock, RecapDoc } from "./recap"

/**
 * Slack's mrkdwn.
 *
 * A single `*` is the only markup token used. Slack's mrkdwn is not Markdown:
 * `**bold**` renders as literal asterisks, `#` headings do nothing, and `-`
 * bullets are not list syntax. Every one of those is a way to paste something
 * that looks broken in front of a client, so the safe subset is the whole
 * vocabulary here.
 */
export function renderMrkdwn(doc: RecapDoc): string {
  return render(doc, {
    strong: (text) => `*${text}*`,
    bullet: "•",
  })
}

/**
 * Plain text, for email, a document, or anywhere `*` would just be noise.
 *
 * Identical structure and identical content — the only difference is the
 * absence of markup. Notably it keeps the `·` separator and the bullet
 * character, because those are punctuation rather than markup and they are what
 * make the shape readable without any styling at all.
 */
export function renderPlain(doc: RecapDoc): string {
  return render(doc, {
    strong: (text) => text,
    bullet: "•",
  })
}

type Style = {
  strong: (text: string) => string
  bullet: string
}

function render(doc: RecapDoc, style: Style): string {
  const lines: Array<string> = []

  // No greeting and no sign-off. The user is pasting into a channel that
  // already supplies both, and "Here's my standup for today" is a line every
  // reader has learned to skip.
  lines.push(style.strong(`${doc.dayLabel} — ${headline(doc)}`))

  for (const block of doc.blocks) {
    lines.push("")
    lines.push(style.strong(`${block.projectName} · ${recapDuration(block.durationMs)}`))
    for (const line of blockLines(block, style)) lines.push(line)
  }

  // Omitted ENTIRELY when empty. Never `Blocked: none` — a line saying nothing
  // is in the way is a line the reader has to process to learn nothing, and it
  // makes the day look more managed than it was.
  if (doc.next !== undefined) {
    lines.push("")
    lines.push(`${style.strong("Next:")} ${collapse(doc.next)}`)
  }
  if (doc.blocked !== undefined) {
    if (doc.next === undefined) lines.push("")
    lines.push(`${style.strong("Blocked:")} ${collapse(doc.blocked)}`)
  }

  return lines.join("\n")
}

function blockLines(block: RecapBlock, style: Style): Array<string> {
  const shown = block.bullets.length - block.omittedCount
  const lines: Array<string> = []

  for (const bullet of block.bullets.slice(0, shown)) {
    // Duration LAST and in parentheses: the sentence is the content and the
    // number is the receipt. Leading with the number turns a report of work
    // into a report of hours, which is the document Toggl already produces.
    lines.push(`${style.bullet} ${bullet.text} (${recapDuration(bullet.durationMs)})`)
  }

  if (block.omittedCount > 0) {
    lines.push(
      `${style.bullet} plus ${block.omittedCount} more (${recapDuration(block.omittedMs)})`
    )
  }

  return lines
}

function headline(doc: RecapDoc): string {
  const total = recapDuration(doc.totalMs)
  const count = doc.blocks.length
  if (count === 0) return total
  return `${total} across ${count} ${count === 1 ? "project" : "projects"}`
}

/**
 * Newline collapsing, applied again at render time.
 *
 * `assembleRecap` already collapses note text, but `next` and `blocked` are
 * free-form fields the user types into directly and can contain hard newlines.
 * One stray newline turns the rest of the recap into a separate paragraph in
 * Slack, so this is not belt-and-braces — it is the only place those two
 * strings are handled.
 *
 * The user's own `*` characters are deliberately left ALONE. Someone who writes
 * "the *real* fix was the pool size" meant that emphasis; stripping or escaping
 * it would silently edit their words, and the failure mode of leaving it is
 * that Slack renders emphasis they asked for.
 */
function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim()
}
