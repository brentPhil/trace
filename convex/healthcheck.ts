import { query } from "./_generated/server"

// Touches no tables, so it works against an empty schema. Exists to prove the
// whole pipeline end to end: server-rendered through the route loader, then
// upgraded to a live subscription on the client.
//
// Deliberately returns a constant. Query results are cached, so a timestamp
// here would make the cache behave oddly and obscure what we are testing.
export const get = query({
  args: {},
  handler: async () => {
    return { ok: true, backend: "convex" as const }
  },
})
