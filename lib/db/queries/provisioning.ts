import 'server-only';

import type { Role } from '@/lib/domain/constants';
import type { PersonFootprint } from '@/lib/domain/permissions';

import { withUser } from '../client';

/* ============================================================================
 * PROVISIONING QUERIES — LAYER 1
 * ----------------------------------------------------------------------------
 * Creating people, and the invitations that let them in.
 *
 * ── THE CHAIN IS ENFORCED BY THE DATABASE, NOT BY THIS FILE ──────────────────
 * FR-141: Super Admin → Admin → Coordinator/Member. Nothing here checks that,
 * and the omission is the point — migration 005's insert policy already says it:
 *
 *     super_admin  may create  admin, team_coordinator, member
 *     admin        may create  team_coordinator, member
 *     anyone else  may create  nothing
 *
 * So an Admin attempting to mint another Admin is refused by Postgres, not by a
 * branch somebody could forget. The server action checks the same rule first
 * only so the person gets a sentence instead of a policy violation.
 *
 * ── AND NOBODY, EVER, CREATES A SUPER ADMIN ──────────────────────────────────
 * Absent from every branch of that policy, and independently impossible:
 * `users_single_super_admin_idx` permits exactly one such row in this database
 * for its whole life (BR-028). Two mechanisms, deliberately.
 * ========================================================================= */

export interface PendingInvitation {
  readonly id: string;
  readonly userId: string;
  readonly fullName: string;
  readonly email: string;
  readonly role: Role;
  readonly purpose: string;
  readonly sentToEmail: string;
  readonly invitedByName: string | null;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly isExpired: boolean;
}

function iso(value: unknown): string {
  if (!value) return '';
  return value instanceof Date ? value.toISOString() : String(value);
}

/**
 * Create the person's row. Returns the new id.
 *
 * The account starts `pending_activation` and is deliberately left with no
 * credential at all: no password, no temporary password, nothing to leak. It
 * becomes usable only when the invitee sets their own password, which is what
 * doc 16 §3 means by "passwords are never sent by email".
 */
export async function createPerson(
  actorId: string,
  input: {
    fullName: string;
    email: string;
    role: Role;
    roleTitle: string | null;
    weeklyCapacityPoints: number;
    maxConcurrentTasks: number;
  },
): Promise<string> {
  const rows = await withUser(actorId, (tx) => tx`
    insert into public.users (
      full_name, email, role, role_title, account_state, is_active,
      weekly_capacity_points, max_concurrent_tasks, created_by_id
    ) values (
      ${input.fullName.trim()},
      ${input.email.trim().toLowerCase()},
      ${input.role}::public.user_role,
      ${input.roleTitle?.trim() || null},
      'pending_activation',
      true,
      ${input.weeklyCapacityPoints},
      ${input.maxConcurrentTasks},
      ${actorId}
    )
    returning id
  `);
  return rows[0].id as string;
}

/** Is this address already taken? Checked before insert, for a readable error. */
export async function emailIsTaken(actorId: string, email: string): Promise<boolean> {
  /* ⚠️ Runs as the actor, so RLS applies — and `users_select` shows a Coordinator
     and above every row, which is who reaches this. A Member could not see a
     conflicting row, but a Member cannot create people either, so the question
     never arises for them. The unique index is the real guarantee; this exists
     only to turn a constraint violation into a sentence. */
  const rows = await withUser(actorId, (tx) => tx`
    select 1 from public.users where email = ${email.trim().toLowerCase()} limit 1
  `);
  return rows.length > 0;
}

/**
 * Everyone who has been invited and has not yet activated.
 *
 * Joined to `users` rather than read from `invitations` alone, because the
 * interesting question is "who cannot get in yet", and that lives on the account.
 */
