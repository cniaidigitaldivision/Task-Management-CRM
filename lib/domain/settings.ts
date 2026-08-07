import {
  SCORE_WEIGHTS,
  SYSTEM_DEFAULTS,
  scoreWeightsAreValid,
  sumScoreWeights,
  type ScoreWeights,
} from './constants';
import type { Action } from './permissions';

/* ============================================================================
 * EDITABLE SETTINGS — doc 19 §5, FR-057
 * ----------------------------------------------------------------------------
 * LAYER 2. Pure: the definitions, the validation, and the merge. No database.
 *
 * ── OVERRIDES ONLY, NEVER A SEEDED COPY ──────────────────────────────────────
 * `system_settings` is deliberately EMPTY on a fresh install. An unset key falls
 * back to SYSTEM_DEFAULTS, which stays the single source of truth (registry
 * C-16 §9a). Seeding it would create a second declaration of every default, and
 * the two would drift the first time one was edited.
 *
 * Practical consequence worth knowing: resetting a setting DELETES its row
 * rather than writing the default back. Writing it back would freeze today's
 * default into the database, so a later change to the shipped value would not
 * reach a workspace that had once "reset" to it.
 *
 * ── EVERY SETTING NAMES THE PERMISSION THAT GATES IT ─────────────────────────
 * The role rules are already in doc 03 §3 as `settings.*` actions. Each
 * definition points at one, so the screen and the server ask the same question
 * of the same table — rather than a hard-coded `role === 'super_admin'` here
 * that would quietly disagree with the matrix the moment either changed.
 *
 * ── WHY THE BOUNDS ARE NOT COSMETIC ──────────────────────────────────────────
 * A capacity of 48 is the one that matters. It is the *attendance* week, and
 * setting capacity to it leaves every threshold permanently silent — the system
 * looks configured and warns about nothing, which is the most common way a
 * workload tool fails. The bound is the reasoning, enforced.
 * ========================================================================= */

export type SettingKey =
  | 'defaultWeeklyCapacity'
  | 'defaultMaxConcurrentTasks'
  | 'softThresholdPct'
  | 'hardThresholdPct'
  | 'criticalThresholdPct'
  | 'sustainedOverloadDays'
  | 'otherWorkWarningPct'
  | 'minutesPerEffortPoint'
  | 'timerIdlePromptMinutes'
  | 'timerIdleAutoPauseMinutes'
  | 'timerAutoPauseOutsideHours'
  | 'requireReasonForManualTime'
  | 'failedLoginsToLock'
  | 'accountLockAutoClearMinutes'
  | 'recoveryCodeTtlMinutes'
  | 'activationTokenTtlHours'
  | 'passwordMinLength'
  | 'scoringWeights';

export interface SettingDefinition {
  readonly key: SettingKey;
  readonly label: string;
  readonly help: string;
  readonly group: 'capacity' | 'timers' | 'security' | 'scoring';
  readonly kind: 'integer' | 'boolean' | 'weights';
  readonly min?: number;
  readonly max?: number;
  readonly unit?: string;
  /** The doc 03 §3 action that decides who may change it. */
  readonly permission: Action;
}

