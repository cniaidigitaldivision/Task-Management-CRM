import 'server-only';

import { withUser } from '@/lib/db/client';

/* ============================================================================
 * GOALS & DEVELOPMENT — the owner's reference, 2026-09-25
 * ----------------------------------------------------------------------------
 * Agreed goals with a baseline, a target and a running current value; the
 * check-in history behind that value; and the conversation around it.
 *
 * ── ⚠️ "CURRENT" IS THE LATEST CHECK-IN, NOT A COLUMN ─────────────────────
 * Storing current on the goal means two places can disagree the moment somebody
 * edits a check-in, and the check-in history is the thing a reader trusts. So
 * current is READ from the newest check-in that carried a number, and falls
 * back to the baseline when nobody has reported yet — which is what "not
 * started" means.
 *
 * ── ⚠️ PROGRESS IS FROM THE BASELINE, NOT FROM ZERO ───────────────────────
 * A goal from 60% to 80% that stands at 70% is HALF done, not 87% done. The bar
 * measures the distance actually travelled. It is computed here rather than in
 * the component so the figure on the bar and the figure in the table cannot
 * drift apart.
 * ========================================================================= */

export type GoalStatus = 'not_started' | 'in_progress' | 'achieved' | 'archived';

export interface Goal {
  readonly id: string;
  readonly subjectId: string;
  readonly title: string;
  readonly baseline: number;
  readonly target: number;
  readonly unit: string;
  readonly measure: string;
  /** The newest check-in that carried a number, or the baseline. */
  readonly current: number;
  /** 0–100, the distance travelled from baseline to target. */
  readonly progress: number;
  readonly dueDate: string | null;
  readonly nextCheckinOn: string | null;
  readonly status: GoalStatus;
  readonly actions: readonly string[];
  readonly setById: string | null;
  readonly setByName: string | null;
  readonly agreedOn: string;
  readonly projectId: string | null;
  readonly projectName: string | null;
  readonly checkins: number;
  /** Set when at least one check-in carries a link — the "evidence" rule. */
  readonly hasEvidence: boolean;
  readonly lastCheckinOn: string | null;
}

export interface GoalCheckin {
  readonly id: string;
  readonly goalId: string;
  readonly onDate: string;
  readonly byName: string | null;
  readonly note: string;
  readonly value: number | null;
  readonly evidenceLabel: string;
  readonly evidenceUrl: string;
}

export interface GoalComment {
  readonly id: string;
  readonly goalId: string;
  readonly authorId: string | null;
  readonly authorName: string | null;
  readonly body: string;
  readonly parentId: string | null;
  readonly at: string;
}

const dateOnly = (value: unknown): string | null => {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
};

/** baseline → target as a percentage of the distance, clamped and safe at 0. */
export function progressOf(baseline: number, target: number, current: number): number {
  const span = target - baseline;
  if (span === 0) return current >= target ? 100 : 0;
  const done = ((current - baseline) / span) * 100;
  return Math.max(0, Math.min(100, Math.round(done)));
}

