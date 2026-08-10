/**
 * Emits the `import:importEntries` argument batches from the extracted rows.
 *
 * The `clientKey` is Toggl's own entry id, so a re-import is a no-op whatever
 * order the rows arrive in — the property that makes a half-failed batch safe
 * to re-send, and that let the previous reconstruction be replaced without
 * anyone reconciling by hand.
 *
 * Batched because the whole payload is one command-line argument and a
 * mutation has a write ceiling.
 */
import { writeFileSync, mkdirSync } from "node:fs"
import { entries } from "./extracted.mjs"

const USER_ID = process.argv[2]
const OUT = process.argv[3] ?? "scripts/toggl-import/batches"
const BATCH = 15

if (USER_ID === undefined) {
  console.error("usage: node payload.mjs <userId> [outDir]")
  process.exit(1)
}

const rows = entries()
mkdirSync(OUT, { recursive: true })

let n = 0
for (let i = 0; i < rows.length; i += BATCH) {
  writeFileSync(
    `${OUT}/${String(n).padStart(2, "0")}.json`,
    JSON.stringify({ userId: USER_ID, entries: rows.slice(i, i + BATCH) })
  )
  n++
}

const secs = rows.reduce((a, r) => a + (r.endedAt - r.startedAt) / 1000, 0)
console.log(`${rows.length} entries -> ${n} batches in ${OUT}`)
console.log(`total    ${Math.floor(secs / 3600)}:${String(Math.floor((secs % 3600) / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`)
console.log(`billable ${rows.filter((r) => r.billable).length} of ${rows.length}`)
console.log(`project  ${rows.filter((r) => r.projectName).length} Sealogs, ${rows.filter((r) => !r.projectName).length} unassigned`)
