import { describe, expect, it } from "vitest"
import { entriesText } from "@/lib/export/entries-text"
import { groupByDay } from "@/lib/group-entries"
import { NOW, makeEntry } from "@/test-utils/fixtures"
import type { Id } from "../../../convex/_generated/dataModel"

/*
 * THE CLIPBOARD WRITER, over the cases where "copy what is on screen" and
 * "copy what is true" could come apart.
 *
 * Every assertion here is about the TEXT, not about a shape — this is the one
 * export whose consumer is a person or a language model reading prose, so the
 * thing worth pinning is the sentence, and a snapshot would let a wording
 * change through unread.
 */

const PROJECT = "project-1" as unknown as Id<"projects">

const OPTIONS = {
  timeZone: "UTC",
  use12Hour: false,
  display: "hms" as const,
  projectName: (id: string | undefined) => (id === PROJECT ? "Acme" : ""),
  range: { from: "2026-08-05" as const, to: "2026-08-05" as const },
  narrowing: [],
}

/** `groupByDay` with no clock running, which is the ordinary case here. */
function groupsOf(entries: Array<ReturnType<typeof makeEntry>>) {
  return groupByDay(entries, "UTC", NOW)
}

describe("entriesText", () => {
  it("writes the heading, the day and one line per record", () => {
    const text = entriesText(
      groupsOf([
        makeEntry({
          _id: "a" as unknown as Id<"timeEntries">,
          title: "Crew dropdowns",
          projectId: PROJECT,
        }),
      ]),
      OPTIONS
    )

    expect(text).toBe(
      [
        "Time entries · Wed 5 Aug 2026",
        "1 record · 1:00:00",
        "",
        "Wed 5 Aug 2026 — 1:00:00",
        "- 12:00 – 13:00 · 1:00:00 · Acme · Crew dropdowns",
        "",
      ].join("\n")
    )
  })

  /*
   * The whole point of the feature. A note is the only field that says what
   * actually happened, and the log clips it to one line by default — so a
   * clipped note here would copy a screen affordance rather than the record.
   */
  it("writes every line of a note, indented, uncut", () => {
    const text = entriesText(
      groupsOf([
        makeEntry({
          title: "Crew dropdowns",
          note: "Rewrote the picker.\n\nStill to do: the empty state.",
        }),
      ]),
      OPTIONS
    )

    expect(text).toContain(
      [
        "- 12:00 – 13:00 · 1:00:00 · No project · Crew dropdowns",
        "    Rewrote the picker.",
        "",
        "    Still to do: the empty state.",
      ].join("\n")
    )
  })

  /*
   * A day's `totalMs` counts a running entry's elapsed time; its `entries` does
   * not include the row. Carrying the group's own total across would print a
   * heading above rows that visibly do not add up to it, in a document whose
   * reader cannot check it against the screen.
   */
  it("totals only the records it writes, and says what it left running", () => {
    const text = entriesText(
      groupsOf([
        makeEntry({ _id: "a" as unknown as Id<"timeEntries">, title: "Done" }),
        makeEntry({
          _id: "b" as unknown as Id<"timeEntries">,
          title: "Running",
          startedAt: NOW,
          endedAt: null,
          durationMs: null,
        }),
      ]),
      OPTIONS
    )

    expect(text).toContain("1 record · 1:00:00")
    expect(text).toContain(
      "Wed 5 Aug 2026 — 1:00:00 (1 still running, not counted)"
    )
    expect(text).not.toContain("Running")
  })

  /*
   * "Today" is right on screen and wrong the moment the text leaves it: a note
   * pasted into Slack on Thursday about "Today" is a note about Wednesday, and
   * the reader has no way to tell.
   */
  it("never says Today or Yesterday", () => {
    const groups = groupsOf([makeEntry({ title: "Work" })])
    expect(groups[0].label).toBe("Today")
    expect(entriesText(groups, OPTIONS)).not.toContain("Today")
  })

  it("names an untitled entry rather than leaving the field blank", () => {
    expect(
      entriesText(groupsOf([makeEntry({ title: "" })]), OPTIONS)
    ).toContain("· (no description)")
  })

  /*
   * A week's rows pasted into a standup note look like the whole week. The
   * three hours a project filter removed are invisible in the paste unless the
   * paste says so.
   */
  it("names the narrowing that produced this set", () => {
    const text = entriesText(groupsOf([makeEntry({ title: "Work" })]), {
      ...OPTIONS,
      narrowing: ["project Acme", "billable only"],
    })

    expect(text).toContain("Filtered by: project Acme, billable only")
  })

  it("omits the range heading when the log is unbounded", () => {
    const text = entriesText(groupsOf([makeEntry({ title: "Work" })]), {
      ...OPTIONS,
      range: null,
    })

    expect(text.split("\n")[0]).toBe("Time entries")
  })

  it("prints a multi-day range as two dates", () => {
    const text = entriesText(groupsOf([makeEntry({ title: "Work" })]), {
      ...OPTIONS,
      range: { from: "2026-08-03", to: "2026-08-05" },
    })

    expect(text.split("\n")[0]).toBe(
      "Time entries · Mon 3 Aug 2026 – Wed 5 Aug 2026"
    )
  })

  /* Decimal is the unit the user bills in, and DESIGN.md permits it on a single
   * row in an export — so a copied duration matches the screen it came from. */
  it("bills in the user's own unit", () => {
    const text = entriesText(groupsOf([makeEntry({ title: "Work" })]), {
      ...OPTIONS,
      display: "decimal",
    })

    expect(text).toContain("1 record · 1.00 h")
    expect(text).toContain("· 1.00 h ·")
  })

  it("keeps the log's own day order and drops days with no rows", () => {
    const text = entriesText(
      groupsOf([
        makeEntry({
          _id: "a" as unknown as Id<"timeEntries">,
          title: "Wednesday work",
        }),
        makeEntry({
          _id: "b" as unknown as Id<"timeEntries">,
          title: "Monday work",
          startedAt: NOW - 2 * 86_400_000,
          endedAt: NOW - 2 * 86_400_000 + 3_600_000,
        }),
      ]),
      { ...OPTIONS, range: { from: "2026-08-03", to: "2026-08-05" } }
    )

    const days = text.split("\n").filter((line) => line.includes(" — "))
    expect(days).toEqual([
      "Wed 5 Aug 2026 — 1:00:00",
      "Mon 3 Aug 2026 — 1:00:00",
    ])
  })
})
