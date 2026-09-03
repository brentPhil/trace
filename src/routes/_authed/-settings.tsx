/*
 * /settings — THE PAGE, NOT THE ROUTE. The route definition and its loader
 * stay in settings.tsx; the `-` prefix keeps this file out of the route tree,
 * the same convention the tests beside it already use.
 *
 * The component lives here because it has to be EXPORTED — -settings.test.tsx
 * renders it against a seeded query client — and an export of a route file is
 * something the router's code-splitter refuses to split: every page shipped in
 * the eager bundle, with a [tanstack-router] warning per route saying so.
 * Imported from a non-route file, `component:` splits as normal.
 */
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useToastManager } from "@/components/ui/toast"
import { useEffect, useState } from "react"
import { useSuspenseQuery } from "@tanstack/react-query"
import {
  convexQuery,
  useConvexAction,
  useConvexMutation,
} from "@convex-dev/react-query"
import { GoogleCalendarSection } from "@/components/settings/google-calendar-section"
import { InvoiceLogoSection } from "@/components/settings/invoice-logo-section"
import { MusicLibrarySection } from "./-music-library"
import { MusicSection } from "@/components/settings/music-section"
import { ThemeSection } from "@/components/settings/theme-section"
import { useTheme } from "@/components/theme-provider"
import { Page } from "@/components/shell/page"
import { authClient } from "@/lib/auth-client"
import { useLatest } from "@/hooks/use-latest"
import { useClassifierMutations } from "@/hooks/use-classifiers"
import { useOutboxMutation } from "@/lib/offline/outbox-provider"
import { useOnlineStatus } from "@/lib/offline/use-online-status"
import { OFFLINE_GOOGLE_REASON, OFFLINE_UPLOAD_REASON } from "@/lib/offline/offline-copy"
import { errorMessage } from "@/lib/error-message"
import { formatTotal } from "@/lib/format-total"
import { rateHelp } from "@/lib/format-money"
import { cn } from "@/lib/utils"
import { formatMoney, parseMoney, supportedCurrencies } from "@shared/money"
import { MAX_LOGO_BYTES, isAcceptedLogoContentType } from "@shared/logo"
import { api } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"

/** A sample used to show what each duration format actually looks like. */
const SAMPLE_MS = 8 * 3_600_000 + 12 * 60_000

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
]

const RUNAWAY_CHOICES = [4, 6, 8, 10, 12, 24]

/*
 * THE ONE-SHOT MARKER THAT SAYS "THIS LOAD IS A RETURN FROM GOOGLE".
 *
 * Without it, the round-trip effect below treated the ordinary disconnected
 * state as an OAuth return, and DISCONNECT RE-CONNECTED ITSELF: deleting the
 * `googleConnections` row flipped `connected` true→false, the effect's
 * dependencies changed, it re-ran, `listAccounts()` still reported the Google
 * account that nothing had unlinked, and `connect` inserted a fresh row and
 * scheduled a sync. The only control for ending the mirror silently
 * re-acquired other people's names and email addresses, and a reload did not
 * help because the effect also ran on mount while disconnected.
 *
 * `sessionStorage` RATHER THAN A REF OR STATE, because `linkSocial` performs a
 * full document navigation to Google and Google navigates back: React state
 * and a `useRef` are both destroyed on that hop, so a bare ref set before
 * navigating away is guaranteed to be gone by the time it would be read.
 * `sessionStorage` is the one client store that survives a document load and
 * still dies with the tab — exactly this marker's wanted lifetime.
 *
 * Rather than a `callbackURL` query flag, because a URL parameter is
 * forgeable: anyone could hand the user a link to /settings carrying it, and
 * the marker would then fire `connect` on a visit the user never started.
 * Storage can only be written by this page.
 */
const GOOGLE_LINK_RETURN_KEY = "chroneli:google-link-return"

/** Set on the way OUT to Google, so only a deliberate Connect/Reconnect press
 *  can arm the round-trip. Both calls are wrapped: `sessionStorage` throws
 *  outright in a browser configured to block all site data — a browser in
 *  which the Better Auth session cookie would not survive either, so the page
 *  has already failed for larger reasons than this marker. */
function markGoogleLinkReturn(): void {
  try {
    window.sessionStorage.setItem(GOOGLE_LINK_RETURN_KEY, "1")
  } catch {
    // Nothing to recover here: the link still happens, the round-trip simply
    // does not complete itself and the section keeps offering Connect.
  }
}

