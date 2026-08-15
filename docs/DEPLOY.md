# 🚀 DEPLOYING TO VERCEL

> ⚠️ **Moved to a new Vercel account, 2026-08-14. Not yet deployed.**
>
> | | |
> |---|---|
> | Team | **AI Digital Division** (Hobby) |
> | Project | **`task-management-crm`** |
> | Domain | `task-management-crm-ivory.vercel.app` |
> | Production | **none yet** — the project has no production deployment |
>
> The previous project was `cni-crm` at `cni-crm.vercel.app`, backed by the old
> Supabase project. Both are superseded; nothing on that deployment points at
> the current database.
>
> **Every step below is live again**, because this project has never been
> deployed and has no environment variables set. Step 3 is the one that decides
> whether the first deploy works.

> Everything here you run yourself. **No environment value should ever be sent to
> me** — `vercel env add` reads from your terminal and the dashboard reads from
> your browser, and neither puts the value anywhere I can see it.

---

## 1. Install the CLI and sign in

Both are interactive, so they have to be yours. In this session, prefix a
command with `!` to run it here and keep the output in the conversation.

```bash
npm i -g vercel
vercel login
```

---

## 2. Link the project

From the project folder:

```bash
vercel link
```

Answer:

| Question | Answer |
|---|---|
| Set up and deploy? | **no** — link only, we are not deploying yet |
| Which scope? | your own account |
| Link to existing project? | **no** |
| Project name | `task-management-crm` |
| Directory | `./` |

This writes a `.vercel/` folder, which is already git-ignored.

---

## 3. Add the environment variables — **before the first deploy**

The build itself no longer needs them (fixed 2026-08-07 — it used to fail with
*"Failed to collect configuration for /security"*, which said nothing about the
real cause). The **running app** absolutely does, so a deploy without them gives
you a site that loads and then errors on every page.

Run each of these and paste the value when prompted. It goes from your terminal
straight to Vercel.

```bash
vercel env add DATABASE_URL production
vercel env add SESSION_SECRET production
vercel env add TOKEN_PEPPER production
vercel env add MFA_ENCRYPTION_KEY production
vercel env add NEXT_PUBLIC_APP_URL production
```

| Variable | What to paste |
|---|---|
| `DATABASE_URL` | Exactly what is in your `.env.local` — the pooled port 6543 string |
| `SESSION_SECRET` | Same as `.env.local`. Changing it signs everybody out |
| `TOKEN_PEPPER` | Same as `.env.local`. Changing it invalidates every outstanding recovery and reset code |
| `MFA_ENCRYPTION_KEY` | Same as `.env.local`. Not read by anything yet — see the warning below |
| `NEXT_PUBLIC_APP_URL` | ⚠️ **The Vercel URL, not localhost.** You will not know it until after the first deploy, so set it to anything now and correct it in step 5 |

Once Resend is wired in, three more:

```bash
vercel env add RESEND_API_KEY production
vercel env add EMAIL_FROM production
vercel env add SECURITY_ALERT_EMAIL production
```

> **Repeat for `preview` if you want branch deployments to work.** Point them at
> the same database only if you accept that a preview branch can write to real
> data. Safer: leave preview without variables, so those builds succeed and the
> app refuses to run.

---

## 4. Deploy

```bash
vercel --prod
```

---

## 5. Fix the app URL, then redeploy

The first deploy tells you the URL. Set it properly:

```bash
vercel env rm NEXT_PUBLIC_APP_URL production
vercel env add NEXT_PUBLIC_APP_URL production     # https://your-url.vercel.app
vercel --prod
```

This matters more than it looks: every activation, password-reset and unlock
link in an email is built from that value. Wrong, and the links go nowhere.

---

## 6. Check it

```bash
npm run smoke -- https://your-url.vercel.app
```

Twenty-five checks: every screen renders for an Admin and for a Member, and
every screen a Member should not reach refuses them.

---

## Things to know before the URL is public

**⚠️ `/setup` IS OPEN AGAIN — this changed on 2026-08-14.** The project moved to
a fresh Supabase database (`xmqcmbbgbyuohpzywote`), which has **no Super Admin
row**, so `app.setup_is_available()` returns true and the route will accept the
first person who reaches it. Whoever that is becomes the owner of the system,
permanently — the database permits exactly one Super Admin, ever.

Vercel URLs are **not** private; they appear in public certificate transparency
logs. So the order matters: **run `/setup` yourself, from localhost, before the
new deployment is reachable.** Once it completes, the route refuses everybody
again and this note goes back to being historical.

The old project's setup codes — including the ones in
`First-run setup · CNI CRM super admin codes.pdf` — belong to the old database
and are dead. Setup issues a new Super Admin password and ten new recovery
codes, shown exactly once.

**The demo accounts do not exist yet** on the new database. `npm run seed:demo`
recreates them; their password is in this repository and in `DEMO-GUIDE.md`, so
anyone with the URL and that password signs in as an Admin. Fine while the
address is unlisted; clear it before real work goes in:

```bash
npm run seed:demo -- --wipe
```

**Preview deployments share whatever database you give them.** Give them none
and they cannot touch production data.

---

## ⚠️ One gap that is not closed

`MFA_ENCRYPTION_KEY` is set and **nothing reads it**. Authenticator secrets are
stored in plaintext in `mfa_factors.secret_encrypted`, which is named for what
it is supposed to hold rather than what it holds. Until that is built, anybody
with database access can generate valid two-factor codes for any enrolled
account — which is also the only reason `npm run demo:code` can work.

Not a reason to delay the deploy; it is the same exposure that already exists
locally. It is a reason not to describe the system as fully hardened yet.
