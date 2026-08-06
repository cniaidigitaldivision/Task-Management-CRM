# 🚀 DEPLOYING TO VERCEL

> ✅ **Already done.** Live at **https://cni-crm.vercel.app**.
>
> The GitHub repository is connected to the Vercel project, so **every push to
> `main` deploys itself** — steps 1, 2 and 4 below are only needed if that link
> is ever broken and the CLI has to be used instead.
>
> What still matters here: the environment-variable list (step 3), the
> redeploy-after-changing-them rule, and the notes at the foot.

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
| Project name | `cni-crm` |
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

**`/setup` is already closed.** A Super Admin exists, and the database permits
exactly one, so the route refuses everybody — permanently. Had it still been
open, whoever found the URL first would have become the owner of the system.
Vercel URLs are not private; they appear in public certificate logs.

**The demo accounts still work,** and their password is in this repository and
in `DEMO-GUIDE.md`. Anyone with the URL and that password signs in as an Admin.
Fine while the address is unlisted; clear it before real work goes in:

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
