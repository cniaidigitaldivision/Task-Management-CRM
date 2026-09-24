import 'server-only';

import { withUser } from '@/lib/db/client';

/* ============================================================================
 * REVIEWS & FEEDBACK — the owner's reference, 2026-09-25
 * ----------------------------------------------------------------------------
 * A queue of what this person has submitted, the evidence attached to one
 * submission, the criteria it is judged against, the conversation around it,
 * and the two decisions a reviewer can take.
 *
 * ── ⚠️ NOTHING HERE NEEDED A NEW TABLE, AND THAT WAS CHECKED FIRST ────────
 * Every part of the reference already exists in this product:
 *
 *   the queue          `tasks` with status in_review / revisions
 *   evidence           `attachments`
 *   acceptance criteria `checklist_items` — the task checklist, already built
 *   the conversation   `comments`
 *   the decisions      `changeStatusAction(task, done | revisions, reason)`
 *   the reason         `activity_log.after->>'reason'`, which that action writes
 *
 * Adding a `task_reviews` table would have duplicated all six and left two
 * records of the same event to disagree. The one thing genuinely missing was a
 * page that puts them in front of a reviewer, which is what this read is for.
 *
 * ── ⚠️ "SUBMITTED" IS WHEN IT ENTERED REVIEW, NOT WHEN IT WAS MADE ────────
 * The waiting time a reviewer is judged on runs from the moment the work was
 * handed over. `tasks.updated_at` would restart every time anybody touched the
 * row, so the timestamp comes from the log's newest `in_review` entry.
 * ========================================================================= */

export interface ReviewRow {
  readonly taskId: string;
  readonly reference: string;
  readonly title: string;
  readonly description: string | null;
  readonly projectId: string;
  readonly projectName: string;
  readonly status: 'in_review' | 'revisions';
  readonly submittedByName: string | null;
  readonly submittedByAvatar: string | null;
  /** Whoever put the work there — the reviewer, by the owner's own rule. */
  readonly reviewerId: string | null;
  readonly reviewerName: string | null;
  readonly reviewerAvatar: string | null;
  readonly submittedAt: string | null;
  readonly dueDate: string | null;
  readonly attachments: number;
  readonly criteria: number;
  readonly criteriaMet: number;
  readonly comments: number;
}

export interface ReviewCounts {
  readonly awaiting: number;
  readonly changesRequested: number;
  /** Closed this month by somebody other than the person who did the work. */
  readonly approvedThisMonth: number;
  /** Everything they finished this month, for the honest denominator. */
  readonly doneThisMonth: number;
}

export interface ReviewEvidence {
  readonly id: string;
  readonly fileName: string;
  readonly mimeType: string | null;
  readonly sizeBytes: number | null;
  readonly uploadedByName: string | null;
  readonly at: string;
}

export interface ReviewCriterion {
  readonly id: string;
  readonly text: string;
  readonly done: boolean;
}

export interface ReviewMessage {
  readonly id: string;
  readonly authorId: string | null;
  readonly authorName: string | null;
  readonly body: string;
  readonly at: string;
}

export interface ReviewEvent {
  readonly at: string;
  readonly action: string;
  readonly actorName: string | null;
  readonly reason: string | null;
}

export interface ReviewDetail {
  readonly evidence: readonly ReviewEvidence[];
  readonly criteria: readonly ReviewCriterion[];
  readonly messages: readonly ReviewMessage[];
  readonly history: readonly ReviewEvent[];
}

const iso = (value: unknown): string | null =>
  value ? new Date(value as string).toISOString() : null;

const dateOnly = (value: unknown): string | null => {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
};

/**
 * What this person has waiting on somebody's decision.
 *
 * ⚠️ IT COUNTS THE CRITERIA IN THE SAME STATEMENT. A reviewer scanning the
 * queue wants to know which submissions are actually ready; three extra scalar
 * subqueries on an indexed foreign key cost less than the round trip a second
 * read would take.
 */
