'use server';

import { revalidatePath } from 'next/cache';

import { requireUser } from '@/lib/auth/current-user';
import { withUser } from '@/lib/db/client';
import { audit } from '@/lib/db/queries/audit';
import { record } from '@/lib/db/queries/feed';
import {
  addAvailability,
  getPerson,
  removeUserSkill,
  setTheme,
  setUserSkill,
  updateCapacity,
  updateOwnProfile,
} from '@/lib/db/queries/people';
import {
  AVAILABILITY_TYPES,
  ROLE_LABEL,
  THEMES,
  type AvailabilityType,
  type Theme,
} from '@/lib/domain/constants';
import { can } from '@/lib/domain/permissions';

/* ============================================================================
 * PEOPLE ACTIONS — LAYER 3
 * ----------------------------------------------------------------------------
 * ── WHY NONE OF THESE CREATE AN ACCOUNT ──────────────────────────────────────
 * Provisioning a person is a *credential* operation, not a profile edit: it
 * needs an invitation token, a 48-hour expiry, an activation ceremony and an
 * email that actually arrives (FR-141 to FR-144, doc 16 §3). That is Step 5.2,
 * and doing half of it here — creating a row somebody cannot sign in to — would
 * be worse than not doing it, because the account would look real.
 *
 * So these actions edit people who already exist: capacity, concurrency limit,
 * job title, skills, leave, and the person's own profile and theme.
 *
 * ── THE SUPER ADMIN IS UNTOUCHABLE, AND NOT BECAUSE OF THIS FILE ──────────────
 * Migration 005's trigger refuses any foreign write to a `super_admin` row.
 * These actions do not need to check for it and deliberately do not pretend to:
 * the guarantee is in the database, where it holds even when the application is
 * wrong (BR-027, FR-140).
 * ========================================================================= */

export interface PeopleActionResult {
  readonly ok: boolean;
  readonly error?: string;
}

const fail = (error: string): PeopleActionResult => ({ ok: false, error });

function str(form: FormData, key: string): string {
  return String(form.get(key) ?? '').trim();
}

