import {
  CAPACITY_OVERRIDE_ROLES,
  SYSTEM_DEFAULTS,
  WORKLOAD_BAND_META,
  type Priority,
  type Role,
  type TaskStatus,
  type WorkloadBand,
} from './constants';
import { isOpen, taskLoad } from './task-machine';

/* ============================================================================
 * WORKLOAD & CAPACITY ENGINE — doc 06
 * ----------------------------------------------------------------------------
 * LAYER 2. Pure. Every input arrives as an argument, including the date.
 *
 * ── THE ONE IDEA THIS FILE IS BUILT ON ───────────────────────────────────────
 * Doc 06 §1: counting tasks is the wrong measure. Ten "repost this story" jobs
 * are an hour; three ad campaigns are three days. A count says the first person
 * is three times busier. They are not.
 *
 * So load is measured in points — effort × priority × status weight — and the
 * task count survives only as a *secondary* guard, because someone at 40%
 * capacity juggling twelve things is still dysfunctional. Both, not either.
 *
 * ── WHY NOTHING HERE IS STORED ───────────────────────────────────────────────
 * Doc 20: "workload and assignment store nothing; both are fully derived." A
 * cached utilisation figure has to be invalidated by every status change, every
 * priority edit, every reassignment, every leave request and every capacity
 * adjustment. Miss one and the dashboard lies — and a workload number nobody
 * trusts is worse than no workload number, because people act on it once and
 * then stop believing it.
 *
 * It is a sum over one person's open tasks. At seven people that is trivially
 * cheap, and it is always right.
 * ========================================================================= */

export interface WorkloadTaskInput {
  readonly effortPoints: number;
  readonly priority: Priority;
  readonly status: TaskStatus;
  /** ISO date or null. Decides which week the task lands in. */
  readonly dueDate: string | null;
}

export interface AvailabilityInput {
  readonly startDate: string;
  readonly endDate: string;
  readonly capacityMultiplier: number;
}

export interface WorkloadResult {
  readonly loadPoints: number;
  readonly capacityPoints: number;
  readonly effectiveCapacityPoints: number;
  readonly utilisationPct: number;
  readonly band: WorkloadBand;
  readonly bandLabel: string;
  readonly openTaskCount: number;
  /** Tasks actually in flight — the context-switching guard. doc 06 §1. */
  readonly activeTaskCount: number;
  readonly maxConcurrentTasks: number;
  readonly atMaxConcurrent: boolean;
  /** 0 when fully available; 1 when on leave for the whole window. */
  readonly availabilityMultiplier: number;
  readonly isFullyUnavailable: boolean;
}

/* ---------------------------------------------------------------------------
 * The window
 * ------------------------------------------------------------------------- */

/**
 * The Monday–Sunday week containing `nowMs`, as ISO dates.
 *
 * Monday, not Sunday. The working week here is Mon–Sat (ADR-004), so a week that
 * began on Sunday would put the single non-working day at the *start* and split
 * nothing usefully. Sunday closes the week.
 */
export function weekWindow(nowMs: number): { start: string; end: string } {
  const d = new Date(nowMs);
  const day = d.getUTCDay(); // 0 = Sunday
  const daysSinceMonday = (day + 6) % 7;
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - daysSinceMonday);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  return { start: iso(start), end: iso(end) };
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Does this task count toward the given window?
 *
 * doc 06 §2 step 2: yes if its due date falls inside the window, **or** if it is
 * already in flight regardless of due date. The second half matters more than it
 * looks — without it, work someone is actively doing but which is due next month
 * would register as zero load, and the person actually at their limit would look
 * free.
 */
export function countsTowardWindow(
  task: WorkloadTaskInput,
  window: { start: string; end: string },
): boolean {
  if (!isOpen(task.status)) return false;
  if (task.status === 'in_progress' || task.status === 'revisions' || task.status === 'blocked') {
    return true;
  }
  if (!task.dueDate) {
    /* No due date and not started: it is real future work but not this week's.
       Backlog's 0.25 weight already expresses "real but not imminent", so
       double-discounting it by excluding it entirely would understate load. It
       counts. */
    return task.status === 'backlog';
  }
  return task.dueDate >= window.start && task.dueDate <= window.end;
}

/* ---------------------------------------------------------------------------
 * Availability — doc 06 §2 step 3
 * ------------------------------------------------------------------------- */

/**
 * The fraction of the window the person is actually available for.
 *
 * Counts *working* days only (Mon–Sat), so a Sunday holiday does not reduce
 * anyone's capacity — it was never capacity in the first place. Each absent day
 * contributes its own multiplier, which is what makes a half-day worth 0.5
 * rather than a whole day off.
 */
