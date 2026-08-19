# Getting a Google OAuth client for the Calendar link

What this produces: a **client ID** and **client secret**, set on the Convex
deployment as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Nothing in the
Calendar link works until they exist — and it fails late rather than loudly,
when someone clicks "Connect Google Calendar", because Better Auth builds its
config at module-import time and never checks that they are set.

Do this once per environment. Dev and production need **different redirect
URIs** on the same client, or two clients.

## The one value everything hinges on

The authorised redirect URI. Google matches it character for character —
scheme, host, port, path, no trailing slash — and a mismatch is the failure
almost everybody hits:

```
{SITE_URL}/api/auth/callback/google
```

For this project's dev deployment (`SITE_URL` is `http://localhost:3100`, and
the dev server is always started on that port — see `.claude/launch.json`):

```
http://localhost:3100/api/auth/callback/google
```

**Not** the `.convex.site` domain, even though Better Auth's routes are mounted
on the Convex HTTP router. `src/routes/api/auth/$.ts` proxies `/api/auth/*`
from the app's own origin to Convex, and `convex/auth.ts` sets
`baseURL: process.env.SITE_URL` — so Google redirects back to the **app**, not
to Convex.

If you change `SITE_URL`, the redirect URI has to change with it.

## Steps

### 1. Pick or create a project

<https://console.cloud.google.com/> → the project dropdown in the top bar →
**New project** (or reuse an existing one).

### 2. Enable the Calendar API

**APIs & Services → Library** → search "Google Calendar API" → **Enable**.

Skipping this is the second-most-common failure: OAuth succeeds, then every
sync returns 403 and the connection lands in `reauth`.

### 3. Configure the consent screen

**APIs & Services → OAuth consent screen** — in newer consoles this lives under
**Google Auth Platform → Branding / Audience**.

- User type: **External** (Internal only exists on Workspace accounts).
- App name, user support email, developer contact email. That is all that is
  required while the app is unpublished.
- **Scopes:** add `https://www.googleapis.com/auth/calendar.readonly`. It is a
  *sensitive* scope, which is what makes step 5's warning matter.
- **Test users:** add your own Google address. **Do not skip this.** While the
  app is in "Testing", Google refuses anyone not on this list with a bare
  `Error 403: access_denied`, before it will even draw a consent screen — there
  is nothing in that error naming the test-user list as the cause, which is why
  it costs people an afternoon.

### 4. Create the client

**APIs & Services → Credentials → Create credentials → OAuth client ID**.

- Application type: **Web application**.
- Name: anything ("Chroneli dev").
- **Authorised redirect URIs → Add URI**, and paste the URI from the top of
  this document. `http://localhost` is accepted for Web application clients, so
  no tunnel or HTTPS is needed for dev.
- Leave "Authorised JavaScript origins" empty. This flow is a server-side
  redirect; it does not need one.

**Create** → the dialog shows the client ID and client secret. The secret can be
re-shown later from the client's detail page, so a lost copy is recoverable.

### 5. Know what "Testing" costs you

While the consent screen is in **Testing** with a sensitive scope, Google
**expires refresh tokens after 7 days**. This feature depends on the refresh
token: the sync asks Better Auth for a fresh access token every run.

So on a Testing-mode app the calendar link works for a week, then the token
refresh starts failing. `TOKEN_FAILURE_LIMIT` counts three consecutive
failures — about 45 minutes — and flags the connection `reauth`, at which point
Settings shows "Chroneli has lost access to your Google Calendar" and the user
reconnects.

That is the system behaving correctly, not a bug.

**Publish the app** to end it: OAuth consent screen → Publishing status →
**Publish app**. That does two things at once — it stops the 7-day refresh
token expiry, and it drops the test-user list, so accounts no longer have to be
enrolled one at a time.

On a Workspace account, setting **User type: Internal** is better still: no
test-user list, no verification, and no unverified-app warning for anyone in
the org. It is not offered on personal Gmail accounts.

What publishing does NOT remove, because `calendar.readonly` is sensitive and
the app is unverified: the one-time "Google hasn't verified this app"
interstitial (**Advanced → Go to …** past it), and a 100-user cap. Neither
matters for a personal tool; verification is only worth pursuing to let
strangers sign up without seeing the warning — see **Getting the app verified**
below for what that costs.

Consent itself cannot be switched off — OAuth requires the account holder to
approve the scopes at least once. The only alternative is a Workspace service
account with domain-wide delegation, which is the wrong shape for a product
where each user links their own calendar.

### 6. Set them on the deployment

Not `.env.local` — Convex functions cannot read that file.

```bash
npx convex env set GOOGLE_CLIENT_ID your-id.apps.googleusercontent.com
```

```bash
npx convex env set GOOGLE_CLIENT_SECRET your-secret
```

Confirm they landed (prints names, not values):

```bash
npx convex env list
```

Production is a separate deployment with its own variables, and needs its own
redirect URI added to the client — `https://your-domain/api/auth/callback/google`.

### 7. Walk it through

1. Start the dev server on port 3100 (the `chroneli-dev` config in
   `.claude/launch.json`), and `npx convex dev` in another terminal.
2. Sign in, go to **/settings**, find **Google Calendar**, click **Connect
   Google Calendar**.
3. Google's consent screen appears. An unpublished app shows a "Google hasn't
   verified this app" warning — **Advanced → Go to … (unsafe)** is the way
   through while testing.
4. Back on /settings, your calendars list within a few seconds. They arrive
   **hidden** by design: a calendar Google added should not start drawing on
   your grid unannounced.
