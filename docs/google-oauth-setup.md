# Google sign-in for Sympony's Calendar & Tasks sync

Sympony connects directly from the user's device to **Google Calendar** and **Google Tasks** using Google OAuth 2.0 (PKCE loopback). So that users only click **Sign in with Google** (no client IDs to paste), Sympony is built with its own Google OAuth client. You create that client once, in Google Cloud; it takes about ten minutes.

## 1. Project and APIs

1. Open <https://console.cloud.google.com/> with the Google account that will own Sympony's client.
2. Top bar → project picker → **New project** → name it `Sympony` → **Create**, then select it.
3. **APIs & Services → Library** → enable both:
   - **Google Calendar API**
   - **Google Tasks API**

## 2. Consent screen (Google Auth Platform)

1. **APIs & Services → OAuth consent screen** (or **Google Auth Platform → Branding**) → **Get started**.
2. App name `Sympony`, user support email: yours. Audience: **External**. Contact email: yours. Agree → **Create**.
3. **Data Access → Add or remove scopes**: add
   - `https://www.googleapis.com/auth/calendar.events` — read upcoming events to answer questions like "what's on my calendar tomorrow?", and create, move, or delete an event only when the user asks.
   - `https://www.googleapis.com/auth/calendar.calendarlist.readonly` — list the user's calendars so they choose which ones Sympony and Pony use.
   - `https://www.googleapis.com/auth/tasks` — show the user's tasks and add, edit, or complete one on request.
   - `https://www.googleapis.com/auth/userinfo.email` — display the signed-in Google account email in Settings.

   → **Update** → **Save**.
4. **Audience**:
   - While the app is in **Testing**, only the **Test users** you add here can sign in, and Google ends their sign-in after **7 days** (Sympony then says "Google signed Sympony out… Sign in again").
   - For everyday use, click **Publish app** (In production) and complete Google OAuth verification for the Calendar and Tasks scopes.

## 3. The client

1. **APIs & Services → Credentials → Create credentials → OAuth client ID**.
2. Application type: **Desktop app**, name `Sympony` → **Create**.
3. Copy the **Client ID** (`….apps.googleusercontent.com`) and the **Client secret** (`GOCSPX-…`).
   (For a desktop app Google doesn't treat the secret as secret: it ships inside the app. Sympony still keeps it out of git.)

## 4. Build it into Sympony

Create `.signing/oauth.env` in the repo (the `.signing` folder is git-ignored):

```sh
SYMPONY_GOOGLE_CLIENT_ID=1234567890-abc.apps.googleusercontent.com
SYMPONY_GOOGLE_CLIENT_SECRET=GOCSPX-xxxxxxxx
```

Then `./install.sh`. It prints `Google sign-in: built in`; Settings → Calendar and Settings → Todo → Sync with → Google Tasks show only **Sign in with Google** from then on.

Without the file, a build still works: Settings shows Client ID / Client secret fields where a user can paste their own Desktop client.

## 5. Using it

- **Google Calendar:** Settings → Calendar → **Sign in with Google** → choose your Google account → **Allow** → pick which calendars Sympony & Pony use → events sync immediately to the Calendar notch tab and Pony's context. You can ask Pony (via chat or voice) *"what's on my calendar tomorrow?"*, or ask it to create, move/edit, or delete events.
- **Google Tasks:** Settings → Todo → **Sync with: Google Tasks** → (already signed in if you connected via Calendar, or click **Sign in with Google**) → pick a **List** (or "New list “Sympony”"). Tasks sync both ways every 5 minutes and right after changes, and Pony can show, add, edit, or complete tasks on request.
- **Disconnect anytime:** Click **Disconnect** in Settings → Calendar or Settings → Todo to revoke the Google token and remove cached calendars/events from this device immediately.
