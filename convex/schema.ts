import { defineSchema } from "convex/server"

// No application tables yet.
//
// Better Auth is installed as a Convex component, so its user, session, and
// account tables live in the component's own namespace rather than here. Add
// this app's tables below as the domain takes shape.
export default defineSchema({})
