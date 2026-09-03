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
  // `toStrictEqual`, not `toEqual`: the latter ignores keys whose value is
  // `undefined`, so it cannot tell a real `delete` from `= undefined` — and
  // the deleting branch is the whole point of this test.
  expect(client.getQueryData(KEY)).toStrictEqual({
    timezone: "UTC",
    currency: "EUR",
    logoUrl: null,
  })
})