function num(form: FormData, key: string): number | undefined {
  const raw = str(form, key);
  if (raw === '') return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

/* ==========================================================================
 * Capacity, concurrency and job title — Admin+ (doc 03 §3.1)
 * ========================================================================== */

export async function updateCapacityAction(
  _prev: PeopleActionResult,
  form: FormData,
): Promise<PeopleActionResult> {
  const user = await requireUser();
  const userId = str(form, 'userId');

  const target = await getPerson(user.id, userId);
  if (!target) return fail('That person is no longer available.');

  if (
    !can({ role: user.role, id: user.id }, 'user.set_capacity_and_skills', {
      ownerId: target.id,
      ownerRole: target.role,
    })
  ) {
    return fail('Only an Admin can change capacity and skills (doc 03 §3.1).');
  }

  const capacity = num(form, 'weeklyCapacityPoints');
  const maxTasks = num(form, 'maxConcurrentTasks');

  /* ADR-004 is the reason for the upper bound. 48 is the *attendance* week;
     capacity is 36 because breaks, briefs, calls, context switching and render
     waits take roughly a quarter of it. Allowing 48 here would leave every
     threshold permanently silent, which is the most common way a workload
     system fails — it looks configured and warns about nothing. */
  if (capacity !== undefined && (capacity < 1 || capacity > 48)) {
    return fail(
      'Weekly capacity has to be between 1 and 48 points. 36 is the default — 48 attendance hours are not 48 productive hours (ADR-004).',
    );
  }
  if (maxTasks !== undefined && (maxTasks < 1 || maxTasks > 20)) {
    return fail('The concurrent-task limit has to be between 1 and 20.');
  }

  try {
    await updateCapacity(user.id, userId, {
      weeklyCapacityPoints: capacity,
      maxConcurrentTasks: maxTasks,
      roleTitle: str(form, 'roleTitle') || null,
    });

    await withUser(user.id, async (tx) => {
      await audit(tx, user, {
        entityType: 'user',
        entityId: userId,
        action: 'user.capacity_changed',
        before: {
          weeklyCapacityPoints: target.weeklyCapacityPoints,
          maxConcurrentTasks: target.maxConcurrentTasks,
        },
        after: {
          weeklyCapacityPoints: capacity ?? target.weeklyCapacityPoints,
          maxConcurrentTasks: maxTasks ?? target.maxConcurrentTasks,
        },
      });
      await record(tx, user.id, {
        entityType: 'user',
        entityId: userId,
        action: 'capacity_changed',
        summary: `updated ${target.fullName}'s capacity`,
        before: {
          weeklyCapacityPoints: target.weeklyCapacityPoints,
          maxConcurrentTasks: target.maxConcurrentTasks,
          roleTitle: target.roleTitle,
        },
        after: {
          weeklyCapacityPoints: capacity ?? target.weeklyCapacityPoints,
          maxConcurrentTasks: maxTasks ?? target.maxConcurrentTasks,
          roleTitle: str(form, 'roleTitle') || null,
        },
      });
    });

    revalidatePath('/team');
    revalidatePath('/workload');
    revalidatePath('/dashboard');
    return { ok: true };
  } catch {
    /* The most likely cause is the migration-005 trigger refusing a write to the
       Super Admin row. Say what happened rather than leaking the SQL. */
    return fail(
      `That change was refused. The Super Admin row cannot be altered by anyone else (BR-027), and an ${ROLE_LABEL[user.role]} can only manage people below them.`,
    );
  }
}

/* ==========================================================================
 * Skills — FR-012
 * ========================================================================== */

export async function setSkillAction(
  userId: string,
  skillId: string,
  proficiency: number,
  isPrimary = false,
): Promise<PeopleActionResult> {
  const user = await requireUser();
  const target = await getPerson(user.id, userId);
  if (!target) return fail('That person is no longer available.');

  if (
    !can({ role: user.role, id: user.id }, 'user.set_capacity_and_skills', {
      ownerId: target.id,
      ownerRole: target.role,
    })
  ) {
    return fail('Only an Admin can set skills.');
  }
  if (!Number.isInteger(proficiency) || proficiency < 1 || proficiency > 5) {
    return fail('Proficiency runs 1 to 5 — 5 is expert, 3 is capable, 1 is can-help.');
  }

  await setUserSkill(user.id, { userId, skillId, proficiency, isPrimary });
  revalidatePath('/team');
  return { ok: true };
}

export async function removeSkillAction(
  userId: string,
  skillId: string,
): Promise<PeopleActionResult> {
  const user = await requireUser();
  const target = await getPerson(user.id, userId);
  if (!target) return fail('That person is no longer available.');

  if (
    !can({ role: user.role, id: user.id }, 'user.set_capacity_and_skills', {
      ownerId: target.id,
      ownerRole: target.role,
    })
  ) {
    return fail('Only an Admin can set skills.');
  }

  await removeUserSkill(user.id, userId, skillId);
  revalidatePath('/team');
  return { ok: true };
}

/* ==========================================================================
 * Leave and availability — FR-014
 * ========================================================================== */

export async function addAvailabilityAction(
  _prev: PeopleActionResult,
  form: FormData,
): Promise<PeopleActionResult> {
  const user = await requireUser();
  const userId = str(form, 'userId') || user.id;
  const type = str(form, 'type') as AvailabilityType;
  const startDate = str(form, 'startDate');
  const endDate = str(form, 'endDate') || startDate;

  if (!AVAILABILITY_TYPES.includes(type)) return fail('Choose a type of absence.');
  if (!startDate) return fail('Give a start date.');
  if (endDate < startDate) return fail('The end date cannot be before the start date.');

  /* A half day is half a day. Anything else is fully out, and doc 06 §2 excludes
     a fully-unavailable person from recommendations entirely (BR-005). */
  const multiplier = type === 'half_day' ? 0.5 : 0;

  try {
    await addAvailability(user.id, {
      userId,
      startDate,
      endDate,
      type,
      capacityMultiplier: multiplier,
      note: str(form, 'note') || null,
    });

    await withUser(user.id, (tx) =>
      record(tx, user.id, {
        entityType: 'user',
        entityId: userId,
        action: 'availability_added',
        summary: `recorded ${type.replace('_', ' ')} from ${startDate} to ${endDate}`,
        after: { type, startDate, endDate, multiplier },
      }),
    );

    revalidatePath('/team');
    revalidatePath('/workload');
    revalidatePath('/my-work');
    return { ok: true };
  } catch {
    return fail('That could not be saved. You can only record leave for yourself or your team.');
  }
}

/* ==========================================================================
 * Your own profile
 * ========================================================================== */

export async function updateProfileAction(
  _prev: PeopleActionResult,
  form: FormData,
): Promise<PeopleActionResult> {
  const user = await requireUser();

  const fullName = str(form, 'fullName');
  if (!fullName) return fail('Your name cannot be blank.');
  if (fullName.length > 120) return fail('That name is too long.');

  try {
    await updateOwnProfile(user.id, {
      fullName,
      phone: str(form, 'phone') || null,
      timezone: str(form, 'timezone') || undefined,
    });
    revalidatePath('/profile');
    revalidatePath('/', 'layout');
    return { ok: true };
  } catch {
    return fail('That could not be saved.');
  }
}

/**
 * FR-202 — the theme follows the person, not the browser.
 *
 * The toggle still writes localStorage for the pre-paint script (there is no way
 * to avoid a flash otherwise: the database cannot be consulted before the first
 * paint). This persists the same choice so a new device starts correct.
 */
export async function setThemeAction(theme: Theme): Promise<PeopleActionResult> {
  const user = await requireUser();
  if (!THEMES.includes(theme)) return fail('Unknown theme.');
  await setTheme(user.id, theme);
  return { ok: true };
}
