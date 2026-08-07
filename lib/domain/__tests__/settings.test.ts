import { describe, expect, it } from 'vitest';

import { SCORE_WEIGHTS, SYSTEM_DEFAULTS, type Role } from '../constants';
import { PERMISSIONS, can } from '../permissions';
import {
  SETTING_BY_KEY,
  SETTING_DEFINITIONS,
  mergeSettings,
  validateCombination,
  validateSetting,
  type SettingKey,
} from '../settings';

/* ============================================================================
 * SETTINGS — FR-057
 * ----------------------------------------------------------------------------
 * These settings decide when the system warns, when it blocks, and who it
 * recommends. Getting one wrong does not throw — it silently changes what the
 * whole workload model says, which is the failure mode the C-06 incident had.
 * So the exhaustive cases below are the point, not thoroughness for its own
 * sake.
 * ========================================================================= */

const defaults = mergeSettings(new Map());

describe('the definitions themselves', () => {
  it('has no duplicate keys', () => {
    const keys = SETTING_DEFINITIONS.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('names a permission that actually exists in the doc 03 matrix', () => {
    /* A typo'd permission would not fail to compile if the action union ever
       widened, and `can()` would then answer for a rule nobody wrote. */
    for (const definition of SETTING_DEFINITIONS) {
      expect(PERMISSIONS[definition.permission], definition.key).toBeDefined();
    }
  });

  it('gives every numeric setting a usable range', () => {
    for (const definition of SETTING_DEFINITIONS) {
      if (definition.kind !== 'integer') continue;
      expect(definition.min, definition.key).toBeTypeOf('number');
      expect(definition.max, definition.key).toBeTypeOf('number');
      expect(definition.max!, definition.key).toBeGreaterThan(definition.min!);
    }
  });

  it('ships a default that is inside its own declared range', () => {
    /* The bug this catches: tightening a bound in a later release below the
       shipped default, so the screen renders a value it would refuse to save. */
    for (const definition of SETTING_DEFINITIONS) {
      const value = defaults[definition.key];
      const check = validateSetting(definition.key, value);
      expect(check.ok, `${definition.key} default ${String(value)}`).toBe(true);
    }
  });

  it('ships a coherent set of defaults', () => {
    expect(validateCombination(defaults)).toBeNull();
  });

  it('covers every key in the merged record', () => {
    for (const key of Object.keys(defaults) as SettingKey[]) {
      expect(SETTING_BY_KEY.get(key), key).toBeDefined();
    }
  });
});

describe('validateSetting — integers', () => {
  it('accepts a value at each end of the range', () => {
    expect(validateSetting('defaultWeeklyCapacity', 1)).toEqual({ ok: true, value: 1 });
    expect(validateSetting('defaultWeeklyCapacity', 48)).toEqual({ ok: true, value: 48 });
  });

  it('refuses one past each end', () => {
    expect(validateSetting('defaultWeeklyCapacity', 0).ok).toBe(false);
    expect(validateSetting('defaultWeeklyCapacity', 49).ok).toBe(false);
  });

  it('parses the string a form actually submits', () => {
    expect(validateSetting('defaultWeeklyCapacity', ' 36 ')).toEqual({ ok: true, value: 36 });
  });

  it('refuses a fraction — points are whole', () => {
    expect(validateSetting('defaultWeeklyCapacity', 36.5).ok).toBe(false);
  });

  it('refuses text, blanks, NaN and infinity rather than coercing them', () => {
    for (const raw of ['', '  ', 'lots', NaN, Infinity, null, undefined, {}]) {
      expect(validateSetting('defaultWeeklyCapacity', raw).ok, String(raw)).toBe(false);
    }
  });

  it('explains the refusal in the unit somebody typed in', () => {
    const result = validateSetting('recoveryCodeTtlMinutes', 600);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('60 min');
  });
});

describe('validateSetting — booleans', () => {
  it('accepts the checkbox forms as well as real booleans', () => {
    expect(validateSetting('timerAutoPauseOutsideHours', true)).toEqual({ ok: true, value: true });
    expect(validateSetting('timerAutoPauseOutsideHours', 'on')).toEqual({ ok: true, value: true });
    expect(validateSetting('timerAutoPauseOutsideHours', '')).toEqual({ ok: true, value: false });
    expect(validateSetting('timerAutoPauseOutsideHours', 'false')).toEqual({
      ok: true,
      value: false,
    });
  });

  it('refuses anything else instead of quietly reading it as false', () => {
    /* `Boolean('no')` is true and `Boolean(0)` is false. Guessing here would
       flip a safety switch the opposite way from what was intended. */
    for (const raw of ['no', 0, 1, 'yes', null]) {
      expect(validateSetting('timerAutoPauseOutsideHours', raw).ok, String(raw)).toBe(false);
    }
  });
});

describe('validateSetting — scoring weights (C-06)', () => {
  const good = { ...SCORE_WEIGHTS };

  it('accepts the shipped set', () => {
    expect(validateSetting('scoringWeights', good).ok).toBe(true);
  });

  it('refuses 105%, which is the bug that happened', () => {
    const result = validateSetting('scoringWeights', { ...good, skill: good.skill + 0.05 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('105%');
      expect(result.message).toContain('100%');
    }
  });

  it('refuses 99% too — under is as wrong as over', () => {
    expect(validateSetting('scoringWeights', { ...good, skill: good.skill - 0.01 }).ok).toBe(false);
  });

  it('refuses a missing weight rather than treating it as zero', () => {
    const partial: Record<string, number> = { ...good };
    delete partial.fairness;
    expect(validateSetting('scoringWeights', partial).ok).toBe(false);
  });

  it('refuses a negative weight, which would make a strength count against you', () => {
    expect(
      validateSetting('scoringWeights', { ...good, fairness: -0.1, skill: good.skill + 0.1 }).ok,
    ).toBe(false);
  });

  it('accepts a redistribution that still totals exactly 100%', () => {
    const shifted = { ...good, skill: good.skill + 0.05, fairness: good.fairness - 0.05 };
    expect(validateSetting('scoringWeights', shifted).ok).toBe(true);
  });

  it('refuses null and non-objects', () => {
    for (const raw of [null, undefined, 42, 'weights']) {
      expect(validateSetting('scoringWeights', raw).ok, String(raw)).toBe(false);
    }
  });
});

describe('validateCombination — the rules no single field can see', () => {
  const withValues = (patch: Partial<Record<SettingKey, number>>) => ({ ...defaults, ...patch });

  it('refuses a soft threshold at or above the hard one', () => {
    /* Both are individually in range. Together the warning never fires, because
       the block happens first — the feature is disabled with no error. */
    expect(validateCombination(withValues({ softThresholdPct: 95, hardThresholdPct: 90 }))).toMatch(
      /soft threshold/i,
    );
    expect(validateCombination(withValues({ softThresholdPct: 90, hardThresholdPct: 90 }))).toMatch(
      /soft threshold/i,
    );
  });

  it('allows one point of separation', () => {
    expect(
      validateCombination(withValues({ softThresholdPct: 89, hardThresholdPct: 90 })),
    ).toBeNull();
  });

  it('refuses a critical threshold below the hard one', () => {
    expect(
      validateCombination(withValues({ hardThresholdPct: 120, criticalThresholdPct: 110 })),
    ).toMatch(/critical/i);
  });

  it('allows critical equal to hard', () => {
    expect(
      validateCombination(withValues({ hardThresholdPct: 120, criticalThresholdPct: 120 })),
    ).toBeNull();
  });

  it('refuses an auto-pause at or before the idle prompt', () => {
    expect(
      validateCombination(
        withValues({ timerIdlePromptMinutes: 30, timerIdleAutoPauseMinutes: 20 }),
      ),
    ).toMatch(/auto-pause/i);
    expect(
      validateCombination(
        withValues({ timerIdlePromptMinutes: 30, timerIdleAutoPauseMinutes: 30 }),
      ),
    ).toMatch(/auto-pause/i);
  });
});

describe('mergeSettings', () => {
  it('falls back to the shipped default for every unset key', () => {
    expect(mergeSettings(new Map()).defaultWeeklyCapacity).toBe(
      SYSTEM_DEFAULTS.defaultWeeklyCapacity,
    );
  });

  it('applies a stored override', () => {
    expect(mergeSettings(new Map([['defaultWeeklyCapacity', 30]])).defaultWeeklyCapacity).toBe(30);
  });

  it('ignores a stored value that no longer validates instead of throwing', () => {
    /* Bounds tighten between releases. A row written under the old ones must not
       be able to take the application down at startup — the shipped default is
       always a safe answer, and the screen shows the field as unchanged. */
    const merged = mergeSettings(
      new Map<string, unknown>([
        ['defaultWeeklyCapacity', 9999],
        ['scoringWeights', { skill: 2 }],
        ['timerAutoPauseOutsideHours', 'perhaps'],
      ]),
    );
    expect(merged.defaultWeeklyCapacity).toBe(SYSTEM_DEFAULTS.defaultWeeklyCapacity);
    expect(merged.scoringWeights).toEqual(SCORE_WEIGHTS);
    expect(merged.timerAutoPauseOutsideHours).toBe(SYSTEM_DEFAULTS.timerAutoPauseOutsideHours);
  });

  it('ignores a key that is not a setting', () => {
    const merged = mergeSettings(new Map([['dropTheDatabase', true]]));
    expect(merged).toEqual(defaults);
  });

  it('does not mutate the defaults between calls', () => {
    mergeSettings(new Map([['defaultWeeklyCapacity', 12]]));
    expect(mergeSettings(new Map()).defaultWeeklyCapacity).toBe(
      SYSTEM_DEFAULTS.defaultWeeklyCapacity,
    );
  });
});

describe('who may change what (doc 03 §3.6)', () => {
  const actor = (role: Role) => ({ role, id: '00000000-0000-0000-0000-000000000001' });

  it('lets the Super Admin change every setting on the screen', () => {
    for (const definition of SETTING_DEFINITIONS) {
      expect(can(actor('super_admin'), definition.permission), definition.key).toBe(true);
    }
  });

  it('lets an Admin change only the library and the two shared defaults', () => {
    /* The screen is Admin-gated, but the doc 03 matrix reserves the numbers the
       whole workload model rests on — the thresholds, the weights, the security
       timings — for the Super Admin. So an Admin opening Settings sees most of
       it read-only rather than gets refused at the door, which is the honest
       shape: they are allowed here, just not allowed to move those. */
    const allowed = SETTING_DEFINITIONS.filter((d) => can(actor('admin'), d.permission)).map(
      (d) => d.key,
    );
    expect(allowed).toEqual(['otherWorkWarningPct']);
  });

  it('lets a Team Coordinator and a Member change none of them', () => {
    /* Hiding a control is convenience; this per-field check is what actually
       stops a hand-rolled POST (registry C-21). */
    for (const role of ['team_coordinator', 'member'] as const) {
      for (const definition of SETTING_DEFINITIONS) {
        expect(can(actor(role), definition.permission), `${role}/${definition.key}`).toBe(false);
      }
    }
  });

  it('keeps the security settings to the Super Admin alone', () => {
    for (const role of ['admin', 'team_coordinator', 'member'] as const) {
      expect(can(actor(role), 'settings.security'), role).toBe(false);
    }
  });

  it('lets an Admin manage the skills library, which is not a numbered setting', () => {
    expect(can(actor('admin'), 'settings.skills_library')).toBe(true);
    expect(can(actor('team_coordinator'), 'settings.skills_library')).toBe(false);
  });
});
