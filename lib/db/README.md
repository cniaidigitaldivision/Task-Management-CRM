# `lib/db` — Layer 1, the only code that speaks SQL

> **Read this before writing a single query.** The database enforces rules the
> application cannot be trusted to remember, and it can only do that if every
> request tells it who is asking. That contract is in §2, and getting it wrong
> silently disables the second half of the security model.

**Owned by:** [doc 04](../../docs/04-DATA-MODEL.md) (tables and columns) ·
[doc 20 §2](../../docs/20-IMPLEMENTATION-CONTRACTS.md) (module boundaries) ·
[doc 19 §9](../../docs/19-MASTER-SPECIFICATION-REGISTRY.md) (C-13 … C-17)

---

## 1. What is where

| Path | Contents |
|---|---|
| `migrations/001…006_*.sql` | **The single source of truth for the schema** (registry C-16). Numbered, append-only, never edited once applied. |
| `verify/005_super_admin_immutability.sql` | The Step 2 gate proof — 35 assertions, self-cleaning, safe to run against production. |
| `../../types/database.ts` | **Generated**, never hand-edited. Regenerate after every migration (§6). |
| `queries/` | *(Step 4)* Every read and write. Nothing outside this folder issues SQL. |

### Migrations, and why they are the source of truth

doc 20 §3 originally named `lib/db/schema.ts` as the one place every table is
declared, while doc 20 §7 requires every change to be a new numbered SQL
migration. Two hand-maintained declarations of one schema will drift, which is
the precise failure §3 exists to prevent. Registry **C-16** resolves it: the SQL
is authoritative, and the TypeScript is generated from the live database. A
generated mirror cannot disagree with its source.

| # | Migration | Contents |
|:--:|---|---|
| 001 | `identity_core` | schema `app`, enums, `users`, `auth_identities`, `invitations`, `sessions` |
| 002 | `mfa_and_login_protection` | `mfa_factors`, `recovery_codes`, `login_attempts`, `break_glass` |
| 003 | `audit_and_security_log` | `audit_log`, `security_events`, append-only triggers |
| 004 | `skills_and_settings` | `skills`, `user_skills`, `system_settings` |
| 005 | `rls_and_super_admin_immutability` | role `cni_app`, identity helpers, `user_directory`, all RLS, **the Super Admin trigger** |
| 006 | `harden_function_search_paths` | `search_path = ''` on every `app` function; linter findings closed |

---

## 2. ⚠️ THE IDENTITY CONTRACT

We do **not** use Supabase Auth (registry **C-13**), so `auth.uid()` does not
exist. The database learns who is acting from a transaction-local setting
(**C-14**):

```ts
// The ONLY way application code reaches the database.
await withUser(userId, async (tx) => {
  // SET LOCAL ROLE cni_app;
  // SET LOCAL app.user_id = '<userId>';
  return tx.query(/* … */)
})
```

Two things must both be true for the policies to bind:

| | Why |
|---|---|
| **The session acts as `cni_app`** | `postgres` has `BYPASSRLS`. Connected as `postgres`, every policy in migration 005 is invisible and layer 2 of the security model is simply switched off. `cni_app` does not bypass anything. |
| **`app.user_id` is set** | Unset, `app.current_user_id()` is NULL, every policy predicate is false, and queries return nothing. **Fail-closed** — a forgotten identity produces an empty result, never an unfiltered one. |

### ⚠️ Setting the role — the connection string does NOT work (registry C-18)

The original plan was to put it in the URL:

```
postgresql://…/postgres?options=-c%20role%3Dcni_app        ← silently ignored
```

**Supabase's pooler does not forward libpq startup options.** The session stays
`postgres`, which has `BYPASSRLS`, so every policy is skipped and nothing looks
wrong. Measured with `npm run check:db`, not assumed.

The role is taken **per transaction** instead, by `withUser()` / `withAppRole()`:

```sql
BEGIN;
  SELECT set_config('role', 'cni_app', true);      -- SET LOCAL
  SELECT set_config('app.user_id', $1,   true);    -- SET LOCAL
  …
COMMIT;
```

Behind a **transaction-mode** pooler this is the only correct mechanism, not a
fallback. A session-level `SET ROLE` would persist on the backend after the
transaction ends and leak to whichever request reused that connection next.

`prepare: false` is **mandatory** on the client for the same reason: a named
prepared statement lives on one backend connection, and transaction mode hands
out a different one each time.

**Honest about the strength of this:** it is defence in depth, not a sandbox.
`session_user` is still `postgres`, so a `RESET ROLE` would climb back out. The
hard boundary is the **trigger** layer, which fires for every role including the
table owner — which is why the rules that matter most are triggers and not only
policies.

If a hard boundary is wanted later: give `cni_app` `LOGIN` and its own password
and connect as it directly. One migration, no application change.

### Verifying it

```
npm run check:db
```

Reads `.env.local`, redacts the password, and asks the database what it actually
believes — including the one that matters: inside a transaction with
`SET LOCAL ROLE`, is `current_user` really `cni_app`, does that role lack
`BYPASSRLS`, and does `select from users` with no identity return **zero** rows?

### Never connect as `postgres`, and never use the service-role key

The `service_role` key bypasses RLS completely. It is not used by this
application and must never reach the browser (doc 16 §8). The `anon` and
`authenticated` roles had all privileges on `public` revoked in migration 005 —
we do not use PostgREST, and the `anon` key ships inside the client bundle.

---

## 3. The pre-authentication surface (registry C-15)

Verifying a password means reading `auth_identities` *before* an identity
exists. That cannot satisfy §2, so it gets a deliberately narrow exception: a
small, named set of `SECURITY DEFINER` functions in schema `app`.

**Rules for that set:**

1. Each function is reviewed individually as a security boundary.
2. Each does one thing, takes scalars, and returns the minimum.
3. It is the **only** exception. The answer to "this is awkward under RLS" is
   never "add another definer function".
4. `password_hash` never leaves the server, in any form.

Planned for Step 4 (doc 20 §9 step 4.x):

| Function | Purpose |
|---|---|
| `app.auth_find_identity(email)` | Resolve an address to a user, role, state and hash for verification |
| `app.auth_record_attempt(…)` | Append to `login_attempts` and apply the 3-attempt lock (FR-155a) |
| `app.auth_create_session(…)` | Issue a session once authentication has actually succeeded |
| `app.auth_consume_token(…)` | Redeem an activation / reset / unlock token (FR-142, FR-155) |
| `app.setup_super_admin(…)` | The one-time, self-disabling setup route (doc 20 §9 step 5.1) |

---

## 4. What the database enforces on its own

These hold even when the application is wrong. That is the point of them.

| Invariant | Mechanism | Spec |
|---|---|---|
| A `super_admin` row is writable only by itself | trigger `users_enforce_write_rules` | BR-027, FR-140 |
| The Super Admin cannot demote, deactivate, suspend or lock themselves | same trigger | FR-156 |
| No account is ever promoted to `super_admin` | same trigger + `users_single_super_admin_idx` | BR-028 |
| At most one `super_admin` row can exist, ever | partial unique index | BR-028 |
| No account changes its own role | same trigger | doc 03 §5 |
| An Admin manages downward only, never another Admin | same trigger | doc 03 §3 |
| No user row is ever deleted | same trigger + revoked `DELETE` | BR-007 |
| The Super Admin always keeps ≥1 verified MFA factor | trigger `mfa_factors_protect_super_admin` | FR-146 |
| `audit_log`, `security_events`, `login_attempts` are append-only | triggers + revoked grants | FR-153, SA-10 |
| Members read only their own rows | RLS | ADR-003, FR-157 |
| No raw token is ever stored | `CHECK (… ~ '^[0-9a-f]{64}$')` | doc 16 §3 |
| `break_glass` has no client path at all | RLS enabled, zero policies, all privileges revoked | doc 04 §5 |

