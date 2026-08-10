/**
 * Emits the `import:importEntries` argument batches.
 *
 * `clientKey` is DETERMINISTIC — `toggl:<range>:<n>` — not a fresh UUID per
 * run. `createImpl` dedupes on it, so re-running this import is a no-op rather
 * than a second fortnight of duplicates. That property is the difference
 * between an importer you can retry after a half-failed batch and one you
 * cannot.
 *
 * Batched because the whole payload is one command-line argument and a
 * mutation has a write ceiling. Each batch is independently retryable, again
 * because of the keys.
 */
import { writeFileSync, mkdirSync } from "node:fs"
import { entries } from "./reconstruct.mjs"

const USER_ID = process.argv[2]
const TZ = process.argv[3] ?? "Asia/Singapore"
const PROJECT = process.argv[4] ?? "Sealogs"
const OUT = process.argv[5] ?? "scripts/toggl-import/batches"
const BATCH = 13
const RANGE = "2026-07-27..2026-08-09"

if (USER_ID === undefined) {
  console.error("usage: node payload.mjs <userId> [timeZone] [projectName] [outDir]")
  process.exit(1)
}

const rows = entries(TZ).map((e, i) => ({
  clientKey: `toggl:${RANGE}:${String(i).padStart(3, "0")}`,
  title: e.title,
  startedAt: e.startedAt,
  endedAt: e.endedAt,
}))

mkdirSync(OUT, { recursive: true })
let n = 0
for (let i = 0; i < rows.length; i += BATCH) {
  const args = {
    userId: USER_ID,
    projectName: PROJECT,
    entries: rows.slice(i, i + BATCH),
  }
  writeFileSync(`${OUT}/${String(n).padStart(2, "0")}.json`, JSON.stringify(args))
  n++
}

console.log(`${rows.length} entries -> ${n} batches in ${OUT}`)
console.log(`project: ${PROJECT}  timezone: ${TZ}`)
console.log(`billable: left to the project's own default (Sealogs is billable at $10/hr)`)
console.log(`first: ${new Date(rows[0].startedAt).toLocaleString("en-GB", { timeZone: TZ })}`)
console.log(`last:  ${new Date(rows.at(-1).endedAt).toLocaleString("en-GB", { timeZone: TZ })}`)
