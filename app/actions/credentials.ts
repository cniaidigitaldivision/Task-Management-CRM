'use server';

import { revalidatePath } from 'next/cache';

import { requireUser, stepUpIsFresh } from '@/lib/auth/current-user';
import { withUser } from '@/lib/db/client';
import { brandMarkLabel } from '@/lib/brand/service-marks';
import { audit } from '@/lib/db/queries/audit';
import * as V from '@/lib/db/queries/credentials';
import { notify } from '@/lib/db/queries/feed';
import { can } from '@/lib/domain/permissions';
import { nowMs } from '@/lib/now';

/* ============================================================================
 * THE CREDENTIALS VAULT — owner request 2026-08-12
 * ----------------------------------------------------------------------------
 * ── WHAT THIS DOES NOT DO, AND WILL NOT ──────────────────────────────────────
 * It does not show anybody's CRM password. Those are Argon2id digests; there is
 * no key and no admin view, and adding one would mean storing passwords
 * recoverably so that a single compromised Super Admin account exposed every
 * person's password — including ones reused elsewhere. The owner was told this
 * plainly. To get into somebody's account, force a reset (CHANGE-PLAN 4.1).
 *
 * This holds the third-party logins the division keeps for clients and projects.
 *
 * ── THREE CONTROLS, AND EACH ANSWERS A DIFFERENT QUESTION ────────────────────
 *   who may see the row      row-level security (migration 023). Not this file.
 *   who may read the secret  step-up re-auth, here, every single time
 *   what happened            a CRITICAL security event per reveal, here
 *
 * The middle one is the reason this file exists rather than the queries being
 * called from a page. `credential.reveal` is in `STEP_UP_ACTIONS`, so a valid
 * session is not enough — which is the whole point of FR-149: a hijacked session
 * must not be able to do what a stolen password could, and a vault is exactly
 * where that distinction stops being theoretical.
 *
 * ── WHY A REVEAL IS LOGGED AS 'critical' ─────────────────────────────────────
 * Because it is the one action in this system that hands over a working secret,
 * and unlike every other privileged act it leaves no other trace: a role change
 * shows up in the role, a purge shows up in the absence. Reading a password
 * changes nothing at all, so if it is not written down it did not happen.
 * ========================================================================= */

export interface VaultResult {
  readonly ok: boolean;
  readonly error?: string;
  /** The client shows the re-authentication dialog when this is set. */
  readonly stepUpRequired?: boolean;
  readonly message?: string;
}

export interface RevealResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly stepUpRequired?: boolean;
  readonly label?: string;
  readonly username?: string | null;
  readonly secret?: string;
}

const fail = (error: string): VaultResult => ({ ok: false, error });

function str(form: FormData, key: string): string {
  return String(form.get(key) ?? '').trim();
}

function optional(form: FormData, key: string): string | null {
  const value = str(form, key);
  return value === '' ? null : value;
}

/** `yyyy-mm-dd` or nothing. A malformed date is refused rather than dropped. */
function optionalDate(form: FormData, key: string): string | null | 'invalid' {
  const value = str(form, key);
  if (value === '') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'invalid';
  if (Number.isNaN(Date.parse(`${value}T00:00:00Z`))) return 'invalid';
  return value;
}

/* ==========================================================================
 * READ
 * ==========================================================================
 * No secrets in here. `CredentialRow` carries `hasSecret`, never the value —
 * see the note in lib/db/queries/credentials.ts.
 * ========================================================================== */

export async function listCredentialsAction(): Promise<
  { ok: true; credentials: V.CredentialRow[] } | { ok: false; error: string }
> {
  const user = await requireUser();
  if (!can({ role: user.role, id: user.id }, 'credential.view')) {
    return { ok: false, error: 'You cannot see stored credentials.' };
  }
  return { ok: true, credentials: await V.listCredentials(user.id) };
}

/* ==========================================================================
 * REVEAL — the only path to plaintext
 * ========================================================================== */

