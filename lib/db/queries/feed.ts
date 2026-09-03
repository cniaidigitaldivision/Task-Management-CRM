import 'server-only';

import { mergePrefs, wantsInApp } from '@/lib/domain/notification-prefs';

import type { NotificationKind } from '@/lib/domain/constants';

import { withUser, type Tx } from '../client';
import type { ActivityRow, NotificationRow } from './types';

/* ============================================================================
 * ACTIVITY & NOTIFICATIONS — LAYER 1
 * ----------------------------------------------------------------------------
 * Two feeds that look similar and are not:
 *
 *   activity_log  — "what happened", append-only, shared. Yusra moved CLI-091 to
 *                   Blocked. Everyone who can see the task can see the entry.
 *   notifications — "what happened *to you*", per person, readable and dismissable.
 *                   RLS restricts every row to its own user, at every rank —
 *                   including the Super Admin, who has no business reading a
 *                   member's inbox.
 *
 * They are written together by the same server action, which is why `record()`
 * and `notify()` both take a transaction: an action that logs but fails to notify
 * leaves someone unaware their work was reassigned, and an action that notifies
 * but fails to log leaves a change nobody can trace. Both or neither.
 * ========================================================================= */

export interface ActivityInput {
  readonly entityType: 'task' | 'project' | 'user' | 'setting' | 'comment' | 'time';
  readonly entityId: string;
  readonly action: string;
  readonly summary?: string | null;
  readonly before?: unknown;
  readonly after?: unknown;
}

/**
 * Append to the shared feed, inside a caller's transaction.
 *
 * `actorId` comes from the transaction's identity, not from an argument — RLS on
 * `activity_log` insists that `actor_id = app.current_user_id()`, so an entry
 * cannot be attributed to someone else even by mistake.
 */
export async function record(tx: Tx, actorId: string, input: ActivityInput): Promise<void> {
  await tx`
    insert into public.activity_log (actor_id, entity_type, entity_id, action, summary, before, after)
    values (
      ${actorId}, ${input.entityType}, ${input.entityId}, ${input.action},
      ${input.summary ?? null},
      ${input.before === undefined ? null : tx.json(input.before as never)},
      ${input.after === undefined ? null : tx.json(input.after as never)}
    )
  `;
}

export interface NotifyInput {
  readonly userId: string;
  readonly kind: NotificationKind;
  readonly title: string;
  readonly body?: string | null;
  readonly linkTo?: string | null;
  readonly entityId?: string | null;
}

/**
 * Notify someone, inside a caller's transaction.
 *
 * Silently skips notifying the actor about their own action. Being told "you
 * moved this task" the instant you moved it is noise, and a notification feed
 * that is mostly noise gets ignored — which then costs you the one notification
 * that mattered.
 */
export async function notify(
  tx: Tx,
  actorId: string,
  input: NotifyInput,
): Promise<void> {
  if (input.userId === actorId) return;

  /* ── THE RECIPIENT'S PREFERENCES DECIDE, NOT THE CALLER ────────────────────
     Checked here rather than at each of the twenty-odd call sites, because a
     preference honoured in nineteen places and forgotten in the twentieth is
     worse than one that does not exist: the person believes they have turned
     something off and it keeps arriving, so they stop trusting the switch.

     `mergePrefs` re-applies the locks, so a stored `false` against an
     unsilenceable kind — written before it was locked, or by somebody posting
     to the action directly — cannot suppress the notification. */
  const [recipient] = await tx`
    select app.notification_prefs_for(${input.userId}) as prefs
  `;
  if (!wantsInApp(mergePrefs(recipient?.prefs), input.kind)) return;

  await tx`
    insert into public.notifications (user_id, kind, title, body, link_to, entity_id)
    values (
      ${input.userId}, ${input.kind}::public.notification_kind, ${input.title},
      ${input.body ?? null}, ${input.linkTo ?? null}, ${input.entityId ?? null}
    )
  `;
}

/**
 * Notify somebody about their own situation.
 *
 * ── WHY THIS EXISTS BESIDE `notify()` ────────────────────────────────────────
 * `notify()` deliberately drops a notification whose recipient is the actor:
 * being told "you moved this task" the instant you moved it is noise, and a feed
 * that is mostly noise gets ignored.
 *
 * A timer alert is the exact opposite case. "Five minutes left on CLI-116" is
 * addressed to the person running the clock, and they are the only person it is
 * any use to — so the self-skip would silently discard every one of them.
 *
 * The recipient's PREFERENCES are still honoured. That is the part that must not
 * be bypassed: somebody who has switched time-limit warnings off has decided
 * something, and an alert about their own work is not a reason to overrule it.
 *
 * There is no `actorId` parameter on purpose. Adding one would invite passing a
 * different actor to defeat the self-skip in `notify()`, which is a rule worth
 * keeping rather than working around.
 */
export async function notifySelf(tx: Tx, input: NotifyInput): Promise<void> {
  const [recipient] = await tx`
    select app.notification_prefs_for(${input.userId}) as prefs
  `;
  if (!wantsInApp(mergePrefs(recipient?.prefs), input.kind)) return;

  await tx`
    insert into public.notifications (user_id, kind, title, body, link_to, entity_id)
    values (
      ${input.userId}, ${input.kind}::public.notification_kind, ${input.title},
      ${input.body ?? null}, ${input.linkTo ?? null}, ${input.entityId ?? null}
    )
  `;
}

