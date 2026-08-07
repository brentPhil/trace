import { describe, expect, it } from "vitest"
import { BULLET_CAP, assembleRecap, suggestBlocked } from "./recap"
import { renderMrkdwn, renderPlain } from "./render"
import type { RecapEntry, RecapProject } from "./recap"

/*
 * The recap is the reason the product exists, so it is tested against whole
 * rendered documents rather than field-by-field. A golden output catches the
 * thing that actually matters — "would a freelancer paste this into a client
 * channel?" — which no amount of asserting on intermediate structures does.
 *
 * Three worked days, from the plan: clean, messy, fragmented.
 */

const MIN = 60_000
const HOUR = 3_600_000

const ACME: RecapProject = { id: "p_acme", name: "Acme redesign", color: "coral" }
const BELL: RecapProject = { id: "p_bell", name: "Bellweather API", color: "teal" }
const INTERNAL: RecapProject = { id: "p_int", name: "Internal", color: "slate" }

let seq = 0
function e(over: Partial<RecapEntry> & { durationMs: number }): RecapEntry {
  seq += 1
  return {
    id: `e${seq}`,
    title: "",
    startedAt: 1_000_000 + seq * 1000,
    billable: false,
    ...over,
  }
}

const day = (entries: Array<RecapEntry>, projects = [ACME, BELL, INTERNAL], extra = {}) =>
  assembleRecap({
    day: "2026-08-06",
    dayLabel: "Thu 6 Aug",
    entries,
    projects,
    ...extra,
  })

// ---------------------------------------------------------------------------

describe("the clean day", () => {
  // Every entry noted, two projects, nothing awkward. This is the document the
  // plan specifies, and it is the one that has to be exactly right.
  const entries = [
    e({
      title: "Checkout form",
      note: "Rebuilt the checkout form validation — card errors now surface inline",
      projectId: ACME.id,
      durationMs: HOUR + 46 * MIN,
      billable: true,
      startedAt: 3,
    }),
    e({
      title: "PR review",
      note: "Reviewed Priya's PR #218; left notes on the state-machine transitions",
      projectId: ACME.id,
      durationMs: 47 * MIN,
      billable: true,
      startedAt: 4,
    }),
    e({
      title: "Pool leak",
      note: "Traced the intermittent 502s to a connection-pool leak in the webhook worker",
      projectId: BELL.id,
      durationMs: 2 * HOUR + 5 * MIN,
      billable: true,
      startedAt: 5,
    }),
  ]

  it("renders the document from the plan", () => {
    const doc = day(entries, [ACME, BELL], {
      next: "ship the pool fix behind a flag once staging is up",
      blocked: "waiting on Dana for the legal wording",
    })

    expect(renderMrkdwn(doc)).toBe(
      [
        "*Thu 6 Aug — 4h 38m across 2 projects*",
        "",
        // Acme first: more billable time (2h 33m vs 2h 05m). Same ordering as
        // the plan's own worked example.
        "*Acme redesign · 2h 33m*",
        "• Rebuilt the checkout form validation — card errors now surface inline (1h 46m)",
        "• Reviewed Priya's PR #218; left notes on the state-machine transitions (47m)",
        "",
        "*Bellweather API · 2h 05m*",
        "• Traced the intermittent 502s to a connection-pool leak in the webhook worker (2h 05m)",
        "",
        "*Next:* ship the pool fix behind a flag once staging is up",
        "*Blocked:* waiting on Dana for the legal wording",
      ].join("\n")
    )
  })

  it("renders plain text with the same content and no markup", () => {
    const doc = day(entries, [ACME, BELL])
    const plain = renderPlain(doc)

    expect(plain).not.toContain("*")
    // Same lines, same order, same durations.
    expect(plain).toContain("Bellweather API · 2h 05m")
    expect(plain).toContain(
      "• Reviewed Priya's PR #218; left notes on the state-machine transitions (47m)"
    )
  })

  it("omits Next and Blocked entirely when they are empty", () => {
    // Never `Blocked: none` — a line saying nothing is wrong is a line the
    // reader processes to learn nothing.
    const text = renderMrkdwn(day(entries, [ACME, BELL]))
    expect(text).not.toContain("Next")
    expect(text).not.toContain("Blocked")
  })
})

