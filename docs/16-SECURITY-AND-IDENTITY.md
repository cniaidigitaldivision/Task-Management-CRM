# 16 — Security & Identity Architecture

**Added:** 2026-08-06 (Session 02)
**Status:** Planned, not built
**Standards followed:** NIST SP 800-63B (Digital Identity) · OWASP ASVS v4 Level 2 · OWASP Top 10 2021 · CIS Benchmarks

---

## 0. Read this first — a straight answer about "certifications"

You asked for *"extreme certifications or whatever you know better to maintain better security of this account."*

Here is the honest position, because it saves you money:

**Certifications like ISO 27001 and SOC 2 do not apply to you right now.** They certify an *organisation's processes* — documented policies, staff training, third-party audits, annual renewal. They cost $15,000–$50,000+ per year and are demanded by enterprise customers doing vendor due diligence. For a 7-person internal tool with no external users, buying one would be spending money on a certificate nobody will ever ask to see.

**What actually produces security is the standards those certifications audit against.** Those are free, public, and we can implement all of them:

| Standard | What it covers | Applied here |
|---|---|---|
| **NIST SP 800-63B** | Password and authenticator requirements | §5 — password policy, MFA |
| **OWASP ASVS v4 L2** | Application security verification checklist | §9 — controls matrix |
| **OWASP Top 10 2021** | The ten most exploited web weaknesses | §9 |
| **CIS Benchmarks** | Secure configuration baselines | §8, §10 |
| **NIST SP 800-207** | Zero-trust principles | §4 — never trust the session, verify each action |

**The plan below implements security at a level well above what a typical business CRM ships with.** If you later sell this as a product (Q-015 — you said "we will, but not now"), this same foundation is exactly what a SOC 2 audit would examine, so nothing here is wasted.

---

## 1. Threat model — what we are actually defending against

Security work is only meaningful against specific threats. Here are yours, ranked by realistic likelihood for a small business in Pakistan running a cloud CRM.

| # | Threat | Likelihood | Impact | Primary defence |
|---|---|:--:|:--:|---|
| T-1 | **Password reuse** — a team member uses their CRM password on a site that gets breached | 🔴 High | 🔴 High | Breach-database check on every password set, mandatory MFA for privileged roles |
| T-2 | **Phishing** — fake "CNI CRM login" page harvests credentials | 🔴 High | 🔴 Critical | Phishing-resistant MFA (passkeys) for Super Admin, login alerts, domain discipline |
| T-3 | **Email account compromise** — someone's Gmail is breached, attacker uses "forgot password" | 🟠 Medium | 🔴 Critical | Super Admin recovery **cannot** be email-only; MFA required to complete any reset |
| T-4 | **Insider misuse** — a departing member takes data or sabotages tasks | 🟠 Medium | 🟠 Medium | Least privilege, immutable audit log, instant deactivation, soft deletes |
| T-5 | **Session hijacking** — stolen cookie on a shared or infected machine | 🟠 Medium | 🟠 Medium | Device-bound sessions, short TTL, re-auth on context change |
| T-6 | **Credential interception in transit** — passwords emailed in plaintext | 🔴 High | 🔴 Critical | **§3 — we never put a password in an email.** |
| T-7 | **Privilege escalation** — a member manipulates a request to act as Admin | 🟡 Low | 🔴 Critical | Server-side authorisation + database row-level security, two independent layers |
| T-8 | **Brute force / credential stuffing** | 🔴 High | 🟠 Medium | Rate limiting, progressive lockout, CAPTCHA escalation, bot detection |
| T-9 | **Lost Super Admin access** — phone lost, password forgotten, nobody can recover | 🟠 Medium | 🔴 **Total loss** | §6 — break-glass procedure. **This is the risk your "no one can alter Super Admin" rule creates.** |
| T-10 | **Malicious file upload** | 🟡 Low | 🟠 Medium | Type/size validation, no execution, signed URLs, scanning |
| T-11 | **Supply chain** — compromised npm package | 🟡 Low | 🔴 High | Lockfiles, automated dependency scanning, minimal dependencies |
| T-12 | **Data loss** — accidental deletion or provider failure | 🟠 Medium | 🔴 High | Soft deletes, daily backups, tested restore |

Everything below traces back to one of these.

---

## 2. The identity hierarchy

