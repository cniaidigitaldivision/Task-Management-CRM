# 📁 CONNECTING GOOGLE DRIVE

> **You do this, not me.** The key is a credential, and standing rule R5 is that
> secrets do not pass through a conversation — three from Session 09 still need
> rotating for exactly that reason. Nothing below asks you to send me anything.
>
> The feature is built and working. Until the key exists it says *"Google Drive is
> not connected"* on the Documents screen and uploads still queue for approval —
> they simply cannot be sent anywhere yet.

---

## What you are creating, and why it is a service account

A **service account** is a Google identity that belongs to the application rather
than to a person. It was chosen (your decision, 2026-08-13) over each person
connecting their own Drive because:

- it has no interactive login and no refresh token to expire, so nothing needs
  re-authorising every few weeks
- **nothing breaks when somebody leaves.** With per-person OAuth, a project's files
  live in whoever uploaded them and disappear from view the day that account is
  closed
- there is one place to look when something is wrong

The trade, stated plainly: **the service account can see nothing by default.** You
have to share your Drive folder with it. That is step 4, and it is the step people
forget — a 404 from Drive almost always means this was missed.

---

## 1 · Create the service account

1. Go to <https://console.cloud.google.com/> and sign in as
   **the Google account that owns the company Drive**.
2. Create a project (or pick one). Any name — `cni-crm` is fine.
3. **APIs & Services → Library →** search **Google Drive API →** *Enable*.
   Nothing works without this and the error it produces is unhelpful.
4. **APIs & Services → Credentials → Create credentials → Service account.**
   - Name: `cni-crm-drive`
   - Skip the optional role and access steps — permissions come from Drive
     sharing, not from Cloud IAM. Granting a project role here would give it
     access to cloud resources it has no business touching.

## 2 · Create its key

1. Open the service account → **Keys → Add key → Create new key → JSON.**
2. A `.json` file downloads. **This is the credential.** Treat it exactly as you
   would the database password: do not email it, do not paste it into a chat, do
   not commit it.

## 3 · Put it in `.env.local`

The whole file goes on **one line**, in single quotes:

```
GOOGLE_SERVICE_ACCOUNT_JSON='{"type":"service_account","project_id":"…","private_key":"-----BEGIN PRIVATE KEY-----\n…\n-----END PRIVATE KEY-----\n","client_email":"cni-crm-drive@….iam.gserviceaccount.com",…}'
```

Two things that go wrong here, both handled but worth knowing:

- **Single quotes, not double.** The JSON is full of double quotes.
- **The `\n` inside `private_key` stays as literal backslash-n.** Do not convert
  them to real line breaks — `lib/drive/client.ts` converts them back, because a
  key pasted into a `.env` file always arrives this way and PEM parsing fails
  cryptically otherwise.

Then restart: `npm run build && npm run start -- --port 4310`.

## 4 · ⚠️ Share the Drive folder with it — the step people miss

1. Open the JSON and copy the **`client_email`** value. It looks like
   `cni-crm-drive@your-project.iam.gserviceaccount.com`.
   (The Documents screen shows this address once the key is in place, so you do not
   have to keep opening the file.)
2. In Google Drive, right-click the folder you want the CRM to use → **Share** →
   paste that address → give it **Editor** → Send.

Without this the service account is authenticated and can see **nothing**. That is
correct behaviour and the most common cause of a 404.

## 5 · Point the CRM at a folder

On **Documents**, as Super Admin or Admin:

1. It should now say *"Google Drive is connected"* and show the address above.
2. Paste the **folder id** into **Watched folder id** and Save. The id is the last
   part of the folder's URL:
   `https://drive.google.com/drive/folders/`**`1AbCdEfGhIjK…`**
3. Press **Check now**.

---

## What happens after that

| | |
|---|---|
| **Anybody uploads** | The file goes into the CRM's own storage and waits. **It is not in Drive.** |
| **An Admin approves** | The bytes are uploaded to Drive, and only then is the row marked approved and the local copy removed. If Drive is unreachable it stays pending and can be approved again. |
| **An Admin refuses** | The file is deleted and **never reaches Drive** — that is the point of approving it. The record stays, with the reason, so the uploader knows what to fix. |
| **A Coordinator** | Can add, edit and delete documents but **cannot approve** — including their own upload. That is what keeps the queue meaningful. |
| **A new subfolder appears** | Becomes a **draft project**, marked as needing details. A folder name cannot say what type a project is, who owns it or when it is due, so it waits for you rather than entering reports and workload half-defined. |

### The check is manual for now

**Check now** reads the folder on demand. Automatic polling every few minutes —
which is what you chose — needs the run to be triggered by something other than a
person, and the honest options are:

- **`vercel.json` cron** calling a route, like the existing digest. Simple, and
  the interval is as coarse as the platform allows.
- **A schedule in Supabase** hitting the same route.

Both need a shared secret so the route cannot be triggered by anybody who finds
the URL — `CRON_SECRET` already exists for the digest and would be reused. Say the
word and I will wire it; it is a small addition and I did not want to add a public
endpoint without asking.

### If something is wrong

| It says | It usually means |
|---|---|
| *Drive refused the request (404)* | The folder has not been shared with the service account (step 4), or the id is wrong. |
| *Google refused the credentials (400/401)* | The JSON is truncated, or the `\n` in the private key were converted to real newlines. |
| *The private key could not be used to sign a request* | The key is missing its `BEGIN`/`END` lines, or the JSON is malformed. |
| *Drive is not connected* after a restart | `.env.local` was saved but the server was not rebuilt. |

Nothing in the application logs, returns or displays the key itself — including in
these errors. That is deliberate: an error message is a place secrets leak.
