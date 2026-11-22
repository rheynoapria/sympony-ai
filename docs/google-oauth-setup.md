# Google sign-in for Sympony's to-do sync

Sympony syncs its Todo tab with a Google Tasks list. So that users only click **Sign in** (no client IDs to paste),
Sympony is built with its own Google OAuth client. You create that client once, in Google Cloud; it takes about
ten minutes.

## 1. Project and API

1. Open <https://console.cloud.google.com/> with the Google account that will own Sympony's client.
2. Top bar → project picker → **New project** → name it `Sympony` → **Create**, then select it.
3. **APIs & Services → Library** → search **Google Tasks API** → **Enable**.

## 2. Consent screen (Google Auth Platform)

1. **APIs & Services → OAuth consent screen** (or **Google Auth Platform → Branding**) → **Get started**.
2. App name `Sympony`, user support email: yours. Audience: **External**. Contact email: yours. Agree → **Create**.
3. **Data Access → Add or remove scopes**: add
   - `https://www.googleapis.com/auth/tasks`
   - `https://www.googleapis.com/auth/userinfo.email`

   → **Update** → **Save**.
4. **Audience**:
   - While the app is in **Testing**, only the **Test users** you add here can sign in, and Google ends their
     sign-in after **7 days** (Sympony then says "Google signed Sympony out… Sign in again").
   - For everyday use, click **Publish app** (In production). Without Google's verification, users see a
     "Google hasn't verified this app" screen once (Advanced → Go to Sympony) and the app is capped at 100 users.
     Verification (privacy policy, a short video) removes both; it's needed only to share Sympony widely.

## 3. The client

1. **APIs & Services → Credentials → Create credentials → OAuth client ID**.
2. Application type: **Desktop app**, name `Sympony (macOS)` → **Create**.
3. Copy the **Client ID** (`….apps.googleusercontent.com`) and the **Client secret** (`GOCSPX-…`).
   (For a desktop app Google doesn't treat the secret as secret: it ships inside the app. Sympony still keeps it out
   of git.)

## 4. Build it into Sympony

Create `.signing/oauth.env` in the repo (the `.signing` folder is git-ignored):

```sh
SYMPONY_GOOGLE_CLIENT_ID=1234567890-abc.apps.googleusercontent.com
SYMPONY_GOOGLE_CLIENT_SECRET=GOCSPX-xxxxxxxx
```

Then `./install.sh`. It prints `Google sign-in: built in`; Settings → Todo → Sync with → Google Tasks shows only
**Sign in** from then on.

Without the file, a build still works: Settings shows Client ID / Client secret fields where a user can paste their
own Desktop client.

## 5. Using it

Settings → Todo → **Sync with: Google Tasks** → **Sign in** → the browser opens Google's page → choose the account →
**Allow** → "Sympony is signed in…" (close the tab) → back in Settings pick a **List** (or "New list “Sympony”").
Sync runs at once, every 5 minutes and a few seconds after a task changes; **Sync now** forces one.
