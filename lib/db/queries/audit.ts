import 'server-only';

import { headers } from 'next/headers';

import type { Role } from '@/lib/domain/constants';

import { withUser, type Tx } from '../client';

/* ============================================================================
 * THE AUDIT TRAIL — FR-153, SA-10, doc 16 §10
 * ----------------------------------------------------------------------------
 * ── WHY THIS IS NOT `activity_log` ───────────────────────────────────────────
 * Two tables that both record "somebody did something", kept apart deliberately.
 *
 *   activity_log  the human feed. "Yusra moved CLI-091 to Blocked, 2m ago."
 *                 Readable by anybody who can see the task. Chatty by design.
 *
 *   audit_log     the record of PRIVILEGED acts. Who changed a role, who
 *                 deactivated whom, who overrode a capacity block and what
 *                 reason they typed. Before and after, IP, session, outcome.
 *                 Super Admin only, or Admin minus the Super Admin's own
 *                 entries (Q-054, enforced by policy, not by this file).
 *
 * If they were one table the audit trail would be 95% task movements, and the
 * one entry that mattered would be unfindable. Keeping the feed chatty is what
 * lets the trail stay signal.
 *
 * ── IT IS APPEND-ONLY, ENFORCED BY TRIGGER ───────────────────────────────────
 * No UPDATE, no DELETE, for any role including the Super Admin (doc 19 §6). A
 * REVOKE cannot bind a table owner, so the guarantee is a trigger.
 *
 * ── FAILURES ARE RECORDED TOO ────────────────────────────────────────────────
 * `outcome` exists because a denied privilege escalation is more interesting
 * than a successful routine one. An audit log containing only what worked
 * cannot answer "did anybody try".
 * ========================================================================= */

export interface AuditEntry {
  /**
   * `report` was added for CHANGE-PLAN 5.2. The database column is free text
   * (migration 003), so this union is the only thing keeping the values
   * consistent — which is why a report export is labelled as what it is rather
   * than squeezed into `task` because that value already existed. A report spans
   * tasks, projects and people; filing it under one of them would make the audit
   * log harder to read later, which is the only reason it exists.
   */
  readonly entityType:
    | 'user'
    | 'project'
    | 'task'
    | 'setting'
    | 'session'
    | 'security'
    | 'report'
    | 'credential'
    | 'document'
    /* Separate from 'document' because sharing a FOLDER is a different act from
       approving a file, and an audit reader filtering on one must not be handed
       the other. */
    | 'drive_folder'
    /* Separate from 'user' for the same reason. Correcting somebody's check-out
       time and changing their role are both writes to a person's record, but an
       auditor asking "who has been editing timesheets" must not have to read
       every profile edit to find out — and the answer to that question is the
       one somebody will want months later, during a disagreement about pay. */
    | 'attendance'
    /* Separate again, and for the sharpest version of the same reason. Money is
       the thing an auditor is most likely to be asked about specifically — "who
       filed that expense", "who changed what somebody is paid", "who exported
       the ledger" — and those questions must be answerable without reading
       every project and user edit to find them. */
    | 'finance';
  readonly entityId: string | null;
  /** Dotted and stable — `user.role_changed`, not "changed role". */
  readonly action: string;
  readonly before?: unknown;
  readonly after?: unknown;
  /** The typed justification, where one was required (BR-003, FR-043). */
  readonly reason?: string | null;
  /** Matches the audit_outcome enum exactly — success, denied, failed. Using a
   *  word the database does not know ("refused") fails at insert time, which is
   *  how this was found. */
  readonly outcome?: 'success' | 'denied' | 'failed';
}

/** The request facts worth keeping on a privileged act. */
async function facts(): Promise<{ ip: string | null; userAgent: string | null }> {
  try {
    const list = await headers();
    return {
      ip: list.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
      userAgent: list.get('user-agent'),
    };
  } catch {
    /* Called outside a request (a script, a test). The entry is still worth
       writing; it simply has no IP. */
    return { ip: null, userAgent: null };
  }
}

