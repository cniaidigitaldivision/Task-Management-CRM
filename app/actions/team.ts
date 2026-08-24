'use server';

import { revalidatePath } from 'next/cache';

import { requireUser, stepUpIsFresh } from '@/lib/auth/current-user';
import {
  expiresInMinutes,
  generateNumericCode,
  generateToken,
  generateTrailRef,
  hashScopedCode,
  hashToken,
} from '@/lib/auth/tokens';
import { withUser } from '@/lib/db/client';
import {
  getResetTrail,
  issueToken,
  recordTokenDelivery,
  revokeAllSessions,
  revokeToken,
  setTokenTrailRef,
} from '@/lib/db/queries/auth';
import { audit } from '@/lib/db/queries/audit';
import { record } from '@/lib/db/queries/feed';
import * as P from '@/lib/db/queries/provisioning';
import { describeSender, sendEmail } from '@/lib/email/send';
import { invitationEmail, passwordResetEmail } from '@/lib/email/templates';
import {
  ROLES,
  ROLE_LABEL,
  SYSTEM_DEFAULTS,
  type Role,
} from '@/lib/domain/constants';
import {
  assignableRolesFor as assignableRolesForRole,
  can,
  purgeBlockers,
  purgeRefusal,
} from '@/lib/domain/permissions';
import { nowMs } from '@/lib/now';
import { getSettings } from '@/lib/settings/current';
import { appUrl } from '@/lib/app-url';
import { describeEmailFailure } from '@/lib/view/reset-trail';

/* ============================================================================
 * TEAM PROVISIONING — LAYER 3, FR-141 to FR-144, doc 16 §3
 * ----------------------------------------------------------------------------
 * ── THE ONE RULE THIS FILE EXISTS TO KEEP ────────────────────────────────────
 * A password is never sent to anybody. Not generated for them, not emailed, not
 * shown to the person who created the account. Creating somebody produces a row
 * with NO credential at all — nothing that could leak, because nothing exists —
 * and a single-use token that lets them set their own.
 *
 * That is why "add a person" could not be a form that also takes a password, and
 * why this step waited for the token chain rather than shipping something that
 * looked finished.
 *
 * ── THE PROVISIONING CHAIN IS CHECKED THREE TIMES, ON PURPOSE ────────────────
 *   1. here, against lib/domain/permissions.ts, so the refusal is a sentence
 *   2. by `users_insert`, which permits an Admin to create only Coordinators and
 *      Members and refuses anything else at the database
 *   3. by `users_single_super_admin_idx`, which makes a second Super Admin
 *      impossible for the lifetime of the database
 *
 * Nobody would design three. They accumulated because each answers a different
 * question — "should this person be allowed", "is this write permitted", "can
 * this state exist at all" — and removing any one of them would be a downgrade.
 *
 * ── A FAILED EMAIL DOES NOT FAIL THE INVITATION ──────────────────────────────
 * The account and the token are created first; the send is attempted after and
 * merely reported. If sending threw, a brief Resend outage would leave an
 * account that exists, a token that exists, and an error implying neither does —
 * and the retry would collide with the email address just taken. The link comes
 * back in the result either way, so it can always be delivered by hand.
 * ========================================================================= */

export interface TeamActionResult {
  readonly ok: boolean;
  readonly error?: string;
  /** Shown so an invitation can be delivered by hand when mail is not working. */
  readonly activationUrl?: string;
  readonly emailNote?: string;
  readonly warning?: string;
  /** Plain confirmation, for when there is nothing to caveat. */
  readonly message?: string;
  /**
   * The caller must re-authenticate before this will be accepted (FR-149).
   *
   * ⚠️ Added 2026-08-22. `user.change_role` and `user.promote_to_admin` have
   * been in `STEP_UP_ACTIONS` since that list was written, and this file was the
   * one place that never asked — it imported `requireUser` and nothing else. So
   * the permission was enforced and the ceremony was not, which meant a hijacked
   * session could appoint an Admin without re-entering a password. See the note
   * on `changeRoleAction`.
   */
  readonly stepUpRequired?: boolean;
}

const fail = (error: string): TeamActionResult => ({ ok: false, error });

function str(form: FormData, key: string): string {
  return String(form.get(key) ?? '').trim();
}

/* `appUrl()` now lives in lib/app-url.ts and derives the origin from the
   request, so a link is never built against localhost. See that file. */

