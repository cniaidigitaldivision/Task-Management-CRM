'use server';

import { revalidatePath } from 'next/cache';

import { requireUser } from '@/lib/auth/current-user';
import { generateToken, hashToken } from '@/lib/auth/tokens';
import { withUser } from '@/lib/db/client';
import { issueToken, revokeAllSessions } from '@/lib/db/queries/auth';
import { audit } from '@/lib/db/queries/audit';
import { record } from '@/lib/db/queries/feed';
import * as P from '@/lib/db/queries/provisioning';
import { describeSender, sendEmail } from '@/lib/email/send';
import { invitationEmail } from '@/lib/email/templates';
import {
  ROLES,
  ROLE_LABEL,
  SYSTEM_DEFAULTS,
  type Role,
} from '@/lib/domain/constants';
import { can } from '@/lib/domain/permissions';
import { nowMs } from '@/lib/now';
import { getSettings } from '@/lib/settings/current';

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
}

const fail = (error: string): TeamActionResult => ({ ok: false, error });

function str(form: FormData, key: string): string {
  return String(form.get(key) ?? '').trim();
}

function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:4310').replace(/\/+$/, '');
}

/** Which roles this actor may hand out. doc 03 §3.1, and `users_insert` agrees. */
function assignableRoles(actorRole: Role): Role[] {
  if (actorRole === 'super_admin') return ['admin', 'team_coordinator', 'member'];
  if (actorRole === 'admin') return ['team_coordinator', 'member'];
  return [];
}

export async function assignableRolesFor(actorRole: Role): Promise<Role[]> {
  return assignableRoles(actorRole);
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
  if (!assignableRoles(user.role).includes(role)) {
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

  const activationUrl = `${appUrl()}/activate?token=${token}`;

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

  const result = await sendEmail({ to: email, subject: message.subject, html: message.html, text: message.text });

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

  const activationUrl = `${appUrl()}/activate?token=${token}`;
  const message = invitationEmail({
    fullName: target.fullName,
    invitedByName: user.fullName,
    roleLabel: ROLE_LABEL[target.role],
    activationUrl,
  });
  const result = await sendEmail({ to: target.email, subject: message.subject, html: message.html, text: message.text });

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
      after: { email: target.email, sessionsRevoked: true },
    });
  });

  revalidatePath('/team');
  return {
    ok: true,
    warning: `${target.fullName} is signed out everywhere and must set a new password. Send them to "Forgot your password?" — no password was generated, because none ever is.`,
  };
}