export async function revealCredentialAction(id: string): Promise<RevealResult> {
  const user = await requireUser();
  const actor = { role: user.role, id: user.id };

  /* ── ⚠️ RANK OR A NAMED GRANT. THE GRANT *IS* THE PERMISSION ──────────────
     `credential.reveal` is denied to a Member, and migration 050 lets an Admin
     give one Member one credential. Without this second clause that grant would be
     useless: row-level security would hand the row over and then this line would
     refuse to decrypt it — access granted at the database and denied by the
     application, which is the worst of both and impossible to diagnose from the
     screen.

     ⚠️ The grant lookup runs as the caller and asks only about their OWN row
     (`credential_grants_select`), so this cannot be used to discover whether a
     credential exists: no grant and no such credential both answer false. */
  if (!can(actor, 'credential.reveal') && !(await V.hasCredentialGrant(user.id, id))) {
    return { ok: false, error: 'You cannot read stored credentials.' };
  }

  /* ── ⚠️ NO STEP-UP HERE, BY THE OWNER'S INSTRUCTION ───────────────────────
     *"don't require confirming the password again… Just decrypt the credential and
     let me watch. Keep the access level and all these things."*

     So the rank-or-grant check above stays and the password prompt is gone. The
     full reasoning, and what it costs, is recorded where the list itself lives —
     see `STEP_UP_ACTIONS` in lib/domain/permissions.ts.

     ⚠️ THE AUDIT WRITE BELOW IS NOW THE ONLY CONTROL LEFT on a reveal. It was
     always there; it used to be the second line of defence and is now the first,
     which is why the `console.error` on a failed audit write matters more than it
     did — a reveal that is not recorded is a reveal nobody can review. */
  const found = await V.revealCredential(user.id, id);
  /* Indistinguishable from "not visible to you", which is the right answer to
     give somebody trying ids. */
  if (!found) return { ok: false, error: 'That credential is not available.' };

  /* ⚠️ Stamped BEFORE the audit block, and separately from it. `markCredentialUsed`
     swallows its own failure by design: the secret is already decrypted and on its
     way to the person, so failing the reveal because a display cache could not be
     written would be the wrong trade. The audit row below is the one that must not
     be lost, which is why it has its own `console.error`. */
  await V.markCredentialUsed(user.id, id);

  await withUser(user.id, async (tx) => {
    await audit(tx, user, {
      entityType: 'credential',
      entityId: id,
      action: 'credential.revealed',
      after: { label: found.label },
    });
    await tx`
      insert into public.security_events (user_id, event_type, severity, details)
      values (
        ${user.id},
        'credential_revealed',
        'critical'::public.security_severity,
        ${tx.json({ credentialId: id, label: found.label, role: user.role })}
      )
    `;
  }).catch(() => {
    /* The audit must not swallow the reveal — the person is mid-task and the
       secret is already decrypted. But a vault whose log fails silently is not a
       vault, so this is loud in the server log. */
    console.error('[vault] AUDIT WRITE FAILED for a credential reveal', { id });
  });

  return {
    ok: true,
    label: found.label,
    username: found.username,
    secret: found.secret,
  };
}

/* ==========================================================================
 * WRITE
 * ========================================================================== */