/* `assignableRolesFor` moved to lib/domain/permissions.ts for CHANGE-PLAN 6.1 —
   the app shell needs it while rendering and cannot await an action for a pure
   lookup. This wrapper stays because it is already a server action other code
   calls. */

export async function assignableRolesFor(actorRole: Role): Promise<Role[]> {
  return assignableRolesForRole(actorRole);
}

/* ==========================================================================
 * CREATE A PERSON + INVITE THEM
 * ========================================================================== */

export async function invitePersonAction(
  _prev: TeamActionResult,
  form: FormData,
): Promise<TeamActionResult> {
  const user = await requireUser();
  const actor = { role: user.role, id: user.id };

  if (!can(actor, 'user.create')) {
    return fail('Only an Admin can add people to the team (doc 03 §3.1).');
  }

  const fullName = str(form, 'fullName');
  const email = str(form, 'email').toLowerCase();
  const role = str(form, 'role') as Role;
  const roleTitle = str(form, 'roleTitle');

  if (!fullName) return fail('Enter their name.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail('That does not look like an email address.');
  if (!ROLES.includes(role)) return fail('Choose a role.');

  /* BR-028 and doc 16 §2: there is no in-app path to a second Super Admin, and
     saying so plainly beats letting the database refuse it cryptically. */
  if (role === 'super_admin') {
    return fail(
      'A Super Admin cannot be created here. There is exactly one, for the life of the system, created by the first-run setup (BR-028).',
    );
  }
  if (!assignableRolesForRole(user.role).includes(role)) {
    return fail(
      `A ${ROLE_LABEL[user.role]} cannot create a ${ROLE_LABEL[role]}. Only the Super Admin can appoint an Admin (FR-141).`,
    );
  }

  const capacity = Number(str(form, 'weeklyCapacityPoints')) || SYSTEM_DEFAULTS.defaultWeeklyCapacity;
  const maxTasks = Number(str(form, 'maxConcurrentTasks')) || SYSTEM_DEFAULTS.defaultMaxConcurrentTasks;
  if (capacity < 1 || capacity > 48) {
    return fail('Weekly capacity has to be between 1 and 48 points. 36 is the default (ADR-004).');
  }

  if (await P.emailIsTaken(user.id, email)) {
    return fail(
      'Somebody already has that email address. If they were deactivated, restore them instead of creating a second account — BR-007 keeps their history attached.',
    );
  }

  let userId: string;
  try {
    userId = await P.createPerson(user.id, {
      fullName,
      email,
      role,
      roleTitle: roleTitle || null,
      weeklyCapacityPoints: capacity,
      maxConcurrentTasks: maxTasks,
    });
  } catch {
    return fail(
      'That account could not be created. You can only add people below your own rank.',
    );
  }

  /* The raw token exists in memory for the length of this function and nowhere
     else. The database stores its SHA-256 and a check constraint enforces that
     the stored value is a 64-character hex digest (migration 001). */
  const token = generateToken();
  const expiresAt = new Date(
    nowMs() + Number((await getSettings()).activationTokenTtlHours) * 3600_000,
  );

  await issueToken({
    userId,
    tokenHash: hashToken(token),
    purpose: 'activation',
    sentToEmail: email,
    expiresAt,
    createdBy: user.id,
  });

  const activationUrl = `${await appUrl()}/activate?token=${token}`;

  await withUser(user.id, async (tx) => {
    await record(tx, user.id, {
      entityType: 'user',
      entityId: userId,
      action: 'invited',
      summary: `invited ${fullName} as ${ROLE_LABEL[role]}`,
      after: { email, role, invitedBy: user.fullName },
    });
    /* Creating an account is a privileged act, so it goes in the audit trail as
       well as the feed. Same transaction: an account that exists with no record
       of who created it is exactly what FR-153 is for. */
    await audit(tx, user, {
      entityType: 'user',
      entityId: userId,
      action: 'user.invited',
      after: { fullName, email, role, capacity, maxTasks },
    });
  });

  /* ---- Send it. Failure here is reported, never thrown. ---- */
  const sender = describeSender();
  const message = invitationEmail({
    fullName,
    invitedByName: user.fullName,
    roleLabel: ROLE_LABEL[role],
    activationUrl,
  });

  /* Spread whole — the invitation carries the header mark as an inline
     attachment, and naming the fields individually drops it (lib/email/send.ts). */
  const result = await sendEmail({ to: email, ...message });

  let emailNote: string;
  if (result.sent) {
    emailNote = sender.sandbox
      ? `Handed to Resend — but the sandbox sender only delivers to the address that owns your Resend account, so ${email} will most likely never see it. Send them the link below yourself.`
      : `Emailed to ${email}.`;
  } else if (!result.configured) {
    emailNote = 'No email was sent — RESEND_API_KEY is not set. Copy the link below to them.';
  } else {
    emailNote = `The email did not go out: ${result.reason} The invitation is valid regardless — copy the link below.`;
  }

  revalidatePath('/team');
  return { ok: true, activationUrl, emailNote };
}

/* ==========================================================================
 * RESEND / REVOKE
 * ========================================================================== */

export async function resendInvitationAction(userId: string): Promise<TeamActionResult> {
  const user = await requireUser();
  if (!can({ role: user.role, id: user.id }, 'user.create')) {
    return fail('Only an Admin can re-issue an invitation.');
  }

  const target = await P.getAccountState(user.id, userId);
  if (!target) return fail('That person is no longer available.');
  if (target.accountState !== 'pending_activation') {
    return fail(`${target.fullName} has already activated their account.`);
  }

  const token = generateToken();
  const expiresAt = new Date(
    nowMs() + Number((await getSettings()).activationTokenTtlHours) * 3600_000,
  );

  /* `auth_issue_token` supersedes the previous outstanding token of the same
     purpose, so the old link stops working the moment a new one is issued —
     which is what "single use" has to mean when links can be re-sent. */
  await issueToken({
    userId,
    tokenHash: hashToken(token),
    purpose: 'activation',
    sentToEmail: target.email,
    expiresAt,
    createdBy: user.id,
  });

  const activationUrl = `${await appUrl()}/activate?token=${token}`;
  const message = invitationEmail({
    fullName: target.fullName,
    invitedByName: user.fullName,
    roleLabel: ROLE_LABEL[target.role],
    activationUrl,
  });
  const result = await sendEmail({ to: target.email, ...message });

  await withUser(user.id, async (tx) => {
    await record(tx, user.id, {
      entityType: 'user',
      entityId: userId,
      action: 'invitation_resent',
      summary: `re-issued the invitation for ${target.fullName}`,
    });
    await audit(tx, user, {
      entityType: 'user',
      entityId: userId,
      action: 'user.invitation_reissued',
      after: { email: target.email },
    });
  });

  revalidatePath('/team');
  return {
    ok: true,
    activationUrl,
    emailNote: result.sent
      ? 'A fresh link was sent. The previous one no longer works.'
      : `The email did not go out: ${'reason' in result ? result.reason : ''} The new link is below; the previous one no longer works.`,
  };
}

export async function revokeInvitationAction(invitationId: string): Promise<TeamActionResult> {
  const user = await requireUser();
  if (!can({ role: user.role, id: user.id }, 'user.create')) {
    return fail('Only an Admin can withdraw an invitation.');
  }

  await P.revokeInvitation(user.id, invitationId);
  await withUser(user.id, async (tx) => {
    await record(tx, user.id, {
      entityType: 'user',
      entityId: invitationId,
      action: 'invitation_revoked',
      summary: 'withdrew an invitation',
    });
    await audit(tx, user, {
      entityType: 'user',
      entityId: invitationId,
      action: 'user.invitation_revoked',
    });
  });

  revalidatePath('/team');
  return { ok: true };
}

/* ==========================================================================
 * DEACTIVATE / RESTORE
 * ========================================================================== */

export async function setActiveAction(userId: string, isActive: boolean): Promise<TeamActionResult> {
  const user = await requireUser();
  const target = await P.getAccountState(user.id, userId);
  if (!target) return fail('That person is no longer available.');

  if (!can({ role: user.role, id: user.id }, 'user.deactivate', {
    ownerId: userId,
    ownerRole: target.role,
  })) {
    return fail('Only an Admin can deactivate somebody.');
  }
  if (userId === user.id) {
    return fail('You cannot deactivate your own account.');
  }

  try {
    await P.setPersonActive(user.id, userId, isActive);

    /* Deactivating without cutting the sessions leaves somebody working for
       hours on a cookie issued this morning. `session_resolve` refuses an
       inactive account on the next request anyway, but revoking is immediate
       and explicit rather than relying on that. */
    if (!isActive) await revokeAllSessions(userId, 'account_deactivated');

    await withUser(user.id, async (tx) => {
      await record(tx, user.id, {
        entityType: 'user',
        entityId: userId,
        action: isActive ? 'reactivated' : 'deactivated',
        summary: `${isActive ? 'restored' : 'deactivated'} ${target.fullName}`,
        before: { isActive: target.isActive },
        after: { isActive },
      });
      await audit(tx, user, {
        entityType: 'user',
        entityId: userId,
        action: isActive ? 'user.reactivated' : 'user.deactivated',
        before: { isActive: target.isActive, email: target.email },
        after: { isActive },
      });
    });

    revalidatePath('/team');
    return {
      ok: true,
      warning: isActive
        ? undefined
        : `${target.fullName} is signed out everywhere and cannot sign in. Their tasks, comments and history are untouched — accounts are never deleted (BR-007).`,
    };
  } catch {
    return fail(
      'That was refused. The Super Admin cannot be deactivated by anybody, and an Admin can only manage people below their own rank.',
    );
  }
}

/* ==========================================================================
 * PERMANENT REMOVAL — owner request 2026-08-23
 * ==========================================================================
 * *"I want that super admin and admin to be able to delete a team member…
 * I'm adding someone and I couldn't delete it. I don't want to dump my
 * database with the testing or dummy data."*
 *
 * ── THIS IS NOT A REPEAL OF BR-007 ───────────────────────────────────────────
 * "Accounts are deactivated, never deleted" still holds for anybody who has
 * done work here — the database refuses those at the foreign key whatever this
 * action decides. What changed is that a person who has authored NOTHING, which
 * is every mistyped invitation and every test account, is no longer permanent.
 *
 * ── WHY THE FOOTPRINT IS READ BEFORE THE DELETE ──────────────────────────────
 * Not to decide — the database decides. To make the refusal a sentence. Without
 * it the failure arrives as `foreign key violation on tasks_created_by_id_fkey`,
 * which tells the reader nothing about what to do instead.
 */

export async function purgePersonAction(userId: string): Promise<TeamActionResult> {
  const user = await requireUser();
  const actor = { role: user.role, id: user.id };

  const target = await P.getAccountState(user.id, userId);
  if (!target) return fail('That person is no longer available.');

  /* ⚠️ Step-up, as `user.purge` has demanded since STEP_UP_ACTIONS was written.
     Permanent and irreversible is exactly the category that list exists for:
     a hijacked session must not be able to erase somebody. */
  if (!stepUpIsFresh(user, nowMs())) {
    return {
      ok: false,
      error: 'Deleting somebody permanently needs your password again first.',
      stepUpRequired: true,
    };
  }

  const footprint = await P.personFootprint(user.id, userId);
  const refusal = purgeRefusal(actor, { id: userId, role: target.role }, footprint);

  if (refusal === 'not_permitted') {
    return fail('Only an Admin or the Super Admin can delete somebody.');
  }
  if (refusal === 'self') {
    return fail('You cannot delete your own account.');
  }
  if (refusal === 'outranked') {
    return fail(
      `You can only delete somebody below your own rank, and ${target.fullName} is not.`,
    );
  }
  if (refusal === 'has_work') {
    const blockers = purgeBlockers(footprint);
    return fail(
      `${target.fullName} cannot be deleted — they have ${blockers.join(', ')} in the system. ` +
        `Deleting them would destroy that work or leave it orphaned, so deactivate them instead: ` +
        `they lose all access immediately and what they made stays intact.`,
    );
  }

  /* Sessions first. If the delete succeeds the cascade takes them anyway, and if
     it does not, somebody about to be removed has still been signed out — which
     is the safer of the two failure modes. */
  await revokeAllSessions(userId, 'account_deactivated');

  let removed: boolean;
  try {
    removed = await P.purgePerson(user.id, userId);
  } catch {
    /* Reached when a RESTRICT foreign key refuses — which means the footprint
       missed a table. Reported honestly rather than as a success. */
    return fail(
      `${target.fullName} could not be deleted: something in the system still refers to them. ` +
        `Deactivate them instead — they lose all access and their history is kept.`,
    );
  }

  /* ⚠️ ZERO ROWS IS A REFUSAL, NOT A SUCCESS. `users` is under RLS, so a row
     this actor may not delete is invisible to the statement rather than an
     error: the delete reports success and removes nothing. Before migration 043
     that was the behaviour for every delete. */
  if (!removed) {
    return fail(
      `${target.fullName} was not deleted — the database refused it. ` +
        `Deactivate them instead.`,
    );
  }

  /* ⚠️ No `record()` here. The activity feed keys on the entity, and the entity
     is the row that just stopped existing. The database writes a `user_purged`
     security event from inside the trigger (migration 042), attributed to this
     actor and naming the address — which is the durable trail, and it commits
     with the delete rather than alongside it. `audit` is still written because
     it does not hold a foreign key to `users`. */
  await withUser(user.id, async (tx) => {
    await audit(tx, user, {
      entityType: 'user',
      entityId: userId,
      action: 'user.purged',
      before: { email: target.email, role: target.role, fullName: target.fullName },
    });
  });

  revalidatePath('/team');
  return {
    ok: true,
    message: `${target.fullName} has been deleted permanently.`,
  };
}

/* ==========================================================================
 * CHANGE ROLE
 * ========================================================================== */

export async function changeRoleAction(userId: string, role: Role): Promise<TeamActionResult> {
  const user = await requireUser();
  const target = await P.getAccountState(user.id, userId);
  if (!target) return fail('That person is no longer available.');

  if (!ROLES.includes(role)) return fail('That is not a role.');
  if (userId === user.id) {
    return fail('You cannot change your own role — not even the Super Admin can (FR-156).');
  }
  if (role === 'super_admin') {
    return fail('Nobody can be promoted to Super Admin. There is exactly one, ever (BR-028).');
  }
  if (target.role === 'super_admin') {
    return fail('The Super Admin cannot be altered by anybody else (BR-027, FR-140).');
  }

  const actor = { role: user.role, id: user.id };
  const context = { ownerId: userId, ownerRole: target.role };

  if (!can(actor, 'user.change_role', context)) {
    return fail('Only an Admin can change somebody’s role.');
  }
  /* Appointing an Admin is the Super Admin's alone (FR-141). Without this an
     Admin could promote a Member to Admin and quietly widen the circle. */
  if (role === 'admin' && !can(actor, 'user.promote_to_admin', context)) {
    return fail('Only the Super Admin can appoint an Admin.');
  }

  /* ── ⚠️ RE-AUTHENTICATION, FR-149 — ADDED 2026-08-22 ──────────────────────
     `user.change_role` and `user.promote_to_admin` are both in
     `STEP_UP_ACTIONS`, and this action never asked. Credentials, settings, the
     profile email and task purging all did; team management was the gap.

     What that meant in practice: a session taken over at an unlocked laptop
     could grant somebody Admin without ever producing a password or a second
     factor — which is the exact scenario step-up exists for. Changing a role is
     the most durable thing in this file. A forced password reset is loud and
     reversible; an extra Admin is quiet and persists.

     Checked AFTER the permission and validity checks, so nobody is made to
     re-authenticate only to be told the change was not allowed anyway. Same
     ordering as `changeEmailAction` in people.ts, for the same reason. */
  if (!stepUpIsFresh(user, nowMs())) {
    return {
      ok: false,
      stepUpRequired: true,
      error: 'Confirm it is you before changing somebody’s role.',
    };
  }

  try {
    await P.setPersonRole(user.id, userId, role);

    await withUser(user.id, async (tx) => {
      await record(tx, user.id, {
        entityType: 'user',
        entityId: userId,
        action: 'role_changed',
        summary: `changed ${target.fullName} from ${ROLE_LABEL[target.role]} to ${ROLE_LABEL[role]}`,
        before: { role: target.role },
        after: { role },
      });
      /* The single most sensitive entry in the whole trail: a role change is how
         privilege is granted, so before AND after are recorded even though the
         feed line already says it in words. */
      await audit(tx, user, {
        entityType: 'user',
        entityId: userId,
        action: 'user.role_changed',
        before: { role: target.role, email: target.email },
        after: { role },
      });
    });

    revalidatePath('/team');
    return {
      ok: true,
      /* FR-005: the role is read from the database on every request and never
         baked into the session, so this is true rather than aspirational. */
      warning: `${target.fullName} is now ${ROLE_LABEL[role]}. It applies on their very next page load — the role is never cached in their session.`,
    };
  } catch {
    return fail('That change was refused. You can only manage people below your own rank.');
  }
}

/* ==========================================================================
 * FORCE A PASSWORD RESET
 * ========================================================================== */

export async function forceResetAction(userId: string): Promise<TeamActionResult> {
  const user = await requireUser();
  const target = await P.getAccountState(user.id, userId);
  if (!target) return fail('That person is no longer available.');

  if (!can({ role: user.role, id: user.id }, 'user.force_password_reset', {
    ownerId: userId,
    ownerRole: target.role,
  })) {
    return fail('Only an Admin can force a password reset, and only on somebody below them.');
  }

  await P.forcePasswordReset(user.id, userId);
  await revokeAllSessions(userId, 'admin_forced_password_reset');

  /* Sends the reset itself (CHANGE-PLAN 4.1). Until now this action revoked the
     sessions and told the Admin to point the person at "Forgot your password?",
     which meant a forced reset was two manual steps and had nothing to show a
     status for. `issueReset` is shared with the Resend button so a resend is
     provably the same operation rather than a near-copy that drifts. */
  const delivery = await issueReset(user.id, {
    userId,
    email: target.email,
    fullName: target.fullName,
  });

  await withUser(user.id, async (tx) => {
    await record(tx, user.id, {
      entityType: 'user',
      entityId: userId,
      action: 'password_reset_forced',
      summary: `forced a password reset on ${target.fullName}`,
    });
    await audit(tx, user, {
      entityType: 'user',
      entityId: userId,
      action: 'user.password_reset_forced',
      /* The outcome of the send is part of the record. "We forced a reset" and
         "the email was refused" are different events to somebody reading this
         back six months later. */
      after: {
        email: target.email,
        sessionsRevoked: true,
        emailState: delivery.state,
        sandboxSender: delivery.sandbox,
      },
    });
  });

  revalidatePath('/team');
  return {
    ok: true,
    ...(delivery.state === 'accepted' && !delivery.sandbox
      ? {
          message: `${target.fullName} is signed out everywhere. A reset link is on its way to ${target.email}, valid for ${delivery.ttlMinutes} minutes. No password was generated, because none ever is.`,
        }
      : {
          warning: `${target.fullName} is signed out everywhere and must set a new password, but ${describeDelivery(delivery, target.email)} The Team screen shows the status, and you can resend from there.`,
        }),
  };
}

/* --------------------------------------------------------------------------
 * ISSUING A RESET — used by forcing one and by resending it
 * --------------------------------------------------------------------------
 * One function for both so "Resend" cannot quietly become a slightly different
 * operation. FR-155 already invalidates the previous code whenever a new one is
 * issued, so resending is genuinely re-issuing and not a second live code.
 * ------------------------------------------------------------------------ */

interface Delivery {
  readonly state: 'accepted' | 'refused' | 'unreachable' | 'not_configured';
  readonly detail: string;
  readonly sandbox: boolean;
  readonly ttlMinutes: number;
}

async function issueReset(
  adminId: string,
  target: { userId: string; email: string; fullName: string },
): Promise<Delivery> {
  const code = generateNumericCode(6);
  const trailRef = generateTrailRef();
  const settings = await getSettings();
  const ttlMinutes = Number(settings.recoveryCodeTtlMinutes);

  /* Scoped exactly as the self-service path scopes it, so the code this email
     carries is verifiable by the SAME `completeReset` and no second code path
     exists to keep in step. */
  const tokenHash = hashScopedCode('password_reset', target.email, code);

  const invitationId = await issueToken({
    userId: target.userId,
    tokenHash,
    purpose: 'password_reset',
    sentToEmail: target.email,
    expiresAt: expiresInMinutes(nowMs(), ttlMinutes),
    /* This is what makes it a FORCED reset in the record: nobody provisions
       their own, so `created_by_id` is how the trail tells the two apart. */
    createdBy: adminId,
  });

  await setTokenTrailRef(adminId, invitationId, trailRef);

  const message = passwordResetEmail({
    fullName: target.fullName,
    code,
    resetUrl: `${await appUrl()}/reset-password?code=${code}&t=${trailRef}`,
  });

  const result = await sendEmail({ to: target.email, ...message });

  const sender = describeSender();
  const delivery: Delivery = result.sent
    ? { state: 'accepted', detail: `Resend id ${result.id}`, sandbox: sender.sandbox, ttlMinutes }
    : {
        state: result.configured ? 'refused' : 'not_configured',
        detail: result.reason,
        sandbox: sender.sandbox,
        ttlMinutes,
      };

  await recordTokenDelivery(tokenHash, delivery.state, delivery.detail, delivery.sandbox);
  return delivery;
}

/** The honest sentence for a send that is not simply fine. */
function describeDelivery(delivery: Delivery, email: string): string {
  if (delivery.state === 'not_configured') {
    return 'no email was sent — RESEND_API_KEY is not set.';
  }
  if (delivery.state === 'refused' || delivery.state === 'unreachable') {
    /* Summarised rather than dumped. The verbatim text is kept in `email_detail`
       and shown in the status panel — this is the sentence somebody reads first. */
    return `the email was not sent. ${describeEmailFailure(delivery.detail).summary}`;
  }
  /* Accepted, but the sandbox sender only ever reaches the Resend account's own
     address — everything else is taken with a 200 and silently dropped. Saying
     "sent" here would be the single most misleading thing this screen could do. */
  return `it was accepted by Resend and will NOT reach ${email}: there is still no verified sending domain, so only the Resend account's own address receives mail.`;
}

/* --------------------------------------------------------------------------
 * READING THE TRAIL
 * --------------------------------------------------------------------------
 * The shape and the mapping live in `lib/view/reset-trail.ts`, not here. The
 * Team page reads the whole team's trails in one query and the panel is
 * presentational, so there is no per-person action to fetch one — an earlier
 * version had both, and two copies of the code that decides whether a link reads
 * as expired is exactly the kind of thing that drifts silently.
 * ------------------------------------------------------------------------ */

/**
 * Resend — issue a fresh code and email it again.
 *
 * Gated by the same permission as forcing one, because it IS forcing one again:
 * it invalidates the previous code (FR-155) and starts the expiry over. Anyone
 * who may not force a reset must not be able to do it by pressing Resend.
 */
export async function resendResetAction(userId: string): Promise<TeamActionResult> {
  const user = await requireUser();
  const target = await P.getAccountState(user.id, userId);
  if (!target) return fail('That person is no longer available.');

  if (!can({ role: user.role, id: user.id }, 'user.force_password_reset', {
    ownerId: userId,
    ownerRole: target.role,
  })) {
    return fail('Only an Admin can send a password reset, and only to somebody below them.');
  }

  const delivery = await issueReset(user.id, {
    userId,
    email: target.email,
    fullName: target.fullName,
  });

  await withUser(user.id, async (tx) => {
    await audit(tx, user, {
      entityType: 'user',
      entityId: userId,
      action: 'user.password_reset_resent',
      after: { email: target.email, emailState: delivery.state, sandboxSender: delivery.sandbox },
    });
  });

  revalidatePath('/team');
  return delivery.state === 'accepted' && !delivery.sandbox
    ? {
        ok: true,
        message: `A new link is on its way to ${target.email}, valid for ${delivery.ttlMinutes} minutes. The previous one no longer works.`,
      }
    : {
        ok: true,
        warning: `A new code was issued and the previous one no longer works, but ${describeDelivery(delivery, target.email)}`,
      };
}

/**
 * Revoke link — kill the outstanding code without issuing another.
 *
 * The person stays signed out and still cannot get in; they simply have no live
 * link either. For a reset sent to the wrong address, or one forced by mistake,
 * this is the correction — and it is why `invalidated_at` was already in the
 * schema rather than something this needed to invent.
 */
export async function revokeResetLinkAction(userId: string): Promise<TeamActionResult> {
  const user = await requireUser();
  const target = await P.getAccountState(user.id, userId);
  if (!target) return fail('That person is no longer available.');

  if (!can({ role: user.role, id: user.id }, 'user.force_password_reset', {
    ownerId: userId,
    ownerRole: target.role,
  })) {
    return fail('Only an Admin can revoke a reset link, and only for somebody below them.');
  }

  const trail = await getResetTrail(user.id, userId);
  if (!trail) return fail('There is no forced reset to revoke.');
  if (trail.consumedAt) return fail('That reset was already completed, so there is nothing to revoke.');
  if (trail.invalidatedAt) return fail('That link was already revoked.');

  const killed = await revokeToken(trail.id);
  if (!killed) return fail('That link is no longer live, so nothing was changed.');

  await withUser(user.id, async (tx) => {
    await audit(tx, user, {
      entityType: 'user',
      entityId: userId,
      action: 'user.password_reset_link_revoked',
      after: { email: trail.sentToEmail },
    });
  });

  revalidatePath('/team');
  return {
    ok: true,
    warning: `That link is dead. ${target.fullName} is still signed out and still has to set a new password — press Resend when you are ready to send them a working one.`,
  };
}