// ---------------------------------------------------------------------------

describe("the messy day", () => {
  it("never folds un-noted time into a noted bullet", () => {
    // THE rule. Two entries share a title; one has a note and one does not.
    // Adding the silent 40 minutes to the line that has a sentence on it would
    // produce a tidier document that misattributes time to a description which
    // does not cover it.
    const doc = day([
      e({
        title: "Standup",
        note: "Ran through the release checklist with Priya",
        projectId: ACME.id,
        durationMs: 20 * MIN,
      }),
      e({ title: "Standup", projectId: ACME.id, durationMs: 40 * MIN }),
    ])

    const block = doc.blocks[0]
    expect(block.bullets).toHaveLength(2)
    expect(block.bullets.map((b) => b.kind)).toEqual(["title-only", "noted"])
    expect(block.bullets.find((b) => b.kind === "noted")?.durationMs).toBe(20 * MIN)
    expect(block.bullets.find((b) => b.kind === "title-only")?.durationMs).toBe(40 * MIN)
  })

  it("emits a title-only bullet verbatim, indistinguishable in the copied text", () => {
    // Omitting it loses billable time from a document beside an invoice.
    // Annotating it advertises the user's hygiene to their client.
    const text = renderMrkdwn(
      day([e({ title: "Invoicing", projectId: ACME.id, durationMs: 26 * MIN })])
    )
    expect(text).toContain("• Invoicing (26m)")
    expect(text).not.toContain("no note")
  })

  it("counts unlabelled entries without editorialising", () => {
    const doc = day([
      e({ durationMs: 23 * MIN, projectId: ACME.id }),
      e({ durationMs: 7 * MIN, projectId: ACME.id }),
    ])
    const text = renderMrkdwn(doc)
    expect(text).toContain("• 2 unlabelled entries (30m)")
  })

  it("uses the singular for exactly one unlabelled entry", () => {
    const text = renderMrkdwn(day([e({ durationMs: 23 * MIN, projectId: ACME.id })]))
    expect(text).toContain("• 1 unlabelled entry (23m)")
  })

  it("keeps entries whose project no longer resolves", () => {
    // Dropping the block would lose real hours from a document that sits beside
    // an invoice, which is worse than showing an unnamed one.
    const doc = day([e({ durationMs: HOUR, projectId: "p_gone" })], [])
    expect(doc.totalMs).toBe(HOUR)
    expect(doc.blocks).toHaveLength(1)
  })

  it("never renders two blocks both titled 'No project'", () => {
    // Reachable: delete an entry, delete its project (allowed — nothing live
    // references it), then undo the entry. Keying the grouping on the raw
    // projectId gave the orphan its own block which, having no project to name
    // it, was also called "No project".
    const doc = day(
      [
        e({ title: "Ghost work", durationMs: 2 * HOUR, projectId: "p_gone" }),
        e({ title: "Loose work", durationMs: 45 * MIN }),
      ],
      []
    )

    const named = doc.blocks.map((b) => b.projectName)
    expect(new Set(named).size).toBe(named.length)
    expect(doc.blocks).toHaveLength(1)
    expect(doc.blocks[0].durationMs).toBe(2 * HOUR + 45 * MIN)
    // And no time went missing in the merge.
    expect(doc.blocks[0].durationMs).toBe(doc.totalMs)
  })

  it("labels the no-project block without scolding", () => {
    const doc = day([e({ title: "Email", durationMs: 15 * MIN })])
    expect(doc.blocks[0].projectName).toBe("No project")
  })

  it("never applies a duration threshold", () => {
    // A four-minute entry someone bothered to write a note on is often the most
    // informative line in the recap. Short entries are ordered, never filtered.
    const doc = day([
      e({ title: "Deploy", note: "Shipped the hotfix", projectId: ACME.id, durationMs: 60_000 }),
      e({ title: "Long thing", projectId: ACME.id, durationMs: 4 * HOUR }),
    ])
    expect(doc.blocks[0].bullets).toHaveLength(2)
    expect(renderMrkdwn(doc)).toContain("Shipped the hotfix (1m)")
  })
})

