'use server';

import { revalidatePath } from 'next/cache';

import { requireUser } from '@/lib/auth/current-user';
import { withUser } from '@/lib/db/client';
import { record } from '@/lib/db/queries/feed';
import { createProject, getProject, updateProject } from '@/lib/db/queries/projects';
import {
  PROJECT_STATUSES,
  PROJECT_STATUS_REQUIRES_REASON,
  PROJECT_TYPES,
  PROJECT_TYPE_META,
  type ProjectStatus,
  type ProjectType,
} from '@/lib/domain/constants';
import { can } from '@/lib/domain/permissions';

/* ============================================================================
 * PROJECT ACTIONS — LAYER 3
 * ----------------------------------------------------------------------------
 * ── THE CODE IS DERIVED, NEVER SUBMITTED ─────────────────────────────────────
 * `code` decides the reference prefix, and the prefix is what makes `EVT-142`
 * self-describing (FR-113, Q-026). If a form could send it, a Client project
 * could be created with the code `EVT` and every task raised in it would lie
 * about what kind of work it is — permanently, because references are never
 * rewritten. So it comes from PROJECT_TYPE_META and the form cannot influence it.
 *
 * ── TYPE-SPECIFIC FIELDS ─────────────────────────────────────────────────────
 * Doc 15 §3 gives each type its own handful of fields. They are collected into
 * `type_fields` jsonb rather than forty mostly-null columns, because exactly one
 * shape is relevant to any given row. Only the keys the type declares are read,
 * so a hand-crafted POST cannot stuff arbitrary data into the column.
 * ========================================================================= */

export interface ProjectActionResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly projectId?: string;
}

const fail = (error: string): ProjectActionResult => ({ ok: false, error });

/** Doc 15 §3 — the only keys each type may carry. An allowlist, not a filter. */
const TYPE_FIELDS: Readonly<Record<ProjectType, readonly string[]>> = {
  event: ['event_date', 'venue', 'expected_scale'],
  client: [
    'client_name',
    'contact_person',
    'contact_email',
    'contact_phone',
    'engagement_type',
    'retainer_hours_per_month',
    'is_billable',
    'priority_tier',
  ],
  business: ['objective', 'area', 'target_completion'],
  self_promotion: ['channel', 'campaign_goal', 'target_publish_date'],
  other: ['requested_by', 'reason_not_a_project'],
};

function str(form: FormData, key: string): string {
  return String(form.get(key) ?? '').trim();
}

function collectTypeFields(form: FormData, type: ProjectType): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of TYPE_FIELDS[type]) {
    const value = str(form, key);
    if (value !== '') out[key] = value;
  }
  return out;
}

export async function createProjectAction(
  _prev: ProjectActionResult,
  form: FormData,
): Promise<ProjectActionResult> {
  const user = await requireUser();

  if (!can({ role: user.role, id: user.id }, 'project.create')) {
    return fail('Only an Admin can create a project (doc 03 §3.2).');
  }

  const name = str(form, 'name');
  const type = str(form, 'type') as ProjectType;
  const status = (str(form, 'status') || 'active') as ProjectStatus;
  const statusReason = str(form, 'statusReason');

  if (!name) return fail('Give the project a name.');
  if (!PROJECT_TYPES.includes(type)) return fail('Choose a project type.');
  if (!PROJECT_STATUSES.includes(status)) return fail('That is not a valid status.');

  if (PROJECT_STATUS_REQUIRES_REASON.includes(status) && !statusReason) {
    return fail('Putting a project on hold or cancelling it requires a written reason.');
  }

  try {
    const projectId = await createProject(user.id, {
      name,
      type,
      // Derived. See the header — a submitted code would make references lie.
      code: PROJECT_TYPE_META[type].code,
      description: str(form, 'description') || null,
      status,
      statusReason: statusReason || null,
      ownerId: str(form, 'ownerId') || user.id,
      startDate: str(form, 'startDate') || null,
      startTime: str(form, 'startTime') || null,
      targetEndDate: str(form, 'targetEndDate') || null,
      targetEndTime: str(form, 'targetEndTime') || null,
      typeFields: collectTypeFields(form, type),
    });

    await withUser(user.id, (tx) =>
      record(tx, user.id, {
        entityType: 'project',
        entityId: projectId,
        action: 'created',
        summary: `created the project ${name}`,
        after: { name, type, status },
      }),
    );

    revalidatePath('/projects');
    revalidatePath('/dashboard');
    return { ok: true, projectId };
  } catch (error) {
    return fail(readable(error));
  }
}

export async function updateProjectAction(
  _prev: ProjectActionResult,
  form: FormData,
): Promise<ProjectActionResult> {
  const user = await requireUser();
  const projectId = str(form, 'projectId');

  const existing = await getProject(user.id, projectId);
  if (!existing) return fail('That project is no longer available.');

  if (!can({ role: user.role, id: user.id }, 'project.edit')) {
    return fail('Only an Admin can edit a project (doc 03 §3.2).');
  }

  const status = (str(form, 'status') || existing.status) as ProjectStatus;
  const statusReason = str(form, 'statusReason');

  if (PROJECT_STATUS_REQUIRES_REASON.includes(status) && !statusReason && !existing.statusReason) {
    return fail(`Moving a project to ${status.replace('_', ' ')} requires a written reason.`);
  }

  /* Q-024: the catch-all project has to keep existing. If it could be archived,
     ad-hoc work would have nowhere to land and would go back to being invisible,
     which is the problem doc 15 exists to solve. */
  if (existing.isPermanent && (status === 'archived' || status === 'cancelled')) {
    return fail(
      'The Misc / Ad-hoc project cannot be archived — ad-hoc work has to have somewhere to land (Q-024).',
    );
  }

  try {
    await updateProject(user.id, projectId, {
      name: str(form, 'name') || existing.name,
      description: str(form, 'description') || null,
      status,
      statusReason: statusReason || existing.statusReason,
      ownerId: str(form, 'ownerId') || existing.ownerId,
      startDate: str(form, 'startDate') || null,
      startTime: str(form, 'startTime') || null,
      targetEndDate: str(form, 'targetEndDate') || null,
      targetEndTime: str(form, 'targetEndTime') || null,
      typeFields: { ...existing.typeFields, ...collectTypeFields(form, existing.type) },
    });

    await withUser(user.id, (tx) =>
      record(tx, user.id, {
        entityType: 'project',
        entityId: projectId,
        action: status === existing.status ? 'updated' : 'status_changed',
        summary:
          status === existing.status
            ? `updated the project ${existing.name}`
            : `moved ${existing.name} to ${status.replace('_', ' ')}`,
        before: { status: existing.status },
        after: { status, statusReason: statusReason || null },
      }),
    );

    revalidatePath('/projects');
    revalidatePath('/dashboard');
    return { ok: true, projectId };
  } catch (error) {
    return fail(readable(error));
  }
}

function readable(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('projects_reason_required')) {
    return 'That status needs a written reason.';
  }
  if (message.includes('projects_dates_ordered')) {
    return 'The target end date cannot be before the start date.';
  }
  if (message.includes('projects_single_permanent_idx')) {
    return 'There is already a permanent catch-all project (Q-024).';
  }
  if (message.includes('violates row-level security')) {
    return 'You do not have permission to change that.';
  }
  return 'That could not be saved. Nothing was changed.';
}