/**
 * Write one entry, inside a caller's transaction.
 *
 * The actor's email and role are copied onto the row rather than joined at read
 * time. That is denormalisation on purpose: roles change and people leave, and
 * an audit entry has to say what was true *when it happened*. Joining to `users`
 * would silently rewrite history the moment somebody was promoted — the entry
 * would claim an Admin did what a Member actually did.
 */
export async function audit(
  tx: Tx,
  actor: { id: string; email: string; role: Role },
  entry: AuditEntry,
): Promise<void> {
  const { ip, userAgent } = await facts();

  await tx`
    insert into public.audit_log (
      actor_id, actor_email, actor_role, entity_type, entity_id,
      action, before, after, reason, outcome, ip_address, user_agent
    ) values (
      ${actor.id}, ${actor.email}, ${actor.role}::public.user_role,
      ${entry.entityType}, ${entry.entityId},
      ${entry.action},
      ${entry.before === undefined ? null : tx.json(entry.before as never)},
      ${entry.after === undefined ? null : tx.json(entry.after as never)},
      ${entry.reason ?? null},
      ${entry.outcome ?? 'success'},
      ${ip}::inet,
      ${userAgent}
    )
  `;
}

/** Convenience for an action that has no transaction of its own to join. */
export async function auditAlone(
  actor: { id: string; email: string; role: Role },
  entry: AuditEntry,
): Promise<void> {
  await withUser(actor.id, (tx) => audit(tx, actor, entry));
}

/* ==========================================================================
 * READING IT
 * ========================================================================== */

export interface AuditRow {
  readonly id: string;
  readonly actorName: string | null;
  readonly actorEmail: string | null;
  readonly actorRole: string | null;
  readonly entityType: string;
  readonly entityId: string | null;
  readonly action: string;
  readonly reason: string | null;
  readonly outcome: string;
  readonly ipAddress: string | null;
  readonly before: unknown;
  readonly after: unknown;
  readonly createdAt: string;
}

function iso(value: unknown): string {
  if (!value) return '';
  return value instanceof Date ? value.toISOString() : String(value);
}

/**
 * The trail, newest first.
 *
 * No role check here. `audit_log_select` already implements Q-054: the Super
 * Admin sees everything, an Admin sees everything whose actor was not the Super
 * Admin, and nobody else sees anything at all. Repeating that in TypeScript
 * would be a second implementation of an access rule.
 */
export async function listAuditLog(
  actorId: string,
  options: { limit?: number; search?: string; entityType?: string } = {},
): Promise<AuditRow[]> {
  const rows = await withUser(actorId, async (tx) => {
    const conditions = [tx`true`];

    if (options.entityType) conditions.push(tx`a.entity_type = ${options.entityType}`);
    if (options.search?.trim()) {
      const needle = `%${options.search.trim()}%`;
      conditions.push(
        tx`(a.action ilike ${needle} or a.actor_email ilike ${needle} or a.reason ilike ${needle})`,
      );
    }

    let where = conditions[0];
    for (const c of conditions.slice(1)) where = tx`${where} and ${c}`;

    return tx`
      select a.*, u.full_name as actor_name
        from public.audit_log a
        left join public.users u on u.id = a.actor_id
       where ${where}
       order by a.created_at desc
       limit ${options.limit ?? 100}
    `;
  });

  return rows.map((row) => ({
    id: row.id as string,
    actorName: (row.actor_name as string | null) ?? null,
    actorEmail: (row.actor_email as string | null) ?? null,
    actorRole: (row.actor_role as string | null) ?? null,
    entityType: row.entity_type as string,
    entityId: (row.entity_id as string | null) ?? null,
    action: row.action as string,
    reason: (row.reason as string | null) ?? null,
    outcome: row.outcome as string,
    ipAddress: row.ip_address ? String(row.ip_address) : null,
    before: row.before,
    after: row.after,
    createdAt: iso(row.created_at),
  }));
}

