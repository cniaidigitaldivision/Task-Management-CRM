import 'server-only';

import { dateOnly } from '../row-values';

import type { AvailabilityType, Role, Theme } from '@/lib/domain/constants';

import { withUser } from '../client';
import type { AvailabilityRow, PersonRow, SkillRow, UserSkillRow } from './types';

/* ============================================================================
 * PEOPLE QUERIES — LAYER 1
 * ----------------------------------------------------------------------------
 * ADR-003 is enforced by migration 005's policies on `users`, not here: a member
 * reading this table sees their own row and nothing else. So `listPeople()`
 * returns the whole team for a Coordinator and exactly one row for a member,
 * from the same code path, with no branch anywhere in this file.
 *
 * That is worth stating plainly because it looks like a bug on first reading.
 * The absence of a `where` clause is the point. A visibility filter here would
 * be a second implementation of the rule — and the one that ran second would be
 * the one everybody trusted.
 * ========================================================================= */

function toPerson(row: Record<string, unknown>): PersonRow {
  return {
    id: row.id as string,
    fullName: row.full_name as string,
    email: row.email as string,
    role: row.role as Role,
    roleTitle: (row.role_title as string | null) ?? null,
    accountState: row.account_state as string,
    isActive: row.is_active as boolean,
    avatarUrl: (row.avatar_url as string | null) ?? null,
    weeklyCapacityPoints: Number(row.weekly_capacity_points ?? 36),
    maxConcurrentTasks: Number(row.max_concurrent_tasks ?? 5),
    timezone: row.timezone as string,
    lastLoginAt: iso(row.last_login_at),
    lockedAt: iso(row.locked_at),
    createdAt: iso(row.created_at) ?? '',
  };
}

function iso(value: unknown): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

export async function listPeople(
  actorId: string,
  options: { includeInactive?: boolean } = {},
): Promise<PersonRow[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select * from public.users
     where ${options.includeInactive ? tx`true` : tx`is_active`}
     order by
       case role when 'super_admin' then 0 when 'admin' then 1
                 when 'team_coordinator' then 2 else 3 end,
       full_name
  `);
  return rows.map(toPerson);
}

export async function getPerson(actorId: string, userId: string): Promise<PersonRow | null> {
  const rows = await withUser(actorId, (tx) => tx`select * from public.users where id = ${userId}`);
  return rows[0] ? toPerson(rows[0]) : null;
}

/**
 * Who can be given work: active, not the Super Admin.
 *
 * The Super Admin is excluded deliberately. Doc 16 §2 makes that account the
 * owner of the system rather than a member of the delivery team, and putting it
 * in the assignee list means its capacity starts appearing in workload reports —
 * which quietly inflates the team's apparent headroom.
 */
/* ── ⚠️ WORK FLOWS DOWNWARD — owner instruction, 2026-08-23 ──────────────────
   *"a lower-level person could not assign a task to an upper-level person… the
   team coordinator can assign a task to all team members except the admin and
   super admin."*

   This was `role <> 'super_admin'`: a blunt exclusion that hid one person from
   everybody, including from themselves, and did nothing about the case the
   owner actually named — a Coordinator putting work on an Admin.

   The rank comparison says the whole rule in one line, and says it in the same
   direction as `canAssignTo` in lib/domain/permissions.ts. Filtering HERE rather
   than in each component means the task dialog, the bulk bar's "Assign to…" and
   anything added later all inherit it without knowing it exists.

   ⚠️ Still not the boundary. `rankGate` in app/actions/tasks.ts re-checks every
   assignment server-side, because a list that omits a name is convenience and a
   hand-written POST is not bound by it (registry C-21). */
export async function listAssignablepeople(actorId: string): Promise<PersonRow[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select * from public.users u
     where u.is_active
       and u.account_state = 'active'
       and app.role_rank(u.role) <= app.role_rank(app.current_user_role())
     order by u.full_name
  `);
  return rows.map(toPerson);
}

/* ---- Profile and preferences ---- */

