import { describe, expect, it } from "vitest"
import { isOffline } from "./online"

const connected = { isWebSocketConnected: true, hasEverConnected: true, connectionRetries: 0 }

describe("isOffline", () => {
  it("is offline when the browser says so, whatever the socket thinks", () => {
    expect(isOffline(connected, false)).toBe(true)
  })
  it("is online while connected", () => {
    expect(isOffline(connected, true)).toBe(false)
  })
  it("is offline once a previously good socket has dropped and retried", () => {
    expect(isOffline({ ...connected, isWebSocketConnected: false, connectionRetries: 1 }, true)).toBe(true)
  })
  it("gives a fresh boot two tries before calling it offline", () => {
    const fresh = { isWebSocketConnected: false, hasEverConnected: false, connectionRetries: 0 }
    expect(isOffline(fresh, true)).toBe(false)
    expect(isOffline({ ...fresh, connectionRetries: 1 }, true)).toBe(false)
    expect(isOffline({ ...fresh, connectionRetries: 2 }, true)).toBe(true)
  })
})
