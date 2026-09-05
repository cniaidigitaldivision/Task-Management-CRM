/* ============================================================================
 * SETTINGS & SYNC — the Studio's fifth tab, owner 2026-09-04
 * ----------------------------------------------------------------------------
 * Pure. No database, no React, no clock — every function takes `nowMs`, which is
 * what makes the awkward cases testable rather than argued about.
 *
 * ── ⚠️ THE CRON IS THE FLOOR, AND MOST FREQUENCIES HERE ARE BELOW IT ───────
 * `vercel.json` wakes the runner once a day — see `CRON_INTERVAL_HOURS` for why
 * that is not the two hours it was designed for. A rule asking for "hourly"
 * therefore runs daily in practice, because nothing exists to wake it in
 * between. `effectiveFrequency` says so plainly and the UI prints it next to the
 * choice — an interval the system cannot honour is a promise the page would be
 * making on the platform's behalf.
 * ========================================================================= */

export const SYNC_FREQUENCIES = ['hourly', 'every_6h', 'every_12h', 'daily', 'weekly'] as const;
export type SyncFrequency = (typeof SYNC_FREQUENCIES)[number];

export const FREQUENCY_LABEL: Readonly<Record<SyncFrequency, string>> = {
  hourly: 'Hourly',
  every_6h: 'Every 6 hours',
  every_12h: 'Every 12 hours',
  daily: 'Daily',
  weekly: 'Weekly',
};

/** How many hours a frequency asks for. Weekly is handled separately. */
const FREQUENCY_HOURS: Readonly<Record<SyncFrequency, number>> = {
  hourly: 1,
  every_6h: 6,
  every_12h: 12,
  daily: 24,
  weekly: 168,
};

/**
 * The scheduler's own interval, in hours, from `vercel.json`.
 *
 * ── ⚠️ 24 BECAUSE THE VERCEL ACCOUNT IS ON THE HOBBY PLAN ──────────────────
 * The design was two-hourly and the deploy was refused outright:
 *
 *     Hobby accounts are limited to daily cron jobs. This cron expression
 *     (0 * / 2 * * *) would run more than once per day.
 *
 * So collection runs once a day, at 00:30 Karachi — after the day it is
 * collecting has finished.
 *
 * ⚠️ EVERY CADENCE STATEMENT IN THE PRODUCT READS THIS CONSTANT. The stale
 * thresholds on an account, the words under the Quick Actions button, the
 * warning when somebody picks a frequency finer than the scheduler can honour —
 * all of it. Changing this number and `vercel.json` together is the whole of
 * restoring two-hourly collection on a Pro plan; changing either alone makes the
 * product describe a cadence it does not have.
 */
export const CRON_INTERVAL_HOURS = 24;

/** "once a day" / "every 2 hours" — the cadence in words, derived not typed. */
export const CRON_CADENCE =
  CRON_INTERVAL_HOURS === 24 ? 'once a day' : `every ${CRON_INTERVAL_HOURS} hours`;

/**
 * How long an account may go unsynced before it is behind, and then stale.
 *
 * ⚠️ DERIVED FROM THE INTERVAL, NOT FIXED. They were 6 and 24 hours, which were
 * three and twelve scheduler cycles when it ran two-hourly. Left fixed under a
 * daily cron every account would sit permanently on "Behind" — six hours after a
 * sync is perfectly healthy when the next one is not due for a day.
 */
export const BEHIND_AFTER_HOURS = Math.max(6, CRON_INTERVAL_HOURS * 1.5);
export const STALE_AFTER_HOURS = Math.max(24, CRON_INTERVAL_HOURS * 3);

/**
 * What a frequency actually delivers, given the cron.
 *
 * ⚠️ A RULE CANNOT RUN MORE OFTEN THAN THE JOB THAT CHECKS IT. Asking for hourly
 * gets two-hourly, and the page says so at the point of choosing rather than
 * letting somebody discover it from a Last Run column a week later.
 */
