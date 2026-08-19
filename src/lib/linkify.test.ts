// Finding links in an invite description.
//
// The input is third-party text — whoever sent the meeting wrote it — so the
// cases that matter are the hostile and the malformed ones, not the tidy URL on
// its own line. The Teams block in a real invite is the shape this was built
// against: a long URL with a query string, wrapped in dashed rules and
// surrounding prose.
import { describe, expect, it } from "vitest"
import { linkify, safeHref } from "@/lib/linkify"

describe("safeHref", () => {
  it("allows http and https", () => {
    expect(safeHref("https://example.com")).toBe("https://example.com")
    expect(safeHref("http://example.com")).toBe("http://example.com")
  })

  it("refuses every other scheme", () => {
    // React already neutralises this one and browsers block top-level data:
    // navigation, so these are defence in depth — but the whole cost is a check.
    expect(safeHref("javascript:alert(1)")).toBeNull()
    expect(safeHref("data:text/html,<script>alert(1)</script>")).toBeNull()
    expect(safeHref("file:///etc/passwd")).toBeNull()
  })

  it("refuses a relative path", () => {
    // It would resolve against Chroneli's own origin, which is never what a
    // link inside someone else's calendar invite means.
    expect(safeHref("/settings")).toBeNull()
    expect(safeHref("not a url")).toBeNull()
  })

  it("is null for an absent url", () => {
    expect(safeHref(undefined)).toBeNull()
  })
})

describe("linkify", () => {
  it("returns one text segment when there is nothing to link", () => {
    expect(linkify("Standup, no link")).toEqual([
      { kind: "text", value: "Standup, no link" },
    ])
  })

  it("splits prose around a link", () => {
    expect(linkify("Join at https://example.com now")).toEqual([
      { kind: "text", value: "Join at " },
      { kind: "link", value: "https://example.com", href: "https://example.com" },
      { kind: "text", value: " now" },
    ])
  })

  it("keeps a query string, which is where meeting passcodes live", () => {
    const url =
      "https://teams.microsoft.com/meet/247181968887963?p=CVeTEgIPQw3vicMw3N"
    const [segment] = linkify(url)
    expect(segment).toEqual({ kind: "link", value: url, href: url })
  })

  it("does not swallow a sentence's full stop", () => {
    expect(linkify("See https://example.com/agenda.")).toEqual([
      { kind: "text", value: "See " },
      {
        kind: "link",
        value: "https://example.com/agenda",
        href: "https://example.com/agenda",
      },
      { kind: "text", value: "." },
    ])
  })

  it("drops an unbalanced closing bracket but keeps a balanced one", () => {
    expect(linkify("(see https://example.com)")).toEqual([
      { kind: "text", value: "(see " },
      { kind: "link", value: "https://example.com", href: "https://example.com" },
      { kind: "text", value: ")" },
    ])

    const wiki = "https://en.wikipedia.org/wiki/Foo_(bar)"
    expect(linkify(wiki)).toEqual([{ kind: "link", value: wiki, href: wiki }])
  })

  it("finds several links in one block", () => {
    const segments = linkify("https://a.example.com\nand https://b.example.com")
    expect(segments.filter((s) => s.kind === "link")).toHaveLength(2)
  })

  it("leaves a javascript: run as prose rather than dropping it", () => {
    // The user can still read and copy it; it simply is not clickable. Silently
    // deleting text somebody wrote would be worse than not linking it.
    const segments = linkify("do not click javascript:alert(1) thanks")
    expect(segments).toEqual([
      { kind: "text", value: "do not click javascript:alert(1) thanks" },
    ])
  })

  it("preserves the newlines the description is laid out with", () => {
    const text = "___________\nJoin:\nhttps://example.com\n___________"
    const rejoined = linkify(text)
      .map((segment) => segment.value)
      .join("")
    expect(rejoined).toBe(text)
  })

  it("round-trips any input exactly", () => {
    // The strongest property this function has: it only ever SPLITS text. If
    // concatenating the segments does not reproduce the input, something was
    // dropped or duplicated, and the user is reading a description that is not
    // what the sender wrote.
    for (const text of [
      "",
      "plain",
      "https://example.com",
      "a https://example.com b https://other.example.com c",
      "trailing https://example.com...",
      "javascript:alert(1)",
    ]) {
      expect(
        linkify(text)
          .map((segment) => segment.value)
          .join("")
      ).toBe(text)
    }
  })
})
