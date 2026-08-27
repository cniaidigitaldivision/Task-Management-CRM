/* ============================================================================
 * THE DASHBOARD, AS NUMBERS
 * ----------------------------------------------------------------------------
 * Owner, 2026-08-25: *"redesign the whole dashboard… full of animations, 3D
 * views, moving charts… everything should be live over there and full of
 * interaction."*
 *
 * ── ⚠️ WHY AN ANIMATED DASHBOARD NEEDS ITS ARITHMETIC PULLED OUT ────────────
 * Every figure on the new page is now filterable: pick a project, pick a period,
 * and the KPI tiles, the trend, the 3D columns, the ring, the performer ranking
 * and the platform breakdown must all re-derive together. That is six views of
 * one filtered set — exactly the shape that produced a card disagreeing with the
 * table beneath it on the reports page, and again on attendance.
 *
 * So the filtering and the aggregation happen HERE, once, over plain arrays, and
 * each view is a projection. A component that animates a number it also computes
 * is a component where a wrong number is indistinguishable from a mid-animation
 * frame.
 *
 * ── ⚠️ STRUCTURAL INPUT TYPES, NOT THE DB ROWS ──────────────────────────────
 * Everything below takes the narrowest shape it actually reads. The same rule as
 * lib/view/attendance-board.ts: it keeps this file unit-testable without a
 * database, and it means a column added to `tasks` cannot change what the
 * dashboard counts.
 * ========================================================================= */

/**
 * The slice of a task view this file reads.
 *
 * ⚠️ It carries display fields (`reference`, `title`, `blockedReason`) as well as
 * the ones the arithmetic needs, because the dashboard's filter has to narrow the
 * "needs a decision" LIST and the charts together. Passing two differently-shaped
 * arrays across the server/client boundary — one to count, one to render — is two
 * things that can fall out of step, and the whole point of this module is that
 * every view is a projection of one set.
 */
export interface DashTask {
  readonly id: string;
  readonly reference: string;
  readonly title: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly projectType: string;
  readonly assigneeId: string | null;
  readonly assignee: string;
  readonly assigneeAvatarUrl: string | null;
  readonly status: string;
  readonly priority: string;
  readonly effortPoints: number;
  readonly overdue: boolean;
  readonly timeSpentMinutes: number;
  readonly timeLimitMinutes: number;
  readonly blockedReason: string | null;
  /** `Completed …` for work that closed recently — see `toTaskView`. */
  readonly dueLabel: string;
}

/**
 * What needs somebody today, in the order a lead triages it.
 *
 * Blocked work is stopped and costing money, an overdue item is already late, and
 * a review is a person waiting on you. Capped, because a list of everything is not
 * a list of priorities.
 *
 * ⚠️ De-duplicated by id. A task can be blocked AND overdue, and the first
 * version of this list showed it twice — once under each reason.
 */
export function needsDecision(tasks: readonly DashTask[], limit = 8): DashTask[] {
  const open = tasks.filter(isOpen);
  const ordered = [
    ...open.filter((t) => t.status === 'blocked'),
    ...open.filter((t) => t.overdue),
    ...open.filter((t) => t.status === 'in_review'),
  ];
  const seen = new Set<string>();
  const out: DashTask[] = [];
  for (const task of ordered) {
    if (seen.has(task.id)) continue;
    seen.add(task.id);
    out.push(task);
    if (out.length === limit) break;
  }
  return out;
}

export interface DashProject {
  readonly id: string;
  readonly name: string;
  readonly taskCount: number;
  readonly openTaskCount: number;
  readonly doneTaskCount: number;
  readonly overdueTaskCount: number;
  readonly effortPoints: number;
}

export interface DashWeek {
  readonly weekStart: string;
  readonly created: number;
  readonly completed: number;
}

/* Statuses that mean "this work is finished with", in one place. Counting a
   cancelled task as open is the difference between a backlog and a graveyard. */