// ---------------------------------------------------------------------------

describe("the fragmented day", () => {
  /** Twelve noted entries across three projects — well past the cap. */
  const fragmented = () => {
    const entries: Array<RecapEntry> = []
    for (let i = 0; i < 6; i++) {
      entries.push(
        e({
          title: `Acme task ${i}`,
          note: `Acme note ${i}`,
          projectId: ACME.id,
          durationMs: (60 - i) * MIN,
          billable: true,
        })
      )
    }
    for (let i = 0; i < 4; i++) {
      entries.push(
        e({
          title: `Bell task ${i}`,
          note: `Bell note ${i}`,
          projectId: BELL.id,
          durationMs: (30 - i) * MIN,
          billable: true,
        })
      )
    }
    for (let i = 0; i < 2; i++) {
      entries.push(
        e({ title: `Admin ${i}`, note: `Admin note ${i}`, projectId: INTERNAL.id, durationMs: 10 * MIN })
      )
    }
    return entries
  }

  it("caps the copied text at eight content bullets plus rollups", () => {
    const doc = day(fragmented())
    const text = renderMrkdwn(doc)
    const contentBullets = text
      .split("\n")
      .filter((l) => l.startsWith("• ") && !l.includes("plus "))
    expect(contentBullets).toHaveLength(BULLET_CAP)
  })

  it("gives every block at least one real bullet", () => {
    // A block reduced to nothing but "plus 4 more" tells the reader a project
    // happened and refuses to say what.
    const doc = day(fragmented())
    for (const block of doc.blocks) {
      expect(block.bullets.length - block.omittedCount).toBeGreaterThanOrEqual(1)
    }
  })

  it("states exactly what the clipboard leaves out", () => {
    const doc = day(fragmented())
    const text = renderMrkdwn(doc)
    const rolled = doc.blocks.filter((b) => b.omittedCount > 0)
    expect(rolled.length).toBeGreaterThan(0)
    for (const block of rolled) {
      expect(text).toContain(`plus ${block.omittedCount} more`)
    }
  })

  it("does NOT cap the document itself — the panel shows the whole day", () => {
    const entries = fragmented()
    const doc = day(entries)
    const totalBullets = doc.blocks.reduce((n, b) => n + b.bullets.length, 0)
    expect(totalBullets).toBe(entries.length)
  })

  it("sorts the internal block last without knowing what 'internal' means", () => {
    // Achieved purely by ordering on billable time. The product never guesses
    // which project names are admin.
    const doc = day(fragmented())
    expect(doc.blocks[doc.blocks.length - 1].projectName).toBe("Internal")
  })
})

// ---------------------------------------------------------------------------

describe("invariants that must hold for any day", () => {
  const days: Array<Array<RecapEntry>> = [
    [],
    [e({ durationMs: MIN })],
    [
      e({ title: "A", note: "a note", projectId: ACME.id, durationMs: 90 * MIN, billable: true }),
      e({ title: "A", projectId: ACME.id, durationMs: 30 * MIN }),
      e({ title: "B", projectId: BELL.id, durationMs: 45 * MIN }),
      e({ durationMs: 5 * MIN }),
      e({ title: "C", note: "c note", projectId: INTERNAL.id, durationMs: 200 * MIN }),
    ],
  ]

  it("block subtotals always sum to the header total", () => {
    for (const entries of days) {
      const doc = day(entries)
      const summed = doc.blocks.reduce((n, b) => n + b.durationMs, 0)
      expect(summed).toBe(doc.totalMs)
    }
  })

  it("no bullet ever exceeds its block subtotal — the floor property", () => {
    for (const entries of days) {
      for (const block of day(entries).blocks) {
        for (const bullet of block.bullets) {
          expect(bullet.durationMs).toBeLessThanOrEqual(block.durationMs)
        }
      }
    }
  })

  it("a block's bullets sum to exactly its subtotal, so no time is lost", () => {
    for (const entries of days) {
      for (const block of day(entries).blocks) {
        const summed = block.bullets.reduce((n, b) => n + b.durationMs, 0)
        expect(summed).toBe(block.durationMs)
      }
    }
  })

  it("every entry is accounted for by exactly one bullet", () => {
    for (const entries of days) {
      const ids = day(entries)
        .blocks.flatMap((b) => b.bullets)
        .flatMap((b) => b.entryIds)
      expect(ids.slice().sort()).toEqual(entries.map((x) => x.id).sort())
    }
  })

  it("renders an empty day without crashing or inventing content", () => {
    const text = renderMrkdwn(day([]))
    expect(text).toBe("*Thu 6 Aug — <1m*")
  })
})

