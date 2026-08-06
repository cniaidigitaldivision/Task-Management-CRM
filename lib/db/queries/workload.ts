import 'server-only';

import { listAvailability, listPeople } from './people';
import { otherWorkShareByPerson } from './projects';
import { listOpenTasksForCapacity } from './tasks';
import {
  computeWorkload,
  weekWindow,
  type WorkloadResult,
} from '@/lib/domain/workload';
import { SYSTEM_DEFAULTS } from '@/lib/domain/constants';

/* ============================================================================
 * TEAM WORKLOAD — the composition step
 * ----------------------------------------------------------------------------
 * Not a query. It runs three queries and hands the results to
 * `lib/domain/workload.ts`, which does all the arithmetic.
 *
 * The split matters: the maths is pure and unit-tested with no database in
 * sight, and this file has no rules in it at all. If capacity ever comes out
 * wrong, there is exactly one place to look.
 *
 * ── WHY IT IS ONE PASS OVER ALL TASKS, NOT ONE QUERY PER PERSON ──────────────
 * Seven people would be seven round trips to Supabase — roughly 350ms of pure
 * latency to compute a number that is a sum. One query returns every open task
 * with an assignee and the grouping happens in memory. At this size that is
 * both simpler and an order of magnitude faster.
 *
 * Everything here respects row-level security, so a member calling it gets
 * their own figure and nobody else's — the same code path, a narrower view.
 * ========================================================================= */

export interface PersonWorkload {
  readonly userId: string;
  readonly name: string;
  readonly roleTitle: string | null;
  readonly role: string;
  readonly workload: WorkloadResult;
  /** doc 15 §6 — share of open effort that is ad-hoc "Other" work. */
  readonly otherWorkPct: number;
  /** True when Other work has passed the 15% warning line. */
  readonly otherWorkHigh: boolean;
}

export async function teamWorkload(
  actorId: string,
  nowMs: number = Date.now(),
): Promise<{ window: { start: string; end: string }; people: PersonWorkload[] }> {
  const window = weekWindow(nowMs);

  const [people, tasks, availability, otherShare] = await Promise.all([
    listPeople(actorId),
    listOpenTasksForCapacity(actorId),
    listAvailability(actorId, window),
    otherWorkShareByPerson(actorId),
  ]);

  const otherByUser = new Map(otherShare.map((row) => [row.userId, row]));

  const rows = people
    /* The Super Admin owns the system rather than carrying delivery work
       (doc 16 §2). Including that account would add 36 points of phantom
       capacity to every team utilisation figure. */
    .filter((person) => person.role !== 'super_admin')
    .map((person) => {
      const theirs = tasks.filter((t) => t.assigneeId === person.id);

      const workload = computeWorkload({
        tasks: theirs.map((t) => ({
          effortPoints: t.effortPoints,
          priority: t.priority,
          status: t.status,
          dueDate: t.dueDate,
        })),
        capacityPoints: person.weeklyCapacityPoints,
        maxConcurrentTasks: person.maxConcurrentTasks,
        availability: availability.filter((a) => a.userId === person.id),
        window,
      });

      const share = otherByUser.get(person.id);
      const otherWorkPct =
        share && share.totalPoints > 0
          ? Math.round((share.otherPoints / share.totalPoints) * 100)
          : 0;

      return {
        userId: person.id,
        name: person.fullName,
        roleTitle: person.roleTitle,
        role: person.role,
        workload,
        otherWorkPct,
        otherWorkHigh: otherWorkPct > SYSTEM_DEFAULTS.otherWorkWarningPct,
      };
    })
    /* Busiest first. A workload screen exists to answer "who is in trouble",
       and alphabetical order buries the answer in the middle. */
    .sort((a, b) => b.workload.utilisationPct - a.workload.utilisationPct);

  return { window, people: rows };
}

/** The team's own figure: total load against total effective capacity. */
export function teamUtilisation(people: readonly PersonWorkload[]): {
  loadPoints: number;
  capacityPoints: number;
  utilisationPct: number;
} {
  const loadPoints = people.reduce((sum, p) => sum + p.workload.loadPoints, 0);
  const capacityPoints = people.reduce(
    (sum, p) => sum + p.workload.effectiveCapacityPoints,
    0,
  );
  return {
    loadPoints: Math.round(loadPoints * 10) / 10,
    capacityPoints: Math.round(capacityPoints * 10) / 10,
    utilisationPct: capacityPoints > 0 ? Math.round((loadPoints / capacityPoints) * 100) : 0,
  };
}