const CLOSED = new Set(['done', 'cancelled']);

export function isOpen(task: DashTask): boolean {
  return !CLOSED.has(task.status);
}

/* ---------------------------------------------------------------------------
 * The filter
 * ------------------------------------------------------------------------- */

export interface DashFilters {
  /** A project id, or `all`. */
  readonly project: string;
  /** A task status, or `all`. Applies to the open set only — see below. */
  readonly status: string;
}

export const NO_DASH_FILTERS: DashFilters = { project: 'all', status: 'all' };

/**
 * Narrow the task set the whole page is computed from.
 *
 * ⚠️ ONE function, called ONCE, by the page. Every projection below then takes
 * the result. Filtering inside each projection instead is how the ring ends up
 * describing a different set from the columns beside it — and with six views
 * that is six places to forget.
 */
export function filterDashTasks(
  tasks: readonly DashTask[],
  filters: DashFilters,
): DashTask[] {
  return tasks.filter((task) => {
    if (filters.project !== 'all' && task.projectId !== filters.project) return false;
    if (filters.status !== 'all' && task.status !== filters.status) return false;
    return true;
  });
}

/* ---------------------------------------------------------------------------
 * Who is finishing work
 * ------------------------------------------------------------------------- */

export interface Performer {
  readonly userId: string;
  readonly name: string;
  readonly avatarUrl: string | null;
  /** Tasks this person has closed as done, in the filtered set. */
  readonly done: number;
  /** Effort points behind those tasks — volume, not just count. */
  readonly points: number;
  /** Share of all done work in the set, 0–100 to one decimal. */
  readonly sharePct: number;
}

/**
 * The reference's "Top Performers (Tasks Done)".
 *
 * ── ⚠️ COUNTED FROM `done`, NEVER FROM `assignee` ALONE ─────────────────────
 * The obvious implementation — group every task by assignee — ranks whoever was
 * given the most work, which is close to the opposite of what the heading claims.
 * A person holding twenty untouched tasks would top a "tasks done" board.
 *
 * ⚠️ Unassigned work is dropped rather than bucketed under "Somebody". It is real
 * completed work, so it stays in the totals; it is just not a person, and a
 * leaderboard row for nobody invites the question of who that is.
 */
export function topPerformers(tasks: readonly DashTask[], limit = 5): Performer[] {
  const by = new Map<string, { name: string; avatarUrl: string | null; done: number; points: number }>();

  let total = 0;
  for (const task of tasks) {
    if (task.status !== 'done') continue;
    total += 1;
    if (task.assigneeId === null) continue;
    const entry = by.get(task.assigneeId) ?? {
      name: task.assignee,
      avatarUrl: task.assigneeAvatarUrl,
      done: 0,
      points: 0,
    };
    entry.done += 1;
    entry.points += Number.isFinite(task.effortPoints) ? task.effortPoints : 0;
    by.set(task.assigneeId, entry);
  }

  return [...by.entries()]
    .map(([userId, entry]) => ({
      userId,
      name: entry.name,
      avatarUrl: entry.avatarUrl,
      done: entry.done,
      points: entry.points,
      /* ⚠️ Against ALL done work including unassigned, so the shares describe the
         division rather than only the people on the board. They therefore need
         not reach 100%, which is honest. */
      sharePct: total === 0 ? 0 : Math.round((entry.done / total) * 1000) / 10,
    }))
    .sort((a, b) => b.done - a.done || b.points - a.points || a.name.localeCompare(b.name))
    .slice(0, limit);
}

/* ---------------------------------------------------------------------------
 * Where the work lives
 * ------------------------------------------------------------------------- */

export interface ProjectColumn {
  readonly id: string;
  readonly name: string;
  readonly done: number;
  readonly open: number;
  readonly overdue: number;
  readonly total: number;
  /** Percent complete, 0–100. */
  readonly donePct: number;
}