export function effectiveFrequency(frequency: SyncFrequency): {
  readonly hours: number;
  readonly honoured: boolean;
  readonly note: string;
} {
  const asked = FREQUENCY_HOURS[frequency];
  const actual = Math.max(asked, CRON_INTERVAL_HOURS);

  return {
    hours: actual,
    honoured: actual === asked,
    note:
      actual === asked
        ? `Runs every ${actual} hours.`
        : `The scheduler runs ${CRON_CADENCE}, so this collects ${CRON_CADENCE} rather than ${FREQUENCY_LABEL[frequency].toLowerCase()}.`,
  };
}

export const SYNC_CATEGORIES = ['metrics', 'posts', 'profile'] as const;
export type SyncCategory = (typeof SYNC_CATEGORIES)[number];

/**
 * ⚠️ EACH ONE MAPS ONTO A REAL BRANCH OF `lib/meta/sync.ts`. A category naming
 * something the runner cannot scope would be a checkbox that changes nothing —
 * the worst kind of setting, because it looks like it worked.
 */
export const CATEGORY_DETAIL: Readonly<
  Record<SyncCategory, { label: string; description: string; token: string }>
> = {
  metrics: {
    label: 'Daily insights',
    description: 'Reach, views, engagement and follower counts, one row per day per metric.',
    token: 'chart-1',
  },
  posts: {
    label: 'Posts & performance',
    description: 'Each published post with its permalink, surface and per-post figures.',
    token: 'chart-2',
  },
  profile: {
    label: 'Profile snapshot',
    description: 'The account’s follower and media totals as they stand right now.',
    token: 'chart-3',
  },
};

/* ---- The rule ------------------------------------------------------------ */

export interface SyncRule {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly platforms: readonly string[];
  readonly categories: readonly string[];
  readonly frequency: SyncFrequency;
  readonly runAt: string;
  readonly timezone: string;
  readonly runOnWeekday: number | null;
  readonly retryMinutes: number;
  readonly maxRetries: number;
  readonly isActive: boolean;
  readonly nextRunAt: string;
  readonly lastRunAt: string | null;
  readonly lastOutcome: 'ok' | 'failed' | null;
  readonly lastError: string | null;
  readonly runCount: number;
  readonly failureCount: number;
  readonly createdByName: string | null;
}

export interface SyncSettings {
  readonly autoSyncEnabled: boolean;
  readonly intervalHours: number;
  readonly retentionMonths: number;
  readonly pausedAt: string | null;
  readonly pausedByName: string | null;
  readonly updatedAt: string | null;
  readonly updatedByName: string | null;
}

export const DEFAULT_SETTINGS: SyncSettings = {
  autoSyncEnabled: true,
  intervalHours: CRON_INTERVAL_HOURS,
  retentionMonths: 36,
  pausedAt: null,
  pausedByName: null,
  updatedAt: null,
  updatedByName: null,
};

/**
 * A rule's success rate.
 *
 * ⚠️ NULL BEFORE IT HAS RUN, never 100%. A rule created a minute ago has not
 * succeeded at anything, and printing "100%" against it is the single most
 * misleading number this page could carry — it is indistinguishable from a rule
 * that has run four hundred times without a failure.
 */
export function successRate(rule: Pick<SyncRule, 'runCount' | 'failureCount'>): number | null {
  if (rule.runCount === 0) return null;
  return ((rule.runCount - rule.failureCount) / rule.runCount) * 100;
}

export interface RuleState {
  readonly label: string;
  readonly token: string;
  readonly detail: string;
}

/**
 * What a rule is doing.
 *
 * ⚠️ "OVERDUE" IS A REAL STATE AND IT IS SHOWN. A rule past its time that has
 * not run means the cron is not reaching this project — which is true on this
 * branch today, because the runner is registered in `vercel.json` and the branch
 * is not deployed. Reporting every rule as "Active" would hide exactly that.
 */
