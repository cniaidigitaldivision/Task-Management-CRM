import 'server-only';

import type { Role } from '@/lib/domain/constants';

import { withUser } from '../client';

/* ============================================================================
 * REMARKS ON A PROJECT — LAYER 1 (migration 104)
 * ----------------------------------------------------------------------------
 * Notes people leave about a project: what a client said on the phone, why a
 * campaign slipped, anything the next person opening the page ought to know.
 *
 * ── ⚠️ NO AUTHORISATION CODE IN THIS FILE, AND THAT IS THE DESIGN ───────────
 * Everything runs through `withUser`, and migration 104's policies answer every
 * question these functions could ask: a remark is readable exactly when the
 * PROJECT is readable (`app.project_is_visible`, the same predicate
 * `projects_select` uses), it can only be written under your own name, and it
 * can only be removed by its author or an Admin.
 *
 * So an unauthorised read returns no rows rather than throwing, and an
 * unauthorised write raises a policy violation the action turns into a
 * sentence. Re-checking any of it here would create a second rule to keep in
 * step with the first.
 * ========================================================================= */

export interface RemarkRow {
  readonly id: string;
  readonly body: string;
  readonly createdAt: string;
  readonly authorId: string | null;
  /** Null when the account has been deleted — rendered as "Former member". */
  readonly authorName: string | null;
  readonly authorAvatarUrl: string | null;
  readonly authorRole: Role | null;
}

/**
 * A project's remarks, oldest first.
 *
 * ── ⚠️ OLDEST FIRST, WHICH IS THE OPPOSITE OF EVERY OTHER FEED HERE ─────────
 * Activity, notifications and posts all come back newest-first, because they
 * are lists somebody scans. This is a conversation, and a conversation is read
 * top to bottom — the owner asked for *"a proper chat"*. The dialog scrolls to
 * the bottom on open, so the newest is still what you see first.
 *
 * ⚠️ No LIMIT. A project accumulates a handful of these, not a stream, and
 * paginating a chat that fits on one screen would cost a control nobody needs.
 * If a project ever runs to hundreds, the fix is a limit plus "show earlier",
 * not a change to the order.
 */
export async function listProjectRemarks(
  actorId: string,
  projectId: string,
): Promise<RemarkRow[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select r.id, r.body, r.created_at,
           r.author_id, u.full_name as author_name,
           u.avatar_url as author_avatar_url, u.role as author_role
      from public.project_remarks r
      left join public.users u on u.id = r.author_id
     where r.project_id = ${projectId}::uuid
     order by r.created_at
  `);

  return (rows as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id),
    body: String(row.body),
    createdAt:
      row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    authorId: (row.author_id as string | null) ?? null,
    authorName: (row.author_name as string | null) ?? null,
    authorAvatarUrl: (row.author_avatar_url as string | null) ?? null,
    authorRole: (row.author_role as Role | null) ?? null,
  }));
}

/**
 * How many remarks a project has, for the button's badge.
 *
 * Separate from `listProjectRemarks` because the page needs the number and not
 * the text: the thread is fetched when the dialog opens. Loading every remark
 * of every project into the page's props would put kilobytes of conversation
 * into the HTML for a badge reading "3" — and payload size is where this
 * application's slowness has actually been, twice.
 */
export async function countProjectRemarks(actorId: string, projectId: string): Promise<number> {
  const rows = await withUser(actorId, (tx) => tx`
    select count(*) as n from public.project_remarks where project_id = ${projectId}::uuid
  `);
  return Number(rows[0]?.n ?? 0);
}

/**
 * Add one.
 *
 * ⚠️ `author_id` is the ACTOR, not an argument. Migration 104's insert policy
 * refuses anything else, and passing it would invite a call site that hands in
 * somebody else's id and then fails at the database with a policy error nobody
 * can read.
 */
export async function insertProjectRemark(
  actorId: string,
  projectId: string,
  body: string,
): Promise<string> {
  const rows = await withUser(actorId, (tx) => tx`
    insert into public.project_remarks (project_id, author_id, body)
    values (${projectId}::uuid, ${actorId}::uuid, ${body})
    returning id
  `);
  return String(rows[0].id);
}

/**
 * Withdraw one.
 *
 * Returns whether a row actually went. ⚠️ A remark somebody may not remove
 * simply matches no rows under the delete policy, so `false` means "not yours
 * and you are not an Admin" as well as "already gone" — the action says the
 * former, because it is the only one worth explaining.
 */
export async function deleteProjectRemark(actorId: string, remarkId: string): Promise<boolean> {
  const rows = await withUser(actorId, (tx) => tx`
    delete from public.project_remarks where id = ${remarkId}::uuid returning id
  `);
  return rows.length > 0;
}