export async function updateOwnProfile(
  actorId: string,
  input: { fullName?: string; phone?: string | null; timezone?: string; theme?: Theme },
): Promise<void> {
  const has = (k: keyof typeof input) => Object.hasOwn(input, k);
  await withUser(actorId, (tx) => tx`
    update public.users set
      full_name = case when ${has('fullName')} then ${input.fullName ?? null} else full_name end,
      phone     = case when ${has('phone')} then ${input.phone ?? null} else phone end,
      timezone  = case when ${has('timezone')} then ${input.timezone ?? null} else timezone end,
      theme     = case when ${has('theme')} then ${input.theme ?? null}::public.theme_preference else theme end
    where id = ${actorId}
  `);
}

/**
 * Change your own sign-in address.
 *
 * ── WHY THIS IS NOT A FIELD ON `updateOwnProfile` ────────────────────────────
 * Name, phone and timezone are labels. This is the identity `app.auth_find_identity`
 * looks the account up by — get it wrong and there is no way back in. It gets its
 * own statement, its own ceremony (step-up, in the action above this) and its own
 * alert, and it can never be changed as a side effect of saving a phone number.
 *
 * ── THE OLD ADDRESS COMES BACK FROM A CTE, NOT A SECOND SELECT ───────────────
 * The alert has to name the address that was actually replaced, so the old value
 * must be captured atomically with the change. A `select` before the `update` is
 * two round trips with a gap in between; a subquery inside `RETURNING` would
 * work only because of a snapshot rule subtle enough that the next person to
 * read it would reasonably assume it was a bug.
 *
 * A data-modifying CTE is neither. `previous` is evaluated against the
 * statement's snapshot — that is documented, not incidental — so it holds the
 * pre-update value, and the whole thing is one round trip. (Postgres 18's
 * `RETURNING OLD.email` says this in one word; Supabase is not there yet.)
 *
 * ── COLLISIONS COME BACK AS 23505, AND THAT IS THE ONLY WAY TO SEE THEM ──────
 * `users_email_key` is a unique index. Checking first is not an option: RLS on
 * `users` shows a Member exactly one row — their own — so a "is this address
 * taken?" select would answer "no" for every address in the system except their
 * own. The database is the only thing that can see the whole column, so the
 * caller maps the unique violation rather than pre-empting it.
 */
export async function changeOwnEmail(
  actorId: string,
  newEmail: string,
): Promise<{ previousEmail: string } | null> {
  const rows = await withUser(actorId, (tx) => tx`
    with previous as (
      select id, email from public.users where id = ${actorId}
    )
    update public.users u
       set email = ${newEmail}
      from previous p
     where u.id = p.id
    returning p.email as previous_email
  `);

  const previous = rows[0]?.previous_email as string | undefined;
  return previous === undefined ? null : { previousEmail: previous };
}

/**
 * FR-202: the theme follows the person, not the browser.
 *
 * Kept separate from updateOwnProfile because the theme toggle fires on a click
 * and must not carry the risk of touching a name or a timezone. One column, one
 * statement.
 */
export async function setTheme(actorId: string, theme: Theme): Promise<void> {
  await withUser(actorId, (tx) => tx`
    update public.users set theme = ${theme}::public.theme_preference where id = ${actorId}
  `);
}

/**
 * Capacity and concurrency. Admin+ only — RLS on `users` enforces the downward
 * rule (an Admin manages below themselves; nobody edits the Super Admin).
 */
export async function updateCapacity(
  actorId: string,
  userId: string,
  input: { weeklyCapacityPoints?: number; maxConcurrentTasks?: number; roleTitle?: string | null },
): Promise<void> {
  const has = (k: keyof typeof input) => Object.hasOwn(input, k);
  await withUser(actorId, (tx) => tx`
    update public.users set
      weekly_capacity_points = case when ${has('weeklyCapacityPoints')}
        then ${input.weeklyCapacityPoints ?? null}::integer else weekly_capacity_points end,
      max_concurrent_tasks = case when ${has('maxConcurrentTasks')}
        then ${input.maxConcurrentTasks ?? null}::integer else max_concurrent_tasks end,
      role_title = case when ${has('roleTitle')} then ${input.roleTitle ?? null} else role_title end
    where id = ${userId}
  `);
}

/* ---- Availability (FR-014) ---- */