```
                    ╔═══════════════════════════════════════╗
                    ║        🔐 SUPER ADMIN                 ║
                    ║        (your brother)                 ║
                    ║  • Created once, at system setup      ║
                    ║  • CANNOT be edited, demoted,         ║
                    ║    disabled or deleted by ANY         ║
                    ║    other account — enforced in the    ║
                    ║    database, not just the UI          ║
                    ║  • Mandatory MFA, no exceptions       ║
                    ║  • Only he can change his own         ║
                    ║    credentials                        ║
                    ╚═══════════════╤═══════════════════════╝
                                    │ creates & manages
                                    ▼
                    ┌───────────────────────────────────────┐
                    │        👤 ADMIN  (your sister)        │
                    │  • Created by Super Admin only        │
                    │  • Can be edited/disabled by          │
                    │    Super Admin only                   │
                    │  • MFA mandatory                      │
                    └───────────────┬───────────────────────┘
                                    │ creates & manages
                                    ▼
        ┌───────────────────────────┴───────────────────────┐
        ▼                                                   ▼
┌──────────────────────────┐                  ┌──────────────────────────┐
│  🎯 TEAM COORDINATOR     │                  │  👥 TEAM MEMBER          │
│  (Kashif)                │                  │  (Yusra + others)        │
│  • Created by Admin+     │                  │  • Created by Admin+     │
│  • MFA recommended       │                  │  • MFA optional          │
└──────────────────────────┘                  └──────────────────────────┘
```

### The Super Admin immutability rule

> *"The super admin can never be altered or managed by anyone else rather than the super admin himself."*

Enforced at **four independent layers**, so a bug in one doesn't defeat the rule:

| Layer | Enforcement |
|---|---|
| 1. **Database constraint** | A trigger on `users` rejects any `UPDATE` or `DELETE` on a `super_admin` row where the acting session identity ≠ that row's id. This fires even if application code is wrong. |
| 2. **Row-level security** | RLS policy: `super_admin` rows are writable only by themselves. |
| 3. **Server authorisation** | Every mutation runs through the permission service before touching the database. |
| 4. **UI** | Controls simply don't render. (Presentation only — never counted as security.) |

**Additionally:** the Super Admin role itself cannot be granted by anyone. There is no "promote to Super Admin" button anywhere in the application. A second Super Admin can only be created through the sealed procedure in §6.

---

## 3. Credential provisioning — how accounts are created

> Your requirement: *"SuperAdmin creates the admin. He will create the email and password and then he will mail the email and password and the link to where he can change the credentials… The admin can create emails and password for the members. They will go through the same process."*

### The one change I'm making, and why

Your flow is right. The chain of authority — Super Admin provisions Admin, Admin provisions Members — is exactly how it should work, and it's preserved completely.

**The one thing I will not do is put a password in an email.** Email is a plaintext store-and-forward system. A password sent by email:
- sits permanently in the sender's Sent folder and the recipient's Inbox
- passes through and is logged by intermediate mail servers
- is readable by anyone who ever gains access to either mailbox, including months later
- is frequently synced to phones, laptops, and backup services

That is threat **T-6**, and it's the single most common way small-business accounts are compromised. You asked for zero breaches; this is the first thing that has to go.

**What replaces it costs you nothing in convenience.**

### The provisioning flow (recommended — Option A)

```
┌──────────────────────────────────────────────────────────────────────────┐
│ STEP 1 — Super Admin creates the Admin account                           │
│                                                                          │
│   Form:  Full name · Email · Role title · Access level: Admin            │
│          Weekly capacity · Skills                                        │
│   [ Create account & send invitation ]                                   │
│                                                                          │
│   The system:                                                            │
│   • creates the account in state PENDING_ACTIVATION                      │
│   • generates a 256-bit cryptographically random activation token        │
│   • stores ONLY a SHA-256 hash of that token — the raw token is never    │
│     written to the database or to any log                                │
│   • sets it to expire in 48 hours, single use                            │
│   • does NOT set any password. The account has no password at all yet.   │
└──────────────────────────────────────────────────────────────────────────┘
                                    │
┌───────────────────────────────────▼──────────────────────────────────────┐
│ STEP 2 — What lands in the Admin's inbox                                 │
│                                                                          │
│   Subject: You've been added to CNI CRM                                  │
│                                                                          │
│   Hello Sana,                                                            │
│   Ahmed has created your CNI CRM account as an Administrator.            │
│                                                                          │
│   Your login email:  sana@company.com                                    │
│                                                                          │
│   Set your password to activate your account:                            │
│   ┌────────────────────────────────────────────────┐                     │
│   │        [ Set my password ]                     │                     │
│   └────────────────────────────────────────────────┘                     │
│   This link expires in 48 hours and can be used once.                    │
│                                                                          │
│   If you didn't expect this email, tell Ahmed immediately.               │
│                                                                          │
│   ← Note: the email contains the login email and a link. NO PASSWORD.    │
└──────────────────────────────────────────────────────────────────────────┘
                                    │
┌───────────────────────────────────▼──────────────────────────────────────┐
│ STEP 3 — Admin clicks the link and sets their own password               │
│                                                                          │
│   • Token validated: not expired, not used, hash matches                 │
│   • Password strength meter shown live                                   │
│   • Checked against the breach database (§5)                             │
│   • Because this is a privileged role: MFA setup is MANDATORY here.      │
│     QR code shown, TOTP verified, 10 recovery codes issued and           │
│     required to be downloaded before continuing.                         │
│   • Token consumed. Account → ACTIVE.                                    │
│   • Confirmation email to the Admin AND alert to the Super Admin:        │
│     "Sana activated her Admin account at 14:32 from Karachi, PK."        │
└──────────────────────────────────────────────────────────────────────────┘
                                    │
┌───────────────────────────────────▼──────────────────────────────────────┐
│ STEP 4 — Admin logs in and repeats the same flow for each Member         │
│   Identical process. Members: MFA offered but optional (Q-032).          │
└──────────────────────────────────────────────────────────────────────────┘
```

