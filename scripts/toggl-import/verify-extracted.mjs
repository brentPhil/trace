/** Checks the transcribed rows against the totals Toggl itself reported. */
import { EXPECTED, entries } from "./extracted.mjs"

const TZ = "Asia/Singapore"
const rows = entries()
let failures = 0

const check = (label, actual, expected) => {
  const ok = actual === expected
  if (!ok) failures++
  console.log(`${ok ? "  ok  " : "FAIL  "}${label}${ok ? "" : `  got ${actual}, want ${expected}`}`)
}
const fmt = (s) =>
  `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`

const seconds = rows.reduce((a, r) => a + (r.endedAt - r.startedAt) / 1000, 0)
const days = [...new Set(rows.map((r) => new Date(r.startedAt).toLocaleDateString("en-CA", { timeZone: TZ })))]

console.log("\n— against Toggl's own figures —")
check(`${EXPECTED.entries} entries`, rows.length, EXPECTED.entries)
check(`total ${fmt(EXPECTED.seconds)}`, seconds, EXPECTED.seconds)
check(`${EXPECTED.billable} billable`, rows.filter((r) => r.billable).length, EXPECTED.billable)
check(`${EXPECTED.days} working days`, days.length, EXPECTED.days)

console.log("\n— structural —")
check("no title is undefined", rows.filter((r) => r.title === undefined).length, 0)
check("every end after its start", rows.filter((r) => r.endedAt <= r.startedAt).length, 0)
check("clientKeys unique", new Set(rows.map((r) => r.clientKey)).size, rows.length)
check("none longer than 24h", rows.filter((r) => r.endedAt - r.startedAt > 86_400_000).length, 0)

const sorted = [...rows].sort((a, b) => a.startedAt - b.startedAt)
let overlaps = 0
for (let i = 1; i < sorted.length; i++) if (sorted[i].startedAt < sorted[i - 1].endedAt) overlaps++
console.log(`\n  note  ${overlaps} overlapping pair(s) — real trackers do overlap; not an error`)

console.log("\n— per day —")
for (const day of days.sort()) {
  const s = rows.filter((r) => new Date(r.startedAt).toLocaleDateString("en-CA", { timeZone: TZ }) === day)
  console.log(`  ${day}  ${String(s.length).padStart(2)} entries  ${fmt(s.reduce((a, r) => a + (r.endedAt - r.startedAt) / 1000, 0)).padStart(8)}`)
}

console.log(`\nno project: ${rows.filter((r) => r.projectName === undefined).length}  |  Sealogs: ${rows.filter((r) => r.projectName).length}`)
console.log(failures === 0 ? "\nALL CHECKS PASSED\n" : `\n${failures} CHECK(S) FAILED\n`)
process.exit(failures === 0 ? 0 : 1)