/**
 * The reference's "Tasks by Project" — a stacked column per project.
 *
 * Built from the TASKS rather than from `projects.doneTaskCount`, because this
 * has to follow the page's filters and those counts are pre-aggregated over
 * everything. The project list only supplies names and ordering.
 *
 * ⚠️ `overdue` is a subset of `open`, not a third bucket — a late task is still
 * open. It is returned separately for the colour, and `open` already excludes it
 * so the three numbers stack to the total instead of over-counting the lates.
 */
export function projectColumns(
  tasks: readonly DashTask[],
  projects: readonly DashProject[],
  limit = 6,
): ProjectColumn[] {
  const by = new Map<string, { name: string; done: number; open: number; overdue: number }>();

  const nameOf = new Map(projects.map((p) => [p.id, p.name]));
  for (const task of tasks) {
    const entry = by.get(task.projectId) ?? {
      name: nameOf.get(task.projectId) ?? task.projectName,
      done: 0,
      open: 0,
      overdue: 0,
    };
    if (task.status === 'done') entry.done += 1;
    else if (task.status === 'cancelled') {
      /* Cancelled work is neither done nor outstanding. Left out of all three
         buckets on purpose — a column that grows when work is abandoned reads as
         progress. */
    } else if (task.overdue) entry.overdue += 1;
    else entry.open += 1;
    by.set(task.projectId, entry);
  }

  return [...by.entries()]
    .map(([id, entry]) => {
      const total = entry.done + entry.open + entry.overdue;
      return {
        id,
        name: entry.name,
        done: entry.done,
        open: entry.open,
        overdue: entry.overdue,
        total,
        donePct: total === 0 ? 0 : Math.round((entry.done / total) * 100),
      };
    })
    .filter((column) => column.total > 0)
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
    .slice(0, limit);
}

/* ---------------------------------------------------------------------------
 * Where it was published
 * ------------------------------------------------------------------------- */

export interface PlatformTotal {
  readonly slug: string;
  readonly count: number;
  readonly sharePct: number;
}

/**
 * The reference's "Posts by Platform".
 *
 * ⚠️ Restricted to the filtered task ids, so this card follows the page like
 * every other. `platformSlugsByTask` has already de-duplicated a task published
 * to one platform twice — see its own note — so this is a straight count.
 */
export function platformTotals(
  slugsByTask: ReadonlyMap<string, readonly string[]>,
  tasks: readonly DashTask[],
  limit = 6,
): PlatformTotal[] {
  const counts = new Map<string, number>();
  let total = 0;
  for (const task of tasks) {
    for (const slug of slugsByTask.get(task.id) ?? []) {
      counts.set(slug, (counts.get(slug) ?? 0) + 1);
      total += 1;
    }
  }

  return [...counts.entries()]
    .map(([slug, count]) => ({
      slug,
      count,
      sharePct: total === 0 ? 0 : Math.round((count / total) * 1000) / 10,
    }))
    .sort((a, b) => b.count - a.count || a.slug.localeCompare(b.slug))
    .slice(0, limit);
}

/* ---------------------------------------------------------------------------
 * Movement
 * ------------------------------------------------------------------------- */

export interface Delta {
  /** Percent change against the previous period, rounded to one decimal. */
  readonly pct: number;
  readonly direction: 'up' | 'down';
  /** Whether this movement is good news — the CALLER decides, per metric. */
  readonly good: boolean;
  /** `+18.5%`, ready to print. */
  readonly label: string;
}

