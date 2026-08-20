import { cronJobs } from "convex/server"
import { internal } from "./_generated/api"

/*
 * The mirror's poll.
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

/*
 * A MINUTE, and the number is the whole design of the switch.
 *
 * It is the resolution of "the timer changed when my meeting started". Coarser
 * and the screen lags a switch the user is watching for; finer and the job runs
 * more often than the thing it watches for can happen. The RECORD is exact at
 * any interval — both instants come from the event, not from this clock — so
 * what this number buys is only how fast the screen catches up.
 */
crons.interval(
  "google calendar tick",
  { minutes: 1 },
  internal.googleTick.tickAll,
  {}
)

export default crons