function readInput(form: FormData): V.CredentialInput | { error: string } {
  const label = str(form, 'label');
  if (!label) return { error: 'Give it a name — "ABC Traders portal", say.' };

  const url = optional(form, 'url');
  if (url && !/^https?:\/\//i.test(url)) {
    return { error: 'A link has to start with http:// or https://' };
  }

  const expiresAt = optionalDate(form, 'expiresAt');
  if (expiresAt === 'invalid') return { error: 'That expiry date is not a real date.' };

  return {
    label,
    kind: str(form, 'kind') || 'other',
    projectId: optional(form, 'projectId'),
    /* ⚠️ `issuedToId` IS GONE FROM HERE — 2026-08-25. It read a form field that
       stopped existing when the picker replaced the single-select: the picker
       submits `issuedToIds`. So this parsed null on every save and wrote null over
       the old column, while the table and both detail panels were still reading
       it — the owner ticked two people, both were stored in `credential_holders`,
       and the screen showed a dash. Custody is `holderIds` and nothing else. */
    /* ⚠️ `getAll`, not `get`. The picker renders one hidden input per person under
       the same name, exactly as a native multi-select submits — so a single `get`
       would silently keep only the first and quietly drop everyone the owner
       ticked after Kashif. Filtered to plausible uuids: these arrive from a form
       and go into a uuid[] cast, where a malformed value is a 22P02 rather than a
       validation message. */
    holderIds: form
      .getAll('issuedToIds')
      .filter((v): v is string => typeof v === 'string')
      .filter((v) => /^[0-9a-f-]{36}$/i.test(v)),
    username: optional(form, 'username'),
    /* NOT trimmed. A password may legitimately begin or end with a space, and
       silently removing one produces a credential that does not work and a
       person who cannot see why. */
    secret: String(form.get('secret') ?? ''),
    url,
    /* ── ⚠️ VALIDATED AGAINST THE REAL MARK TABLES, NOT TRUSTED ──────────────
       This arrives from a form and lands in a column with no CHECK constraint —
       deliberately, because the valid set is 32 mark keys that live in
       `lib/brand` and would need a migration every time a logo was added
       (migration 051 says so). So the check belongs here, and it has to be a real
       lookup rather than a regex: an unrecognised key would store fine and then
       render an empty coloured tile, which reads as a broken image rather than as
       a bad value.

       An unknown value becomes null — "work it out from the URL" — which is the
       behaviour every credential had before the picker existed. */
    service: brandMarkLabel(str(form, 'service')) === null ? null : str(form, 'service'),
    notes: optional(form, 'notes'),
    expiresAt: expiresAt,
  };
}

export async function saveCredentialAction(
  _prev: VaultResult,
  form: FormData,
): Promise<VaultResult> {
  const user = await requireUser();
  const actor = { role: user.role, id: user.id };

  if (!can(actor, 'credential.manage')) {
    return fail('Only an Admin or a project owner can store credentials.');
  }

  const input = readInput(form);
  if ('error' in input) return fail(input.error);

  const id = str(form, 'id');
  /** Set on a create, so the holders write knows which row it belongs to. */
  let newId: string | null = null;

  try {
    if (id) {
      /* ── ⚠️ THE RESULT IS CHECKED NOW, AND IT WAS NOT BEFORE ──────────────
         `updateCredential` used to return void, so a row the UPDATE policy
         refused produced no error — an UPDATE matching zero rows succeeds — and
         this function fell through to "Saved." A Team Coordinator editing a
         credential on a project they do not own was told their change had been
         stored when nothing had been written. See the query's own note. */
      const saved = await V.updateCredential(user.id, id, input);
      if (!saved) {
        return fail(
          'That credential was not changed — the database refused the write. Storing one needs Admin, or ownership of the project it belongs to.',
        );
      }
    } else {
      /* ⚠️ The id is captured, because the holders below need it and a freshly
         created credential has no id in the form. */
      newId = await V.createCredential(user.id, input);
    }
  } catch {
    /* The insert policy refuses a project the actor does not own, and the check
       constraints refuse a malformed row. Both arrive here as an opaque error, so
       the message names the likely cause rather than guessing at the exact one. */
    return fail(
      'That could not be saved. You can only store credentials against a project you own.',
    );
  }

  /* ── ⚠️ THE HOLDERS ARE WRITTEN AFTER THE ROW, NOT INSIDE IT ───────────────
     They live in their own table (migration 059), so they cannot be part of the
     credential's insert. Written here, once the row is known to exist and to have
     an id.

     ⚠️ Failure is reported rather than swallowed. If the credential saved and the
     holders did not, the form would close saying "Saved." while the owner's
     careful choice of Kashif and Lareeb was thrown away — the exact class of
     silent-success bug that `updateCredential` had. */
  const savedId = id || newId;
  if (savedId) {
    try {
      await V.setCredentialHolders(user.id, savedId, input.holderIds);
    } catch {
      return fail(
        'The credential was saved but who it is issued to could not be — try setting that again.',
      );
    }
  }

  await withUser(user.id, (tx) =>
    audit(tx, user, {
      entityType: 'credential',
      entityId: id || null,
      action: id ? 'credential.updated' : 'credential.created',
      /* The label and where it points, never the secret. An audit log that
         recorded the value would defeat the encryption it sits beside. */
      after: {
        label: input.label,
        kind: input.kind,
        projectId: input.projectId,
        /* Names, not ids, so the log is readable a year later without a join. */
        issuedTo: input.holderIds.length,
        secretStored: input.secret !== '',
      },
    }),
  ).catch(() => console.error('[vault] audit write failed for a credential save'));

  revalidatePath('/vault');
  /* The project's Access tab lists the same rows, and it is now the main place
     credentials are managed from. Without this a credential added there does not
     appear until something else invalidates the route. */
  revalidatePath('/projects');
  return { ok: true, message: id ? 'Saved.' : `${input.label} is stored.` };
}

