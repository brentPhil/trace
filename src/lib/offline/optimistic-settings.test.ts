import { QueryClient } from "@tanstack/react-query"
import { expect, it } from "vitest"
import { TanStackLocalStore } from "./tanstack-local-store"
import { optimisticSettingsUpdate } from "./optimistic-settings"

const KEY = ["convexQuery", "settings:get", {}]

it("patches only the fields sent, and null clears the default rate", () => {
  const client = new QueryClient()
  client.setQueryData(KEY, { timezone: "UTC", currency: "USD", defaultHourlyRateCents: 5000, logoUrl: null })
  const store = new TanStackLocalStore(client)
  optimisticSettingsUpdate(store, { currency: "EUR", defaultHourlyRateCents: null })
  expect(client.getQueryData(KEY)).toEqual({ timezone: "UTC", currency: "EUR", logoUrl: null })
})
