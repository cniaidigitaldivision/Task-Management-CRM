import 'server-only';

import { withUser } from '../client';
import type { SettingKey, SettingValue } from '@/lib/domain/settings';
import { mergeSettings } from '@/lib/domain/settings';

/* ============================================================================
 * SETTINGS QUERIES — LAYER 1
 * ----------------------------------------------------------------------------
 * `system_settings` holds OVERRIDES ONLY. A key with no row falls back to
 * SYSTEM_DEFAULTS, which stays the single source of truth (registry C-16 §9a).
 *
 * ── RESETTING DELETES THE ROW ────────────────────────────────────────────────
 * Not "writes the default back". Writing it back would freeze today's shipped
 * value into the database, so a later change to that default would never reach a
 * workspace that had once reset to it — the row would keep asserting the old
 * number, and nobody would know it was doing so.
 * ========================================================================= */

/* ── THE KEY IS snake_case IN THE DATABASE AND camelCase IN TYPESCRIPT ───────
   Not a stylistic preference: `system_settings` carries

     check (key ~ '^[a-z][a-z0-9_]*$')

   from migration 004, so `defaultWeeklyCapacity` is REJECTED outright — the
   first save would have been a check violation, not a silent mismatch. The
   conversion happens here, at the one boundary that touches the column, so
   neither side has to know about the other's convention. */
export function toStorageKey(key: string): string {
  return key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

export function fromStorageKey(key: string): string {
  return key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

export interface StoredSetting {
  readonly key: string;
  readonly value: unknown;
  readonly updatedByName: string | null;
  readonly updatedAt: string;
}

export async function listOverrides(actorId: string): Promise<StoredSetting[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select s.key, s.value, s.updated_at, u.full_name as updated_by_name
      from public.system_settings s
      left join public.users u on u.id = s.updated_by_id
     order by s.key
  `);

  return rows.map((row) => ({
    key: fromStorageKey(row.key as string),
    value: row.value,
    updatedByName: (row.updated_by_name as string | null) ?? null,
    updatedAt:
      row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  }));
}

/** Every setting's live value, plus which of them are overridden. */
export async function effectiveSettings(actorId: string): Promise<{
  values: Record<SettingKey, SettingValue>;
  overrides: Map<string, unknown>;
  stored: StoredSetting[];
}> {
  const stored = await listOverrides(actorId);
  const overrides = new Map(stored.map((s) => [s.key, s.value]));
  return { values: mergeSettings(overrides), overrides, stored };
}

export async function putOverride(
  actorId: string,
  key: string,
  value: SettingValue,
): Promise<void> {
  /* `tx.json()` and not `JSON.stringify()`. postgres.js serialises a jsonb
     parameter itself, so pre-stringifying encodes it twice and the column ends
     up holding a *string* that reads back as one. It never errors — it silently
     broke project type_fields for a week (registry C-22). */
  await withUser(actorId, (tx) => tx`
    insert into public.system_settings (key, value, updated_by_id)
    values (${toStorageKey(key)}, ${tx.json(value as never)}, ${actorId})
    on conflict (key) do update
      set value = excluded.value, updated_by_id = excluded.updated_by_id
  `);
}

/**
 * Back to the shipped default — by removing the row, per the header.
 *
 * ── IT REPORTS WHETHER IT ACTUALLY DELETED ANYTHING ──────────────────────────
 * The RLS delete policy is `current_user_role() = 'super_admin'`, one step
 * narrower than the insert policy's `acting_at_least('admin')`. An Admin can
 * therefore change a setting and then find they cannot reset it — and RLS
 * expresses that as *zero rows matched*, not as an error. Returning the count
 * is what stops the screen cheerfully reporting a reset that did not happen.
 */
export async function clearOverride(actorId: string, key: string): Promise<boolean> {
  const rows = await withUser(actorId, (tx) => tx`
    delete from public.system_settings where key = ${toStorageKey(key)} returning key
  `);
  return rows.length > 0;
}

/* ==========================================================================
 * SKILLS LIBRARY — FR-017
 * ========================================================================== */

/**
 * Retire a skill rather than delete it.
 *
 * `user_skills` references `skills` with ON DELETE RESTRICT, so a skill somebody
 * holds cannot be removed anyway — but the flag is the better answer regardless.
 * Deleting would erase the fact that six people were once rated on it, which is
 * exactly the history the assignment engine's performance signal is built from.
 */
export async function retireSkill(actorId: string, skillId: string): Promise<void> {
  await withUser(actorId, (tx) => tx`
    update public.skills set is_active = false where id = ${skillId}
  `);
}

export async function restoreSkill(actorId: string, skillId: string): Promise<void> {
  await withUser(actorId, (tx) => tx`
    update public.skills set is_active = true where id = ${skillId}
  `);
}

export async function createSkill(
  actorId: string,
  input: { slug: string; label: string; category: string | null; keywords: string[] },
): Promise<string> {
  const rows = await withUser(actorId, (tx) => tx`
    insert into public.skills (slug, label, category, keywords, is_active)
    values (${input.slug}, ${input.label}, ${input.category}, ${input.keywords}, true)
    returning id
  `);
  return rows[0].id as string;
}

export async function renameSkill(
  actorId: string,
  skillId: string,
  input: { label: string; category: string | null; keywords: string[] },
): Promise<void> {
  /* The slug is deliberately not editable. It is the stable identifier the
     keyword matcher and any future import would key off, and renaming it would
     silently orphan those references while the label — the thing people
     actually read — is free to change. */
  await withUser(actorId, (tx) => tx`
    update public.skills
       set label = ${input.label}, category = ${input.category}, keywords = ${input.keywords}
     where id = ${skillId}
  `);
}

/** Including retired ones, which the library screen needs and the pickers do not. */
export async function listAllSkills(actorId: string): Promise<
  Array<{
    id: string;
    slug: string;
    label: string;
    category: string | null;
    keywords: string[];
    isActive: boolean;
    holders: number;
  }>
> {
  const rows = await withUser(actorId, (tx) => tx`
    select s.*, (select count(*) from public.user_skills us where us.skill_id = s.id) as holders
      from public.skills s
     order by s.is_active desc, s.category nulls last, s.label
  `);

  return rows.map((row) => ({
    id: row.id as string,
    slug: row.slug as string,
    label: row.label as string,
    category: (row.category as string | null) ?? null,
    keywords: (row.keywords as string[]) ?? [],
    isActive: row.is_active as boolean,
    holders: Number(row.holders ?? 0),
  }));
}
