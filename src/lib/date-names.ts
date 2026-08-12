/**
 * The month and weekday words, written down ONCE.
 *
 * There were three copies before this file: `MONTH_ABBR` in
 * `date-range-picker.ts`, `MONTH_NAMES`/`WEEKDAY_NAMES` in `month-grid.ts`, and
 * a private `MONTHS`/`WEEKDAYS` pair in `calendar-label.ts`. Three tables of the
 * same twelve and seven strings, in three files that all draw dates on the same
 * screen — so "Sept" in one and "Sep" in another was a one-character edit away
 * at all times, and the range picker's trigger, the calendar's range bar and the
 * month grid's headings are routinely on screen together.
 *
 * A leaf module rather than a home inside any one of them: none of the three is
 * naturally upstream of the other two, and `month-grid.ts` owning the table the
 * range LABEL formats with would make a label import a grid.
 *
 * NOT LOCALE-DERIVED, deliberately, and for the same reason `us-date.ts` is not:
 * these words sit beside figures this product prints onto invoices, and a
 * document that reads differently depending on which machine rendered it is a
 * document a client cannot check. `Intl` also costs a formatter per call site,
 * which the month grid's per-cell render hooks can least afford.
 *
 * Indexed the way the rest of the codebase already indexes: months are 1-based
 * in `parseDayString`, so callers subtract one; weekdays are 0-based from
 * Sunday, which is what `weekdayOf` and `Date.prototype.getDay` both return.
 */

/** "Jan" … "Dec". `MONTH_ABBR[month - 1]`. */
export const MONTH_ABBR = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
]

/** "January" … "December". `MONTH_NAMES[month - 1]`. */
export const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
]

/** "Sun" … "Sat", indexed by `weekdayOf` / `getDay()`. */
export const WEEKDAY_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
