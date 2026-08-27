import { withUser } from '@/lib/db/client';

/* ============================================================================
 * THE CONTROL ROOM'S OWN READS
 * ----------------------------------------------------------------------------
 * Owner, 2026-08-25, with a "Holographic Control Room" reference: the dashboard
 * shows reports produced this week, publishing volume, and a system-status
 * board. Those three are the only figures on that screen with no existing
 * query — everything else it draws already had one.
 *
 * ── ⚠️ SCOPED BY RLS, LIKE EVERY OTHER READ ────────────────────────────────
 * All of these go through `withUser`, so a Member sees what a Member may see
 * and the page needs no `if` deciding scope — ADR-003's whole point. A Member
 * whose role hides project reports gets zeroes here, which is the correct
 * answer to "how many reports this week" for somebody who cannot see any.
 * ========================================================================= */

export interface WeekdayCount {
  /** `Mon` … `Sun`. */
  readonly label: string;
  readonly count: number;
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * Reports generated on each day of the last 7 days, oldest first.
 *
 * ⚠️ Bucketed in KARACHI time, not UTC. `created_at` is a timestamptz, and a
 * report generated at 2am Karachi is still the previous day in UTC — bucketing
 * without the shift would file a fifth of the week's work under the wrong bar.
 */
export async function reportsByWeekday(actorId: string): Promise<WeekdayCount[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select
      to_char(created_at at time zone 'Asia/Karachi', 'Dy') as day,
      extract(isodow from created_at at time zone 'Asia/Karachi')::int as dow,
      count(*)::int as n
      from public.project_reports
     where created_at >= now() - interval '7 days'
     group by 1, 2
     order by 2
  `);

  const byDow = new Map<number, number>();
  for (const row of rows as Array<Record<string, unknown>>) {
    byDow.set(Number(row.dow), Number(row.n));
  }

  /* Every weekday present, including the empty ones: a bar chart that silently
     drops Tuesday is a chart whose axis lies about the week. */
  return WEEKDAYS.map((label, i) => ({ label, count: byDow.get(i + 1) ?? 0 }));
}

/**
 * How many deliverables were published on each of the last 7 days.
 *
 * ⚠️ Counts DISTINCT tasks, not placement rows. One video cross-posted to four
 * platforms is one asset and four placements — the owner settled that on
 * 2026-08-19, and `task_placements`' own comment says asset counts must come
 * from tasks. Counting rows here would quadruple a good week.
 */
export async function publishedByDay(actorId: string): Promise<WeekdayCount[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select
      extract(isodow from tp.published_on)::int as dow,
      count(distinct tp.task_id)::int as n
      from public.task_placements tp
      join public.tasks t on t.id = tp.task_id
     where tp.published_on is not null
       and tp.published_on >= current_date - 6
       and t.is_deleted = false
     group by 1
     order by 1
  `);

  const byDow = new Map<number, number>();
  for (const row of rows as Array<Record<string, unknown>>) {
    byDow.set(Number(row.dow), Number(row.n));
  }
  return WEEKDAYS.map((label, i) => ({ label, count: byDow.get(i + 1) ?? 0 }));
}

/**
 * Signals the system-status board reports on.
 *
 * ── ⚠️ ONLY WHAT CAN ACTUALLY BE OBSERVED ──────────────────────────────────
 * The reference board lists "AI Engine", "Cloud Services" and "Backup" as
 * Operational. This product has no uptime monitor, no backup log and no model
 * server, so those three would be green lights wired to nothing — the most
 * dangerous thing a status board can contain, because a status light is read as
 * a measurement. What is returned here is only what a query can prove.
 */
export interface SystemSignals {
  /** Critical security events in the last 24 hours. */
  readonly criticalEvents: number;
  /** Warnings in the last 24 hours. */
  readonly warningEvents: number;
  /** Active handoff chains — the automation that creates tasks. */
  readonly activeChains: number;
  /** Rows written to the activity log in the last hour: the app is being used. */
  readonly activityLastHour: number;
}

/**
 * The document register, by state — the legend beside the reports chart.
 *
 * The reference's legend reads "Reports / Submitted / Pending". Those are the
 * document register's own three states, so this is the same idea on data that
 * exists: approved is what has been accepted, pending is what is waiting on an
 * Admin, rejected is what came back.
 */
export interface DocumentTally {
  readonly approved: number;
  readonly pending: number;
  readonly rejected: number;
}

/**
 * Open and overdue counts as they stood at the end of each of the last N weeks.
 *
 * ── ⚠️ THIS IS A REAL PAST, NOT A DERIVED ONE ───────────────────────────────
 * The dashboard's rule is that a sparkline may only appear under a figure whose
 * history can actually be reconstructed — a decorative line under a number
 * nobody can rebuild is worse than no line. Two of the four counters qualify,
 * and this is the query that earns them:
 *
 *   open at week end     created on or before that instant, and not completed
 *                        by it
 *   overdue at week end  due before that instant, and not completed by it
 *
 * Both are exact, because every task carries `created_at`, `due_date` and — if
 * finished — `completed_at`, and migration 012 constrains `completed_at` and
 * `status = 'done'` to agree.
 *
 * ⚠️ The one caveat that used to block this: a CANCELLED task has no
 * `cancelled_at`, so it cannot be known when it stopped being open. Checked on
 * 2026-08-26 — this division has none, and `is_deleted` rows are excluded
 * anyway. Cancelled tasks are therefore left in the open count, which is
 * correct for every row that exists today and slightly overstates the past only
 * if somebody starts cancelling work. Worth revisiting if `cancelled_at` is
 * ever added.
 *
 * ⚠️ There is deliberately NO in-progress series. That would need a history of
 * status changes and this product stores only the current one, so the In
 * Progress tile carries no line rather than a modelled one.
 */