/** Forget the secret, keep the record of the account. */
export async function clearSecretAction(id: string): Promise<VaultResult> {
  const user = await requireUser();
  const actor = { role: user.role, id: user.id };

  if (!can(actor, 'credential.manage')) return fail('You cannot change stored credentials.');

  /* ⚠️ CHECKED, AND THIS IS THE WORST OF THE THREE TO GET WRONG. Reporting "the
     stored password is gone" when the UPDATE policy refused it leaves somebody
     believing a live secret has been destroyed — so they stop treating it as
     live. See the note on `clearSecret`. */
  const cleared = await V.clearSecret(user.id, id);
  if (!cleared) {
    return fail(
      'The stored password was NOT cleared — the database refused the write. It is still there. Clearing one needs Admin, or ownership of the project it belongs to.',
    );
  }

  await withUser(user.id, (tx) =>
    audit(tx, user, {
      entityType: 'credential',
      entityId: id,
      action: 'credential.secret_cleared',
    }),
  ).catch(() => console.error('[vault] audit write failed for a secret clear'));

  revalidatePath('/vault');
  revalidatePath('/projects');
  return {
    ok: true,
    message: 'The stored password is gone. The record of the account stays.',
  };
}

/**
 * Delete the whole entry.
 *
 * Coordinator and above. Owner, 2026-08-23: *"he can also manage all these
 * things."* A person who adds a client's Instagram login is the person who removes
 * it when the client changes it.
 *
 * ⚠️ THIS DOCBLOCK SAID "Admin and above only (the RLS delete policy agrees)" AND
 * BOTH HALVES WERE WRONG. `credential.delete` has allowed a Coordinator since
 * 2026-08-23, so the policy did not agree — it was still Admin-only from migration
 * 023, which is why a Coordinator's Delete button reported "no longer there".
 * Migration 049 brings the policy to Coordinator and above; the refusal message
 * below still names the possibility, because a stale deployment is a real state.
 */
export async function deleteCredentialAction(id: string): Promise<VaultResult> {
  const user = await requireUser();
  const actor = { role: user.role, id: user.id };

  if (!can(actor, 'credential.delete')) {
    return fail('Only an Admin can delete a stored credential.');
  }

  /* Read the label BEFORE deleting, so the audit entry says what went. Reveal is
     the wrong function for that — it would log a CRITICAL read that did not
     happen — so this deliberately takes the label from the list. */
  const all = await V.listCredentials(user.id);
  const label = all.find((c) => c.id === id)?.label ?? 'unknown';

  const removed = await V.deleteCredential(user.id, id);
  /* ⚠️ TWO CAUSES, ONE OUTCOME, AND THE MESSAGE HAS TO ADMIT IT. Zero rows means
     either the row is gone or `credentials_delete` (Admin and above) refused it —
     and the second is far likelier, because `can()` above passes for a Coordinator
     while the policy does not. Saying only "no longer there" sent somebody looking
     for a deletion that had not happened. */
  if (!removed) {
    return fail(
      'That credential was not deleted. Either it is already gone, or the database refused it — deleting one needs Admin.',
    );
  }

  await withUser(user.id, (tx) =>
    audit(tx, user, {
      entityType: 'credential',
      entityId: id,
      action: 'credential.deleted',
      before: { label },
    }),
  ).catch(() => console.error('[vault] audit write failed for a credential delete'));

  revalidatePath('/vault');
  revalidatePath('/projects');
  return { ok: true, message: `${label} is deleted.` };
}