/**
 * The reference's `+18.5% vs last month` chip.
 *
 * ── ⚠️ A RISE IS NOT AUTOMATICALLY GOOD ─────────────────────────────────────
 * More completed work is up and good; more overdue work is up and bad. `higherIsBetter`
 * is therefore required rather than defaulted — the same reasoning as `TrendPill`,
 * where colouring by direction alone is described as how dashboards end up lying.
 *
 * ⚠️ Growth from zero is reported as a direction and NO percentage. "+∞%" and
 * "+100%" are both wrong for 0 → 4, and the second is worse because it looks
 * like a real figure. `pct` is 0 and the label says `new`.
 *
 * ── ⚠️ AND NEITHER IS "+1680%" ──────────────────────────────────────────────
 * That is a real figure this shipped: 15 tasks created in four weeks against 1
 * in the four before, on a division whose history had only just started being
 * recorded. It is arithmetically correct and it is nonsense as a MEASUREMENT —
 * the previous window is too small a base to divide by, so the number describes
 * the emptiness of the old period rather than the health of the new one.
 *
 * TWO guards, because they catch different faults:
 *
 *   · MIN_BASE — the previous window is too small to divide by at all. 18 vs 1
 *     is not "+1700% growth", it is "there was almost nothing before".
 *
 *   · MAX_RATIO — the move is so large that the percentage stops informing.
 *     267 vs 15 really is +1680%, arithmetically, and it is still the wrong
 *     thing to print on a tile: nobody reads past the first two digits, and it
 *     crowds out the figure it is meant to qualify. Past a fivefold change the
 *     honest summary is "×18", which is short, exact and instantly legible.
 *
 * Both were found on screen rather than in a test — the first as "+1680%" on a
 * dashboard whose history had only just begun.
 */
const MIN_BASE = 5;
const MAX_RATIO = 5;

export function delta(current: number, previous: number, higherIsBetter: boolean): Delta {
  const up = current >= previous;
  const good = higherIsBetter ? up : !up;

  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) {
    return {
      pct: 0,
      direction: up ? 'up' : 'down',
      good,
      label: current === previous ? 'no change' : up ? 'new' : 'none left',
    };
  }

  if (Math.abs(previous) < MIN_BASE) {
    return {
      pct: 0,
      direction: up ? 'up' : 'down',
      good,
      /* Says what happened without inventing a ratio: the reader can see both
         figures on the tile and judge the move themselves. */
      label: current === previous ? 'no change' : up ? 'up from few' : 'down from few',
    };
  }

  const ratio = current / Math.abs(previous);
  const pct = Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;

  /* A very large move reads better as a multiple than as a percentage — see
     MAX_RATIO. `pct` is still returned intact, so a caller that wants the raw
     figure (an export, a tooltip) is not deprived of it. */
  if (ratio >= MAX_RATIO) {
    return { pct, direction: 'up', good, label: `×${Math.round(ratio)}` };
  }
  if (ratio > 0 && ratio <= 1 / MAX_RATIO) {
    return { pct, direction: 'down', good, label: `÷${Math.round(1 / ratio)}` };
  }

  return {
    pct,
    direction: up ? 'up' : 'down',
    good,
    label: `${pct > 0 ? '+' : ''}${pct}%`,
  };
}

/**
 * Split a weekly series into "this period" and "the one before it", for `delta`.
 *
 * ⚠️ Both halves are the same LENGTH. Comparing the last 4 weeks against
 * everything before them would put a 4-week sum against a 20-week one and report
 * an 80% collapse every time the history got longer.
 */
export function periodTotals(
  weeks: readonly DashWeek[],
  span: number,
  pick: (week: DashWeek) => number,
): { current: number; previous: number } {
  const size = Math.max(1, Math.min(span, weeks.length));
  const sum = (list: readonly DashWeek[]) => list.reduce((a, w) => a + (Number.isFinite(pick(w)) ? pick(w) : 0), 0);
  return {
    current: sum(weeks.slice(-size)),
    previous: sum(weeks.slice(-size * 2, -size)),
  };
}

/** The last `span` weeks, for the trend chart's own window. */
export function lastWeeks(weeks: readonly DashWeek[], span: number): DashWeek[] {
  return weeks.slice(-Math.max(1, span));
}