### If you want your literal flow — Option B

Some teams genuinely need the creator to hold an initial password, e.g. to read it out over the phone to someone who isn't confident with email links. That's supported:

- The Admin ticks **"Also generate a temporary password."**
- A strong random temporary password is generated and **displayed once, on screen, to the Admin only.** It is copyable, and it disappears on navigation.
- It is **still never emailed.** The Admin relays it by WhatsApp, in person, or by phone — a different channel from the email, which is the entire security benefit.
- The temporary password expires in **24 hours**.
- The user is **forced** to change it at first login, before reaching any other screen.
- The temporary password is stored hashed, marked `is_temporary`, and can never be reused.

This gives you your exact model — the Admin creates and controls the credential — without ever putting it in a mailbox where it lives forever.

**Recommendation: Option A as the default, Option B available as a tick-box.** Set via **Q-031**.

### Account states

| State | Meaning | Can log in? |
|---|---|:--:|
| `PENDING_ACTIVATION` | Created, invitation sent, no password set | ❌ |
| `ACTIVE` | Normal | ✅ |
| `PASSWORD_RESET_REQUIRED` | Temporary password issued, or admin-forced reset | ⚠️ Only to the change-password screen |
| `MFA_SETUP_REQUIRED` | Privileged role that hasn't enrolled MFA | ⚠️ Only to the MFA setup screen |
| `LOCKED` | Too many failed attempts | ❌ Until unlock or cooldown |
| `SUSPENDED` | Disabled by an Admin | ❌ |
| `DEACTIVATED` | Left the team | ❌ (history preserved) |

---

## 4. Authentication & session security

### Password storage
- **Argon2id** (memory-hard, the current OWASP first choice), or bcrypt cost ≥ 12 if the platform requires it
- Per-password salt, handled by the algorithm
- Never logged, never returned by any API, never in an error message
- Rehashed transparently on login if parameters are upgraded

### Session handling

| Control | Setting | Reason |
|---|---|---|
| Cookie flags | `HttpOnly`, `Secure`, `SameSite=Lax` | Blocks JavaScript theft and most CSRF |
| Access token lifetime | 15 minutes | Short blast radius if stolen |
| Refresh token lifetime | Super Admin **8h** · Admin **24h** · Coordinator/Member **7 days** | Privilege determines exposure |
| Absolute session cap | Super Admin **12h** · others **30 days** | No infinite sessions |
| Idle timeout | Super Admin **30 min** · Admin **2h** · Members **none** | Unattended screens |
| Refresh token rotation | Every use, with reuse detection | A replayed token means theft → kill all sessions immediately |
| Device binding | Session tied to a device fingerprint | Cookie stolen to another machine → invalid |
| Concurrent sessions | Super Admin **2 max** · others unlimited | Limits quiet parallel access |
| Session list | Every user sees their active sessions and can revoke any | Self-service response |
| Re-auth triggers | IP country change, new device, ASN change | Zero-trust: verify on context change |

### Multi-factor authentication

| Role | MFA |
|---|---|
| **Super Admin** | 🔴 **Mandatory. Cannot be disabled by anyone, including himself.** Passkey/WebAuthn strongly preferred, TOTP acceptable. |
| **Admin** | 🔴 **Mandatory**, enrolled during activation |
| **Team Coordinator** | 🟠 Strongly recommended, prompted at every login until enrolled |
| **Team Member** | 🟡 Optional — **Q-032** |

**Why passkeys for the Super Admin specifically:** TOTP codes can be phished — a convincing fake login page asks for the code and relays it in real time. A passkey (WebAuthn) is cryptographically bound to the real domain and **physically cannot be used on a fake site**. That closes threat T-2 completely, which no other control does. It works with a phone's fingerprint/face unlock, or a hardware key like a YubiKey (~$25–50).

**Recommendation: your brother's account uses a passkey as primary, TOTP as backup, plus printed recovery codes.**

### Step-up authentication
Certain actions demand re-entry of password **and** MFA, even inside a valid session — so a hijacked session can't do the damage a stolen password could:

- Changing any Super Admin credential
- Creating or deleting an Admin
- Changing a user's role
- Permanently purging data
- Changing security settings or thresholds
- Exporting the full database
- Viewing the complete audit log
- Disabling another user's MFA

### Login protection

