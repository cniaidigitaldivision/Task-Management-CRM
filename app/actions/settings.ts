'use server';

import { revalidatePath } from 'next/cache';

import { requireUser } from '@/lib/auth/current-user';
import { needsStepUp } from '@/lib/auth/step-up';
import { withUser } from '@/lib/db/client';
import { audit } from '@/lib/db/queries/audit';
import * as S from '@/lib/db/queries/settings';
import { can } from '@/lib/domain/permissions';
import {
  SETTING_BY_KEY,
  mergeSettings,
  validateCombination,
  validateSetting,
  type SettingKey,
} from '@/lib/domain/settings';

/* ============================================================================
 * SETTINGS ACTIONS — FR-057, doc 19 §5
 * ----------------------------------------------------------------------------
 * ── FOUR GATES, AND EACH ONE STOPS SOMETHING DIFFERENT ───────────────────────
 *   1. the role, from doc 03 §3 — may this person touch this setting at all
 *   2. step-up (FR-149) — is the person at the keyboard still the account holder
 *   3. the field's own bounds — is this value sane by itself
 *   4. the combination — is the system still coherent with it applied
 *
 * The fourth is the one an obvious implementation leaves out. Every individual
 * value can be in range while the set is nonsense: a soft threshold above the
 * hard one means the warning never fires before the block, and an idle
 * auto-pause before the idle prompt means nobody is ever asked. Both would save
 * happily under per-field validation and quietly disable a feature.
 *
 * ── AND THE WEIGHTS ARE THE REASON ANY OF THIS IS CAREFUL ────────────────────
 * They once totalled 1.05 because a sixth was added without reducing the other
 * five. Every recommendation was inflated by 5% and the "no good match" floor
 * became meaningless. Nothing caught it for weeks (C-06). Making them editable
 * without that check would reintroduce the same bug with a text box attached.
 * ========================================================================= */

export interface SettingsActionResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly note?: string;
  /** The caller must re-authenticate before this will be accepted (FR-149). */
  readonly stepUpRequired?: boolean;
}

const fail = (error: string): SettingsActionResult => ({ ok: false, error });

export async function updateSettingAction(
  key: string,
  raw: unknown,
): Promise<SettingsActionResult> {
  const user = await requireUser();

  const definition = SETTING_BY_KEY.get(key as SettingKey);
  if (!definition) return fail('That is not a setting.');

  if (!can({ role: user.role, id: user.id }, definition.permission)) {
    return fail(
      `Changing "${definition.label}" is not something your role can do (doc 03 §3.6).`,
    );
  }

  /* FR-149. Checked before validation so somebody is asked to re-authenticate
     once, rather than being asked and then told their value was out of range. */
  if (needsStepUp(user, definition.permission)) {
    return {
      ok: false,
      stepUpRequired: true,
      error: 'Confirm it is you before changing this.',
    };
  }

  const checked = validateSetting(definition.key, raw);
  if (!checked.ok) return fail(checked.message);

  /* Gate 4: apply it against everything else and see whether the SET still makes
     sense, not just the field. */
  const { overrides } = await S.effectiveSettings(user.id);
  const proposed = new Map(overrides);
  proposed.set(definition.key, checked.value);

  const conflict = validateCombination(mergeSettings(proposed));
  if (conflict) return fail(conflict);

  const before = mergeSettings(overrides)[definition.key];
  await S.putOverride(user.id, definition.key, checked.value);

  await withUser(user.id, (tx) =>
    audit(tx, user, {
      entityType: 'setting',
      entityId: null,
      action: `setting.${definition.key}`,
      before: { value: before },
      after: { value: checked.value },
    }),
  );

  revalidatePath('/settings');
  revalidatePath('/workload');
  revalidatePath('/dashboard');
  return { ok: true, note: `${definition.label} saved.` };
}