export const SETTING_DEFINITIONS: readonly SettingDefinition[] = [
  /* ---- Capacity ---- */
  {
    key: 'defaultWeeklyCapacity',
    label: 'Default weekly capacity',
    help: '36 is 75% of a 48-hour attendance week. Breaks, briefs, calls, context switching and render waits take the rest. Set it to 48 and every threshold goes permanently silent (ADR-004).',
    group: 'capacity',
    kind: 'integer',
    min: 1,
    max: 48,
    unit: 'points',
    permission: 'settings.default_capacity',
  },
  {
    key: 'defaultMaxConcurrentTasks',
    label: 'Default concurrent-task limit',
    help: 'The second guard. Somebody at 40% capacity juggling twelve things is still in trouble (doc 06 §1).',
    group: 'capacity',
    kind: 'integer',
    min: 1,
    max: 20,
    unit: 'tasks',
    permission: 'settings.default_capacity',
  },
  {
    key: 'softThresholdPct',
    label: 'Soft threshold',
    help: 'Assignment warns and proceeds above this (BR-004).',
    group: 'capacity',
    kind: 'integer',
    min: 50,
    max: 99,
    unit: '%',
    permission: 'settings.capacity_thresholds',
  },
  {
    key: 'hardThresholdPct',
    label: 'Hard threshold',
    help: 'Assignment is blocked above this. Only an Admin can override, in writing (BR-003).',
    group: 'capacity',
    kind: 'integer',
    min: 60,
    max: 200,
    unit: '%',
    permission: 'settings.capacity_thresholds',
  },
  {
    key: 'criticalThresholdPct',
    label: 'Critical threshold',
    help: 'Alerts Admins without anybody attempting an assignment.',
    group: 'capacity',
    kind: 'integer',
    min: 100,
    max: 300,
    unit: '%',
    permission: 'settings.capacity_thresholds',
  },
  {
    key: 'sustainedOverloadDays',
    label: 'Sustained overload',
    help: 'Days above the hard threshold before it counts as sustained rather than a bad week.',
    group: 'capacity',
    kind: 'integer',
    min: 1,
    max: 30,
    unit: 'days',
    permission: 'settings.capacity_thresholds',
  },
  {
    key: 'otherWorkWarningPct',
    label: 'Ad-hoc work warning',
    help: 'Share of committed effort in Other projects before it is flagged (doc 15 §6).',
    group: 'capacity',
    kind: 'integer',
    min: 1,
    max: 100,
    unit: '%',
    permission: 'settings.other_work_threshold',
  },

  /* ---- Timers ---- */
  {
    key: 'minutesPerEffortPoint',
    label: 'Minutes per effort point',
    help: 'Turns an estimate into a default time limit (FR-171).',
    group: 'timers',
    kind: 'integer',
    min: 5,
    max: 240,
    unit: 'min',
    permission: 'settings.status_workflow',
  },
  {
    key: 'timerIdlePromptMinutes',
    label: 'Idle prompt',
    help: 'How long a running timer sits without activity before asking whether it is still going.',
    group: 'timers',
    kind: 'integer',
    min: 5,
    max: 480,
    unit: 'min',
    permission: 'settings.status_workflow',
  },
  {
    key: 'timerIdleAutoPauseMinutes',
    label: 'Idle auto-pause',
    help: 'Must be longer than the prompt, or the timer pauses before anybody is asked.',
    group: 'timers',
    kind: 'integer',
    min: 10,
    max: 600,
    unit: 'min',
    permission: 'settings.status_workflow',
  },
  {
    key: 'timerAutoPauseOutsideHours',
    label: 'Pause outside working hours',
    help: 'Stops a timer left running overnight from inventing eight hours of work (FR-174).',
    group: 'timers',
    kind: 'boolean',
    permission: 'settings.status_workflow',
  },
  {
    key: 'requireReasonForManualTime',
    label: 'Manual time needs a reason',
    help: 'A timer everybody quietly edits is worse than no timer (BR-020).',
    group: 'timers',
    kind: 'boolean',
    permission: 'settings.status_workflow',
  },

  /* ---- Security ---- */
  {
    key: 'failedLoginsToLock',
    label: 'Failed sign-ins before lock',
    help: 'Derived from the append-only ledger, never a counter anybody can reset (FR-155a).',
    group: 'security',
    kind: 'integer',
    min: 3,
    max: 10,
    unit: 'attempts',
    permission: 'settings.security',
  },
  {
    key: 'accountLockAutoClearMinutes',
    label: 'Lock clears itself after',
    help: 'Long enough to be a real obstacle, short enough that somebody who mistyped is not stuck for the afternoon.',
    group: 'security',
    kind: 'integer',
    min: 5,
    max: 1440,
    unit: 'min',
    permission: 'settings.security',
  },
  {
    key: 'recoveryCodeTtlMinutes',
    label: 'Emailed code lasts',
    help: 'Fifteen minutes is one of the three things that make six digits defensible — with the five-attempt cap and single use.',
    group: 'security',
    kind: 'integer',
    min: 5,
    max: 60,
    unit: 'min',
    permission: 'settings.security',
  },
  {
    key: 'activationTokenTtlHours',
    label: 'Invitation link lasts',
    help: 'Long enough to survive a weekend; short enough that a forwarded email stops working.',
    group: 'security',
    kind: 'integer',
    min: 1,
    max: 168,
    unit: 'hours',
    permission: 'settings.security',
  },
  {
    key: 'passwordMinLength',
    label: 'Minimum password length',
    help: 'The Super Admin is always held to 16 regardless of this (SA-2).',
    group: 'security',
    kind: 'integer',
    min: 12,
    max: 64,
    unit: 'characters',
    permission: 'settings.security',
  },

  /* ---- Scoring ---- */
  {
    key: 'scoringWeights',
    label: 'Assignment scoring weights',
    help: 'How the engine ranks who should take a task. Must total exactly 100%.',
    group: 'scoring',
    kind: 'weights',
    permission: 'settings.scoring_weights',
  },
];

