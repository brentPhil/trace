import { describe, expect, it } from "vitest"
import { BULLET_CAP, assembleRecap } from "./recap"
import { renderMrkdwn } from "./render"
import type { RecapEntry, RecapProject } from "./recap"

const MIN = 60_000
const HOUR = 3_600_000
const ACME: RecapProject = { id: "p_acme", name: "Acme", color: "coral" }

let seq = 0
function e(over: Partial<RecapEntry> & { durationMs: number }): RecapEntry {
  seq += 1
  return { id: `e${seq}`, title: "", startedAt: 1000 + seq, billable: false, ...over }
}

const day = (entries: Array<RecapEntry>, projects: Array<RecapProject> = [ACME]) =>
  assembleRecap({ day: "2026-08-06", dayLabel: "Thu 6 Aug", entries, projects })

describe("probe", () => {
  it("A: dangling project collides with the real No project block", () => {
    const doc = day([
      e({ title: "Ghost work", durationMs: 2 * HOUR, projectId: "p_gone" }),
      e({ title: "Loose work", durationMs: 45 * MIN }),
    ])
    console.log("A-blocks", JSON.stringify(doc.blocks.map((b) => [b.projectId, b.projectName, b.durationMs])))
    console.log("A-text\n" + renderMrkdwn(doc))
  })

  it("B: titles differing only by internal whitespace", () => {
    const doc = day([
      e({ title: "Client  call", durationMs: 30 * MIN, projectId: ACME.id }),
      e({ title: "Client call", durationMs: 45 * MIN, projectId: ACME.id }),
      e({ title: "Client\ncall", durationMs: 5 * MIN, projectId: ACME.id }),
    ])
    console.log("B-text\n" + renderMrkdwn(doc))
  })

  it("C: applyCap exhaustive over block/bullet shapes", () => {
    const shapes: Array<Array<number>> = []
    for (let n = 1; n <= 12; n++) {
      for (let variant = 0; variant < 4; variant++) {
        const shape: Array<number> = []
        for (let i = 0; i < n; i++) shape.push(1 + ((i * 3 + variant * 5) % 7))
        shapes.push(shape)
      }
    }

    for (const shape of shapes) {
      const entries: Array<RecapEntry> = []
      const projects: Array<RecapProject> = []
      shape.forEach((count, p) => {
        projects.push({ id: `p${p}`, name: `P${p}`, color: "coral" })
        for (let i = 0; i < count; i++) {
          entries.push(
            e({
              title: `t${p}-${i}`,
              note: `n${p}-${i}`,
              projectId: `p${p}`,
              durationMs: (100 - p * 5 - i) * MIN,
              billable: p % 2 === 0,
            })
          )
        }
      })
      const doc = assembleRecap({
        day: "2026-08-06",
        dayLabel: "Thu 6 Aug",
        entries,
        projects,
      })

      // every block keeps at least one real bullet
      for (const b of doc.blocks) {
        expect(b.bullets.length - b.omittedCount).toBeGreaterThanOrEqual(1)
        expect(b.omittedCount).toBeGreaterThanOrEqual(0)
      }
      const shown = doc.blocks.reduce((n, b) => n + (b.bullets.length - b.omittedCount), 0)
      if (doc.blocks.length <= BULLET_CAP) {
        if (shown > BULLET_CAP) {
          console.log("CAP EXCEEDED", JSON.stringify(shape), shown)
        }
        expect(shown).toBeLessThanOrEqual(BULLET_CAP)
      }
      // subtotals sum to total
      expect(doc.blocks.reduce((n, b) => n + b.durationMs, 0)).toBe(doc.totalMs)
      for (const b of doc.blocks) {
        expect(b.bullets.reduce((n, x) => n + x.durationMs, 0)).toBe(b.durationMs)
        expect(b.omittedMs).toBe(
          b.bullets.slice(b.bullets.length - b.omittedCount).reduce((n, x) => n + x.durationMs, 0)
        )
      }
      // rendered content bullets match
      const content = renderMrkdwn(doc)
        .split("\n")
        .filter((l) => l.startsWith("• ") && !l.startsWith("• plus "))
      expect(content).toHaveLength(shown)
    }
  })

  it("D: is the cap ever under-spent (budget left while bullets omitted)?", () => {
    // 2 blocks: first has 1 bullet, second has 20.
    const entries: Array<RecapEntry> = [
      e({ title: "solo", note: "solo note", projectId: "p0", durationMs: 500 * MIN, billable: true }),
    ]
    for (let i = 0; i < 20; i++) {
      entries.push(e({ title: `x${i}`, note: `n${i}`, projectId: "p1", durationMs: (20 - i) * MIN }))
    }
    const doc = assembleRecap({
      day: "2026-08-06",
      dayLabel: "Thu 6 Aug",
      entries,
      projects: [
        { id: "p0", name: "Solo", color: "coral" },
        { id: "p1", name: "Many", color: "teal" },
      ],
    })
    const shown = doc.blocks.reduce((n, b) => n + (b.bullets.length - b.omittedCount), 0)
    console.log("D-shown", shown, doc.blocks.map((b) => [b.projectName, b.bullets.length, b.omittedCount]))
  })
})