export function ruleState(
  rule: Pick<SyncRule, 'isActive' | 'nextRunAt' | 'lastOutcome' | 'lastError'>,
  nowMs: number,
): RuleState {
  if (!rule.isActive) {
    return { label: 'Paused', token: 'text-tertiary', detail: 'Will not run until resumed.' };
  }
  if (rule.lastOutcome === 'failed') {
    return {
      label: 'Failed',
      token: 'feedback-error',
      /* Meta's own message. A guessed cause sends somebody to the wrong place. */
      detail: rule.lastError ?? 'The last run failed.',
    };
  }

  const due = Date.parse(rule.nextRunAt);
  /* A whole cron interval late, not a minute late: a rule due at 02:00 that the
     02:00 tick has not yet reached is not overdue, it is about to run. */
  if (nowMs - due > CRON_INTERVAL_HOURS * 3_600_000) {
    return {
      label: 'Overdue',
      token: 'feedback-warning',
      detail: 'Was due more than one scheduler cycle ago and has not run.',
    };
  }

  return { label: 'Active', token: 'feedback-success', detail: 'Running on schedule.' };
}

/* ---- The four figures ---------------------------------------------------- */

export interface SyncRun {
  readonly id: string;
  readonly accountName: string;
  readonly platform: string;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly outcome: 'ok' | 'failed';
  readonly daysWritten: number;
  readonly postsWritten: number;
  readonly error: string | null;
}

export interface SchedulerKpis {
  readonly activeRules: number;
  readonly platformsCovered: number;
  /** Null until something has actually run — see `successRate`. */
  readonly successRatePercent: number | null;
  readonly runsCounted: number;
  readonly failedRuns: number;
  /** The soonest active rule, or null when nothing is scheduled. */
  readonly nextRun: { readonly at: string; readonly name: string } | null;
}

/**
 * The Sync Schedule Manager's four cards.
 *
 * ⚠️ THE SUCCESS RATE IS OVER `meta_sync_runs`, NOT OVER THE RULES. The
 * reference labels it "Last 30 Days", and runs are the only thing that records
 * what happened in those thirty days — a rule carries a lifetime counter, so
 * averaging rules would mix a rule created today with one running since August.
 */
export function schedulerKpis(input: {
  readonly rules: readonly SyncRule[];
  readonly runs: readonly SyncRun[];
  readonly nowMs: number;
}): SchedulerKpis {
  const { rules, runs, nowMs } = input;
  const active = rules.filter((r) => r.isActive);

  const platforms = new Set<string>();
  for (const r of active) for (const p of r.platforms) platforms.add(p);

  const THIRTY_DAYS = 30 * 24 * 3_600_000;
  const recent = runs.filter((r) => nowMs - Date.parse(r.startedAt) < THIRTY_DAYS);
  const failed = recent.filter((r) => r.outcome === 'failed').length;

  const next = active
    .map((r) => ({ at: r.nextRunAt, name: r.name }))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))[0];

  return {
    activeRules: active.length,
    platformsCovered: platforms.size,
    successRatePercent:
      recent.length === 0 ? null : ((recent.length - failed) / recent.length) * 100,
    runsCounted: recent.length,
    failedRuns: failed,
    nextRun: next ?? null,
  };
}

/* ---- System health ------------------------------------------------------- */

export interface HealthLine {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  readonly ok: boolean;
  readonly detail: string;
}

export interface SystemHealth {
  readonly verdict: string;
  readonly token: string;
  readonly lines: readonly HealthLine[];
}

/**
 * The Settings tab's System Health panel.
 *
 * ⚠️ EVERY LINE IS CHECKED, NOT ASSERTED. The reference draws five green ticks
 * as fixed text. Here each one is a real answer, and each can come back bad —
 * which is the entire value of a health panel. In particular "Last sync" goes
 * amber the moment collection falls behind, which is the state this branch is
 * in until it is deployed.
 */