export async function listPendingInvitations(actorId: string): Promise<PendingInvitation[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select i.id, i.user_id, i.purpose, i.sent_to_email, i.created_at, i.expires_at,
           i.expires_at <= now() as is_expired,
           u.full_name, u.email, u.role,
           c.full_name as invited_by_name
      from public.invitations i
      join public.users u on u.id = i.user_id
      left join public.users c on c.id = i.created_by_id
     where i.consumed_at is null
       and i.invalidated_at is null
       and i.purpose = 'activation'
     order by i.created_at desc
  `);

  return rows.map((row) => ({
    id: row.id as string,
    userId: row.user_id as string,
    fullName: row.full_name as string,
    email: row.email as string,
    role: row.role as Role,
    purpose: row.purpose as string,
    sentToEmail: row.sent_to_email as string,
    invitedByName: (row.invited_by_name as string | null) ?? null,
    createdAt: iso(row.created_at),
    expiresAt: iso(row.expires_at),
    isExpired: row.is_expired as boolean,
  }));
}

/**
 * Withdraw an outstanding invitation.
 *
 * Marks it invalidated rather than deleting it — `invitations` is the record of
 * who was invited and by whom, and an invitation that was issued and withdrawn
 * is a fact worth keeping.
 */
export async function revokeInvitation(actorId: string, invitationId: string): Promise<void> {
  await withUser(actorId, (tx) => tx`
    update public.invitations set invalidated_at = now()
     where id = ${invitationId} and consumed_at is null and invalidated_at is null
  `);
}

/** Deactivate or restore. Never a delete — BR-007, and a trigger enforces it. */
export async function setPersonActive(
  actorId: string,
  userId: string,
  isActive: boolean,
): Promise<void> {
  await withUser(actorId, (tx) => tx`
    update public.users
       set is_active = ${isActive},
           account_state = ${isActive ? 'active' : 'deactivated'}::public.account_state
     where id = ${userId}
  `);
}

/* ==========================================================================
 * PERMANENT REMOVAL — owner request 2026-08-23
 * ==========================================================================
 * *"I'm adding someone and I couldn't delete it. I don't want to dump my
 * database with the testing or dummy data."*
 *
 * BR-007 said accounts are deactivated and never deleted, and it was right
 * about people who have done work. It was never meant to make a mistyped
 * invitation permanent. Migrations 041–043 opened exactly that gap; these two
 * functions are the only way the application reaches it.
 */

/**
 * What a person has authored, counted against the columns that would refuse a
 * delete.
 *
 * ⚠️ These five counts are not arbitrary — each one maps to RESTRICT foreign
 * keys pointing at `users`. If a new table ever references a user with
 * RESTRICT, it belongs here too, or the interface will promise a delete that
 * the database then refuses.
 *
 * One round trip. Five sequential counts would be five times the latency to
 * Singapore to answer a question nobody is waiting on with interest.
 */
export async function personFootprint(
  actorId: string,
  userId: string,
): Promise<PersonFootprint> {
  const [row] = await withUser(actorId, (tx) => tx<
    {
      tasks_created: string;
      comments: string;
      projects: string;
      time_entries: string;
      uploads: string;
    }[]
  >`
    select
      (select count(*) from public.tasks    t where t.created_by_id  = ${userId}) as tasks_created,
      (select count(*) from public.comments c where c.author_id      = ${userId}) as comments,
      (select count(*) from public.projects p
        where p.created_by_id = ${userId} or p.owner_id = ${userId})              as projects,
      (select count(*) from public.time_entries e where e.user_id    = ${userId}) as time_entries,
      (  (select count(*) from public.documents   d  where d.uploaded_by_id = ${userId})
       + (select count(*) from public.attachments a  where a.uploaded_by_id = ${userId})
       + (select count(*) from public.credentials cr where cr.created_by_id = ${userId})
      )                                                                          as uploads
  `);

  return {
    tasksCreated: Number(row?.tasks_created ?? 0),
    comments: Number(row?.comments ?? 0),
    projects: Number(row?.projects ?? 0),
    timeEntries: Number(row?.time_entries ?? 0),
    uploads: Number(row?.uploads ?? 0),
  };
}

/**
 * Remove a person permanently. Returns whether a row actually went.
 *
 * ⚠️ THE BOOLEAN IS THE WHOLE POINT, AND IT IS NOT DEFENSIVENESS.
 * `users` is under RLS. A row this actor may not delete is not an error — it is
 * invisible to the statement, so the delete affects zero rows and reports
 * success. Before migration 043 added `users_delete`, EVERY delete behaved that
 * way: silently, cheerfully, doing nothing. A caller that ignores this return
 * value will tell somebody an account was removed when it was not.
 *
 * The cascade takes sessions, invitations, MFA factors, project memberships and
 * notifications with it. `activity_log.actor_id` is released to null, which is
 * what migration 041 exists to permit. Anything the person authored refuses the
 * delete outright at the foreign key — check `personFootprint` first so that
 * arrives as a sentence rather than a database error.
 */
export async function purgePerson(actorId: string, userId: string): Promise<boolean> {
  const rows = await withUser(actorId, (tx) => tx`
    delete from public.users where id = ${userId} returning id
  `);
  return rows.length > 0;
}

/**
 * Change somebody's role.
 *
 * The rank rules live in lib/domain/permissions.ts and are checked before this
 * runs. `users_update` independently refuses any write to a `super_admin` row,
 * and the migration-005 trigger refuses a self-demotion — so the three ways this
 * could go wrong are each blocked by something that is not this statement.
 */
export async function setPersonRole(
  actorId: string,
  userId: string,
  role: Role,
): Promise<void> {
  await withUser(actorId, (tx) => tx`
    update public.users set role = ${role}::public.user_role where id = ${userId}
  `);
}

/** FR-155: force the next sign-in to go through a password change. */
export async function forcePasswordReset(actorId: string, userId: string): Promise<void> {
  await withUser(actorId, (tx) => tx`
    update public.users
       set account_state = 'password_reset_required'::public.account_state
     where id = ${userId}
  `);
}

/** The account state, for deciding what to offer on a row. */
export async function getAccountState(
  actorId: string,
  userId: string,
): Promise<{ role: Role; accountState: string; isActive: boolean; email: string; fullName: string } | null> {
  const rows = await withUser(actorId, (tx) => tx`
    select role, account_state, is_active, email, full_name
      from public.users where id = ${userId}
  `);
  if (!rows[0]) return null;
  return {
    role: rows[0].role as Role,
    accountState: rows[0].account_state as string,
    isActive: rows[0].is_active as boolean,
    email: rows[0].email as string,
    fullName: rows[0].full_name as string,
  };
}