/** Read AND clear, in one call. One-shot is the point — a marker that survives
 *  its own reading is a marker that fires `connect` at some later unrelated
 *  moment, which is the defect this replaced. */
function takeGoogleLinkReturn(): boolean {
  try {
    const marked =
      window.sessionStorage.getItem(GOOGLE_LINK_RETURN_KEY) !== null
    window.sessionStorage.removeItem(GOOGLE_LINK_RETURN_KEY)
    return marked
  } catch {
    return false
  }
}

export function Settings() {
  const { data: settings } = useSuspenseQuery(convexQuery(api.settings.get, {}))
  const update = useOutboxMutation("settings.update")
  const generateLogoUploadUrl = useLatest(
    useConvexMutation(api.settings.generateLogoUploadUrl)
  )
  const clearLogo = useLatest(useConvexMutation(api.settings.clearLogo))
  const setLogo = useLatest(useConvexAction(api.settings.setLogo))
  const toasts = useToastManager()
  const online = useOnlineStatus()
  const [logoBusy, setLogoBusy] = useState(false)
  /* The page reads the theme context ONCE and hands the pieces down, so
     `ThemeSection` stays presentational like every other section here. */
  const theme = useTheme()
  const themeActions = {
    setTheme: theme.setTheme,
    setPreset: theme.setPreset,
    setRadius: theme.setRadius,
  }

  const save = (patch: Parameters<typeof update>[0]) => {
    // Never rejects: a refusal reaches the user through the outbox's toast.
    void update(patch)
  }

  // `useLatest`-wrapped for a stable identity, so it can sit in the connect
  // effect's dependency array below without re-running that effect on every
  // render — the same reason every mutation on this page is wrapped.
  const report = useLatest((thrown: unknown) => {
    toasts.add({ title: errorMessage(thrown), priority: "high" })
  })

  /*
   * Google Calendar.
   *
   * `projects` is already ensured by `_authed.tsx`'s own loader for every page
   * under it — -timer.tsx and -projects.tsx read it the same way, with no
   * `ensureQueryData` of their own — so this is a cache read, not a second
   * round trip.
   */
  const { data: connection } = useSuspenseQuery(
    convexQuery(api.google.connection, {})
  )
  const { data: calendars } = useSuspenseQuery(
    convexQuery(api.google.listCalendars, {})
  )
  const { data: projects } = useSuspenseQuery(
    convexQuery(api.projects.list, {})
  )

  const connectMutation = useLatest(useConvexMutation(api.google.connect))
  const disconnectMutation = useLatest(useConvexMutation(api.google.disconnect))
  const setCalendarShowMutation = useLatest(
    useConvexMutation(api.google.setCalendarShow)
  )
  const setCalendarProjectMutation = useLatest(
    useConvexMutation(api.google.setCalendarProject)
  )
  const { createProject } = useClassifierMutations()

  /*
   * `linkSocial`, never `signIn.social`.
   *
   * This ADDS Google to an existing email-and-password identity rather than
   * replacing it: the password login keeps working, and
   * `revokeSessionsOnPasswordReset` keeps meaning what it says. Signing in with
   * Google instead would strand anyone who set this up on a second device.
   */
  const connectGoogle = () => {
    // Armed BEFORE navigating away, because after `linkSocial` there is no
    // "after" — see `GOOGLE_LINK_RETURN_KEY`.
    markGoogleLinkReturn()
    void authClient.linkSocial({
      provider: "google",
      callbackURL: window.location.href,
      /*
       * THE CALENDAR SCOPE IS REQUESTED HERE, not on the provider.
       *
       * `convex/auth.ts` deliberately leaves the provider on Google's default
       * profile-and-email scopes so the SIGN-IN screens do not ask a stranger
       * to hand over their calendar. This is the moment the permission is
       * actually about to be used, which is what Google's incremental
       * authorisation asks for — and Better Auth documents `scopes` as
       * "additional scopes to request when linking the account … compared to
       * the initial authentication", so it upgrades an account that already
       * exists from signing in with Google rather than rejecting it.
       *
       * If this list ever stops matching what `convex/googleApi.ts` calls, the
       * failure is a 403 on every sync and a connection flagged `reauth` —
       * with a consent screen that looked like it succeeded.
       */
      scopes: ["https://www.googleapis.com/auth/calendar.readonly"],
    })
  }

  /*
   * DISCONNECT REVOKES, rather than only forgetting.
   *
   * `google.disconnect` deletes the four `google*` tables; it cannot touch the
   * Better Auth `account` row, and that row holds the REFRESH TOKEN. Left
   * behind, Chroneli keeps a live, offline-capable grant on the user's
   * calendar after they pressed the only button that says it stops — so the
   * unlink is half of what "disconnect" means, not a tidy-up.
   *
   * OUR ROWS FIRST, THE UNLINK SECOND, and the order is the whole decision.
   * Either step can fail. Rows gone with the grant surviving is recoverable:
   * nothing syncs (there is no connection row for the cron to pick up), the
   * section reads disconnected, and pressing Disconnect again retries the
   * unlink. The reverse — grant revoked with our rows surviving — leaves a
   * connection that can never obtain a token again, so every cron run burns
   * its `tokenFailures` counter until `TOKEN_FAILURE_LIMIT` flags it `reauth`,
   * and the user is shown a "lost access" banner for something they asked for.
   * So the recoverable failure is the one placed last-but-one.
   *
   * WHEN GOOGLE IS THE ONLY WAY IN, THE UNLINK IS NOT ATTEMPTED.
   *
   * Better Auth refuses to unlink a sole account (`unlinkAccount` throws
   * FAILED_TO_UNLINK_LAST_ACCOUNT when `findAccounts` returns one row and
   * `allowUnlinkingAll` is off). That used to be unreachable — every account
   * was created through email-and-password and `linkSocial` only ever ADDED
   * Google beside the credential row — and it stopped being unreachable the
   * moment the auth screens grew `signIn.social`: somebody who signed up with
   * Google has exactly one account row, and it is the Google one.
   *
   * Calling it anyway would fail correctly and advise wrongly, because the old
   * message told the user to press Disconnect again — which for them can never
   * work. And succeeding would be worse than failing: it would revoke the only
   * credential they have and lock them out of the product.
   *
   * So the sole-account case is detected first and told the truth: the mirror
   * is deleted, the grant is left alone because it is their key, and revoking
   * calendar access is pointed at Google's own permissions page, which is the
   * only place that can do it without taking their sign-in with it.
   *
   * A failure is REPORTED, never swallowed. "Disconnected" while a live grant
   * survives is the one outcome a user cannot detect from this screen. Toasted
   * here rather than thrown through `report`, because `errorMessage`
   * deliberately flattens anything that is not a Trace error to "That didn't
   * save. Try again." — which would be the wrong sentence twice over: the
   * removal DID save, and trying again is not the only recovery.
   */
  const disconnectGoogle = async () => {
    // Read BEFORE the mirror is deleted. Nothing here depends on that order
    // today, and putting the read first keeps it independent of it.
    const accounts = await authClient.listAccounts()
    const googleIsOnlyAccount =
      (accounts.data ?? []).filter((account) => account.providerId === "google")
        .length === (accounts.data ?? []).length &&
      (accounts.data ?? []).length > 0

    await disconnectMutation({})

    if (googleIsOnlyAccount) {
      toasts.add({
        title:
          "Your calendar data was removed. Chroneli's Google access was left in place because signing in with Google is how you get into your account — remove it at myaccount.google.com/permissions if you want it gone.",
        priority: "high",
      })
      return
    }

    const result = await authClient.unlinkAccount({ providerId: "google" })
    if (result.error) {
      toasts.add({
        title:
          "Your calendar data was removed, but Chroneli could not revoke its Google access. Try Disconnect again, or remove Chroneli in your Google account settings.",
        priority: "high",
      })
    }
  }

  /*
   * HOP TWO, after Google redirects back.
   *
   * `linkSocial` leaves the page, so nothing can be awaited after it — the
   * `google.connect` mutation has to run on the way BACK IN. There are two
   * moments that need it:
   *
   *  - First connect: a Google account now exists on the identity, and our
   *    `googleConnections` row does not (`connection.connected` is false).
   *  - Reconnect: the row exists but is flagged `reauth` (Google access was
   *    revoked), and `connect` is — per its own comment in `convex/google.ts`
   *    — the ONLY thing that clears that flag. Without firing here, a user
   *    who completes Google's consent screen and lands back on this page
   *    would keep seeing the "lost access" banner until the next cron tick,
   *    up to 15 minutes later.
   *
   * WHAT ARMS IT IS THE MARKER, NOT THE STATE. "Not connected" is also what a
   * deliberate disconnect looks like, and reading it as "just came back from
   * Google" is what made Disconnect re-connect itself — see
   * `GOOGLE_LINK_RETURN_KEY`. Only a Connect/Reconnect press sets the marker,
   * and reading it clears it, so this fires at most once per trip out.
   *
   * The marker is TAKEN FIRST, before any early return, so it cannot be left
   * in storage by a render that declined to act on it and then fire at some
   * later unrelated moment — including right after a disconnect.
   *
   * The healthy state (`connected` and `status === "ok"`) is still excluded:
   * the round trip has already completed (a second tab, a reload racing the
   * query), and `connect` has nothing left to do there.
   *
   * `listAccounts()` still runs, because the marker only says the user LEFT
   * for Google — it cannot say they finished. Someone who cancels at the
   * consent screen is redirected back with the marker set and no linked
   * account, and this is what stops `connect` firing for them.
   *
   * No cancel-on-unmount guard: there is no state to set, so a late `connect`
   * is simply the round trip completing. A guard here would also mean
   * StrictMode's deliberate double-invoke cancelled the first pass and found
   * no marker on the second, so the round trip would never complete in dev.
   */
  useEffect(() => {
    if (!takeGoogleLinkReturn()) return
    if (connection.connected && connection.status !== "reauth") return
    void authClient.listAccounts().then((result) => {
      const linked = (result.data ?? []).some(
        (account) => account.providerId === "google"
      )
      if (linked) void connectMutation({}).catch(report)
    })
  }, [connection.connected, connection.status, connectMutation, report])

  const uploadLogo = async (file: File) => {
    if (!isAcceptedLogoContentType(file.type) || file.size > MAX_LOGO_BYTES) {
      toasts.add({
        title: "Use a PNG or JPEG logo no larger than 1 MB.",
        priority: "high",
      })
      return
    }

    setLogoBusy(true)
    try {
      const uploadUrl = await generateLogoUploadUrl({})
      const response = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      })
      if (!response.ok) throw new Error("upload failed")
      const payload: unknown = await response.json()
      const storageId =
        typeof payload === "object" &&
        payload !== null &&
        "storageId" in payload &&
        typeof payload.storageId === "string"
          ? payload.storageId
          : null
      if (storageId === null) throw new Error("upload returned no id")
      await setLogo({ storageId: storageId as Id<"_storage"> })
    } catch (thrown) {
      toasts.add({ title: errorMessage(thrown), priority: "high" })
    } finally {
      setLogoBusy(false)
    }
  }

  return (
    /*
      NOT PINNED — see `Page`'s rule. The header is a lone title, and nothing
      on it acts on what scrolls underneath: every control on this page is
      inside the section it belongs to and saves the instant it changes, so
      there is nothing at the top that a reader eight sections down still
      needs. Pinning would cost a permanent band of ground to keep the word
      "Settings" in view of a page that has already been navigated to.
    */
    <Page title="Settings">
      {/*
        FULL WIDTH, like every other page — but the fix for a wide settings
        page is in `Section`, not here.

        Capping the page was the old answer to a real problem: at 1600px each
        Section's `border-b` was a 1329px hairline running under a 272px
        `<select>`, six times down the page. That is a row with an empty
        middle, and narrowing the page only hid it. `Section` now puts the
        title and hint in a column beside the control, so the rule spans
        something.

        `pb-6` only — the top padding is the title row's, above.
      */}
      <div className="flex flex-1 flex-col gap-8 px-4 pb-6">
        <Section
          title="Time zone"
          hint="Re-files history rather than rewriting it — nothing is lost, but old days may shift."
        >
          <TimezoneField
            value={settings.timezone}
            onChange={(timezone) => save({ timezone })}
          />
        </Section>

        <Section title="Week starts on">
          <Select
            value={String(settings.weekStartDay)}
            onValueChange={(value) => save({ weekStartDay: Number(value) })}
          >
            <SelectTrigger aria-label="Week starts on" className="w-52">
              {/* The value is the day INDEX, so the trigger has to be told the
                  name — see `SelectValue` in ui/select.tsx. */}
              <SelectValue>{(day) => WEEKDAYS[Number(day)]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {WEEKDAYS.map((name, index) => (
                <SelectItem key={name} value={String(index)}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Section>

        <Section
          title="Durations"
                  >
          <div className="flex flex-col gap-2">
            <Radio
              name="durationDisplay"
              checked={settings.durationDisplay === "hms"}
              onChange={() => save({ durationDisplay: "hms" })}
            >
              Hours and minutes
              <Sample>{formatTotal(SAMPLE_MS, "hms")}</Sample>
            </Radio>
            <Radio
              name="durationDisplay"
              checked={settings.durationDisplay === "decimal"}
              onChange={() => save({ durationDisplay: "decimal" })}
            >
              Decimal hours
              <Sample>{formatTotal(SAMPLE_MS, "decimal")}</Sample>
            </Radio>
          </div>
        </Section>

        <Section title="Clock">
          <div className="flex flex-col gap-2">
            <Radio
              name="timeFormat"
              checked={settings.timeFormat === "24"}
              onChange={() => save({ timeFormat: "24" })}
            >
              24-hour
              <Sample>17:30</Sample>
            </Radio>
            <Radio
              name="timeFormat"
              checked={settings.timeFormat === "12"}
              onChange={() => save({ timeFormat: "12" })}
            >
              12-hour
              <Sample>5:30 PM</Sample>
            </Radio>
          </div>
        </Section>

        {/* WITH THE DISPLAY GROUP, after Clock and before the behavioural
            settings below — a palette is a formatting choice, not an account
            or integration one. Ordering here is plain JSX order; there is no
            registry. */}
        <Section title="Theme">
          <ThemeSection
            theme={theme.theme}
            resolved={theme.resolved}
            hydrated={theme.hydrated}
            preset={theme.preset}
            radius={theme.radius}
            actions={themeActions}
          />
        </Section>

        <Section
          title="Runaway timers"
          hint="Never stops anything on your behalf."
        >
          <Select
            value={String(Math.round(settings.runawayThresholdMs / 3_600_000))}
            onValueChange={(value) =>
              save({ runawayThresholdMs: Number(value) * 3_600_000 })
            }
          >
            <SelectTrigger aria-label="Warn after" className="w-52">
              {/* The value is a bare hour count; the option reads "After 8
                  hours" and the trigger has to say the same thing. */}
              <SelectValue>{(hours) => `After ${String(hours)} hours`}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {RUNAWAY_CHOICES.map((hours) => (
                <SelectItem key={hours} value={String(hours)}>
                  After {hours} hours
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Section>

        <Section
          title="Currency"
          /*
           * THE ONE SENTENCE THAT SURVIVED THE CUT, and it is the one that
           * costs money if it is missing.
           *
           * Rates are stored per PROJECT as a plain number of hundredths;
           * currency is a single per-USER label over all of them. Switching
           * USD→EUR re-labels a $10.00/hr project as €10.00/hr — no
           * conversion, no rate touched, every historical figure on /reports
           * re-labelled with it. Nothing on screen shows that until it has
           * already happened, which is the test every remaining hint on this
           * page has to pass.
           *
           * The four sentences around it did not pass it: they explained that
           * the field formats money and that only hundredth-based currencies
           * are offered, both of which the control demonstrates by existing.
           */
          hint="Re-labels the rates you have already set; it does not convert them."
        >
          <CurrencyField
            value={settings.currency}
            onChange={(currency) => save({ currency })}
          />
        </Section>

        {/*
          THE FALLBACK, not "the" rate. A project's own rate always wins; this
          is what prices everything no project rate covers — including billable
          time with no project at all, which was previously unpriceable however
          billable it was, and showed up on /reports only as a footnote saying
          so. Toggl resolves rates the same way and calls this the workspace
          rate: the most granular rate wins, and this is the least granular one
          there is.
        */}
        <Section
          title="Default hourly rate"
          hint="Used for billable time no project rate covers. Leave it blank and that time stays unpriced."
        >
          <RateField
            cents={settings.defaultHourlyRateCents}
            currency={settings.currency}
            onChange={(defaultHourlyRateCents) =>
              save({ defaultHourlyRateCents })
            }
          />
        </Section>

        <Section
          title="Invoice lines"
          hint="You can override this while composing an invoice."
        >
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.mergeInvoiceLines}
              onChange={(event) =>
                save({ mergeInvoiceLines: event.target.checked })
              }
              className="size-4 accent-foreground"
            />
            Merge same-rate projects into one invoice line
          </label>
        </Section>

        {/*
          A RADIO PAIR, not a lone checkbox, and the wording is the reason.
          "Include notes" as a single box states only the on position; the
          reader has to infer that unchecking it leaves the notes out, which on
          a control governing what reaches a client is an inference worth not
          asking for. Both outcomes are written down, the same way Durations and
          Clock above spell out both of theirs.
        */}
        <Section
          title="Notes in the PDF report"
          hint="Changes the exported PDF only — CSV and XLSX exports never carry notes."
        >
          <div className="flex flex-col gap-2">
            <Radio
              name="pdfIncludeNotes"
              checked={!settings.pdfIncludeNotes}
              onChange={() => save({ pdfIncludeNotes: false })}
            >
              Leave notes out
            </Radio>
            <Radio
              name="pdfIncludeNotes"
              checked={settings.pdfIncludeNotes}
              onChange={() => save({ pdfIncludeNotes: true })}
            >
              Print each row's notes
            </Radio>
          </div>
        </Section>

        {/*
          A LONE CHECKBOX, where "Notes in the PDF report" above is a radio
          pair — and the difference is which way the control faces. That one
          governs what reaches a CLIENT, so both outcomes are spelled out
          rather than inferred. This one is a view mode on the user's own
          screen, reversible in one click and visible the moment it changes,
          which is exactly the case `tabTitleClock` below is a checkbox for.
        */}
        <Section
          title="Repeated entries"
          hint="Nothing is merged: exports, invoices and totals are unaffected."
        >
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.groupEntries}
              onChange={(event) => save({ groupEntries: event.target.checked })}
              // `--foreground`, the same accent every other control on this
              // page uses. A checked setting is not a timer running, and the
              // two should not look alike — which is also why this does not
              // reach for `--primary`.
              className="size-4 accent-foreground"
            />
            Group a day&apos;s repeats of the same entry
          </label>
        </Section>

        <Section
          title="Tab title"
                  >
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.tabTitleClock}
              onChange={(event) =>
                save({ tabTitleClock: event.target.checked })
              }
              // This checkbox's own CHECKED state is a setting being toggled,
              // not a timer running, so it takes `--foreground` like every
              // other checkbox and `Radio` in this file rather than the
              // treatment the running state wears.
              //
              // The distinction OUTLIVED the colour it was made of, twice: once
              // when the running accent merged with the affirmative one, and
              // again when the palette went monochrome and neither has a hue at
              // all. It stays because the rule was never about the value — what
              // may be spent here is a setting's accent, not the running
              // state's.
              className="size-4 accent-foreground"
            />
            Show the running timer in the browser tab
          </label>
        </Section>

        <Section
          title="Invoice logo"
          hint={
            online
              ? "Invoices already raised keep the logo they were made with."
              : OFFLINE_UPLOAD_REASON
          }
        >
          {/* A disabled `<fieldset>` disables every native form control it
              contains — the file input and every `Button` beneath it are
              exactly that underneath (see app-sidebar.tsx's ProfileMenu for
              the one control in this app that is not). `className="contents"`
              keeps the fieldset out of the grid this section's children sit
              in: a bare `<fieldset>` is a block box with a UA border, which
              would otherwise wrap the control column in a frame nothing else
              on this page draws. */}
          <fieldset disabled={!online} className="contents">
            <InvoiceLogoSection
              logoUrl={settings.logoUrl}
              busy={logoBusy}
              onFile={(file) => void uploadLogo(file)}
              onRemove={() => {
                setLogoBusy(true)
                void clearLogo({})
                  .catch((thrown: unknown) => {
                    toasts.add({
                      title: errorMessage(thrown),
                      priority: "high",
                    })
                  })
                  .finally(() => setLogoBusy(false))
              }}
            />
          </fieldset>
        </Section>

        <Section
          title="Google Calendar"
          hint={
            online
              ? "Chroneli only ever reads. Nothing is written back, and no meeting starts a timer on its own."
              : OFFLINE_GOOGLE_REASON
          }
        >
          <fieldset disabled={!online} className="contents">
            <GoogleCalendarSection
              connection={connection}
              calendars={calendars}
              projects={projects}
              timeZone={settings.timezone}
              use12Hour={settings.timeFormat === "12"}
              /* Read once per render rather than through `useClock`: "Last
                 synced" only needs to know which local DAY it is, and a ticking
                 clock would re-render this whole page every second to answer a
                 question whose answer changes at midnight. */
              nowMs={Date.now()}
              actions={{
                connect: connectGoogle,
                disconnect: () => void disconnectGoogle().catch(report),
                setShow: (calendarId, show) =>
                  void setCalendarShowMutation({ calendarId, show }).catch(
                    report
                  ),
                setProject: (calendarId, projectId) =>
                  void setCalendarProjectMutation({
                    calendarId,
                    projectId,
                  }).catch(report),
                createProject: (name) => createProject({ name }),
              }}
            />
          </fieldset>
        </Section>

        <Section
          title="Music"
          hint="Remembers the track you chose for a piece of work and starts it again next time."
        >
          <MusicSection
            musicAutoplay={settings.musicAutoplay}
            musicOnStop={settings.musicOnStop}
            onChange={save}
          />
        </Section>

        {/* ITS OWN SECTION RATHER THAN THE ONE ABOVE, because `Section` is a
            label column beside a CONTROL column and a library is not a control:
            a queue, a usage bar, a search, a sort and a list of rows do not fit
            the 1fr half of a two-column grid at any width worth having. Two
            headings also say the true thing — the switches above are
            preferences about playback, and this is the files themselves.

            It is LAST on the page on purpose. It is the tallest block here and
            the one a user visits least; putting it above the account-shaped
            settings would push those below a fold for a library that is set up
            once. */}
        <Section
          title="Music library"
          hint="Tracks you upload become selectable from the tracker's music control."
        >
          <MusicLibrarySection />
        </Section>
      </div>
    </Page>
  )
}

// ---------------------------------------------------------------------------

/**
 * The zone list comes from the runtime rather than a bundled table.
 *
 * `Intl.supportedValuesOf` is exactly the set this browser's own formatter can
 * resolve, so a zone offered here can never be one the app then fails to
 * format. A hand-maintained list goes stale every time a country changes its
 * rules, which happens more often than anyone expects.
 */
function TimezoneField({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  const [zones] = useState<Array<string>>(() => {
    try {
      return Intl.supportedValuesOf("timeZone")
    } catch {
      // Older runtimes: keep whatever is stored so the field is never empty and
      // the user's own zone is never silently replaced.
      return [value, "UTC"]
    }
  })

  // The stored zone might not be in the runtime's list (a different browser set
  // it). Including it keeps the select from silently showing something else.
  const options = zones.includes(value) ? zones : [value, ...zones]

  return (
    <Select
      value={value}
      onValueChange={onChange}
    >
      {/* Widest field on the page, because a zone name is the longest value it
          holds. `max-w-full` so a narrow phone clips the trigger rather than
          the column. Base UI's Select carries type-ahead, which is what the
          native control was buying on a list this long. */}
      <SelectTrigger aria-label="Time zone" className="w-72 max-w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((zone) => (
          <SelectItem key={zone} value={zone}>
            {zone}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/**
 * Same idea as `TimezoneField`, with one extra narrowing.
 *
 * The list is `money.supportedCurrencies()` — the runtime's own ISO 4217 codes,
 * minus the ones whose minor unit is not a hundredth. That is the SAME list
 * `settings.update`'s server-side guard checks against, so the picker and the
 * validator cannot disagree: previously the picker offered all 162 codes while
 * the guard accepted any three letters, and neither matched what `formatMoney`
 * could actually render honestly (JPY silently rounded stored hundredths away;
 * KWD showed a third decimal `parseMoney` then refused).
 *
 * A stored code outside the list is still shown, so a value already saved is
 * never silently swapped for something else under the user.
 *
 * Computed during render, NOT held in a `useState` initializer the way
 * `TimezoneField` above holds its zones. That shape earns its place there — the
 * lazy initializer is what stops a `try`/`catch` around a runtime call from
 * re-running every render. Here there is nothing to guard: the module memoises
 * the list itself, so this is a plain read, and freezing a derived value at
 * first render only bought a fallback that could not follow `value` if the
 * stored currency changed underneath it.
 */
/**
 * The account's fallback rate, as an amount in the user's own currency.
 *
 * Commits on blur and on Enter rather than on every keystroke, unlike the
 * selects and checkboxes on this page: a rate is typed a character at a time,
 * and saving "1", then "10", then "100" would write three rates and re-price
 * every historical report twice on the way to the one the user meant.
 *
 * EMPTY CLEARS IT, and that is a real state rather than zero — `null` on the
 * wire, an absent field in the row. "Nobody has priced this" and "priced at
 * nothing" are different facts, and `unratedBillableMs` on /reports exists to
 * tell them apart.
 */
function RateField({
  cents,
  currency,
  onChange,
}: {
  cents: number | undefined
  currency: string
  onChange: (cents: number | null) => void
}) {
  // Seeded with the bare number, no currency symbol, so the input round-trips
  // through `parseMoney` cleanly — the DISPLAY is where a symbol belongs. The
  // same split /projects makes for a project's own rate.
  const [text, setText] = useState(
    cents === undefined ? "" : (cents / 100).toFixed(2)
  )
  const [error, setError] = useState<string | null>(null)

  const commit = () => {
    // `currency` is passed so the user's OWN sign and ISO code are strippable
    // noise rather than a parse failure — an SGD user pasting "S$10" back out
    // of a figure this app rendered for them. Empty input is `parseMoney`'s own
    // `{ ok: true, cents: null }`, so "clear it" comes through the same parser
    // as every other value rather than being special-cased ahead of it.
    const parsed = parseMoney(text, currency)
    if (!parsed.ok) {
      setError(rateHelp(currency))
      return
    }
    setError(null)
    if (parsed.cents === null) {
      setText("")
      onChange(null)
      return
    }
    setText((parsed.cents / 100).toFixed(2))
    onChange(parsed.cents)
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <input
          aria-label="Default hourly rate"
          aria-invalid={error !== null}
          aria-describedby={error === null ? undefined : "default-rate-error"}
          value={text}
          placeholder="No rate"
          onChange={(event) => setText(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur()
            if (event.key === "Escape") {
              setError(null)
              setText(cents === undefined ? "" : (cents / 100).toFixed(2))
            }
          }}
          className={cn(
            fieldClass,
            "w-32 font-mono tracking-[-0.02em] tabular-nums",
            error !== null && "border-destructive"
          )}
        />
        <span className="text-sm text-muted-foreground">
          per hour
          {cents === undefined ? null : ` · ${formatMoney(cents, currency)}`}
        </span>
      </div>
      {/* The colour is never the only carrier — see DESIGN.md on error states. */}
      {error === null ? null : (
        <p id="default-rate-error" role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}

function CurrencyField({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  const supported = supportedCurrencies()
  // Empty only on a runtime that cannot enumerate currencies at all. Keep
  // whatever is stored so the field is never empty and the user's own currency
  // is never silently replaced — the same fallback `TimezoneField` makes.
  const codes = supported.length > 0 ? supported : [value, "USD"]

  const options = codes.includes(value) ? codes : [value, ...codes]

  return (
    <Select
      value={value}
      onValueChange={onChange}
    >
      <SelectTrigger aria-label="Currency" className="w-52 max-w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((code) => (
          <SelectItem key={code} value={code}>
            {code}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function Section({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    /*
      Label column beside control column, once there is room for two.

      The page is full width like every other page, and this is what keeps that
      from turning each Section into a long hairline under a short control.
      The left column caps the prose at a reading measure — which is what
      `max-w-prose` was doing by hand, and what capping the whole PAGE was
      doing to the rule as well.

      One column below `lg`, where a phone has no width to give a second one.
    */
    <section className="grid gap-2 border-b border-border pb-6 last:border-b-0 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] lg:gap-x-12">
      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">{title}</h2>
        {hint === undefined ? null : (
          <p className="text-xs leading-relaxed text-muted-foreground">
            {hint}
          </p>
        )}
      </div>
      <div className="pt-1 lg:pt-0">{children}</div>
    </section>
  )
}

function Radio({
  name,
  checked,
  onChange,
  children,
}: {
  name: string
  checked: boolean
  onChange: () => void
  children: React.ReactNode
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onChange}
        className="size-4 accent-foreground"
      />
      {children}
    </label>
  )
}

/** What the choice actually looks like, rather than a description of it. */
function Sample({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-sm border border-border px-1.5 py-0.5 font-mono text-xs tracking-[-0.02em] text-muted-foreground tabular-nums">
      {children}
    </span>
  )
}

const fieldClass = cn(
  "rounded-md border border-input bg-background px-2 py-1.5 text-sm",
  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
)