export function systemHealth(input: {
  readonly tokenConfigured: boolean;
  readonly accountCount: number;
  readonly failingAccounts: number;
  readonly lastSyncedAt: string | null;
  readonly autoSyncEnabled: boolean;
  readonly nowMs: number;
}): SystemHealth {
  const { tokenConfigured, accountCount, failingAccounts, lastSyncedAt, autoSyncEnabled, nowMs } =
    input;

  const staleAfter = BEHIND_AFTER_HOURS * 3_600_000;
  const sinceSync = lastSyncedAt === null ? null : nowMs - Date.parse(lastSyncedAt);
  const syncFresh = sinceSync !== null && sinceSync < staleAfter;

  const lines: HealthLine[] = [
    {
      key: 'token',
      label: 'System user token',
      value: tokenConfigured ? 'Active' : 'Missing',
      ok: tokenConfigured,
      detail: tokenConfigured
        ? 'A system-user token never expires, so there is nothing to renew.'
        : 'META_SYSTEM_USER_TOKEN is not set. Nothing can be collected.',
    },
    {
      key: 'accounts',
      label: 'Connected accounts',
      value: accountCount === 0 ? 'None' : String(accountCount),
      ok: accountCount > 0,
      detail:
        accountCount === 0
          ? 'No Facebook Page or Instagram account is linked to this project.'
          : 'Meta serves figures for every linked account.',
    },
    {
      key: 'permissions',
      label: 'Account access',
      value: failingAccounts === 0 ? 'Valid' : `${failingAccounts} failing`,
      ok: failingAccounts === 0,
      detail:
        failingAccounts === 0
          ? 'Every account answered on its last attempt.'
          : 'An account is refusing us — most often access revoked on Meta’s side.',
    },
    {
      key: 'engine',
      label: 'Sync engine',
      value: autoSyncEnabled ? 'Operational' : 'Paused',
      ok: autoSyncEnabled,
      detail: autoSyncEnabled
        ? `The scheduler wakes every ${CRON_INTERVAL_HOURS} hours.`
        : 'Auto-sync is switched off, so nothing is being collected.',
    },
    {
      key: 'last-sync',
      label: 'Last sync',
      value: lastSyncedAt === null ? 'Never' : relativeShort(sinceSync ?? 0),
      ok: syncFresh,
      detail:
        lastSyncedAt === null
          ? 'Nothing has been collected yet.'
          : syncFresh
            ? 'Collection is current.'
            : 'Collection is behind. The scheduler is not reaching this project.',
    },
  ];

  const bad = lines.filter((l) => !l.ok).length;

  return {
    verdict: bad === 0 ? 'Healthy' : bad === 1 ? 'Needs attention' : 'Degraded',
    token: bad === 0 ? 'feedback-success' : bad === 1 ? 'feedback-warning' : 'feedback-error',
    lines,
  };
}

function relativeShort(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 2) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/* ---- Next run ------------------------------------------------------------ */

/**
 * When a rule next runs.
 *
 * ── ⚠️ THE RULE'S OWN TIME IS THE ANCHOR, AND IT USED TO BE IGNORED ────────
 * This function took only `frequency` and returned `now + interval`. Everything
 * downstream honoured that faithfully, so the interval was always right — and
 * the TIME on the rule was decoration. A rule saved as "daily at 02:00" ran at
 * whatever o'clock it happened to be created, then every 24 hours from there,
 * while the table and the calendar both printed 02:00. Found from a live rule:
 * saved with `run_at 21:55`, its next run was computed at 23:55 Karachi.
 *
 * The time now anchors a grid and the next slot strictly after `now` is taken.
 * For a sub-daily rule that means the anchor plus whole intervals — 21:55 with a
 * two-hour step gives 21:55, 23:55, 01:55 and so on — which is why 2, 6 and 12
 * are the only sub-daily steps offered: each divides 24 exactly, so the grid
 * closes on itself every day and the anchor never drifts.
 *
 * ── ⚠️ THE FLOOR AT THE CRON'S INTERVAL STAYS ─────────────────────────────
 * The runner wakes once a day, so an "hourly" rule cannot run hourly however it
 * is scheduled. Without the floor it would be perpetually overdue and its status
 * would read "Overdue" forever while working exactly as well as it possibly can.
 *
 * ── ⚠️ KARACHI, AND THE OFFSET IS A CONSTANT ON PURPOSE ───────────────────
 * `run_at` is a Karachi wall-clock time. Pakistan has observed no daylight
 * saving since 2009, so UTC+5 is fixed and the arithmetic can be plain — no zone
 * database, and no dependency on the reader's or the server's clock, both of
 * which have already caused a date to be reported a day out in this codebase.
 */