| Control | Behaviour |
|---|---|
| Rate limit per IP | 10 attempts / 15 min |
| **Rate limit per account** | **3 failed attempts → account locked** (your decision, §6). Cleared by emailed unlock code, or by an Admin for Coordinators and Members. |
| Lock notification | Account owner emailed immediately with the attempting IP and location |
| **Anti-DoS on the 3-attempt rule** | A 3-strike lock is easy for an outsider to trigger deliberately against a known email address. Mitigated by: (a) per-IP throttling that cuts an attacker off long before they can cycle accounts, (b) self-service unlock so a targeted user is inconvenienced for 30 seconds rather than blocked, (c) attempts from an already-recognised device counted separately from unknown ones. |
| CAPTCHA | After 2 failures |
| Bot detection | Vercel BotID on auth endpoints |
| Generic errors | Always *"Invalid email or password"* — never reveals whether an account exists |
| Timing normalisation | Constant-time response whether or not the account exists |
| Login alert | Super Admin gets an email on **every** sign-in to his account, always |
| Anomaly alerts | New device, new country, impossible travel → email + in-app |
| Failed-attempt visibility | *"3 failed sign-in attempts on your account since your last login"* shown at next login |

---

## 5. Password policy — NIST SP 800-63B aligned

Modern guidance, not the outdated rules most systems still use.

| Rule | Setting | Why |
|---|---|---|
| Minimum length | **12** (Super Admin: **16**) | Length beats complexity by a wide margin |
| Maximum length | 128 | Long passphrases must be allowed |
| Composition rules | **None** | NIST explicitly recommends against forcing symbols/numbers — it produces `Password1!` |
| Breach check | **Required** | Every new password checked against Have I Been Pwned using k-anonymity — only a 5-character hash prefix leaves our server, never the password |
| Common-password blocklist | Required | Dictionary words, keyboard patterns, company name, user's own name/email |
| Forced rotation | **None** | NIST removed this — periodic expiry causes weaker, incrementing passwords. Rotate on evidence of compromise only. |
| Reuse | Last 5 blocked | |
| Strength meter | zxcvbn, live | Guides toward passphrases |
| Paste allowed | **Yes** | Blocking paste breaks password managers, which are a net security gain |
| Password manager | Actively encouraged in onboarding | Highest-leverage advice for a small team |

> **The most valuable security action available to you costs nothing:** have all seven people use a password manager (Bitwarden is free). It eliminates threat T-1 — password reuse — which is the most likely way any of these accounts actually gets breached.

---

## 6. Super Admin hardening — the "zero breach" programme

Your brother's account is the crown jewel. Everything above applies to it, plus the following.

### Additional controls

| # | Control | Detail |
|---|---|---|
| SA-1 | **Mandatory phishing-resistant MFA** | Passkey primary. Cannot be turned off by anyone. |
| SA-2 | **16-character minimum password** | Plus breach check and blocklist |
| SA-3 | **Email code + MFA for recovery** | "Forgot password" sends a one-time code to email (your design, §6) — **and** the authenticator app is required after it, before the reset screen opens. A compromised mailbox alone is not enough. Defeats threat T-3. (Q-039) |
| SA-4 | **Alert on every login** | Email + in-app, every single time. An unexpected one is instant warning. |
| SA-5 | **Step-up re-auth** | For every sensitive action (§4) |
| SA-6 | **Short sessions** | 30 min idle, 12 h absolute, max 2 concurrent |
| SA-7 | **Optional country lock** | Restrict sign-in to Pakistan by IP geolocation. Blocks the overwhelming majority of automated attacks. Overridable via the break-glass path when travelling. **Q-033** |
| SA-8 | **Optional IP allowlist** | Home/office IPs only. Strongest control available, but needs a static IP. **Q-033** |
| SA-9 | **10 recovery codes** | Issued at setup, single-use, shown once. Instructions: print them, store physically, do not save to the same device or cloud. |
| SA-10 | **Immutable audit log** | Every Super Admin action recorded to an append-only log with no UPDATE/DELETE grant for any role — including Super Admin |
| SA-11 | **Database-level immutability** | The trigger and RLS policy from §2 |
| SA-12 | **Cannot self-destruct** | Cannot delete, demote, suspend or lock his own account. Prevents both accident and coerced destruction. |
| SA-13 | **Dual control (optional)** | High-impact actions require a second Super Admin's approval within 15 minutes. Only meaningful if you have two. **Q-030** |
| SA-14 | **Quarterly access review** | Automated reminder to review all accounts, roles and active sessions |

### 🔑 Account recovery — LOCKED (Session 03, [ADR-007](decisions/ADR-007-account-recovery.md))

Your decision: **every account — Super Admin, Admin, Coordinator, Member — gets a "Forgot password" option that sends a one-time code to the account's email.** The user enters the code, resets the password, and regains access. Additionally, **three failed password attempts locks the account**, and the lock is cleared through the same email-code path.