/* ==========================================================================
 * NAMED PER-CREDENTIAL ACCESS — migration 050
 * --------------------------------------------------------------------------
 * Owner, 2026-08-24, of the "Who can see this credential" modal: *"only admins
 * and super admins can add someone and can delete someone from here."*
 *
 * ── ⚠️ THREE GUARDS, AND EACH STOPS A DIFFERENT THING ─────────────────────
 *   can(credential.grant)   Admin and above. A Coordinator may change a stored
 *                           password but not hand it to a third person — see the
 *                           permission's own note for why that asymmetry is right.
 *   stepUpIsFresh           A hijacked session must not be able to grant itself a
 *                           colleague who can read every password.
 *   credential_grants RLS   The same rank test, in the database, so neither of
 *                           the two above is a single point of failure.
 *
 * Every grant and every revoke writes an audit entry AND a security event, the
 * same treatment a reveal gets. A standing permission to read a client's password
 * is at least as important to reconstruct later as a single read of one.
 * ========================================================================== */

export interface GrantResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly message?: string;
  readonly stepUpRequired?: boolean;
}

/** Who has been given this credential by name. Read-only, so Coordinator+ — the
 *  same people who can see the credential and therefore the modal. */
export async function listCredentialGrantsAction(
  credentialId: string,
): Promise<
  { ok: true; grants: V.CredentialGrantRow[] } | { ok: false; error: string }
> {
  const user = await requireUser();
  if (!can({ role: user.role, id: user.id }, 'credential.view')) {
    return { ok: false, error: 'You cannot see stored credentials.' };
  }
  return { ok: true, grants: await V.listCredentialGrants(user.id, credentialId) };
}

/**
 * Change who may open one credential.
 *
 * Owner, 2026-08-24: *"as an admin: I can't delete super admin but I can delete or
 * add more people. I can delete team coordinator and members also."*
 *
 * ── ⚠️ ONE ACTION, THREE TRANSITIONS, BECAUSE THEY SHARE EVERY GUARD ─────────
 * `grant` names a Member in. `exclude` names somebody with rank out. `reset`
 * removes whichever exception exists and returns them to their rank. All three
 * take the same permission check, the same step-up, the same audit entry and the
 * same security event — three actions would have been three places to forget one
 * of those, and the one that gets forgotten is always the audit.
 *
 * ── WHAT EACH REFUSAL PROTECTS ──────────────────────────────────────────────
 *   credential.grant   Admin and above. A Coordinator may change a stored password
 *                      but not decide who else reads it.
 *   step-up            A hijacked session must not be able to hand a colleague
 *                      every password, nor quietly cut somebody out of one.
 *   the 052 trigger    The Super Admin cannot be excluded, and a grant to somebody
 *                      who already has rank is refused as the no-op it would be.
 *                      Both are checked here for the message and there for the
 *                      guarantee.
 */