export async function goalsFor(actorId: string, personId: string): Promise<Goal[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select g.*,
           sb.full_name as set_by_name,
           p.name as project_name,
           (select count(*) from public.goal_checkins c where c.goal_id = g.id)::int as checkins,
           (select c.value from public.goal_checkins c
             where c.goal_id = g.id and c.value is not null
             order by c.on_date desc, c.created_at desc limit 1) as current_value,
           (select max(c.on_date) from public.goal_checkins c where c.goal_id = g.id) as last_checkin_on,
           exists (
             select 1 from public.goal_checkins c
              where c.goal_id = g.id and length(btrim(c.evidence_url)) > 0
           ) as has_evidence
      from public.performance_goals g
      left join public.users sb on sb.id = g.set_by_id
      left join public.projects p on p.id = g.project_id
     where g.subject_id = ${personId}
     order by
       case g.status when 'in_progress' then 0 when 'not_started' then 1
                     when 'achieved' then 2 else 3 end,
       g.due_date nulls last, g.created_at
     limit 120
  `);

  return (rows as Array<Record<string, unknown>>).map((r) => {
    const baseline = Number(r.baseline ?? 0);
    const target = Number(r.target ?? 0);
    const current = r.current_value === null || r.current_value === undefined
      ? baseline
      : Number(r.current_value);
    return {
      id: String(r.id),
      subjectId: String(r.subject_id),
      title: String(r.title),
      baseline,
      target,
      unit: String(r.unit ?? ''),
      measure: String(r.measure ?? ''),
      current,
      progress: progressOf(baseline, target, current),
      dueDate: dateOnly(r.due_date),
      nextCheckinOn: dateOnly(r.next_checkin_on),
      status: String(r.status) as GoalStatus,
      actions: ((r.actions as string[] | null) ?? []).filter(Boolean),
      setById: (r.set_by_id as string | null) ?? null,
      setByName: (r.set_by_name as string | null) ?? null,
      agreedOn: dateOnly(r.agreed_on) ?? '',
      projectId: (r.project_id as string | null) ?? null,
      projectName: (r.project_name as string | null) ?? null,
      checkins: Number(r.checkins ?? 0),
      hasEvidence: r.has_evidence === true,
      lastCheckinOn: dateOnly(r.last_checkin_on),
    };
  });
}

/**
 * The check-ins and the conversation for every goal this person has.
 *
 * ⚠️ ONE READ FOR ALL OF THEM, NOT ONE PER GOAL. Clicking between three goals
 * must not cost three round trips — the whole set is small (a check-in is a
 * sentence) and the page already knows which goals it is showing. Rule Zero,
 * laws 3 and 4.
 */
export async function goalActivity(
  actorId: string,
  personId: string,
): Promise<{ checkins: GoalCheckin[]; comments: GoalComment[] }> {
  const [checkins, comments] = await withUser(actorId, async (tx) => {
    const c = await tx`
      select c.id, c.goal_id, c.on_date, c.note, c.value, c.evidence_label, c.evidence_url,
             u.full_name as by_name
        from public.goal_checkins c
        left join public.users u on u.id = c.by_id
       where c.subject_id = ${personId}
       order by c.on_date desc, c.created_at desc
       limit 300
    `;
    const m = await tx`
      select m.id, m.goal_id, m.author_id, m.body, m.parent_id, m.created_at,
             u.full_name as author_name
        from public.goal_comments m
        left join public.users u on u.id = m.author_id
       where m.subject_id = ${personId}
       order by m.created_at
       limit 300
    `;
    return [c, m] as const;
  });

  return {
    checkins: (checkins as Array<Record<string, unknown>>).map((r) => ({
      id: String(r.id),
      goalId: String(r.goal_id),
      onDate: dateOnly(r.on_date) ?? '',
      byName: (r.by_name as string | null) ?? null,
      note: String(r.note ?? ''),
      value: r.value === null || r.value === undefined ? null : Number(r.value),
      evidenceLabel: String(r.evidence_label ?? ''),
      evidenceUrl: String(r.evidence_url ?? ''),
    })),
    comments: (comments as Array<Record<string, unknown>>).map((r) => ({
      id: String(r.id),
      goalId: String(r.goal_id),
      authorId: (r.author_id as string | null) ?? null,
      authorName: (r.author_name as string | null) ?? null,
      body: String(r.body ?? ''),
      parentId: (r.parent_id as string | null) ?? null,
      at: new Date(r.created_at as string).toISOString(),
    })),
  };
}

/* ── Writing ─────────────────────────────────────────────────────────────── */

export interface GoalInput {
  readonly subjectId: string;
  readonly title: string;
  readonly baseline: number;
  readonly target: number;
  readonly unit: string;
  readonly measure: string;
  readonly dueDate: string | null;
  readonly nextCheckinOn: string | null;
  readonly actions: readonly string[];
  readonly projectId: string | null;
}

export async function createGoal(actorId: string, input: GoalInput): Promise<{ id: string }> {
  const rows = await withUser(actorId, (tx) => tx`
    insert into public.performance_goals
      (subject_id, title, baseline, target, unit, measure, due_date, next_checkin_on,
       actions, project_id, set_by_id)
    values
      (${input.subjectId}, ${input.title}, ${input.baseline}, ${input.target}, ${input.unit},
       ${input.measure}, ${input.dueDate}::date, ${input.nextCheckinOn}::date,
       ${input.actions as string[]}::text[], ${input.projectId}::uuid, ${actorId})
    returning id
  `);
  const row = (rows as Array<Record<string, unknown>>)[0];
  if (!row) throw new Error('That goal could not be created.');
  return { id: String(row.id) };
}

export async function updateGoal(
  actorId: string,
  goalId: string,
  input: Omit<GoalInput, 'subjectId'>,
): Promise<boolean> {
  const rows = await withUser(actorId, (tx) => tx`
    update public.performance_goals
       set title = ${input.title},
           baseline = ${input.baseline},
           target = ${input.target},
           unit = ${input.unit},
           measure = ${input.measure},
           due_date = ${input.dueDate}::date,
           next_checkin_on = ${input.nextCheckinOn}::date,
           actions = ${input.actions as string[]}::text[],
           project_id = ${input.projectId}::uuid
     where id = ${goalId}::uuid
    returning id
  `);
  return (rows as unknown[]).length > 0;
}

export async function setGoalStatus(
  actorId: string,
  goalId: string,
  status: GoalStatus,
): Promise<boolean> {
  const rows = await withUser(actorId, (tx) => tx`
    update public.performance_goals
       set status = ${status}::public.goal_status
     where id = ${goalId}::uuid
    returning id
  `);
  return (rows as unknown[]).length > 0;
}

export async function addCheckin(
  actorId: string,
  input: {
    goalId: string;
    note: string;
    value: number | null;
    evidenceLabel: string;
    evidenceUrl: string;
    onDate: string | null;
  },
): Promise<boolean> {
  /* ⚠️ `subject_id` IS SENT AS A PLACEHOLDER AND OVERWRITTEN BY THE TRIGGER.
     The column is NOT NULL, so something has to be supplied; the database then
     replaces it with the goal's own subject. The caller never decides. */
  const rows = await withUser(actorId, (tx) => tx`
    insert into public.goal_checkins
      (goal_id, subject_id, by_id, note, value, evidence_label, evidence_url, on_date)
    values
      (${input.goalId}::uuid, ${actorId}, ${actorId}, ${input.note}, ${input.value},
       ${input.evidenceLabel}, ${input.evidenceUrl},
       coalesce(${input.onDate}::date, (now() at time zone 'Asia/Karachi')::date))
    returning id
  `);
  return (rows as unknown[]).length > 0;
}

export async function addGoalComment(
  actorId: string,
  goalId: string,
  body: string,
  parentId: string | null,
): Promise<boolean> {
  const rows = await withUser(actorId, (tx) => tx`
    insert into public.goal_comments (goal_id, subject_id, author_id, body, parent_id)
    values (${goalId}::uuid, ${actorId}, ${actorId}, ${body}, ${parentId}::uuid)
    returning id
  `);
  return (rows as unknown[]).length > 0;
}
