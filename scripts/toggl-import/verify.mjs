/** Proves the reconstruction preserves every total the report actually states. */
import { DAYS, DESCRIPTIONS, TOTAL_SECONDS, daySeconds, entries, toSeconds } from "./reconstruct.mjs"

const TZ = process.argv[2] ?? "Asia/Singapore"
let failures = 0

function check(label, actual, expected) {
  const ok = actual === expected
  if (!ok) failures++
  console.log(`${ok ? "  ok  " : "FAIL  "}${label}${ok ? "" : `  got ${actual}, want ${expected}`}`)
}

const fmt = (s) =>
  `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`

const rows = entries(TZ)

console.log("\n— grand total —")
const total = rows.reduce((a, r) => a + r.durationMs / 1000, 0)
check(`grand total is ${fmt(TOTAL_SECONDS)}`, total, TOTAL_SECONDS)
check("descriptions sum to the same", DESCRIPTIONS.reduce((a, d) => a + toSeconds(d.duration), 0), TOTAL_SECONDS)

console.log("\n— per description —")
for (const d of DESCRIPTIONS) {
  const got = rows.filter((r) => r.title === d.title).reduce((a, r) => a + r.durationMs / 1000, 0)
  check(`${(d.title || "(untitled)").slice(0, 58).padEnd(58)} ${fmt(toSeconds(d.duration))}`, got, toSeconds(d.duration))
}

console.log("\n— per day (printed vs reconstructed) —")
for (const d of daySeconds()) {
  const got = rows.filter((r) => r.day === d.day).reduce((a, r) => a + r.durationMs / 1000, 0)
  const printed = DAYS.find((x) => x.day === d.day).hours
  const driftS = Math.round(got - printed * 3600)
  check(`${d.day}  printed ${String(printed).padStart(5)} h  ->  ${fmt(got).padStart(8)}  (${driftS >= 0 ? "+" : ""}${driftS}s vs printed)`, got, d.seconds)
}

console.log("\n— structural —")
check("no zero-length entry", rows.filter((r) => r.durationMs <= 0).length, 0)
check("no entry ends before it starts", rows.filter((r) => r.endedAt <= r.startedAt).length, 0)
check("durationMs agrees with the instants", rows.filter((r) => r.endedAt - r.startedAt !== r.durationMs).length, 0)
check("no day exceeds 24h of wall clock", rows.filter((r) => r.durationMs > 86_400_000).length, 0)

const sorted = [...rows].sort((a, b) => a.startedAt - b.startedAt)
let overlaps = 0
for (let i = 1; i < sorted.length; i++) if (sorted[i].startedAt < sorted[i - 1].endedAt) overlaps++
check("no two entries overlap", overlaps, 0)

const days = new Set(rows.map((r) => r.day))
check("weekend days stay empty", [...days].filter((d) => ["2026-08-01", "2026-08-02", "2026-08-08", "2026-08-09"].includes(d)).length, 0)

console.log(`\n${rows.length} entries across ${days.size} days, ${TZ}`)
const latest = rows.reduce((a, r) => (r.endedAt > a.endedAt ? r : a))
console.log(`latest finish: ${new Date(latest.endedAt).toLocaleString("en-GB", { timeZone: TZ })} (${latest.day})`)
console.log(failures === 0 ? "\nALL CHECKS PASSED\n" : `\n${failures} CHECK(S) FAILED\n`)
process.exit(failures === 0 ? 0 : 1)
