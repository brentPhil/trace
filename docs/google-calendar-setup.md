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

For this project's dev deployment (`SITE_URL` is `http://localhost:3000`):

```
http://localhost:3000/api/auth/callback/google
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
- **Test users:** add your own Google address. While the app is in "Testing",
  only listed test users can consent at all.

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

That is the system behaving correctly, not a bug. To stop it recurring weekly,
**Publish** the app on the consent screen. For a single-user personal project
publishing is enough; Google's verification review is only required once an app
requests sensitive scopes for users beyond the owner.

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

1. `npm run dev`, and `npx convex dev` in another terminal.
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

## When something fails

| Symptom | Cause |
| --- | --- |
| `redirect_uri_mismatch` | The URI in the client does not match `{SITE_URL}/api/auth/callback/google` exactly. Check port and trailing slash |
| `CLIENT_ID_AND_SECRET_REQUIRED` on clicking Connect | The two variables are not set on the deployment |
| `access_blocked` / "app not verified" and no way through | Your address is not in Test users, or the app is unpublished and you skipped the Advanced link |
| Connects, then every sync 403s | The Calendar API was never enabled on the project (step 2) |
| Worked for a week, now says access lost | Testing-mode 7-day refresh-token expiry — see step 5 |
| Calendars list is empty | Expected on an account with no calendars; otherwise check the deployment logs for the `googleSync` action |

## What this grants

`calendar.readonly`, and nothing else. The link never writes to Google: no
events created, no RSVPs changed. Revoking it at
<https://myaccount.google.com/permissions> stops the sync at the next run,
which the app surfaces as the "lost access" banner.