export interface WeekShape {
  readonly weekStart: string;
  readonly open: number;
  readonly overdue: number;
}

export async function weeklyTaskShape(actorId: string, weeks = 8): Promise<WeekShape[]> {
  const rows = await withUser(actorId, (tx) => tx`
    with bounds as (
      select generate_series(
        date_trunc('week', now() at time zone 'Asia/Karachi') - make_interval(weeks => ${weeks - 1}),
        date_trunc('week', now() at time zone 'Asia/Karachi'),
        interval '1 week'
      ) as week_start
    )
    select
      b.week_start::date as week_start,
      (select count(*) from public.tasks t
        where t.is_deleted = false
          and t.created_at < b.week_start + interval '1 week'
          and (t.completed_at is null or t.completed_at >= b.week_start + interval '1 week')
      )::int as open_count,
      (select count(*) from public.tasks t
        where t.is_deleted = false
          and t.due_date is not null
          and t.due_date < (b.week_start + interval '1 week')::date
          and (t.completed_at is null or t.completed_at >= b.week_start + interval '1 week')
      )::int as overdue_count
      from bounds b
     order by b.week_start
  `);

  return (rows as Array<Record<string, unknown>>).map((row) => ({
    weekStart: String(row.week_start).slice(0, 10),
    open: Number(row.open_count ?? 0),
    overdue: Number(row.overdue_count ?? 0),
  }));
}

/** One weekday's documents, split by the state they are in. */
export interface DocumentDay {
  readonly label: string;
  readonly approved: number;
  readonly pending: number;
  readonly rejected: number;
}

/**
 * The document register over the last 7 days, by weekday and state.
 *
 * ── ⚠️ THE CHART IS STACKED BY STATE, NOT A SINGLE COUNT ────────────────────
 * Owner, 2026-08-26: *"for Approval, Pending, and Returned use the data to feed
 * them in such a way that all 3 colors should appear."*
 *
 * A single count per day can only ever be one colour, so this returns the three
 * states separately and the chart stacks them. Whether three colours actually
 * APPEAR is then a fact about the data rather than about the chart: today the
 * register holds three approved documents and nothing else, so one colour is
 * the truthful picture. The moment a document is submitted or returned, the
 * chart shows it without another change here.
 *
 * ⚠️ Bucketed in KARACHI time. `created_at` is a timestamptz, and a document
 * filed at 2am Karachi is still the previous day in UTC — bucketing without the
 * shift files a fifth of the week under the wrong bar.
 */
export async function documentsByDay(actorId: string): Promise<DocumentDay[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select
      extract(isodow from created_at at time zone 'Asia/Karachi')::int as dow,
      state,
      count(*)::int as n
      from public.documents
     where created_at >= now() - interval '7 days'
     group by 1, 2
  `);

  const byDow = new Map<number, { approved: number; pending: number; rejected: number }>();
  for (const row of rows as Array<Record<string, unknown>>) {
    const dow = Number(row.dow);
    const entry = byDow.get(dow) ?? { approved: 0, pending: 0, rejected: 0 };
    const state = String(row.state);
    const n = Number(row.n);
    if (state === 'approved') entry.approved += n;
    else if (state === 'pending') entry.pending += n;
    else if (state === 'rejected') entry.rejected += n;
    byDow.set(dow, entry);
  }

  /* Every weekday present, including the empty ones: a chart that silently
     drops Tuesday is a chart whose axis lies about the week. */
  return WEEKDAYS.map((label, i) => {
    const entry = byDow.get(i + 1) ?? { approved: 0, pending: 0, rejected: 0 };
    return { label, ...entry };
  });
}

export async function documentTally(actorId: string): Promise<DocumentTally> {
  const rows = await withUser(actorId, (tx) => tx`
    select state, count(*)::int as n
      from public.documents
     group by state
  `);

  const by = new Map<string, number>();
  for (const row of rows as Array<Record<string, unknown>>) {
    by.set(String(row.state), Number(row.n));
  }
  return {
    approved: by.get('approved') ?? 0,
    pending: by.get('pending') ?? 0,
    rejected: by.get('rejected') ?? 0,
  };
}

export async function systemSignals(actorId: string): Promise<SystemSignals> {
  const rows = await withUser(actorId, (tx) => tx`
    select
      (select count(*) from public.security_events
        where severity = 'critical' and created_at >= now() - interval '24 hours')::int as critical_events,
      (select count(*) from public.security_events
        where severity = 'warning' and created_at >= now() - interval '24 hours')::int as warning_events,
      (select count(*) from public.handoff_chains where is_active)::int as active_chains,
      (select count(*) from public.activity_log
        where created_at >= now() - interval '1 hour')::int as activity_last_hour
  `);

  const row = (rows[0] ?? {}) as Record<string, unknown>;
  return {
    criticalEvents: Number(row.critical_events ?? 0),
    warningEvents: Number(row.warning_events ?? 0),
    activeChains: Number(row.active_chains ?? 0),
    activityLastHour: Number(row.activity_last_hour ?? 0),
  };
}
