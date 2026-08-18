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
5. **Test users → + ADD USERS → `cniaidigitaldivision@gmail.com` → Save**
6. **Leave the app in Testing.** Do not press *Publish app*.

> ### ⚠️ Step 5 is not optional, and owning the project does not replace it
>
> Skipping it produces, on Google's own screen:
>
> > **Access blocked: CNI CRM has not completed the Google verification process.**
> > The app is currently being tested and can only be accessed by
> > developer-approved testers. · `Error 403: access_denied`
>
> This happened on 2026-08-18. The account being blocked was the project's own
> owner — Google does not infer tester status from ownership. Add the address to
> **Test users** and the same Connect attempt succeeds immediately.
>
> ### ⚠️ Do NOT publish this consent screen
>
> **Corrected 2026-08-18.** An earlier version of this document recommended
> publishing, to escape the seven-day token expiry. That advice was wrong, and
> pressing *Publish app* is what leaves the client in a pending state where nobody
> but a listed tester can sign in.
>
> `https://www.googleapis.com/auth/drive` is a **restricted** scope — Google's
> highest tier, because it reaches a person's whole Drive. Publishing an app that
> uses one requires a **third-party security assessment (CASA)**, which costs money
> and takes weeks. For a seven-person internal tool with a single user, that is
> wildly disproportionate.
>
> **Testing mode is the correct setting here.** Its one cost is at the end of this
> document: refresh tokens expire every seven days, so somebody presses Connect
> again. Ten seconds, and nothing is lost — files in Drive are owned by the
> account and are untouched.
>
> If Publish has already been pressed: **OAuth consent screen → Back to testing**,
> then add the test user.

## Step 4 · Create the OAuth client

1. **APIs & Services → Credentials → Create credentials → OAuth client ID**
2. Application type: **Web application**
3. Name: `CNI CRM server`
4. **Authorised redirect URIs** — add *both*, exactly:

   ```
   http://localhost:4310/api/drive/callback
   https://task-management-crm-ivory.vercel.app/api/drive/callback
   https://taskly.aidigitaldivision.com/api/drive/callback
   ```

   ⚠️ **All lowercase.** The CRM builds the URI from the request's own origin, and
   a browser lowercases the host — so it will always send
   `taskly.…`, never `Taskly.…`. Registering it capitalised risks a
   `redirect_uri_mismatch` that only appears on the custom domain and works fine
   on the Vercel URL, which is a miserable thing to diagnose. Lowercase is correct
   on every host, so there is no reason to chance it.

   A missing URI shows as `redirect_uri_mismatch` on Google's own screen, before
   the CRM is ever reached. Because the URI comes from the request, there is no
   environment variable to keep in step — but Google has to know each host in
   advance.

5. Copy the **Client ID** and **Client secret**.

## Step 5 · Put them in the environment

In `.env.local`:

```
GOOGLE_OAUTH_CLIENT_ID=…apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=…
```

And in Vercel → Project → Settings → Environment Variables, the same two, for
Production. Redeploy afterwards — environment variables are read at boot.

> ✅ **Done on 2026-08-16.** Both are in Vercel Production, marked Sensitive.
>
> ⚠️ **`.env.example` is committed to git and this repo is PUBLIC.** The values
> were first pasted there by mistake and moved to `.env.local` before anything was
> committed or pushed — `git show HEAD:.env.example` had both lines empty, so
> nothing was exposed. Real values go in `.env.local` only; it is git-ignored,
> `.env.example` is not.
>
> ⚠️ **`GOOGLE_SERVICE_ACCOUNT_JSON` is still in Vercel** (Production + Preview)
> and is now dead — no code reads it. Harmless, but it is a stale credential and
> worth deleting.

## Step 6 · Press the button

Sign in to the CRM as an **Admin or the Super Admin**, go to **Documents**, and
press **Connect Google Drive**. Approve the consent screen as
cniaidigitaldivision@gmail.com.

Google will warn that the app is unverified. **Expected, and permanent** — an app
in Testing is never verified. Press **Advanced → Go to CNI CRM (unsafe)**. It says
unsafe because Google cannot vouch for the app; you wrote it, and the only account
it can reach is the one granting access.

⚠️ If instead you get a hard **"Access blocked… Error 403: access_denied"**, the
address is not in **Test users**. Go back to step 3.5 — this is the single most
common way this fails.

You come back to Documents with *"Google Drive is connected"* and the account
address shown.

---

## Who can do what, once it is connected

### The four access levels

Your instruction, 2026-08-16: *"These options of access should be provided at the
time of giving access… the access level is defined at the time of giving, right?"*

Right. Every folder carries **one level**, chosen on the Documents screen by a Team
Coordinator or above. It says what **Members** may do in that folder:

| Level | A Member can | Approval? |
|---|---|---|
| **Coordinators and above** (default) | nothing — the folder is invisible to them | — |
| **Members can view** | read the documents filed here | — |
| **Members can upload** | read, and add files | **None.** Granting the level *is* the approval |
| **Members can upload and delete** | read, add, and delete anything in the folder | **None** |

`upload` is the level that answers your question directly: a Member filing into
such a folder goes **straight to Drive**, with no queue, because you already
decided when you granted the access. The screen says so on the level itself, on
the upload form, and in the confirmation after the file lands.