This is the answer to Q-030 and it's a good one — it solves the lockout problem for all four roles with a flow everyone already understands.

> **Terminology note:** you called the emailed value a *"pass key"*. In this documentation it is called a **one-time recovery code (OTC)** to avoid confusion with *passkey*, which is the WebAuthn hardware/biometric credential described elsewhere in this document. They are different things.

#### The flow

```
┌──────────────────────────────────────────────────────────────────────┐
│ FORGOT PASSWORD                                                      │
│                                                                      │
│  1. User clicks "Forgot password" and enters their email             │
│                                                                      │
│  2. Response is ALWAYS "If that email is registered, a code has      │
│     been sent." — identical whether or not the account exists,       │
│     and returned in constant time. Never confirms an account.        │
│                                                                      │
│  3. Email arrives with a 6-digit one-time code AND a click-through   │
│     link. Either works.                                              │
│       • valid 15 minutes                                             │
│       • single use                                                   │
│       • stored only as a SHA-256 hash — never in plaintext, never    │
│         in logs                                                      │
│       • max 5 code entry attempts, then the code is burned           │
│       • requesting a new code invalidates the previous one           │
│                                                                      │
│  4. ⚠️ SUPER ADMIN AND ADMIN ONLY — second factor required here.     │
│     After the email code, they must also enter their authenticator   │
│     code (or use their passkey) before the reset screen opens.       │
│     Coordinators and Members proceed straight through.               │
│                                                                      │
│  5. New password set — breach-checked, blocklisted, cannot match     │
│     any of the last 5                                                │
│                                                                      │
│  6. ALL existing sessions on the account are revoked immediately     │
│                                                                      │
│  7. Confirmation email sent: "Your password was changed at 14:32     │
│     from Karachi, PK. If this wasn't you, act now."                  │
│     Super Admin resets also alert every Admin.                       │
└──────────────────────────────────────────────────────────────────────┘
```

#### Lockout after 3 failed attempts — LOCKED

```
┌──────────────────────────────────────────────────────────────────────┐
│  Attempt 1 failed  →  "Invalid email or password"                    │
│  Attempt 2 failed  →  "Invalid email or password. 1 attempt left     │
│                        before this account is locked."               │
│  Attempt 3 failed  →  🔒 ACCOUNT LOCKED                              │
│                                                                      │
│     This account has been locked after 3 failed sign-in attempts.    │
│                                                                      │
│     [ Send unlock code to my email ]                                 │
│                                                                      │
│     Same code flow as above. Entering it unlocks the account and     │
│     takes the user to set a new password.                            │
│                                                                      │
│  Also: the account owner is emailed immediately —                    │
│    "3 failed sign-in attempts on your account from IP x.x.x.x        │
│     (Karachi, PK). Your account is locked. If this wasn't you,       │
│     your password may be known to someone else."                     │
│                                                                      │
│  Admins are notified when a Coordinator or Member locks out.         │
│  Super Admin is notified when an Admin locks out.                    │
└──────────────────────────────────────────────────────────────────────┘
```

An Admin can also unlock a Coordinator or Member directly, without waiting for email — useful when someone is standing in front of them.

#### Why the second factor on Super Admin and Admin resets

Your flow is right, and it stays exactly as you described. One consequence is worth naming: **if an emailed code alone can reset the Super Admin password, then whoever controls that mailbox controls the entire CRM.** That's threat T-3, and it's how a large share of small-business account takeovers actually happen — the attacker never touches the application, they take the mailbox.

Requiring the authenticator app *after* the email code closes it completely. For your brother and sister this is one extra tap on a phone they're already required to carry — MFA is mandatory for both roles anyway. The user experience is unchanged; the attack stops working.

Coordinators and Members go straight through with the email code alone, because the blast radius is one person's own tasks.

**This is Q-039.** If you'd rather all four roles use email-only, say so and I'll build it that way — but I'd be doing you a disservice not to flag it.

#### If the email itself is unreachable

Email recovery covers the ordinary case: forgotten password, locked out, new phone. It doesn't cover the rare one — brother's email account is itself lost, hacked, or the domain expires. Two backstops, both free and both entirely under his control:

| Backstop | How |
|---|---|
| **Recovery codes** | 10 printed single-use codes, issued at setup. Any one substitutes for the email code. Kept on paper, not on the same device. |
| **Sealed master credential** | Generated once at setup, shown once, stored only as a hash. Printed and kept physically. Using it alerts everyone and is permanently logged. Genuine last resort. |

Neither is something he'll ever touch in normal use. They exist so that a lost mailbox is an inconvenience rather than the end of the CRM.

---

## 7. Authorisation — defence in depth

Two fully independent layers. A bug in one does not create a breach.

