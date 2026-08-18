import { cronJobs } from "convex/server"
import { internal } from "./_generated/api"

/*
 * The only cron this product has.
 *
 * 15 minutes is the staleness the calendar link accepts: a meeting created or
 * moved in Google shows up within a quarter of an hour. Push notifications
 * (`events.watch`) would make it immediate and cost a verified webhook domain
 * plus a channel renewal every seven days — a renewal nobody notices has stopped
 * until the grid quietly stops updating.
 *
 * `crons.interval`, never the `daily`/`hourly` helpers.
 */
const crons = cronJobs()

crons.interval(
  "google calendar sync",
  { minutes: 15 },
  internal.google.syncAll,
  {}
)

export default crons
