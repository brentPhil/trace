import { describe, expect, it } from "vitest"
import { loopbackCallbackUrl, parsePort } from "@/lib/desktop-handoff"

describe("parsePort", () => {
  it("accepts an in-range port as a string or a number", () => {
    expect(parsePort("52341")).toBe(52341)
    expect(parsePort(52341)).toBe(52341)
    expect(parsePort("1024")).toBe(1024)
    expect(parsePort("65535")).toBe(65535)
  })

  it("rejects anything outside the unprivileged range", () => {
    expect(parsePort("80")).toBeNull()
    expect(parsePort("1023")).toBeNull()
    expect(parsePort("65536")).toBeNull()
    expect(parsePort("-1")).toBeNull()
  })

  it("rejects values that are not plainly integers", () => {
    expect(parsePort("52341.5")).toBeNull()
    expect(parsePort("52341abc")).toBeNull()
    expect(parsePort("0x1234")).toBeNull()
    expect(parsePort(" 52341 ")).toBeNull()
    expect(parsePort("")).toBeNull()
    expect(parsePort(undefined)).toBeNull()
    expect(parsePort(null)).toBeNull()
    expect(parsePort({})).toBeNull()
  })
})

describe("loopbackCallbackUrl", () => {
  it("builds the URL from parts rather than echoing input", () => {
    expect(loopbackCallbackUrl(52341, "tok", "st")).toBe(
      "http://127.0.0.1:52341/callback?token=tok&state=st"
    )
  })

  it("percent-encodes the token and state", () => {
    expect(loopbackCallbackUrl(52341, "a b&c", "d/e")).toBe(
      "http://127.0.0.1:52341/callback?token=a+b%26c&state=d%2Fe"
    )
  })
})