export async function listAvailability(
  actorId: string,
  window: { start: string; end: string },
): Promise<AvailabilityRow[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select id, user_id, start_date, end_date, type, capacity_multiplier, note
      from public.availability
     where end_date >= ${window.start} and start_date <= ${window.end}
  `);
  return rows.map((row) => ({
    id: row.id as string,
    userId: row.user_id as string,
    startDate: dateOnly(row.start_date) ?? '',
    endDate: dateOnly(row.end_date) ?? '',
    type: row.type as AvailabilityType,
    capacityMultiplier: Number(row.capacity_multiplier),
    note: (row.note as string | null) ?? null,
  }));
}

export async function addAvailability(
  actorId: string,
  input: {
    userId: string;
    startDate: string;
    endDate: string;
    type: AvailabilityType;
    capacityMultiplier: number;
    note?: string | null;
  },
): Promise<void> {
  await withUser(actorId, (tx) => tx`
    insert into public.availability
      (user_id, start_date, end_date, type, capacity_multiplier, note, approved_by_id)
    values (
      ${input.userId}, ${input.startDate}, ${input.endDate},
      ${input.type}::public.availability_type, ${input.capacityMultiplier},
      ${input.note?.trim() || null}, ${actorId}
    )
  `);
}

export async function deleteAvailability(actorId: string, id: string): Promise<void> {
  await withUser(actorId, (tx) => tx`delete from public.availability where id = ${id}`);
}

/* ---- Skills (FR-012, FR-017) ---- */

export async function listSkills(actorId: string): Promise<SkillRow[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select id, slug, label, category, keywords, is_active
      from public.skills where is_active order by category nulls last, label
  `);
  return rows.map((row) => ({
    id: row.id as string,
    slug: row.slug as string,
    label: row.label as string,
    category: (row.category as string | null) ?? null,
    keywords: (row.keywords as string[]) ?? [],
    isActive: row.is_active as boolean,
  }));
}

export async function listUserSkills(actorId: string): Promise<UserSkillRow[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select us.user_id, us.skill_id, s.label as skill_label, us.proficiency, us.is_primary
      from public.user_skills us
      join public.skills s on s.id = us.skill_id
     order by us.is_primary desc, us.proficiency desc, s.label
  `);
  return rows.map((row) => ({
    userId: row.user_id as string,
    skillId: row.skill_id as string,
    skillLabel: row.skill_label as string,
    proficiency: Number(row.proficiency),
    isPrimary: row.is_primary as boolean,
  }));
}

export async function setUserSkill(
  actorId: string,
  input: { userId: string; skillId: string; proficiency: number; isPrimary?: boolean },
): Promise<void> {
  await withUser(actorId, (tx) => tx`
    insert into public.user_skills (user_id, skill_id, proficiency, is_primary)
    values (${input.userId}, ${input.skillId}, ${input.proficiency}, ${input.isPrimary ?? false})
    on conflict (user_id, skill_id) do update
      set proficiency = excluded.proficiency, is_primary = excluded.is_primary
  `);
}

export async function removeUserSkill(
  actorId: string,
  userId: string,
  skillId: string,
): Promise<void> {
  await withUser(actorId, (tx) => tx`
    delete from public.user_skills where user_id = ${userId} and skill_id = ${skillId}
  `);
}

/**
 * Set or clear your own profile picture, returning the URL it replaced.
 *
 * The previous URL comes back so the caller can remove the old object once the
 * row is safely updated. That order matters: delete-then-update risks a row
 * pointing at a file that is gone (a broken image on every card), while
 * update-then-delete risks an orphaned file (40 KB of litter nobody sees).
 */
export async function setOwnAvatar(
  actorId: string,
  url: string | null,
): Promise<{ previousUrl: string | null }> {
  const rows = await withUser(actorId, (tx) => tx`
    with previous as (
      select id, avatar_url from public.users where id = ${actorId}
    )
    update public.users u
       set avatar_url = ${url}
      from previous p
     where u.id = p.id
    returning p.avatar_url as previous_url
  `);
  return { previousUrl: (rows[0]?.previous_url as string | null) ?? null };
}
