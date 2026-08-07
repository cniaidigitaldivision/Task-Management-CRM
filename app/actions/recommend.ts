'use server';

import { requireUser } from '@/lib/auth/current-user';
import { gatherCandidates, skillKeywords } from '@/lib/db/queries/recommendation';
import { listTaskSkills } from '@/lib/db/queries/task-relations';
import { getTask } from '@/lib/db/queries/tasks';
import { EFFORT_POINTS, type EffortSize, type Priority } from '@/lib/domain/constants';
import { can } from '@/lib/domain/permissions';
import {
  inferSkills,
  recommend,
  type RecommendationResult,
  type RequiredSkill,
} from '@/lib/domain/recommendation';
import { taskLoad } from '@/lib/domain/task-machine';
import { getSettings } from '@/lib/settings/current';
import { nowMs } from '@/lib/now';

/* ============================================================================
 * WHO SHOULD TAKE THIS — doc 07
 * ----------------------------------------------------------------------------
 * Gathers, scores, ranks. Assigns nobody: the caller still presses the button,
 * and the capacity gate in app/actions/tasks.ts still has the final word. A
 * recommendation that assigned on acceptance would make the block in BR-003
 * reachable through a second door.
 * ========================================================================= */

export interface RecommendPayload extends RecommendationResult {
  readonly ok: boolean;
  readonly error?: string;
  /** Skills guessed from the wording, offered for tagging (FR-055). */
  readonly inferred: Array<{ skillId: string; label: string; matched: string }>;
  /** True when the score used guessed skills because none were tagged. */
  readonly usedInference: boolean;
}

const empty = (error: string): RecommendPayload => ({
  ok: false,
  error,
  ranked: [],
  noGoodMatch: false,
  advice: [],
  skillGaps: [],
  inferred: [],
  usedInference: false,
});

/** For a task that already exists — the assign control on the detail drawer. */
export async function recommendForTaskAction(taskId: string): Promise<RecommendPayload> {
  const user = await requireUser();

  if (!can({ role: user.role, id: user.id }, 'task.assign')) {
    return empty('Coordinators and above assign work.');
  }

  const task = await getTask(user.id, taskId);
  if (!task) return empty('That task no longer exists.');

  const tagged = await listTaskSkills(user.id, taskId);

  return score(user.id, {
    projectId: task.projectId,
    dueDate: task.dueDate,
    loadPoints: taskLoad({
      effortPoints: task.effortPoints,
      priority: task.priority,
      status: task.status,
    }),
    taggedSkills: tagged.map((s) => ({ skillId: s.skillId, label: s.label, weight: s.weight })),
    text: `${task.title} ${task.description ?? ''}`,
  });
}

/** For a task not yet created — the new-task dialog, as they fill it in. */
export async function recommendForDraftAction(input: {
  projectId: string;
  dueDate: string | null;
  effortSize: string;
  priority: string;
  title: string;
  description?: string;
}): Promise<RecommendPayload> {
  const user = await requireUser();

  if (!can({ role: user.role, id: user.id }, 'task.assign')) {
    return empty('Coordinators and above assign work.');
  }
  if (!input.projectId) return empty('Choose a project first.');

  const points = EFFORT_POINTS[input.effortSize as EffortSize];
  if (!points) return empty('Choose an effort estimate first.');

  return score(user.id, {
    projectId: input.projectId,
    dueDate: input.dueDate,
    loadPoints: taskLoad({
      effortPoints: points,
      priority: input.priority as Priority,
      /* A task being planned is scored as though it were already in flight.
         Scoring it as backlog — weight 0.25 — would understate its cost by
         three quarters and recommend somebody who cannot actually take it. */
      status: 'todo',
    }),
    taggedSkills: [],
    text: `${input.title} ${input.description ?? ''}`,
  });
}

async function score(
  actorId: string,
  input: {
    projectId: string;
    dueDate: string | null;
    loadPoints: number;
    taggedSkills: RequiredSkill[];
    text: string;
  },
): Promise<RecommendPayload> {
  const now = nowMs();

  const [inputs, library, settings] = await Promise.all([
    gatherCandidates(actorId, {
      projectId: input.projectId,
      dueDate: input.dueDate,
      nowMs: now,
    }),
    skillKeywords(actorId),
    getSettings(),
  ]);

  /* FR-055. The guess only fills in when nothing is tagged — it never
     overrides a deliberate choice, and it is reported separately so the panel
     can say "scored as if this needs video editing; tag it?" rather than
     quietly ranking against something nobody asked for. */
  const inferred = input.taggedSkills.length === 0 ? inferSkills(input.text, library) : [];
  const usedInference = inferred.length > 0;

  const requiredSkills: RequiredSkill[] = usedInference
    ? inferred.map((match) => ({ skillId: match.skillId, label: match.label, weight: 2 }))
    : input.taggedSkills;

  const daysToDue = input.dueDate
    ? Math.round(
        (Date.parse(`${input.dueDate}T00:00:00Z`) -
          Date.UTC(
            new Date(now).getUTCFullYear(),
            new Date(now).getUTCMonth(),
            new Date(now).getUTCDate(),
          )) /
          86_400_000,
      )
    : null;

  const result = recommend(
    inputs.candidates,
    { requiredSkills, loadPoints: input.loadPoints, daysToDue },
    {
      totalRecentAssignments: inputs.totalRecentAssignments,
      teamSize: inputs.teamSize,
      softThresholdPct: Number(settings.softThresholdPct),
      hardThresholdPct: Number(settings.hardThresholdPct),
      /* The Super Admin's weights, if they have changed any. The engine and the
         settings screen must not disagree about what the team values. */
      weights: settings.scoringWeights as never,
    },
  );

  return { ok: true, ...result, inferred, usedInference };
}