export async function setCredentialAccessAction(
  credentialId: string,
  userId: string,
  intent: 'grant' | 'exclude' | 'reset',
): Promise<GrantResult> {
  const user = await requireUser();
  const actor = { role: user.role, id: user.id };

  if (!can(actor, 'credential.grant')) {
    return fail('Only an Admin or the Super Admin can change who may open a credential.');
  }

  if (!stepUpIsFresh(user, nowMs())) {
    return {
      ok: false,
      stepUpRequired: true,
      error: 'Confirm it is you before changing who may open a stored password.',
    };
  }

  /* The credential has to be one this actor can see. The list runs under RLS, so an
     id they cannot read is indistinguishable from one that does not exist. */
  const all = await V.listCredentials(user.id);
  const credential = all.find((c) => c.id === credentialId);
  if (!credential) return fail('That credential is not available.');

  const rows = await withUser(user.id, (tx) => tx`
    select id, full_name, role, is_active from public.users where id = ${userId}
  `);
  const target = rows[0];
  if (!target || target.is_active !== true) {
    return fail('That person is not an active member of the division.');
  }

  const name = target.full_name as string;
  const role = target.role as string;

  /* ⚠️ CHECKED HERE FOR THE SENTENCE, AND IN THE DATABASE FOR THE GUARANTEE.
     The trigger in migration 052 refuses both of these too; without these two
     branches the person would get a raw Postgres error instead of a reason. */
  if (intent === 'exclude' && role === 'super_admin') {
    return fail(
      `${name} is the Super Admin and cannot be removed from a credential — that is the last route back into the vault if everything else is lost.`,
    );
  }
  if (intent === 'grant' && role !== 'member') {
    return fail(
      `${name} can already open every credential as ${
        role === 'team_coordinator' ? 'a Team Coordinator' : 'an Admin'
      }. There is nothing to grant.`,
    );
  }

  let action: string;
  let message: string;

  try {
    if (intent === 'reset') {
      const cleared = await V.clearCredentialAccess(user.id, credentialId, userId);
      if (cleared === null) {
        return fail(`${name} has no exception on this credential — their access is by role.`);
      }
      /* ⚠️ The two directions are reported differently on purpose. Clearing a
         `deny` GIVES access back; saying "access removed" for that would be the
         opposite of what happened. */
      action = cleared === 'deny' ? 'credential.access_restored' : 'credential.access_revoked';
      message =
        cleared === 'deny'
          ? `${name} can open ${credential.label} again, as their role allows.`
          : `${name} can no longer open ${credential.label}. If they have already opened it, change the password too.`;
    } else {
      await V.setCredentialAccess(
        user.id,
        credentialId,
        userId,
        intent === 'grant' ? 'allow' : 'deny',
      );
      action = intent === 'grant' ? 'credential.access_granted' : 'credential.access_excluded';
      message =
        intent === 'grant'
          ? `${name} can now open ${credential.label}.`
          : `${name} can no longer open ${credential.label}, despite their role. If they have already opened it, change the password too.`;
    }
  } catch {
    /* The trigger, or the policy. Both are refusals rather than faults, and the
       two branches above have already named the ones we can predict. */
    return fail(
      'That change was refused by the database. Changing who may open a credential needs Admin, and the Super Admin cannot be excluded.',
    );
  }

  await withUser(user.id, async (tx) => {
    await audit(tx, user, {
      entityType: 'credential',
      entityId: credentialId,
      action,
      after: { label: credential.label, person: name, personId: userId, personRole: role },
    });
    await tx`
      insert into public.security_events (user_id, event_type, severity, details)
      values (
        ${user.id},
        ${action.replace('credential.', 'credential_')},
        ${intent === 'grant' ? 'critical' : 'warning'}::public.security_severity,
        ${tx.json({ credentialId, label: credential.label, personId: userId, person: name, intent })}
      )
    `;

    /* ── THE PERSON IS TOLD, EITHER WAY ─────────────────────────────────────
       A permission somebody holds without knowing is one they cannot query when
       it is wrong. A permission somebody has LOST without knowing is worse: they
       will keep trying, and conclude the software is broken. */
    {
      await notify(tx, user.id, {
        userId,
        kind: 'security_alert',
        title:
          intent === 'grant'
            ? `You can now open ${credential.label}`
            : intent === 'exclude'
              ? `You no longer have access to ${credential.label}`
              : `Your access to ${credential.label} has changed`,
        body: `${user.fullName} changed who can open this stored login. Opening one is always recorded against your name.`,
        linkTo: '/vault',
        entityId: credentialId,
      });
    }
  }).catch(() => {
    console.error('[vault] AUDIT WRITE FAILED for a credential access change', {
      credentialId,
      userId,
      intent,
    });
  });

  revalidatePath('/vault');
  revalidatePath('/projects');
  return { ok: true, message };
}