```
Request
   │
   ▼
┌──────────────────────────────────────────────────────────┐
│ LAYER 1 — Application (server-side)                      │
│   • Session valid? Not expired? Device matches?          │
│   • Account ACTIVE?                                      │
│   • Role permits this action? (doc 03 matrix)            │
│   • Owns this resource, or has scope over it?            │
│   • Business rules satisfied? (BR-001…BR-016)            │
│   • Step-up re-auth required and satisfied?              │
└──────────────────────┬───────────────────────────────────┘
                       ▼
┌──────────────────────────────────────────────────────────┐
│ LAYER 2 — Database (PostgreSQL Row-Level Security)       │
│   Policies evaluated inside the database itself, against │
│   the authenticated identity. Even a SQL-injection       │
│   payload or a mistaken query cannot read rows the       │
│   session is not entitled to.                            │
└──────────────────────────────────────────────────────────┘
```

**The UI is not a security layer.** Hidden buttons are convenience. Every check exists on the server regardless of what the interface shows.

### Member data isolation (per your decision)
You specified that members cannot see each other. Enforced by RLS, not just by hiding screens:

| Table | Member can read |
|---|---|
| `tasks` | Only rows where `assignee_id = self` |
| `projects` | Only projects containing at least one of their own tasks |
| `users` | Their own row in full. Other users: **name and avatar only** — no role, no capacity, no workload, no skills |
| `comments` | Only on tasks they can see |
| `time_logs` | Only their own |
| `workload` / capacity data | Only their own |
| `activity_log` | None |
| `audit_log` | None |

---

## 8. Infrastructure & data protection

| Area | Control |
|---|---|
| Transport | TLS 1.3, HSTS with preload, no mixed content |
| Data at rest | AES-256 provider-managed encryption |
| Backups | Automated daily, 7-day point-in-time recovery, **restore tested quarterly** — an untested backup is not a backup |
| Secrets | Environment variables only, never committed, rotated on any staff change |
| Database access | No public internet exposure; connection pooling with least-privilege roles |
| File uploads | Allowlisted MIME types, size caps, filename sanitisation, stored outside the web root, served via short-lived signed URLs, never executable |
| Dependencies | Lockfiles committed, automated vulnerability scanning, monthly patch review |
| Headers | CSP, X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy, Permissions-Policy |
| WAF | Vercel Firewall — managed rulesets, rate limiting, bot mitigation |
| Logging | No passwords, tokens, or session IDs ever logged. PII minimised. |
| Deletion | Soft delete everywhere; purge only by Super Admin with step-up auth |
| Region | Database hosted in the region closest to Pakistan (Q-020) |

---

## 9. OWASP Top 10 (2021) coverage

| Risk | Our control |
|---|---|
| **A01 Broken Access Control** | Two-layer authorisation (§7), RLS, permission matrix, deny-by-default, no client-side trust |
| **A02 Cryptographic Failures** | Argon2id, TLS 1.3, AES-256 at rest, hashed tokens, no plaintext secrets anywhere |
| **A03 Injection** | Parameterised queries only (Drizzle ORM), no dynamic SQL, input validation with Zod, output encoding by React |
| **A04 Insecure Design** | Threat model (§1), documented business rules, security requirements written before code |
| **A05 Security Misconfiguration** | Security headers, no default credentials, no debug in production, CIS baselines |
| **A06 Vulnerable Components** | Lockfiles, automated scanning, monthly review, minimal dependency count |
| **A07 Identification & Auth Failures** | §4 and §5 in full — MFA, rate limiting, session hardening, breach checks |
| **A08 Software & Data Integrity** | Signed deployments, no unverified third-party scripts, strict CSP, dependency pinning |
| **A09 Logging & Monitoring Failures** | Immutable audit log, security event alerting, anomaly detection (§10) |
| **A10 SSRF** | No user-supplied URL fetching; any future integration uses an allowlist |

---

## 10. Audit logging & monitoring

### What is logged, always
Authentication events (success, failure, lockout, MFA, logout) · all authorisation denials · every account lifecycle change · every role change · every permission change · every credential change · every capacity override with its reason · every task delete/purge/restore · every project create/delete · every settings change · every data export · every Super Admin action without exception.

Each entry records: **who, what, when, from where (IP + device), before-value, after-value, outcome.**

### Immutability
The audit table has **no UPDATE and no DELETE grant for any role**, including Super Admin. Records are append-only. This is what makes the log trustworthy — if the most privileged account could edit history, the log would prove nothing.

### Real-time alerts

| Event | Alerted to | Channel |
|---|---|---|
| Super Admin login (every one) | Super Admin | Email + in-app |
| Failed Super Admin login | Super Admin | Email |
| 5+ failed logins on any account | Admins | In-app |
| Login from a new country | The user + Admins | Email |
| Impossible travel detected | The user + Super Admin | Email |
| MFA disabled or reset | The user + Super Admin | Email |
| Role changed | Both parties + Super Admin | Email |
| Admin account created or deleted | Super Admin | Email |
| Break-glass recovery used | **Everyone** | Email + in-app |
| Bulk export performed | Super Admin | Email |
| Permanent purge performed | Super Admin | Email |