export function availabilityMultiplier(
  entries: readonly AvailabilityInput[],
  window: { start: string; end: string },
): number {
  const days: string[] = [];
  const cursor = new Date(`${window.start}T00:00:00Z`);
  const last = new Date(`${window.end}T00:00:00Z`);
  while (cursor <= last) {
    // 0 = Sunday, the one non-working day (ADR-004).
    if (cursor.getUTCDay() !== 0) days.push(iso(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  if (days.length === 0) return 1;

  let available = 0;
  for (const day of days) {
    /* The most restrictive overlapping entry wins. Two entries covering the same
       day is a data-entry artefact, not a licence to be doubly absent. */
    let multiplier = 1;
    for (const entry of entries) {
      if (day >= entry.startDate && day <= entry.endDate) {
        multiplier = Math.min(multiplier, clamp01(entry.capacityMultiplier));
      }
    }
    available += multiplier;
  }
  return available / days.length;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/* ---------------------------------------------------------------------------
 * The calculation
 * ------------------------------------------------------------------------- */

export function bandFor(utilisationPct: number): WorkloadBand {
  if (utilisationPct >= WORKLOAD_BAND_META.over.minPct) return 'over';
  if (utilisationPct >= WORKLOAD_BAND_META.warning.minPct) return 'warning';
  if (utilisationPct >= WORKLOAD_BAND_META.healthy.minPct) return 'healthy';
  return 'available';
}

export function computeWorkload(input: {
  tasks: readonly WorkloadTaskInput[];
  capacityPoints: number;
  maxConcurrentTasks: number;
  availability?: readonly AvailabilityInput[];
  window: { start: string; end: string };
}): WorkloadResult {
  const inWindow = input.tasks.filter((t) => countsTowardWindow(t, input.window));

  const loadPoints = round2(inWindow.reduce((sum, t) => sum + taskLoad(t), 0));

  const multiplier = input.availability
    ? availabilityMultiplier(input.availability, input.window)
    : 1;

  const capacityPoints = Math.max(0, input.capacityPoints);
  const effective = round2(capacityPoints * multiplier);

  /* Zero capacity is not 0% utilised and it is not 100% — the question does not
     apply. Someone on leave all week is excluded from recommendations entirely
     (BR-005), so the honest answer is 0 with `isFullyUnavailable` set, and the
     UI says "on leave" instead of drawing a bar. Dividing by zero here would
     produce Infinity and paint every screen red. */
  const utilisationPct = effective <= 0 ? 0 : Math.round((loadPoints / effective) * 100);

  const activeTaskCount = inWindow.filter(
    (t) => t.status === 'in_progress' || t.status === 'revisions',
  ).length;

  const band = effective <= 0 ? 'over' : bandFor(utilisationPct);

  return {
    loadPoints,
    capacityPoints,
    effectiveCapacityPoints: effective,
    utilisationPct,
    band,
    bandLabel: WORKLOAD_BAND_META[band].label,
    openTaskCount: inWindow.length,
    activeTaskCount,
    maxConcurrentTasks: input.maxConcurrentTasks,
    atMaxConcurrent: activeTaskCount >= input.maxConcurrentTasks,
    availabilityMultiplier: multiplier,
    isFullyUnavailable: effective <= 0,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/* ---------------------------------------------------------------------------
 * The assignment gate — BR-003, BR-004
 * ------------------------------------------------------------------------- */

export type AssignmentGateOutcome = 'clear' | 'warn' | 'blocked' | 'override_required';

export interface AssignmentGate {
  readonly outcome: AssignmentGateOutcome;
  /** Projected utilisation *after* this task lands. */
  readonly projectedPct: number;
  readonly message: string;
  /** True when only an Admin+ typing a reason can proceed. BR-003. */
  readonly requiresOverrideReason: boolean;
}

/**
 * "Can I give this person this task?" — doc 06 §3.
 *
 * The distinction that matters: the soft threshold **warns and proceeds**
 * (BR-004), the hard threshold **blocks** (BR-003). A system that only warns
 * trains people to click through warnings; one that only blocks gets worked
 * around. Doc 06 chose both, at different levels, and this is where that lives.
 *
 * A Team Coordinator cannot override at all — they are the role most likely to
 * be under delivery pressure and least able to authorise the consequence.
 */
export function evaluateAssignment(input: {
  current: WorkloadResult;
  incoming: WorkloadTaskInput;
  actorRole: Role;
  softThresholdPct?: number;
  hardThresholdPct?: number;
}): AssignmentGate {
  const soft = input.softThresholdPct ?? SYSTEM_DEFAULTS.softThresholdPct;
  const hard = input.hardThresholdPct ?? SYSTEM_DEFAULTS.hardThresholdPct;

  const incomingLoad = taskLoad(input.incoming);
  const effective = input.current.effectiveCapacityPoints;

  if (effective <= 0) {
    return {
      outcome: 'blocked',
      projectedPct: 0,
      message: 'This person is unavailable for the whole window and cannot take work (BR-005).',
      requiresOverrideReason: false,
    };
  }

  const projectedPct = Math.round(((input.current.loadPoints + incomingLoad) / effective) * 100);
  const canOverride = CAPACITY_OVERRIDE_ROLES.includes(input.actorRole);

  if (projectedPct >= hard) {
    return canOverride
      ? {
          outcome: 'override_required',
          projectedPct,
          message: `This puts them at ${projectedPct}% — over the limit. Type a reason to proceed; it will be logged.`,
          requiresOverrideReason: true,
        }
      : {
          outcome: 'blocked',
          projectedPct,
          message: `This puts them at ${projectedPct}%, over the limit. Only an Admin can override that.`,
          requiresOverrideReason: false,
        };
  }

  if (input.current.atMaxConcurrent) {
    return {
      outcome: 'warn',
      projectedPct,
      message: `They already have ${input.current.activeTaskCount} tasks in flight — at their limit of ${input.current.maxConcurrentTasks}. Volume is fine; attention may not be.`,
      requiresOverrideReason: false,
    };
  }

  if (projectedPct >= soft) {
    return {
      outcome: 'warn',
      projectedPct,
      message: `This puts them at ${projectedPct}% — near capacity.`,
      requiresOverrideReason: false,
    };
  }

  return {
    outcome: 'clear',
    projectedPct,
    message: `They will be at ${projectedPct}% after this.`,
    requiresOverrideReason: false,
  };
}

/** doc 06 §3: 130%+ raises an alert without anyone attempting an assignment. */
export function isCritical(result: WorkloadResult): boolean {
  return !result.isFullyUnavailable && result.utilisationPct >= SYSTEM_DEFAULTS.criticalThresholdPct;
}
