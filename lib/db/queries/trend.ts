import 'server-only';

import { withUser } from '@/lib/db/client';
import { dateOnly } from '@/lib/db/row-values';

/* ============================================================================
 * WEEKLY TREND — the history behind the dashboard's figures
 * ----------------------------------------------------------------------------
 * The redesign's KPI cards carry sparklines and the dashboard carries a trend
 * chart, and both need something the application did not previously ask for: what
 * the numbers were in the weeks before this one.
 *
 * ── IT IS REAL HISTORY, NOT A SHAPE ──────────────────────────------------------
 * `tasks.completed_at` and `tasks.created_at` already record it, and migration 012
 * constrains `completed_at` and `status = 'done'` to agree, so a completion date is
 * as trustworthy as the status is. Nothing here is smoothed, sampled or invented:
 * a flat line means a flat week.
 *
 * ── WHY THE WEEKS ARE GENERATED IN SQL ───────────────────────────────────────
 * `generate_series` produces every week in the range and the counts are joined
 * onto it, so a week with no activity comes back as a zero rather than as a
 * missing row. Grouping alone would return only the weeks that had something in
 * them, and the chart would then draw eight points at even spacing and label them
 * with whatever weeks happened to exist — compressing a quiet fortnight into a
 * single step and showing a rise that never happened. An empty week is data.
 *
 * ── SCOPE IS RLS, AS EVERYWHERE ELSE ─────────────────────────────────────────
 * Run under `withUser`, so a Member's trend is their own work, a Coordinator's is
 * their people's, and an Admin's is the division's — from the same query, with no
 * branch here that could be wrong in the generous direction (ADR-003).
 *
 * Truncation is pinned to UTC to match `weekWindow()` in lib/domain/workload.ts.
 * Without `at time zone 'UTC'`, `date_trunc` follows the database session's zone
 * and the chart's week boundaries would sit hours away from the ones every
 * capacity figure on the same page is computed against.
 * ========================================================================= */

export interface TrendWeek {
  /** The Monday that starts the week, as `YYYY-MM-DD`. */
  readonly weekStart: string;
  /** Tasks created in that week. */
  readonly created: number;
  /** Tasks completed in that week. */
  readonly completed: number;
  /** Effort points completed in that week. */
  readonly completedPoints: number;
}

/**
 * The last `weeks` weeks, oldest first, including the current partial one.
 *
 * The current week is deliberately included and deliberately partial: a chart
 * that ends last Sunday cannot answer "how are we doing", which is the question
 * somebody opening a dashboard on a Wednesday is asking. The final point being
 * low mid-week is legible; a missing final point is not.
 */
export async function weeklyTrend(
  actorId: string,
  weeks = 8,
  nowMs: number = Date.now(),
): Promise<TrendWeek[]> {
  /* Clamped so a caller cannot ask for a series that would neither fit on a chart
     nor finish quickly. */
  const span = Math.min(52, Math.max(2, Math.round(weeks)));

  /* The Monday of the current week, in UTC — the same arithmetic as
     `weekWindow()`, and the reason this is computed here rather than in SQL is
     that `now` arrives as an argument (doc 20 §5: nothing reads its own clock). */
  const d = new Date(nowMs);
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() - ((d.getUTCDay() + 6) % 7));

  const first = new Date(monday);
  first.setUTCDate(first.getUTCDate() - (span - 1) * 7);

  const from = first.toISOString().slice(0, 10);
  const to = monday.toISOString().slice(0, 10);

  const rows = await withUser(
    actorId,
    (tx) => tx`
      with weeks as (
        select gs::date as week_start
        from generate_series(${from}::date, ${to}::date, interval '1 week') as gs
      ),
      made as (
        select (date_trunc('week', t.created_at at time zone 'UTC'))::date as week_start,
               count(*)::int as n
        from public.tasks t
        where not t.is_deleted
        group by 1
      ),
      finished as (
        select (date_trunc('week', t.completed_at at time zone 'UTC'))::date as week_start,
               count(*)::int as n,
               coalesce(sum(t.effort_points), 0)::float8 as pts
        from public.tasks t
        where not t.is_deleted and t.completed_at is not null
        group by 1
      )
      select
        w.week_start,
        coalesce(m.n, 0) as created,
        coalesce(f.n, 0) as completed,
        coalesce(f.pts, 0) as completed_points
      from weeks w
      left join made m on m.week_start = w.week_start
      left join finished f on f.week_start = w.week_start
      order by w.week_start
    `,
  );

  return rows.map((row) => ({
    /* `dateOnly` and NOT `String(row.week_start).slice(0, 10)`. `week_start` is a
       `date`, which the driver hands over as a `Date`, and `String()` on one of
       those gives "Mon Aug 10 2026 05:00:00 GMT+0500 …" — so the slice returns
       "Mon Aug 10". That one-liner is what stopped the calendar from displaying a
       single task for weeks; see the note at the top of lib/db/row-values.ts. */
    weekStart: dateOnly(row.week_start) ?? '',
    created: Number(row.created ?? 0),
    completed: Number(row.completed ?? 0),
    /* Points are `numeric(6,2)`, so a sum arrives as a string from postgres.js and
       would concatenate rather than add anywhere downstream. Cast in SQL and
       coerced again here, because one of those two will eventually be edited. */
    completedPoints: Number(row.completed_points ?? 0),
  }));
}
