import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sql, withAppRole, withUser } from '@/lib/db/client';
import {
  clearOverride,
  effectiveSettings,
  fromStorageKey,
  listAllSkills,
  listOverrides,
  putOverride,
  toStorageKey,
} from '@/lib/db/queries/settings';
import { SCORE_WEIGHTS, SYSTEM_DEFAULTS } from '@/lib/domain/constants';
import { SETTING_DEFINITIONS } from '@/lib/domain/settings';

/* ============================================================================
 * GATE — SETTINGS OVERRIDES, AGAINST THE REAL DATABASE
 * ----------------------------------------------------------------------------
 * The unit suite proves the validation. This proves the *seam*, and the seam is
 * where both of this step's real bugs were:
 *
 *   1. `system_settings` carries `check (key ~ '^[a-z][a-z0-9_]*$')` from
 *      migration 004, and every key in SETTING_DEFINITIONS is camelCase. The
 *      first save in production would have been a check violation. No amount of
 *      unit testing the domain could see it — the constraint is in the DDL.
 *
 *   2. The RLS delete policy is Super Admin only while insert is Admin+, so an
 *      Admin resetting a setting deletes zero rows and gets no error at all.
 *
 * Both read perfectly on the page. That is the pattern (C-18, C-19, C-22): the
 * layers are each correct and disagree with each other.
 *
 * Requires the demo seed:  npm run seed:demo
 * ========================================================================= */

const DOMAIN = 'cni-demo.com';

let superAdminId = '';
let adminId = '';
let memberId = '';

/**
 * Whatever was in `system_settings` before this file ran.
 *
 * These are not fixtures — they are live workspace configuration somebody may
 * have set deliberately, and one of the tests below has to see the table empty.
 * So the whole table is snapshotted and put back, and the suite is safe to run
 * against a real workspace. A test that quietly resets somebody's thresholds
 * would be a worse bug than any it could find.
 */
let snapshot: Array<{ key: string; value: unknown; updated_by_id: string | null }> = [];

/** Belt and braces: keys this file wrote, cleared even if the restore is a no-op. */
const touched = new Set<string>();

beforeAll(async () => {
  const existing = await sql`
    select key, value, updated_by_id from public.system_settings
  `;
  snapshot = existing.map((row) => ({
    key: row.key as string,
    value: row.value,
    updated_by_id: (row.updated_by_id as string | null) ?? null,
  }));

  /* `sql` directly: this is looking up who the identities ARE, and RLS on
     `users` correctly returns nothing without one set. Same bootstrap as
     work-core.test.ts, and for the same reason. */
  const rows = await sql`
    select id, email, role from public.users
     where (email like ${'%@' + DOMAIN} or role = 'super_admin') and is_active
  `;

  for (const row of rows) {
    const role = String(row.role);
    if (role === 'super_admin' && !superAdminId) superAdminId = row.id as string;
    if (role === 'admin' && !adminId) adminId = row.id as string;
    if (role === 'member' && !memberId) memberId = row.id as string;
  }

  /* The Super Admin is deliberately NOT part of the demo seed — there is
     exactly one, created once through /setup, and `users_single_super_admin_idx`
     is what makes that structural rather than a convention. So these tests
     borrow the real one instead of inventing a second. */
  expect(superAdminId, 'no Super Admin exists — run /setup first').toBeTruthy();
  expect(adminId, 'run `npm run seed:demo` — these tests need the demo division').toBeTruthy();
  expect(memberId, 'run `npm run seed:demo` — these tests need the demo division').toBeTruthy();
});

afterAll(async () => {
  /* Leaving an override behind would change what every later test — and the
     running application — computes. The suite has to be re-runnable, and it has
     to leave the workspace exactly as it found it. */
  for (const key of touched) {
    await sql`delete from public.system_settings where key = ${toStorageKey(key)}`;
  }

  for (const row of snapshot) {
    await sql`
      insert into public.system_settings (key, value, updated_by_id)
      values (${row.key}, ${sql.json(row.value as never)}, ${row.updated_by_id})
      on conflict (key) do update
        set value = excluded.value, updated_by_id = excluded.updated_by_id
    `;
  }
});

