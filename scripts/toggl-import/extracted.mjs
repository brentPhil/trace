/**
 * The 41 entries the Toggl detailed report actually shows for 27 Jul - 9 Aug
 * 2026, pulled from the Reports API v3 through the signed-in browser.
 *
 * REAL, all of it — this replaces the reconstruction in reconstruct.mjs, which
 * existed only because the summary export carried no clock times. Every field
 * below came off the wire: `start` and `stop` per entry, the billable flag per
 * entry, and the project per entry.
 *
 * Two things the reconstruction got wrong, and which this fixes:
 *   - 61 invented entries against 41 real ones
 *   - all 61 marked billable (from the project default) when Toggl says 10
 *
 * Rows are `togglId,startSec,durationSec,billable,hasProject,titleIndex`.
 * The Toggl entry id is the idempotency key, so a re-import of the same
 * fortnight is a no-op no matter how the rows are ordered or re-fetched.
 */

const TITLES = [
  "Addressing CB-307 request changes",
  "[B-CB-315] Woking on Engineering Log offline storage & replication follow up tasks",
  "[B-CB-317] Disabling Engineering Log in production behind a feature flag",
  "Team standup",
  "[B-CB-308] Fixing Pre-departure photo bouncing the app back to Home port",
  "[B-CB-312] Fixing missing fuel receipts on refuelling",
  "[B-CB-304] Fixing Engineering tab showing when the engineering log is switched off",
  "[B-CB-300] Fixing Engineering Log offline engine readings",
  "Worked on PR's change request",
  "[B-CB-316.1] Record button disables when the webcam stream dies",
  "All Staff Meeting",
  "[CB-319] Fixing missing engine selection on Engine Fuel and Other Fluids fields",
  "[B-CB-318] Building Logbook Master auto-population from crew duty",
  "",
  "[B-CB-327] Building Schedule Review passenger and vehicle totals",
  "[B-CB-328] Fixing Pre-departure Check dates across time zones",
  "Hudle with benjie regarding the trip-log signature offline persistence issues",
  "[B-CB-330] Fixing Trip Log signature confirmation not saving",
  "[B-CB-331] Fixing Maintenance crew assignment dropdowns",
  "[B-CB-334] Fixing Logbook engine hours save error and duplicates",
  "[B-CB-333] Fixing Crew Training trainer not showing on overdue sessions",
  "[B-CB-332] Fixing Engineering Log rows per page",
  "[B-CB-313] Fixing refuelling delete leaving records on the server",
  "[B-CB-326] Building Crew Training CSV and PDF download",
  "Dev team standup",
  "[B-CB-336] Fixing Logbook role permissions not unlocking sections",
]

const ROWS = `4495292194,1785131306,2547,1,1,0;4495335275,1785134040,9960,1,1,1;4495593388,1785144000,7800,1,1,2;4495758923,1785151800,3600,1,0,3;4495996123,1785160451,3913,1,1,4;4496136782,1785164857,5910,1,1,5;4496824590,1785206640,8040,1,1,4;4497294710,1785220020,16639,1,1,4;4497320275,1785237935,7243,1,1,6;4497552609,1785245160,10192,1,1,7;4498427253,1785303601,6221,0,1,8;4498527586,1785309780,15960,0,1,9;4498864727,1785326400,1440,0,0,10;4499845876,1785380841,7793,0,1,11;4500103763,1785391080,5520,0,1,8;4500105088,1785396600,5588,0,1,11;4500207691,1785402180,8529,0,1,12;4500710137,1785418560,7285,0,1,12;4501422095,1785473883,1403,0,0,13;4501498991,1785480181,7872,0,0,13;4503529927,1785734529,10280,0,1,14;4503850683,1785744780,10020,0,1,15;4503955605,1785754800,3600,0,0,3;4504079797,1785758400,1796,0,1,16;4504607288,1785763200,3600,0,1,17;4505114198,1785817151,3211,0,1,8;4505144806,1785820376,14919,0,1,17;4505450517,1785835260,7387,0,1,18;4505630463,1785844440,3960,0,1,18;4506723892,1785908548,3091,0,1,8;4506771747,1785911700,8460,0,1,19;4506943084,1785920160,12960,0,1,20;4507208707,1785933209,7141,0,1,21;4508057264,1785973989,5007,0,1,21;4508114796,1785978960,6984,0,1,22;4508224311,1785990840,4830,0,1,22;4508249552,1785995682,7542,0,1,23;4508384381,1786003200,3600,0,1,24;4508438320,1786005779,2082,0,1,23;4509681133,1786082678,18670,0,1,23;4510175173,1786107600,5880,0,1,25`

/** What the report's own totals say, so a bad transcription cannot pass. */
export const EXPECTED = { entries: 41, seconds: 288_475, billable: 10, days: 10 }

export const PROJECT = "Sealogs"

export function entries() {
  return ROWS.split(";").map((line) => {
    const [id, startSec, durSec, billable, hasProject, titleIdx] = line.split(",")
    const startedAt = Number(startSec) * 1000
    return {
      clientKey: `toggl:${id}`,
      title: TITLES[Number(titleIdx)],
      startedAt,
      endedAt: startedAt + Number(durSec) * 1000,
      billable: billable === "1",
      ...(hasProject === "1" ? { projectName: PROJECT } : {}),
    }
  })
}