/* ============================================================================
 * STATE, AND THE ACTIVITY LOG
 * ========================================================================= */

/**
 * Deactivate a credential, flag it as compromised, or put it back in use.
 *
 * ── ⚠️ `credential.manage`, WHICH IS ADMIN-ONLY SINCE 2026-08-25 ────────────
 * Owner: *"only the admin is able to assign, add, delete, or manage who can view."*
 * Migration 058 made the UPDATE policy agree, so this check and the database now
 * say the same thing — before today the application was the more permissive of the
 * two and showed Coordinators a button that RLS refused.
 *
 * ⚠️ Audited as three distinct actions rather than one `status.changed`, because
 * "somebody marked a client's login as compromised" is an incident and
 * "somebody retired an old one" is housekeeping. A single action name would bury
 * the first inside a list of the second.
 */
export async function setCredentialStatusAction(
  id: string,
  status: 'active' | 'inactive' | 'compromised',
): Promise<VaultResult> {
  const user = await requireUser();

  if (!can({ role: user.role, id: user.id }, 'credential.manage')) {
    return { ok: false, error: 'Only an Admin can change a credential.' };
  }
  if (status !== 'active' && status !== 'inactive' && status !== 'compromised') {
    return { ok: false, error: 'That is not a state a credential can be in.' };
  }

  /* Read first, so the audit row can name the credential and record what it moved
     FROM — a log saying "set to inactive" without the previous state cannot answer
     "was this already retired when it leaked?". */
  const before = await V.getCredential(user.id, id);
  if (!before) return { ok: false, error: 'That credential is not available.' };

  const changed = await V.setCredentialStatus(user.id, id, status);
  /* ⚠️ A refusal reported as a refusal. `setCredentialStatus` returns false when
     RLS matched no rows, and saying "Saved." to somebody nothing happened for is
     the bug that shipped once on `updateCredential`. */
  if (!changed) {
    return { ok: false, error: 'That change was refused — an Admin is needed for this.' };
  }

  await withUser(user.id, (tx) =>
    audit(tx, user, {
      entityType: 'credential',
      entityId: id,
      action:
        status === 'compromised'
          ? 'credential.marked_compromised'
          : status === 'inactive'
            ? 'credential.deactivated'
            : 'credential.reactivated',
      before: { status: before.status },
      after: { status, label: before.label },
    }),
  ).catch(() => {
    console.error('[vault] AUDIT WRITE FAILED for a credential status change', { id, status });
  });

  revalidatePath('/vault');
  return {
    ok: true,
    message:
      status === 'compromised'
        ? `${before.label} is flagged as compromised. Change the password at the source — this only stops it being handed out here.`
        : status === 'inactive'
          ? `${before.label} is retired. The stored secret is kept, so you can still see what it used to be.`
          : `${before.label} is active again.`,
  };
}

/**
 * Who has read this credential, and when.
 *
 * ⚠️ THE ONLY CONTROL LEFT ON A REVEAL. The step-up prompt was removed on the
 * owner's instruction (2026-08-25), so this log is what makes an unexpected read
 * discoverable. It reads `security_events` — the trail — rather than
 * `credentials.last_used_at`, which is a display cache with no actor on it.
 */
export async function credentialActivityAction(
  id: string,
): Promise<
  | { ok: true; events: Awaited<ReturnType<typeof V.listCredentialEvents>> }
  | { ok: false; error: string }
> {
  const user = await requireUser();

  /* Seeing the log is `credential.view` plus whatever RLS says about the events
     themselves — not `audit_log.view`, which is the whole-system log and a
     different question. Somebody who may see the credential may see who read it. */
  if (!can({ role: user.role, id: user.id }, 'credential.view')) {
    return { ok: false, error: 'You cannot read the vault.' };
  }

  return { ok: true, events: await V.listCredentialEvents(user.id, id) };
}