export interface LoginAttemptRow {
  readonly id: string;
  readonly emailAttempted: string;
  readonly userName: string | null;
  readonly outcome: string;
  readonly ipAddress: string | null;
  readonly ipCountry: string | null;
  readonly createdAt: string;
}

/** doc 16 §10. An Admin sees everybody's; anybody else sees only their own. */
export async function listLoginAttempts(
  actorId: string,
  limit = 60,
): Promise<LoginAttemptRow[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select l.id, l.email_attempted, l.outcome, l.ip_address, l.ip_country, l.created_at,
           u.full_name as user_name
      from public.login_attempts l
      left join public.users u on u.id = l.user_id
     order by l.created_at desc
     limit ${limit}
  `);

  return rows.map((row) => ({
    id: row.id as string,
    emailAttempted: row.email_attempted as string,
    userName: (row.user_name as string | null) ?? null,
    outcome: row.outcome as string,
    ipAddress: row.ip_address ? String(row.ip_address) : null,
    ipCountry: (row.ip_country as string | null) ?? null,
    createdAt: iso(row.created_at),
  }));
}

export interface SecurityEventRow {
  readonly id: string;
  readonly userName: string | null;
  readonly eventType: string;
  readonly severity: string;
  readonly details: unknown;
  readonly createdAt: string;
}

/** Super Admin only, by policy. The alert stream, kept separate from the trail. */
export async function listSecurityEvents(
  actorId: string,
  limit = 40,
): Promise<SecurityEventRow[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select e.id, e.event_type, e.severity, e.details, e.created_at,
           u.full_name as user_name
      from public.security_events e
      left join public.users u on u.id = e.user_id
     order by e.created_at desc
     limit ${limit}
  `);

  return rows.map((row) => ({
    id: row.id as string,
    userName: (row.user_name as string | null) ?? null,
    eventType: row.event_type as string,
    severity: row.severity as string,
    details: row.details,
    createdAt: iso(row.created_at),
  }));
}

/* ==========================================================================
 * SESSIONS — FR-154
 * ========================================================================== */

export interface SessionRow {
  readonly id: string;
  readonly createdAt: string;
  readonly lastSeenAt: string;
  readonly expiresAt: string;
  readonly userAgent: string | null;
  readonly ipAddress: string | null;
  readonly ipCountry: string | null;
  readonly isCurrent: boolean;
}

export async function listMySessions(
  actorId: string,
  currentSessionId: string,
): Promise<SessionRow[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select * from app.session_list(${actorId})
  `);

  return rows.map((row) => ({
    id: row.id as string,
    createdAt: iso(row.created_at),
    lastSeenAt: iso(row.last_seen_at),
    expiresAt: iso(row.expires_at),
    userAgent: (row.user_agent as string | null) ?? null,
    ipAddress: row.ip_address ? String(row.ip_address) : null,
    ipCountry: (row.ip_country as string | null) ?? null,
    /* Marked rather than hidden: signing yourself out of the tab you are using
       is a legitimate thing to want, and hiding it would leave somebody hunting
       for a session that is not in the list. */
    isCurrent: (row.id as string) === currentSessionId,
  }));
}

/** Accounts currently locked out (FR-155a), for an Admin to release. */
export async function listLockedAccounts(
  actorId: string,
): Promise<Array<{ id: string; fullName: string; email: string; lockedAt: string }>> {
  const rows = await withUser(actorId, (tx) => tx`
    select id, full_name, email, locked_at
      from public.users
     where locked_at is not null
     order by locked_at desc
  `);
  return rows.map((row) => ({
    id: row.id as string,
    fullName: row.full_name as string,
    email: row.email as string,
    lockedAt: iso(row.locked_at),
  }));
}
