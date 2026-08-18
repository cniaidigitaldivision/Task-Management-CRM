# 📁 CONNECTING GOOGLE DRIVE

> **You do this, not me.** The client secret is a credential, and standing rule R5
> is that secrets do not pass through a conversation. Nothing below asks you to
> send me anything.
>
> The feature is built and working. Until the OAuth client exists the Documents
> screen says *"Google Drive is not set up yet"*, and uploads still queue for
> approval — they simply cannot be sent anywhere yet.

**Account being connected:** `cniaidigitaldivision@gmail.com` (your instruction,
2026-08-16).

---

## ⚠️ This replaced the service-account plan, and why

The original design (2026-08-13) used a **service account** — a Google identity
belonging to the application rather than to a person. It was the right shape for a
Google Workspace domain and the wrong one here.

A service account **has no Drive storage of its own.** A file it uploads is owned
by it, and Google refuses with:

```
Service Accounts do not have storage quota. Leverage shared drives
or use OAuth delegation instead.
```

The two escapes — a **Shared Drive**, or **domain-wide delegation** — both require
Google Workspace. `cniaidigitaldivision@gmail.com` is a consumer account, so
neither is available.

Worse, the failure would have been late and confusing: listing folders works
perfectly with a service account. Only the approval-into-Drive step — the entire
point — breaks.

**So the CRM acts AS the division's own account.** Files are owned by it, land in
its My Drive, and no quota question arises. The cost is one interactive consent,
once, by you.

---

## What you are creating

An **OAuth 2.0 client** of type *Web application*. It is not itself access to
anything — it is only what makes the **Connect Google Drive** button possible.
Access happens when you press that button and approve the consent screen; what
comes back is a **refresh token**, which the CRM seals and stores in the database.

Where each piece lives:

| Piece | Where it lives | Who can read it |
|---|---|---|
| Client ID | `.env.local` and Vercel | Anyone with the env vars |
| Client secret | `.env.local` and Vercel | Anyone with the env vars |
| **Refresh token** | `drive_connection` table, AES-256-GCM sealed | **Nobody** — the table has zero RLS policies |

That last row is the important one. `drive_connection` is the second table in this
system with **no policies at all** (the first is `break_glass`): there is no
version of "a client may read this" that is safe for a token granting ongoing
access to a real person's Drive. The server reads it through a `SECURITY DEFINER`
function in `lib/db/queries/drive.ts`, and nothing else in the codebase touches
it. Migration 027 proves this at the end of its own run.

---

## Step 1 · Create a Google Cloud project

1. Go to <https://console.cloud.google.com/> signed in as
   **cniaidigitaldivision@gmail.com**.
2. Create a project — call it `CNI CRM`.

## Step 2 · Enable the Drive API

1. **APIs & Services → Library**
2. Search **Google Drive API** → **Enable**

Without this, the connection succeeds and every Drive call returns 403.

## Step 3 · Configure the consent screen

1. **APIs & Services → OAuth consent screen**
2. User type: **External** (a consumer Gmail account has no Internal option)
3. App name: `CNI CRM`, support email: the same Gmail
4. Scopes: add **`https://www.googleapis.com/auth/drive`**
5. Test users: add **cniaidigitaldivision@gmail.com**

> **Leave it in Testing mode.** Publishing would trigger Google's verification
> review, which this does not need — the only user is you. The one consequence of
> Testing mode is at the end of this document; read it.

## Step 4 · Create the OAuth client

1. **APIs & Services → Credentials → Create credentials → OAuth client ID**
2. Application type: **Web application**
3. Name: `CNI CRM server`
4. **Authorised redirect URIs** — add *both*, exactly:

   ```
   http://localhost:4310/api/drive/callback
   https://task-management-crm-ivory.vercel.app/api/drive/callback
   ```

   A missing one shows as `redirect_uri_mismatch` on Google's own screen, before
   the CRM is ever reached. The URI is built from the request's own origin, so
   there is no third environment variable to keep in step — but Google has to know
   about each host in advance.

5. Copy the **Client ID** and **Client secret**.

## Step 5 · Put them in the environment

In `.env.local`:

```
GOOGLE_OAUTH_CLIENT_ID=…apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=…
```

And in Vercel → Project → Settings → Environment Variables, the same two, for
Production. Redeploy afterwards — environment variables are read at boot.

## Step 6 · Press the button

Sign in to the CRM as an **Admin or the Super Admin**, go to **Documents**, and
press **Connect Google Drive**. Approve the consent screen as
cniaidigitaldivision@gmail.com.

Google will warn that the app is unverified. Expected — see step 3. Continue.

You come back to Documents with *"Google Drive is connected"* and the account
address shown.

---

## Who can do what, once it is connected

Your instruction, 2026-08-16: *"super admin, admin and team coordinator can see
the whole documents and they can make the documents viewable for members to see
for any project they want, and members can upload documents to the folders they
are viewing."* Implemented as:

| | Super Admin | Admin | Team Coordinator | Member |
|---|---|---|---|---|
| See the whole document register | ✅ | ✅ | ✅ | — |
| See their own uploads | ✅ | ✅ | ✅ | ✅ |
| See documents on a project they can see | ✅ | ✅ | ✅ | ✅ |
| See documents in a **shared folder** | ✅ | ✅ | ✅ | ✅ |
| Upload (queues for approval) | ✅ | ✅ | ✅ | ✅ |
| File into **any** folder | ✅ | ✅ | ✅ | — |
| File into a **shared** folder | ✅ | ✅ | ✅ | ✅ |
| **Share a folder with members** | ✅ | ✅ | ✅ | — |
| **Approve into Drive** | ✅ | ✅ | — | — |
| Connect / disconnect Drive | ✅ | ✅ | — | — |

Two lines in that table are worth stating out loud:

- **Sharing stops at Coordinator, approving stops at Admin.** A Coordinator runs
  the projects whose folders these are, so deciding who reads a folder is part of
  running it — but they still cannot wave a file into the company Drive, including
  their own. That is what keeps the approval queue meaningful.
- **Visibility does not inherit.** Sharing a folder does not share the folders
  inside it. Inheritance would mean sharing one top-level folder silently exposes
  everything ever nested under it — including folders created in Drive months
  later by somebody who never saw this screen. Each folder is turned on by a
  person who looked at it.

The enforcement is in the database, not the screen: `app.can_read_document` and the
`drive_folders_write` policy, both in migration 027. The checks in the server
actions exist so a Member gets a sentence instead of a stack trace. If the two ever
disagree, the database wins.

---

## ⚠️ The one consequence of Testing mode

An OAuth client left in **Testing** issues refresh tokens that **expire after
seven days**. When that happens, approving a document fails and the Documents
screen shows *"The Google connection has expired or was revoked."*

**The fix is to press Connect Google Drive again.** It takes about ten seconds and
nothing is lost — files already in Drive are owned by the account and are
untouched.

If seven days becomes annoying, publish the consent screen (**OAuth consent
screen → Publish app**). For an app with one internal user Google's review is
usually a formality, and refresh tokens then last until they are revoked. That is
your call, not a technical requirement.

---

## Troubleshooting

| What you see | What it means |
|---|---|
| *"Google Drive is not set up yet"* | The env vars are missing or empty. Step 5. |
| `redirect_uri_mismatch` on Google's screen | The URI in step 4 does not match exactly — check `http` vs `https`, the port, and the trailing path. |
| *"That sign-in could not be verified as one started here"* | The state cookie expired (ten minutes) or the callback did not come from a flow started in the CRM. Press Connect again. |
| 403 on every Drive call | The Drive API is not enabled. Step 2. |
| *"The Google connection has expired or was revoked"* | Almost always the seven-day Testing-mode token. Press Connect again — see above. |
| Approval says *"Drive refused the request (404)"* | The folder id in **Watched folder** does not exist in this account's Drive. |

---

## Disconnecting

**Documents → Disconnect.** It forgets the stored token and nothing else. Files
already filed into Drive stay in Drive, owned by the account — which is the whole
reason for using OAuth rather than a service account.

To revoke from Google's side as well:
<https://myaccount.google.com/permissions> → CNI CRM → Remove access.