describe('the storage key', () => {
  it('round-trips every defined key', () => {
    for (const definition of SETTING_DEFINITIONS) {
      expect(fromStorageKey(toStorageKey(definition.key)), definition.key).toBe(definition.key);
    }
  });

  it('produces a key the table will actually accept', () => {
    /* The constraint, restated. If migration 004's regex changes, this fails
       here rather than the first time somebody saves. */
    for (const definition of SETTING_DEFINITIONS) {
      expect(toStorageKey(definition.key), definition.key).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });
});

describe('writing an override', () => {
  it('accepts a camelCase setting key without violating the check constraint', async () => {
    touched.add('defaultWeeklyCapacity');
    await putOverride(superAdminId, 'defaultWeeklyCapacity', 30);

    const stored = await listOverrides(superAdminId);
    const row = stored.find((s) => s.key === 'defaultWeeklyCapacity');
    expect(row?.value).toBe(30);
  });

  it('stores jsonb as a real object, not a double-encoded string', async () => {
    /* `jsonb_typeof` is the assertion, because JSON.stringify into a jsonb
       parameter never errors — it silently stores `"{\\"skill\\":0.3}"` as a
       STRING, and every read hands back a string that looks close enough to be
       missed. That is exactly how project type_fields broke (C-22). */
    touched.add('scoringWeights');
    await putOverride(superAdminId, 'scoringWeights', { ...SCORE_WEIGHTS });

    const [row] = await sql`
      select jsonb_typeof(value) as kind, value
        from public.system_settings where key = 'scoring_weights'
    `;
    expect(row.kind).toBe('object');
    expect(row.value).toEqual({ ...SCORE_WEIGHTS });
  });

  it('records who changed it', async () => {
    touched.add('defaultWeeklyCapacity');
    await putOverride(superAdminId, 'defaultWeeklyCapacity', 32);

    const stored = await listOverrides(superAdminId);
    const row = stored.find((s) => s.key === 'defaultWeeklyCapacity');
    expect(row?.updatedByName).toBeTruthy();
  });

  it('overwrites rather than duplicating on a second save', async () => {
    touched.add('defaultWeeklyCapacity');
    await putOverride(superAdminId, 'defaultWeeklyCapacity', 33);
    await putOverride(superAdminId, 'defaultWeeklyCapacity', 34);

    const stored = await listOverrides(superAdminId);
    const matches = stored.filter((s) => s.key === 'defaultWeeklyCapacity');
    expect(matches).toHaveLength(1);
    expect(matches[0].value).toBe(34);
  });
});

describe('reading them back', () => {
  it('lets the override win and leaves every other key at its default', async () => {
    touched.add('defaultWeeklyCapacity');
    await putOverride(superAdminId, 'defaultWeeklyCapacity', 28);

    const { values } = await effectiveSettings(superAdminId);
    expect(values.defaultWeeklyCapacity).toBe(28);
    expect(values.hardThresholdPct).toBe(SYSTEM_DEFAULTS.hardThresholdPct);
  });

  it('is readable by a Member, who cannot write one', async () => {
    /* doc 04 §5: read by all authenticated users. The engine's numbers have to
       be legible to the person they are applied to — a capacity warning nobody
       can look up the threshold for is not an explanation. */
    touched.add('defaultWeeklyCapacity');
    await putOverride(superAdminId, 'defaultWeeklyCapacity', 27);

    const { values } = await effectiveSettings(memberId);
    expect(values.defaultWeeklyCapacity).toBe(27);

    await expect(putOverride(memberId, 'hardThresholdPct', 95)).rejects.toThrow();
  });
});

describe('resetting', () => {
  it('deletes the row rather than writing the default back', async () => {
    touched.add('defaultWeeklyCapacity');
    await putOverride(superAdminId, 'defaultWeeklyCapacity', 26);

    expect(await clearOverride(superAdminId, 'defaultWeeklyCapacity')).toBe(true);

    const rows = await sql`
      select 1 from public.system_settings where key = 'default_weekly_capacity'
    `;
    expect(rows).toHaveLength(0);

    const { values } = await effectiveSettings(superAdminId);
    expect(values.defaultWeeklyCapacity).toBe(SYSTEM_DEFAULTS.defaultWeeklyCapacity);
  });

  it('answers false when nothing was there', async () => {
    expect(await clearOverride(superAdminId, 'sustainedOverloadDays')).toBe(false);
  });

  it('answers false for an Admin, whom RLS silently refuses', async () => {
    /* The bug this exists for: the delete policy is `super_admin`, the insert
       policy is `acting_at_least('admin')`. RLS expresses the refusal as zero
       rows matched — no exception — so an Admin pressing Reset would have been
       told it worked while the row sat untouched. */
    touched.add('otherWorkWarningPct');
    await putOverride(adminId, 'otherWorkWarningPct', 44);

    expect(await clearOverride(adminId, 'otherWorkWarningPct')).toBe(false);

    const rows = await sql`
      select value from public.system_settings where key = 'other_work_warning_pct'
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe(44);

    expect(await clearOverride(superAdminId, 'otherWorkWarningPct')).toBe(true);
  });
});

describe('reading them with no identity at all (migration 017)', () => {
  it('answers through app.settings_effective(), which RLS would otherwise block', async () => {
    /* `withAppRole` sets the role but no `app.user_id`, which is exactly the
       state the login form is in. The select policy on system_settings requires
       `current_user_id() is not null`, so a plain select returns nothing — the
       lock threshold on the sign-in page would silently be the shipped default
       forever. The SECURITY DEFINER function is what closes that. */
    touched.add('failedLoginsToLock');
    await putOverride(superAdminId, 'failedLoginsToLock', 4);

    const blocked = await withAppRole((tx) => tx`
      select key from public.system_settings where key = 'failed_logins_to_lock'
    `);
    expect(blocked, 'RLS should hide the row from an anonymous connection').toHaveLength(0);

    const [row] = await withAppRole((tx) => tx`select app.settings_effective() as settings`);
    expect((row.settings as Record<string, unknown>).failed_logins_to_lock).toBe(4);
  });

  it('returns an empty object rather than null when nothing is overridden', async () => {
    /* `jsonb_object_agg` over zero rows is NULL, not '{}'. Without the coalesce
       the accessor would spread null and every setting would come back
       undefined — on the login page, of all places.

       Emptying the table is safe here only because afterAll restores the
       snapshot taken before this file ran. */
    await sql`delete from public.system_settings`;
    const [row] = await withAppRole((tx) => tx`select app.settings_effective() as settings`);
    expect(row.settings).toEqual({});
  });
});

describe('the skills library', () => {
  it('reports how many people hold each skill', async () => {
    const skills = await listAllSkills(superAdminId);
    expect(skills.length).toBeGreaterThan(0);
    for (const skill of skills) {
      expect(Number.isInteger(skill.holders), skill.slug).toBe(true);
      expect(skill.holders).toBeGreaterThanOrEqual(0);
    }
    expect(skills.some((s) => s.holders > 0), 'the demo seed rates people on skills').toBe(true);
  });

  it('refuses to delete one somebody holds — which is why retiring exists', async () => {
    const skills = await listAllSkills(superAdminId);
    const held = skills.find((s) => s.holders > 0);
    expect(held).toBeDefined();

    /* ON DELETE RESTRICT. Offering a delete button in the UI would be offering
       an action the database will not perform. Run as the owner, not through
       withUser, so it is the FK refusing and not RLS. */
    await expect(sql`delete from public.skills where id = ${held!.id}`).rejects.toThrow();
  });

  it('keeps a retired skill visible with its holders intact', async () => {
    const before = await listAllSkills(superAdminId);
    const target = before.find((s) => s.isActive && s.holders > 0);
    expect(target).toBeDefined();

    await withUser(superAdminId, (tx) => tx`
      update public.skills set is_active = false where id = ${target!.id}
    `);

    try {
      const after = await listAllSkills(superAdminId);
      const retired = after.find((s) => s.id === target!.id);
      expect(retired?.isActive).toBe(false);
      expect(retired?.holders).toBe(target!.holders);
    } finally {
      await withUser(superAdminId, (tx) => tx`
        update public.skills set is_active = true where id = ${target!.id}
      `);
    }
  });
});