---

## 11. Roadmap — Google Sign-In and beyond

> *"Later on we will also continue with Google implementation but for now we are not adding that. Do add it in the phases or in the documents."*

Recorded and planned. The identity layer is designed from day one to accept it without rework.

### S-01 · Google Sign-In (OAuth 2.0 / OIDC) — **Phase 7a**
| | |
|---|---|
| What | "Sign in with Google" alongside email + password |
| Why later | Password auth must be complete and hardened first; SSO is additive, not a replacement |
| Design now | `auth_identities` table exists from Phase 1 (doc 04) so a Google identity links to an existing user without a migration |
| Constraint | Restricted to your company's Google Workspace domain (`hd` claim) if you have one — otherwise anyone with any Gmail could attempt sign-in |
| Super Admin | **Remains password + passkey.** Federating the most privileged account to a third party means Google account compromise = CRM compromise. Deliberate exception. |
| Rule | Google sign-in **never** creates an account. Accounts are still provisioned by an Admin. Google only authenticates an account that already exists. Otherwise the entire provisioning chain you designed is bypassed. |

### Later identity work
| ID | Item | Phase |
|---|---|---|
| S-02 | Passkeys for all roles, not just Super Admin | 7a |
| S-03 | Microsoft/Outlook SSO | 7c — only if you move to Microsoft 365 |
| S-04 | SCIM auto-provisioning | Only relevant at 50+ people |
| S-05 | Trusted-device remembering (30 days) | 7b |
| S-06 | Security dashboard for Super Admin — active sessions, recent logins, alerts | 6 |
| S-07 | Automated penetration test / security scan in CI | 6 |
| S-08 | Data export & account deletion (GDPR-style rights) | 7b — becomes mandatory when you sell this (Q-015) |
| S-09 | Field-level encryption for client contact data | 7c |
| S-10 | Tenant isolation architecture | Before any SaaS launch — see §13 |

---

## 12. Incident response runbook

Written in advance, because incidents are the worst time to be inventing a process. Printed and kept offline.

| Scenario | Immediate action |
|---|---|
| **A member's account is compromised** | Super Admin: suspend account → revoke all sessions → force reset → review their audit trail for the last 30 days → reactivate with new credentials + MFA |
| **The Admin account is compromised** | Super Admin: suspend → revoke sessions → review every action taken → check whether any accounts were created or roles changed → reset with new MFA enrolment |
| **The Super Admin account is compromised** | Use break-glass (§6) → immediately rotate the credential → revoke every session system-wide → force reset on all accounts → full audit review → rotate all environment secrets |
| **Super Admin access is lost** (device + password + codes) | Break-glass procedure per Q-030 → new MFA enrolment → new recovery codes → verify no unauthorised changes occurred while locked out |
| **Data is deleted accidentally** | Restore from Trash (30-day window) → if purged, restore from daily backup → check audit log for who and why |
| **Suspected data breach** | Revoke all sessions → force password reset on all accounts → rotate all secrets → export and preserve the audit log → determine scope from logs → notify anyone affected |
| **A team member leaves** | Deactivate (never delete) → revoke sessions → reassign their open tasks → rotate any shared secrets they knew → archive their account |
| **Hosting or database provider outage** | Check provider status → wait if transient → restore from backup to an alternate region if extended |

**Kept offline, printed:** the break-glass credential, the recovery codes, this runbook, and the emergency contacts.

---

## 13. Multi-tenancy — DECIDED: not now ([ADR-008](decisions/ADR-008-single-tenant.md))

**Your decision:** build the CRM for Crescent Nova International only. No `organisation_id`, no tenant scaffolding. *"We cannot make it a generic application yet."*

Recorded and followed. The schema stays clean and single-purpose.

**The zero-cost hedge we're taking anyway** (no decision needed from you, no work added):

| Practice | Why it helps later |
|---|---|
| All database access goes through one query layer in `lib/db/queries/` | If tenant scoping is ever added, it's applied in one place rather than across hundreds of scattered queries |
| RLS policies are defined in named, versioned migration files | Adding a tenant predicate later means editing a known set of files, not archaeology |
| No hard-coded company name, logo, or colours in components | Branding comes from config from day one |

That's ordinary good architecture — we'd do it regardless. It just happens to make a future migration contained rather than sprawling.

**What a later migration would actually involve**, recorded now so the estimate isn't a surprise: add the column to every table, backfill to a single organisation, add the predicate to every RLS policy, add tenant resolution to the session layer, and test hard for cross-tenant leakage. Meaningful work, but bounded — and correctly deferred until you have a second customer who actually wants it.

---

## 14. Requirements added by this document