export const SETTING_BY_KEY: ReadonlyMap<SettingKey, SettingDefinition> = new Map(
  SETTING_DEFINITIONS.map((d) => [d.key, d]),
);

/* ==========================================================================
 * VALIDATION
 * ========================================================================== */

export type SettingValue = number | boolean | ScoreWeights;

export type ValidationResult =
  | { readonly ok: true; readonly value: SettingValue }
  | { readonly ok: false; readonly message: string };

export function validateSetting(key: SettingKey, raw: unknown): ValidationResult {
  const definition = SETTING_BY_KEY.get(key);
  if (!definition) return { ok: false, message: 'That is not a setting.' };

  if (definition.kind === 'boolean') {
    if (typeof raw === 'boolean') return { ok: true, value: raw };
    if (raw === 'true' || raw === 'on') return { ok: true, value: true };
    if (raw === 'false' || raw === '') return { ok: true, value: false };
    return { ok: false, message: `${definition.label} has to be on or off.` };
  }

  if (definition.kind === 'integer') {
    const value = typeof raw === 'number' ? raw : Number(String(raw).trim());
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      return { ok: false, message: `${definition.label} has to be a whole number.` };
    }
    if (definition.min !== undefined && value < definition.min) {
      return {
        ok: false,
        message: `${definition.label} cannot be below ${definition.min}${definition.unit ? ` ${definition.unit}` : ''}.`,
      };
    }
    if (definition.max !== undefined && value > definition.max) {
      return {
        ok: false,
        message: `${definition.label} cannot be above ${definition.max}${definition.unit ? ` ${definition.unit}` : ''}.`,
      };
    }
    return { ok: true, value };
  }

  /* ── The weights, and the reason this check exists ────────────────────────
     They once totalled 1.05 because a sixth was added without reducing the
     other five, and every recommendation was silently inflated by 5% — which
     also made the "no good match" floor meaningless. Nothing caught it until a
     contradiction sweep (C-06). A load-time assertion guards the shipped
     defaults; this guards anything typed in afterwards. */
  const weights = raw as Partial<ScoreWeights> | null;
  if (!weights || typeof weights !== 'object') {
    return { ok: false, message: 'The scoring weights are malformed.' };
  }

  const complete: ScoreWeights = {
    skill: Number(weights.skill),
    availability: Number(weights.availability),
    deadlineFit: Number(weights.deadlineFit),
    fairness: Number(weights.fairness),
    performance: Number(weights.performance),
    projectFamiliarity: Number(weights.projectFamiliarity),
  };

  for (const [name, value] of Object.entries(complete)) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      return { ok: false, message: `The ${name} weight has to be between 0 and 100%.` };
    }
  }

  if (!scoreWeightsAreValid(complete)) {
    const total = Math.round(sumScoreWeights(complete) * 100);
    return {
      ok: false,
      message: `The weights add up to ${total}%, and they have to total exactly 100%. They were once 105%, which inflated every recommendation and went unnoticed for weeks (C-06).`,
    };
  }

  return { ok: true, value: complete };
}