### Why triggers and not only RLS

An RLS `UPDATE` policy sees the **old** row in `USING` and the **new** row in
`WITH CHECK` — never both at once. Every rule shaped like *"you may not change
X into Y"* is therefore impossible to express as a policy. Super Admin
immutability, no-self-elevation and no-promotion are all that shape, so they are
triggers, and RLS merely supports them.

### Why a trigger and not only revoked grants

A table's **owner** holds its privileges implicitly; `REVOKE` against an owner
does nothing. doc 19 §6 requires "no UPDATE or DELETE grant for **any** role,
including `super_admin`", and only a trigger delivers that. Both are applied.

---

## 5. What the database *cannot* enforce — layer 3's job

Stated plainly so nobody assumes coverage that is not there.

| Requirement | Why the database can't, and who must |
|---|---|
| `password_hash` never appears in a response | The server has to read it to verify a password, so `cni_app` can select it. **Queries must name their columns; never `select *` on `auth_identities`.** |
| Per-key settings permissions (doc 19 §5) | RLS is coarse — Admin+ may write. The per-key rule lives in `lib/domain/permissions.ts`. |
| Which actions require a written reason | `audit_log.reason` is nullable; doc 03 §5 decides when it is mandatory. |
| Step-up re-authentication (🔒) | `sessions.step_up_verified_at` is stored; the freshness check is layer 3. FR-149. |
| Denials being logged | A `BEFORE` trigger that raises rolls back anything it wrote, including its own log entry. **The server must record the denial when it catches the error.** doc 16 §10. |
| Recording *why* a query returned nothing | RLS filters silently. A member's forbidden `UPDATE` affects 0 rows and raises nothing — check row counts, do not assume success. |

---

## 6. Routine operations

### After every migration — regenerate the types

```bash
# via the Supabase MCP
generate_typescript_types   →   types/database.ts

# or, with the Supabase CLI installed
npx supabase gen types typescript --project-id rxjqbtvlzxigfakbiktw > types/database.ts
```

### Re-run the gate proof

Paste `verify/005_super_admin_immutability.sql` into the SQL editor, psql, or
the MCP. It is wrapped in `BEGIN … ROLLBACK`, so it leaves nothing behind and
is safe against production. **Every row must read `PASS`.**

Run it after any migration that touches `users`, `mfa_factors`, RLS or the `app`
functions. Migration 006 is exactly that case, and it was re-run: 35/35.

### Run the linter

`get_advisors(type: "security")` after any DDL. One `INFO` is expected and
correct: `break_glass` has RLS enabled with no policies, per doc 04 §5. **Do not
"fix" it by adding a policy** — the table comment says so too.

### Break-glass (doc 16 §6)

Absolute rules have to have one documented way out, or "immutable" becomes
"unrecoverable" (threat T-9, rated *total loss*).

```sql
begin;
  set local app.break_glass = 'on';
  -- the one statement that has to happen
commit;
```

It requires direct database access, which no application code path has, and
every trigger that honours it writes a `critical` security event **that
commits**. Use it for a genuine disaster, never for convenience.

---

## 7. Not yet built

| Thing | Arrives in |
|---|---|
| `queries/` and the `withUser()` helper | Step 4 — authentication |
| The pre-auth definer functions (§3) | Step 4 |
| The one-time Super Admin setup route | Step 5 |
| Starter skills library (~35 rows) | Step 6 (doc 20 §9 step 6.1) |
| `availability`, `projects`, `tasks`, `time_entries`, … | Phase 2+ (doc 19 §6) |

`system_settings` is intentionally **empty**. It stores overrides only;
unset keys fall back to `SYSTEM_DEFAULTS` in `lib/domain/constants.ts`. An empty
table means "everything is at its documented default" — a far easier thing to
verify than 33 seeded rows that nothing keeps in step (registry C-16, §9a).