| ID | Requirement | Priority |
|---|---|---|
| FR-140 | Super Admin is seeded at setup and cannot be created, edited, demoted, suspended or deleted by any other account — enforced by database trigger, RLS, and server authorisation. | P0 |
| FR-141 | Super Admin creates and manages Admin accounts. Admins create and manage Coordinator and Member accounts. | P0 |
| FR-142 | Account creation issues a single-use, 48-hour, cryptographically random activation token, stored only as a hash. | P0 |
| FR-143 | Invitation emails contain the login email and an activation link. **They never contain a password.** | P0 |
| FR-144 | Optionally, a temporary password may be generated and displayed once on screen to the creating Admin, never emailed, expiring in 24 hours, with a forced change at first login. | P1 |
| FR-145 | MFA (TOTP or passkey) is mandatory for Super Admin and Admin, enrolled during activation. | P0 |
| FR-146 | Super Admin MFA cannot be disabled by any account, including his own. | P0 |
| FR-147 | Passwords: Argon2id, min 12 chars (16 for Super Admin), breach-checked, blocklisted, no forced rotation. | P0 |
| FR-148 | Rate limiting and progressive lockout on all authentication endpoints. | P0 |
| FR-149 | Step-up re-authentication for all sensitive actions listed in §4. | P0 |
| FR-150 | Sessions are device-bound, role-scoped in lifetime, with rotating refresh tokens and reuse detection. | P0 |
| FR-151 | Super Admin receives an alert on every login to his account. | P0 |
| FR-152 | Anomaly alerts: new device, new country, impossible travel. | P1 |
| FR-153 | Append-only audit log with no UPDATE or DELETE grant for any role. | P0 |
| FR-154 | Users can view and revoke their own active sessions. | P1 |
| FR-155 | **"Forgot password" for all four roles**: emailed 6-digit one-time code + link, 15-min expiry, single use, hash-stored, max 5 entry attempts. | P0 |
| FR-155a | **3 failed sign-in attempts locks the account**, cleared by emailed unlock code (or by an Admin for Coordinators and Members). | P0 |
| FR-155b | Super Admin and Admin password resets require the authenticator app **after** the email code (Q-039). | P0 |
| FR-155c | Password reset revokes all existing sessions and sends a confirmation email with IP and location. | P0 |
| FR-155d | Recovery codes and a sealed master credential exist as backstops if email itself is unreachable. | P1 |
| FR-155e | Forgot-password responses never reveal whether an account exists, and return in constant time. | P0 |
| FR-156 | Super Admin cannot delete, demote, suspend or lock his own account. | P0 |
| FR-157 | Row-level security enforces member data isolation per §7. | P0 |
| FR-158 | Optional country lock and IP allowlist for Super Admin. | P2 |
| FR-159 | Security dashboard for Super Admin: sessions, recent logins, security alerts, account states. | P1 |
| FR-160 | Google Sign-In (Phase 7a) links to existing accounts only and never creates one. | P2 |
| FR-161 | `auth_identities` table exists from Phase 1 so SSO can be added without migration. | P0 |
| FR-162 | All tables carry `organisation_id` from Phase 1 — subject to Q-034. | P0 |

---

## 15. Questions from this document

### ✅ Answered
| ID | Answer |
|---|---|
| **Q-030** | Email one-time code recovery for all four roles + 3-attempt lockout with email unlock. §6, [ADR-007](decisions/ADR-007-account-recovery.md) |
| **Q-034** | **No `organisation_id`.** Single-tenant. §13, [ADR-008](decisions/ADR-008-single-tenant.md) |

### 🟠 Still open
- **Q-039** — Should Super Admin and Admin password resets require the **authenticator app after the email code**?
  *Default: yes. Without it, whoever controls the mailbox controls the CRM (threat T-3). Costs one extra tap for people who already carry MFA.*
- **Q-040** — Should the emailed recovery value be a **6-digit code, a click-link, or both**?
  *Default: both in the same email — the link is faster on a phone, the code works when the link is mangled by a mail client.*
- **Q-031** — Provisioning: activation-link only (A), or also allow a temporary password shown on screen (B)?
  *Default: A as standard, B available as a tick-box.*
- **Q-032** — MFA for regular Members: mandatory, optional, or optional-but-prompted?
  *Default: optional but prompted at every login until enrolled.*
- **Q-033** — Country lock (Pakistan-only sign-in) for Super Admin and Admin?
  *Default: off initially; easy to switch on later.*
- **Q-035** — Hardware security key (YubiKey, ~$25–50) or a phone-based passkey for your brother?
  *Default: phone passkey — free, and nearly as strong.*
- **Q-036** — Shared password manager for the team (Bitwarden, free)?
  *Default: yes. Highest-value security action available, and it costs nothing.*
- **Q-048** — How long should an account stay locked if the user never requests an unlock code?
  *Default: auto-clears after 30 minutes, so a deliberate lock-out attack can't hold someone hostage.*