/**
 * Rules between settings, which no single field can check alone.
 *
 * Each of these describes a state the system can technically hold and cannot
 * behave sensibly in — a soft threshold above the hard one means the warning
 * never fires, and an idle pause before the prompt means nobody is ever asked.
 */
export function validateCombination(merged: Record<string, SettingValue>): string | null {
  const n = (key: SettingKey) => Number(merged[key]);

  if (n('softThresholdPct') >= n('hardThresholdPct')) {
    return 'The soft threshold has to be below the hard one, or the warning never appears before the block.';
  }
  if (n('criticalThresholdPct') < n('hardThresholdPct')) {
    return 'The critical threshold cannot be below the hard threshold — it is meant to be the worse case.';
  }
  if (n('timerIdleAutoPauseMinutes') <= n('timerIdlePromptMinutes')) {
    return 'The idle auto-pause has to be later than the prompt, or the timer stops before anybody is asked.';
  }
  return null;
}

/* ==========================================================================
 * MERGING
 * ========================================================================== */

/** The live value of every setting: the stored override, else the shipped default. */
export function mergeSettings(
  overrides: ReadonlyMap<string, unknown>,
): Record<SettingKey, SettingValue> {
  const defaults: Record<SettingKey, SettingValue> = {
    defaultWeeklyCapacity: SYSTEM_DEFAULTS.defaultWeeklyCapacity,
    defaultMaxConcurrentTasks: SYSTEM_DEFAULTS.defaultMaxConcurrentTasks,
    softThresholdPct: SYSTEM_DEFAULTS.softThresholdPct,
    hardThresholdPct: SYSTEM_DEFAULTS.hardThresholdPct,
    criticalThresholdPct: SYSTEM_DEFAULTS.criticalThresholdPct,
    sustainedOverloadDays: SYSTEM_DEFAULTS.sustainedOverloadDays,
    otherWorkWarningPct: SYSTEM_DEFAULTS.otherWorkWarningPct,
    minutesPerEffortPoint: SYSTEM_DEFAULTS.minutesPerEffortPoint,
    timerIdlePromptMinutes: SYSTEM_DEFAULTS.timerIdlePromptMinutes,
    timerIdleAutoPauseMinutes: SYSTEM_DEFAULTS.timerIdleAutoPauseMinutes,
    timerAutoPauseOutsideHours: SYSTEM_DEFAULTS.timerAutoPauseOutsideHours,
    requireReasonForManualTime: SYSTEM_DEFAULTS.requireReasonForManualTime,
    failedLoginsToLock: SYSTEM_DEFAULTS.failedLoginsToLock,
    accountLockAutoClearMinutes: SYSTEM_DEFAULTS.accountLockAutoClearMinutes,
    recoveryCodeTtlMinutes: SYSTEM_DEFAULTS.recoveryCodeTtlMinutes,
    activationTokenTtlHours: SYSTEM_DEFAULTS.activationTokenTtlHours,
    passwordMinLength: SYSTEM_DEFAULTS.passwordMinLength,
    scoringWeights: SCORE_WEIGHTS,
  };

  const merged = { ...defaults };
  for (const definition of SETTING_DEFINITIONS) {
    if (!overrides.has(definition.key)) continue;
    /* An override that no longer validates — bounds tightened in a later
       release, say — is IGNORED rather than applied or thrown on. A stored value
       must never be able to take the application down at startup, and the
       shipped default is always a safe answer. */
    const checked = validateSetting(definition.key, overrides.get(definition.key));
    if (checked.ok) merged[definition.key] = checked.value;
  }
  return merged;
}

/** True when this key currently differs from what the system ships with. */
export function isOverridden(
  key: SettingKey,
  overrides: ReadonlyMap<string, unknown>,
): boolean {
  return overrides.has(key);
}