**A new folder starts at "Coordinators and above."** A folder that appears from a
Drive sync is never open to anybody the moment it is created.

### Who can do what

| | Super Admin | Admin | Team Coordinator | Member |
|---|---|---|---|---|
| See the whole document register | ✅ | ✅ | ✅ | — |
| See their own uploads | ✅ | ✅ | ✅ | ✅ |
| See documents on a project they can see | ✅ | ✅ | ✅ | ✅ |
| See documents in a folder they have `view`+ on | ✅ | ✅ | ✅ | ✅ |
| Upload (queues for approval) | ✅ | ✅ | ✅ | ✅ |
| Upload **straight to Drive** | — | — | — | ✅ with `upload`+ |
| Delete a document | ✅ | ✅ | ✅ | ✅ with `manage` |
| File into **any** folder | ✅ | ✅ | ✅ | — |
| **Set a folder's access level** | ✅ | ✅ | ✅ | — |
| **Approve into Drive** | ✅ | ✅ | ✅ | — |
| Connect / disconnect Drive | ✅ | ✅ | — | — |

Four lines are worth stating out loud:

- **Coordinators can now approve** (your decision, 2026-08-16 — previously Admin+).
  Fewer bottlenecks: a Coordinator running a project can push its documents
  through. The trade you accepted is that **they can approve their own upload**, so
  the queue no longer guarantees a second pair of eyes for them. The audit log
  records who approved what, so it is visible rather than merely permitted.
- **Coordinator+ still uses the queue.** `upload` describes what *Members* were
  granted, not a bypass for whoever granted it — so a Coordinator's own file goes
  through the normal approval, which is exactly the one that most needs it.
- **Access does not inherit.** A level applies to that folder only. Inheritance
  would mean opening one top-level folder silently exposes everything ever nested
  under it — including folders created in Drive months later by somebody who never
  saw this screen. At `manage` it would hand out delete rights the same way.
- **`upload` widens what the database permits, and that is deliberate.** The
  insert policy now allows a row to arrive already approved when the folder grants
  it. That is safe only because `cni_app` is unreachable from a browser — every
  insert comes through a server action that has already put the bytes in Drive.
  It is commented as such in migration 028.

The enforcement is in the database, not the screen: `app.can_read_document`,
`app.folder_grants` and the policies on `documents`, all in **migration 028**. The
checks in the server actions exist so a Member gets a sentence instead of a stack
trace. If the two ever disagree, the database wins.

Proved against the live database rather than asserted — a Member with `view` could
read a document but neither delete it nor insert an approved row; the same Member
at `upload` could insert but still not delete; at `manage` they could delete;
revoking the level closed all of it again.

---

## ⚠️ The seven-day reconnect — the accepted cost of Testing mode

A client in Testing issues refresh tokens that **expire after seven days**. When
one does, approving a document fails and the Documents screen shows:

> The Google connection has expired or was revoked.

**The fix is to press Connect Google Drive again.** About ten seconds, and nothing
is lost — files already in Drive are owned by the account and are untouched.

This is deliberate, not an outstanding bug. The alternative is a CASA security
assessment for the restricted `drive` scope — see step 3. A weekly button press
is the cheaper side of that trade by a wide margin.

**If it becomes genuinely annoying**, the escape is not to publish but to narrow
the scope. `drive.file` is *sensitive* rather than *restricted*, so it needs no
security assessment — but it only reaches files the app itself created or the user
explicitly picked, which would break the folder watch and the folder-tree scan.
Making that work means adding the Google Picker so folders are chosen through
Google's own UI. A real piece of work, worth doing only if the reconnect stops
being tolerable.

---

## Troubleshooting

| What you see | What it means |
|---|---|
| **"Access blocked: … has not completed the Google verification process"**, `403 access_denied` | The address is not in **Test users**. Owning the Google Cloud project does *not* make you a tester. Step 3.5. **The most common failure.** |
| *"Google Drive is not set up yet"* | The env vars are missing or empty. Step 5. |
| `redirect_uri_mismatch` on Google's screen | The URI in step 4 does not match exactly — check `http` vs `https`, the port, and the trailing path. |
| *"That sign-in could not be verified as one started here"* | The state cookie expired (ten minutes) or the callback did not come from a flow started in the CRM. Press Connect again. |
| 403 on every Drive call | The Drive API is not enabled. Step 2. |
| *"The Google connection has expired or was revoked"* | The seven-day Testing-mode token. Press Connect again — expected, not a bug. |
| Google warns the app is **unverified** | Expected and permanent in Testing. **Advanced → Go to CNI CRM**. Different from *Access blocked* above: a warning you can click past, not a refusal. |
| A Member says *"I can see the folder but it won't let me add anything"* | The folder is at **view**. Raise it to **Members can upload**. |
| A Member's upload appeared in Drive with no approval | Working as intended — that folder is at `upload` or above. Lower it if that was not what you meant. |
| Approval says *"Drive refused the request (404)"* | The folder id in **Watched folder** does not exist in this account's Drive. |

---

## Disconnecting

**Documents → Disconnect.** It forgets the stored token and nothing else. Files
already filed into Drive stay in Drive, owned by the account — which is the whole
reason for using OAuth rather than a service account.

To revoke from Google's side as well:
<https://myaccount.google.com/permissions> → CNI CRM → Remove access.