export async function resetSettingAction(key: string): Promise<SettingsActionResult> {
  const user = await requireUser();

  const definition = SETTING_BY_KEY.get(key as SettingKey);
  if (!definition) return fail('That is not a setting.');

  if (!can({ role: user.role, id: user.id }, definition.permission)) {
    return fail('Your role cannot change that setting.');
  }
  if (needsStepUp(user, definition.permission)) {
    return { ok: false, stepUpRequired: true, error: 'Confirm it is you first.' };
  }

  /* Resetting can break the combination too — dropping a customised soft
     threshold back to 85 while the hard one sits at 80 leaves the same
     incoherent state as setting it there by hand. */
  const { overrides } = await S.effectiveSettings(user.id);
  const proposed = new Map(overrides);
  proposed.delete(definition.key);

  const conflict = validateCombination(mergeSettings(proposed));
  if (conflict) {
    return fail(`${conflict} Adjust the others first, then reset this one.`);
  }

  /* Zero rows means RLS refused it, not that there was nothing to do — the
     delete policy is Super Admin only while the insert policy is Admin+. Saying
     "restored" over a row that is still there would be a lie the screen would
     then repeat back on every reload. */
  const removed = await S.clearOverride(user.id, definition.key);
  if (!removed) {
    const { overrides: after } = await S.effectiveSettings(user.id);
    if (after.has(definition.key)) {
      return fail(
        'Only the Super Admin can put a setting back to its default. The change itself stayed.',
      );
    }
    return { ok: true, note: `${definition.label} was already at the shipped default.` };
  }

  await withUser(user.id, (tx) =>
    audit(tx, user, {
      entityType: 'setting',
      entityId: null,
      action: `setting.${definition.key}.reset`,
      after: { restoredToShippedDefault: true },
    }),
  );

  revalidatePath('/settings');
  return { ok: true, note: `${definition.label} is back to the shipped default.` };
}

/* ==========================================================================
 * SKILLS LIBRARY — FR-017
 * ========================================================================== */

function slugify(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export async function createSkillAction(
  _prev: SettingsActionResult,
  form: FormData,
): Promise<SettingsActionResult> {
  const user = await requireUser();
  if (!can({ role: user.role, id: user.id }, 'settings.skills_library')) {
    return fail('Only an Admin can edit the skills library.');
  }

  const label = String(form.get('label') ?? '').trim();
  const category = String(form.get('category') ?? '').trim() || null;
  const keywords = String(form.get('keywords') ?? '')
    .split(',')
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean);

  if (!label) return fail('Give the skill a name.');

  const slug = slugify(label);
  if (!slug) return fail('That name has no letters or numbers in it.');

  try {
    await S.createSkill(user.id, { slug, label, category, keywords });
    await withUser(user.id, (tx) =>
      audit(tx, user, {
        entityType: 'setting',
        entityId: null,
        action: 'skill.created',
        after: { slug, label, category },
      }),
    );
    revalidatePath('/settings');
    revalidatePath('/team');
    return { ok: true, note: `“${label}” added.` };
  } catch {
    return fail(`There is already a skill with a name like “${label}”.`);
  }
}

export async function renameSkillAction(
  skillId: string,
  input: { label: string; category: string | null; keywords: string[] },
): Promise<SettingsActionResult> {
  const user = await requireUser();
  if (!can({ role: user.role, id: user.id }, 'settings.skills_library')) {
    return fail('Only an Admin can edit the skills library.');
  }
  if (!input.label.trim()) return fail('A skill needs a name.');

  await S.renameSkill(user.id, skillId, {
    label: input.label.trim(),
    category: input.category?.trim() || null,
    keywords: input.keywords.map((k) => k.trim().toLowerCase()).filter(Boolean),
  });

  await withUser(user.id, (tx) =>
    audit(tx, user, {
      entityType: 'setting',
      entityId: skillId,
      action: 'skill.updated',
      after: input,
    }),
  );

  revalidatePath('/settings');
  revalidatePath('/team');
  return { ok: true, note: 'Saved.' };
}

/**
 * Retire or restore a skill. Never delete.
 *
 * `user_skills` references `skills` with ON DELETE RESTRICT, so one somebody
 * holds could not be deleted anyway — and the flag is the better answer
 * regardless. Deleting would erase the fact that six people were rated on it,
 * which is exactly the history the engine's performance signal reads.
 */
export async function setSkillActiveAction(
  skillId: string,
  isActive: boolean,
): Promise<SettingsActionResult> {
  const user = await requireUser();
  if (!can({ role: user.role, id: user.id }, 'settings.skills_library')) {
    return fail('Only an Admin can edit the skills library.');
  }

  if (isActive) await S.restoreSkill(user.id, skillId);
  else await S.retireSkill(user.id, skillId);

  await withUser(user.id, (tx) =>
    audit(tx, user, {
      entityType: 'setting',
      entityId: skillId,
      action: isActive ? 'skill.restored' : 'skill.retired',
    }),
  );

  revalidatePath('/settings');
  revalidatePath('/team');
  return {
    ok: true,
    note: isActive
      ? 'Back in the library and available to assign.'
      : 'Retired. Anybody already rated on it keeps that rating — it just stops being offered.',
  };
}