// ---------------------------------------------------------------------------

describe("text the user wrote survives both renderers", () => {
  it("keeps the user's own asterisks", () => {
    // Someone who writes "the *real* fix" meant that emphasis. Stripping it
    // would silently edit their words.
    const doc = day([
      e({ title: "Fix", note: "the *real* fix was the pool size", projectId: ACME.id, durationMs: HOUR }),
    ])
    expect(renderMrkdwn(doc)).toContain("the *real* fix was the pool size")
    expect(renderPlain(doc)).toContain("the *real* fix was the pool size")
  })

  it("collapses newlines inside a note so the list does not break", () => {
    const doc = day([
      e({ title: "Fix", note: "line one\nline two\n\nline three", projectId: ACME.id, durationMs: HOUR }),
    ])
    const text = renderMrkdwn(doc)
    expect(text).toContain("• line one line two line three (1h)")
  })

  it("collapses newlines in Next and Blocked, which are typed directly", () => {
    const doc = day([e({ durationMs: HOUR })], [ACME], {
      next: "ship it\nthen tell Dana",
      blocked: "waiting on\nthe legal wording",
    })
    const text = renderMrkdwn(doc)
    expect(text).toContain("*Next:* ship it then tell Dana")
    expect(text).toContain("*Blocked:* waiting on the legal wording")
  })

  it("renders Blocked alone with a blank line before it", () => {
    const doc = day([e({ durationMs: HOUR })], [ACME], { blocked: "waiting on Dana" })
    const lines = renderMrkdwn(doc).split("\n")
    expect(lines[lines.length - 2]).toBe("")
    expect(lines[lines.length - 1]).toBe("*Blocked:* waiting on Dana")
  })
})

// ---------------------------------------------------------------------------

describe("the Blocked prefill", () => {
  const noted = (note: string, startedAt = 1) =>
    e({ title: "t", note, durationMs: HOUR, startedAt })

  it("takes the shortest clause-bounded suffix containing a marker", () => {
    expect(
      suggestBlocked([noted("Fixed the parser. Waiting on Dana for the legal wording.")])
    ).toBe("Waiting on Dana for the legal wording.")
  })

  it("returns a contiguous verbatim substring, never a paraphrase", () => {
    const note = "Shipped the API; blocked on the staging key."
    const suggestion = suggestBlocked([noted(note)])
    expect(suggestion).not.toBeUndefined()
    expect(note).toContain(suggestion!)
  })

  it("extends backwards when the last clause has no marker", () => {
    expect(
      suggestBlocked([noted("Blocked on the API key. Shipped the rest.")])
    ).toBe("Blocked on the API key. Shipped the rest.")
  })

  it("treats a question as an obstacle", () => {
    expect(suggestBlocked([noted("Did the migration. Who owns the DNS record?")])).toBe(
      "Who owns the DNS record?"
    )
  })

  it("reads the LAST noted entry of the day", () => {
    expect(
      suggestBlocked([
        noted("Waiting on the early thing.", 1),
        noted("Finished cleanly.", 9),
      ])
    ).toBeUndefined()
  })

  it("returns nothing when no note mentions an obstacle", () => {
    expect(suggestBlocked([noted("Shipped everything and went home.")])).toBeUndefined()
  })

  it("returns nothing when the day has no notes at all", () => {
    expect(suggestBlocked([e({ title: "x", durationMs: HOUR })])).toBeUndefined()
  })
})
