import { createFileRoute } from "@tanstack/react-router"
import { pageTitle } from "@shared/brand"
import { Projects } from "./-projects"

/*
 * The page itself is in ./-projects — see that file's header. The route file
 * holds nothing but the definition, so `component:` is an import from a
 * non-route file and the code-splitter can do its job.
 */
export const Route = createFileRoute("/_authed/projects")({
  head: () => ({ meta: [{ title: pageTitle("Projects") }] }),
  component: Projects,
})