/* ==========================================================================
 * READS
 * ========================================================================== */

export async function listActivity(actorId: string, limit = 25): Promise<ActivityRow[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select a.id, a.actor_id, u.full_name as actor_name, u.avatar_url as actor_avatar_url,
           a.entity_type, a.entity_id, a.action, a.summary, a.created_at
      from public.activity_log a
      left join public.users u on u.id = a.actor_id
     order by a.created_at desc
     limit ${limit}
  `);
  return rows.map((row) => ({
    id: row.id as string,
    actorId: (row.actor_id as string | null) ?? null,
    actorName: (row.actor_name as string | null) ?? null,
    actorAvatarUrl: (row.actor_avatar_url as string | null) ?? null,
    entityType: row.entity_type as string,
    entityId: row.entity_id as string,
    action: row.action as string,
    summary: (row.summary as string | null) ?? null,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  }));
}

/**
 * Everything that has happened to ONE project — the "Recent Activity" panel.
 *
 * ── ⚠️ WHY THIS IS NOT `listActivity` WITH A FILTER ───────────────────────────
 * A project's history is not only the rows filed against the project itself. Almost
 * everything a reader cares about — an asset uploaded, a post approved, a story moved
 * to review — is logged against a TASK, with the task's id as `entity_id`. Filtering
 * `entity_type = 'project'` returns "created the project" and nothing else, which is
 * exactly as empty as the panel it would feed.
 *
 * So this unions the project's own rows with the rows of every task in it. The join to
 * `tasks` is what scopes it, and because that join runs under the caller's RLS a
 * reader can only ever see activity for tasks they could already open.
 */
export async function listProjectActivity(
  actorId: string,
  projectId: string,
  limit = 12,
): Promise<ActivityRow[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select a.id, a.actor_id, u.full_name as actor_name, u.avatar_url as actor_avatar_url,
           a.entity_type, a.entity_id, a.action, a.summary, a.created_at
      from public.activity_log a
      left join public.users u on u.id = a.actor_id
     where (a.entity_type = 'project' and a.entity_id = ${projectId})
        or (a.entity_type = 'task' and a.entity_id in (
              select t.id from public.tasks t
               where t.project_id = ${projectId} and not t.is_deleted
            ))
     order by a.created_at desc
     limit ${limit}
  `);
  return rows.map((row) => ({
    id: row.id as string,
    actorId: (row.actor_id as string | null) ?? null,
    actorName: (row.actor_name as string | null) ?? null,
    actorAvatarUrl: (row.actor_avatar_url as string | null) ?? null,
    entityType: row.entity_type as string,
    entityId: row.entity_id as string,
    action: row.action as string,
    summary: (row.summary as string | null) ?? null,
    createdAt:
      row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  }));
}

/**
 * A cheap "has anything happened to me" reading, for the live refresh.
 *
 * ── ⚠️ WHY THIS EXISTS RATHER THAN POLLING THE PAGE ─────────────────────────
 * Owner, 2026-09-03: *"in the team member dashboard to whom the task is
 * assigned… without refreshing it should display silently. If he forgets to
 * refresh, he doesn't know a new task has arrived."*
 *
 * Re-rendering a whole page every 25 seconds for every open tab would put a
 * board's worth of queries behind a question that is almost always "no". This
 * is ONE indexed count and ONE max over the caller's own notification rows, and
 * the page is only re-read when the answer actually moves.
 *
 * Assignment and reassignment both write a notification (see the two `notify`
 * calls in app/actions/tasks.ts), so a new row here is exactly the event the
 * owner described. `unread` as well as `latest` because marking one read is
 * also a change worth reflecting in the bell.
 *
 * ⚠️ Through `withUser`, so RLS scopes it to the caller. A pulse that counted
 * everybody's notifications would leak the division's activity rate to anybody
 * who opened the network tab.
 */
export async function notificationPulse(
  actorId: string,
): Promise<{ unread: number; latest: string | null }> {
  const rows = await withUser(actorId, (tx) => tx`
    select count(*) filter (where not is_read)::int as unread,
           max(created_at) as latest
      from public.notifications
  `);
  const row = (rows as Array<Record<string, unknown>>)[0] ?? {};
  return {
    unread: Number(row.unread ?? 0),
    latest: row.latest ? new Date(row.latest as string).toISOString() : null,
  };
}

export async function listNotifications(
  actorId: string,
  limit = 30,
): Promise<NotificationRow[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select id, kind, title, body, link_to, is_read, created_at
      from public.notifications
     order by created_at desc
     limit ${limit}
  `);
  return rows.map((row) => ({
    id: row.id as string,
    kind: row.kind as string,
    title: row.title as string,
    body: (row.body as string | null) ?? null,
    linkTo: (row.link_to as string | null) ?? null,
    isRead: row.is_read as boolean,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  }));
}

export async function countUnread(actorId: string): Promise<number> {
  const rows = await withUser(
    actorId,
    (tx) => tx`select count(*) as n from public.notifications where not is_read`,
  );
  return Number(rows[0]?.n ?? 0);
}

export async function markNotificationsRead(actorId: string, ids?: readonly string[]): Promise<void> {
  await withUser(actorId, (tx) =>
    ids?.length
      ? tx`update public.notifications set is_read = true, read_at = now()
            where id = any(${ids as unknown as string[]}::uuid[]) and not is_read`
      : tx`update public.notifications set is_read = true, read_at = now() where not is_read`,
  );
}