5. Turn **Show** on for the calendar you want.
6. Open **/timer** in Calendar view. Meetings render as unfilled outlined
   blocks; entries stay filled. Click one for the read-only detail popover.

## Getting the app verified

Only worth doing if people other than you will link their calendars. The
unverified-but-published state — a warning interstitial and a 100-user cap — is
fine for a personal tool, and Google itself lists "personal use, single user or
a few known individuals" as an explicit exception to verification.

The good news first: `calendar.readonly` is **sensitive**, not **restricted**.
Restricted scopes (Gmail, Drive) drag in an annual third-party security
assessment — CASA — that costs real money. Sensitive scopes do not. This is a
form, a video, and a wait.

### What has to exist before you can submit

Three of these do not exist yet, and they are the actual work. The form itself
takes twenty minutes.

**1. A verified domain.** Ownership of `chroneli.com` proved in
[Google Search Console](https://search.google.com/search-console), signed in as
an account with Owner or Editor on the Cloud project. Same account, or the
console will not see the verification.

**2. A homepage that describes the app.** Public — a reviewer will open it
signed out — on the verified domain, saying what Chroneli does, and linking to
the privacy policy. `src/routes/index.tsx` is currently one sentence and two
buttons. It renders for signed-out visitors, so a reviewer sees it, but "Track
what you worked on, and what you got done." is not a description of an app that
reads your calendar. It needs a paragraph about the calendar link specifically.

**3. A privacy policy, on the same domain.** There isn't one. This is the item
reviewers bounce most often, because a generic template fails: it has to name
the Google user data this app touches and say what happens to it. For Chroneli
that means calendar event titles, times, locations, descriptions, attendee
names and email addresses; stored in Convex; never sold, never shared, never
used for advertising or to train models; deleted when the user disconnects. It
must also commit to the
[Limited Use requirements](https://developers.google.com/terms/api-services-user-data-policy#additional_requirements_for_specific_api_scopes)
by name.

**4. Consent-screen branding that matches.** App name, logo and support email on
the OAuth screen have to be the same ones the site uses. A reviewer compares the
two.

### The demo video

YouTube, **unlisted**, in English, and it has to show three specific things —
not a marketing tour:

- the OAuth consent screen, with the app name on it,
- the **browser address bar with the OAuth client ID visible in the URL** (this
  is the one people re-record for; do not crop it out),
- each sensitive scope actually being used.

For this app the shortest honest take is: /settings → **Connect Google
Calendar** → consent screen (pause so the URL and scopes are legible) → back to
Settings with the calendar list populated → turn **Show** on → /timer in
Calendar view with meeting blocks drawn → click one for the popover. That last
minute *is* the scope justification, demonstrated.

### The justification to paste

One per scope, and it must argue why a narrower scope is not enough:

> **`https://www.googleapis.com/auth/calendar.readonly`** — Chroneli is a time
> tracker. It mirrors the user's upcoming events into the app's own calendar
> grid so they can see meetings alongside tracked time and start a timer against
> one without leaving the app. Event title, start and end time, location,
> description, organiser and attendee response are all displayed in the meeting
> detail panel. No narrower scope exists: `calendar.events.readonly` and
> `calendar.app.created` cover only events this app created, and this app
> creates none — it reads events created by the user and their colleagues, which
> is the entire feature. Chroneli never writes to Google Calendar: it creates no
> events, changes no RSVPs, and requests no write scope.

### Submitting

Cloud Console → **Google Auth Platform** → publish **Branding** → **Verification
Center** → **Add or remove scopes**, declare `calendar.readonly`, paste the
justification, paste the YouTube link, submit.

Google says up to **10 days** once the submission is complete. In practice the
clock restarts every time a reviewer asks for something, so the thing that
decides whether this takes two weeks or two months is how fast you answer their
email — sent to the support address on the consent screen, so make sure that is
an inbox you read.

Nothing breaks while you wait. The app keeps working exactly as it does now,
warning interstitial and all; verification only removes the interstitial and the
100-user cap.

## When something fails

| Symptom | Cause |
| --- | --- |
| `redirect_uri_mismatch` | The URI in the client does not match `{SITE_URL}/api/auth/callback/google` exactly. Check port and trailing slash. This bit once already: the client was registered against port 3000 and the app moved to 3100, so the two disagreed by four characters. Google's error names the URI it received — register exactly that |
| `CLIENT_ID_AND_SECRET_REQUIRED` on clicking Connect | The two variables are not set on the deployment |
| `access_denied` before any consent screen | The app is in Testing and your address is not under Test users. Add it (step 3). If it IS there, check the publishing status: a Production app requesting the sensitive `calendar.readonly` scope is blocked outright until it passes Google's verification review |
| `access_blocked` / "app not verified" with a way past | Expected on an unpublished app — **Advanced → Go to … (unsafe)** |
| Sign-in asks for calendar access | `convex/auth.ts` was edited but not pushed. The provider config runs on the DEPLOYMENT, so `npx convex dev` has to have re-pushed it — editing the file is not enough |
| Connects, then every sync 403s | The Calendar API was never enabled on the project (step 2) |
| Worked for a week, now says access lost | Testing-mode 7-day refresh-token expiry — see step 5 |
| Calendars list is empty | Expected on an account with no calendars; otherwise check the deployment logs for the `googleSync` action |

## What this grants

`calendar.readonly`, and nothing else. The link never writes to Google: no
events created, no RSVPs changed. Revoking it at
<https://myaccount.google.com/permissions> stops the sync at the next run,
which the app surfaces as the "lost access" banner.