export async function reviewQueue(
  actorId: string,
  personId: string | null,
  limit = 50,
): Promise<ReviewRow[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select t.id, t.reference, t.title, t.description, t.status::text as status, t.due_date,
           p.id as project_id, p.name as project_name,
           u.full_name as submitted_by_name, u.avatar_url as submitted_by_avatar,
           cb.id as reviewer_id, cb.full_name as reviewer_name, cb.avatar_url as reviewer_avatar,
           (select max(a.created_at) from public.activity_log a
             where a.entity_type = 'task' and a.entity_id = t.id and a.action = 'in_review'
           ) as submitted_at,
           (select count(*) from public.attachments at where at.task_id = t.id)::int as attachments,
           (select count(*) from public.checklist_items ci where ci.task_id = t.id)::int as criteria,
           (select count(*) from public.checklist_items ci
             where ci.task_id = t.id and ci.is_done)::int as criteria_met,
           (select count(*) from public.comments c where c.task_id = t.id)::int as comments
      from public.tasks t
      join public.projects p on p.id = t.project_id
      left join public.users u on u.id = t.assignee_id
      /* ⚠️ THE ASSIGNER IS THE REVIEWER. Owner, 2026-09-24: *"the person who
         assigns the task will review that task."* When they assigned it to
         themselves there is nobody waiting, and the page says Unassigned. */
      left join public.users cb on cb.id = t.created_by_id and cb.id <> t.assignee_id
     where not t.is_deleted
       and t.status in ('in_review', 'revisions')
       and (${personId}::uuid is null or t.assignee_id = ${personId}::uuid)
     order by submitted_at nulls last, t.reference
     limit ${limit}
  `);

  return (rows as Array<Record<string, unknown>>).map((r) => ({
    taskId: String(r.id),
    reference: String(r.reference),
    title: String(r.title),
    description: (r.description as string | null) ?? null,
    projectId: String(r.project_id),
    projectName: String(r.project_name),
    status: String(r.status) as ReviewRow['status'],
    submittedByName: (r.submitted_by_name as string | null) ?? null,
    submittedByAvatar: (r.submitted_by_avatar as string | null) ?? null,
    reviewerId: (r.reviewer_id as string | null) ?? null,
    reviewerName: (r.reviewer_name as string | null) ?? null,
    reviewerAvatar: (r.reviewer_avatar as string | null) ?? null,
    submittedAt: iso(r.submitted_at),
    dueDate: dateOnly(r.due_date),
    attachments: Number(r.attachments ?? 0),
    criteria: Number(r.criteria ?? 0),
    criteriaMet: Number(r.criteria_met ?? 0),
    comments: Number(r.comments ?? 0),
  }));
}

export async function reviewCounts(
  actorId: string,
  personId: string | null,
): Promise<ReviewCounts> {
  const rows = await withUser(actorId, (tx) => tx`
    select
      count(*) filter (where t.status = 'in_review')::int as awaiting,
      count(*) filter (where t.status = 'revisions')::int as changes_requested,
      count(*) filter (
        where t.status = 'done'
          and t.completed_at >= date_trunc('month', (now() at time zone 'Asia/Karachi'))
          and exists (
            select 1 from public.activity_log a
             where a.entity_type = 'task' and a.entity_id = t.id
               and a.action = 'done' and a.actor_id is distinct from t.assignee_id
          )
      )::int as approved_this_month,
      count(*) filter (
        where t.status = 'done'
          and t.completed_at >= date_trunc('month', (now() at time zone 'Asia/Karachi'))
      )::int as done_this_month
      from public.tasks t
     where not t.is_deleted
       and (${personId}::uuid is null or t.assignee_id = ${personId}::uuid)
  `);

  const r = (rows as Array<Record<string, unknown>>)[0] ?? {};
  return {
    awaiting: Number(r.awaiting ?? 0),
    changesRequested: Number(r.changes_requested ?? 0),
    approvedThisMonth: Number(r.approved_this_month ?? 0),
    doneThisMonth: Number(r.done_this_month ?? 0),
  };
}

/**
 * Everything the right-hand panel shows about one submission.
 *
 * ⚠️ ONE STATEMENT, FOUR JSON SUBQUERIES. A transaction runs its statements in
 * series on one connection, so four reads here would be four round trips to
 * Singapore — the mistake that made the task ledger's timeline take eight
 * seconds, measured, in this same feature.
 */
export async function reviewDetail(actorId: string, taskId: string): Promise<ReviewDetail> {
  const rows = await withUser(actorId, (tx) => tx`
    select
      coalesce((
        select json_agg(e order by e.created_at desc) from (
          select a.id, a.file_name, a.mime_type, a.size_bytes, a.created_at,
                 ub.full_name as uploaded_by_name
            from public.attachments a
            left join public.users ub on ub.id = a.uploaded_by_id
           where a.task_id = ${taskId}::uuid
           order by a.created_at desc limit 40
        ) e
      ), '[]'::json) as evidence,
      coalesce((
        select json_agg(c order by c.sort_order, c.created_at) from (
          select ci.id, ci.text, ci.is_done, ci.sort_order, ci.created_at
            from public.checklist_items ci
           where ci.task_id = ${taskId}::uuid
           order by ci.sort_order, ci.created_at limit 40
        ) c
      ), '[]'::json) as criteria,
      coalesce((
        select json_agg(m order by m.created_at) from (
          select cm.id, cm.author_id, cm.body, cm.created_at, au.full_name as author_name
            from public.comments cm
            left join public.users au on au.id = cm.author_id
           where cm.task_id = ${taskId}::uuid
           order by cm.created_at limit 60
        ) m
      ), '[]'::json) as messages,
      coalesce((
        select json_agg(h order by h.created_at desc) from (
          select a.created_at, a.action, au.full_name as actor_name,
                 coalesce(nullif(a.after->>'reason', ''), nullif(a.after->>'overrideReason', '')) as reason
            from public.activity_log a
            left join public.users au on au.id = a.actor_id
           where a.entity_type = 'task' and a.entity_id = ${taskId}::uuid
             and a.action in ('in_review', 'revisions', 'done', 'cancelled')
           order by a.created_at desc limit 40
        ) h
      ), '[]'::json) as history
  `);

  const row = (rows as Array<Record<string, unknown>>)[0] ?? {};
  const evidence = (row.evidence as Array<Record<string, unknown>>) ?? [];
  const criteria = (row.criteria as Array<Record<string, unknown>>) ?? [];
  const messages = (row.messages as Array<Record<string, unknown>>) ?? [];
  const history = (row.history as Array<Record<string, unknown>>) ?? [];

  return {
    evidence: evidence.map((r) => ({
      id: String(r.id),
      fileName: String(r.file_name),
      mimeType: (r.mime_type as string | null) ?? null,
      sizeBytes: r.size_bytes === null || r.size_bytes === undefined ? null : Number(r.size_bytes),
      uploadedByName: (r.uploaded_by_name as string | null) ?? null,
      at: iso(r.created_at) ?? '',
    })),
    criteria: criteria.map((r) => ({
      id: String(r.id),
      text: String(r.text),
      done: r.is_done === true,
    })),
    messages: messages.map((r) => ({
      id: String(r.id),
      authorId: (r.author_id as string | null) ?? null,
      authorName: (r.author_name as string | null) ?? null,
      body: String(r.body ?? ''),
      at: iso(r.created_at) ?? '',
    })),
    history: history.map((r) => ({
      at: iso(r.created_at) ?? '',
      action: String(r.action),
      actorName: (r.actor_name as string | null) ?? null,
      reason: (r.reason as string | null) ?? null,
    })),
  };
}

/**
 * The date the revised work is wanted by.
 *
 * ⚠️ IT MOVES THE TASK'S OWN DUE DATE, not a second date beside it. The
 * reference calls the field "Next revision due"; storing that separately would
 * leave the board, the ledger and every overdue count reading the old one while
 * the reviewer believed they had moved it. `tasks_update` decides who may.
 */
export async function setRevisionDue(
  actorId: string,
  taskId: string,
  dueDate: string | null,
): Promise<boolean> {
  const rows = await withUser(actorId, (tx) => tx`
    update public.tasks
       set due_date = ${dueDate}::date
     where id = ${taskId}::uuid and not is_deleted
    returning id
  `);
  return (rows as unknown[]).length > 0;
}