export function nextRunAfter(
  rule: Pick<SyncRule, 'frequency' | 'runAt' | 'runOnWeekday'>,
  nowMs: number,
): number {
  const DAY = 86_400_000;
  const stepMs = Math.max(FREQUENCY_HOURS[rule.frequency], CRON_INTERVAL_HOURS) * 3_600_000;

  /* Shift into "Karachi milliseconds", so flooring to a day boundary lands on a
     Karachi midnight rather than a UTC one. */
  const local = nowMs + KARACHI_OFFSET_MS;

  const [h, m] = rule.runAt.split(':').map(Number);
  const minutes = ((h || 0) * 60 + (m || 0)) * 60_000;
  const anchor = Math.floor(local / DAY) * DAY + minutes;

  const back = (ms: number) => ms - KARACHI_OFFSET_MS;

  if (rule.frequency === 'weekly') {
    /* 1970-01-01 was a Thursday, which is index 3 when Monday is 0. */
    const target = (rule.runOnWeekday ?? 1) - 1;
    let candidate = anchor;
    for (let i = 0; i < 8; i += 1) {
      const dow = (Math.floor(candidate / DAY) + 3) % 7;
      if (dow === target && candidate > local) return back(candidate);
      candidate += DAY;
    }
    /* Unreachable in practice — eight days always contain the weekday. */
    return back(candidate);
  }

  if (rule.frequency === 'daily') {
    let candidate = anchor;
    while (candidate <= local) candidate += DAY;
    return back(candidate);
  }

  /* Sub-daily: the anchor sets the phase, the interval sets the spacing. Walk
     backwards first, because the anchor may be later today than `now`. */
  let candidate = anchor;
  while (candidate > local) candidate -= stepMs;
  while (candidate <= local) candidate += stepMs;
  return back(candidate);
}

/** Pakistan has observed no daylight saving since 2009, so this is a constant. */
const KARACHI_OFFSET_MS = 5 * 3_600_000;

/* ---- The calendar -------------------------------------------------------- */

export interface CalendarEntry {
  readonly ruleId: string;
  readonly name: string;
  readonly token: string;
  /** 0–6, Monday first. */
  readonly weekday: number;
  /** Minutes past midnight, in the rule's own zone. */
  readonly minutes: number;
  readonly frequency: SyncFrequency;
}

/**
 * Where each rule sits on the week grid.
 *
 * ⚠️ AN HOURLY RULE IS ONE ENTRY, NOT A HUNDRED AND SIXTY-EIGHT. The reference
 * draws it as a single band across the top of the week, which is right: drawing
 * a block per occurrence would fill the grid with identical tiles and hide every
 * other rule behind them.
 */
export function weekEntries(rules: readonly SyncRule[]): readonly CalendarEntry[] {
  const out: CalendarEntry[] = [];

  rules.forEach((rule, i) => {
    if (!rule.isActive) return;

    const [h, m] = rule.runAt.split(':').map(Number);
    const minutes = (h || 0) * 60 + (m || 0);
    const token = `chart-${(i % 8) + 1}`;

    if (rule.frequency === 'weekly') {
      out.push({
        ruleId: rule.id,
        name: rule.name,
        token,
        /* Stored 1–7 ISO with Monday as 1; the grid is 0-based Monday-first. */
        weekday: (rule.runOnWeekday ?? 1) - 1,
        minutes,
        frequency: rule.frequency,
      });
      return;
    }

    /* Everything else happens every day, so it appears on all seven columns —
       and the renderer draws a sub-daily rule as one band rather than as seven
       separate blocks. */
    for (let d = 0; d < 7; d += 1) {
      out.push({ ruleId: rule.id, name: rule.name, token, weekday: d, minutes, frequency: rule.frequency });
    }
  });

  return out;
}

/** "02:00" → "2:00 AM". The reference's clock format. */
export function clockLabel(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}
