'use server';

import { revalidatePath } from 'next/cache';

import { requireUser } from '@/lib/auth/current-user';
import { auditAlone } from '@/lib/db/queries/audit';
import { getProject } from '@/lib/db/queries/projects';
import {
  deleteSyncRule,
  insertSyncRule,
  setSyncRuleActive,
  upsertSyncSettings,
} from '@/lib/db/queries/meta-sync-settings';
import { can } from '@/lib/domain/permissions';
import {
  SYNC_CATEGORIES,
  SYNC_FREQUENCIES,
  nextRunAfter,
  type SyncFrequency,
} from '@/lib/domain/meta-sync-settings';
import { nowMs } from '@/lib/now';

/* ============================================================================
 * SETTINGS & SYNC — the writes, owner 2026-09-04
 * ----------------------------------------------------------------------------
 * ⚠️ SWITCHING AUTO-SYNC OFF IS AUDITED, AND THAT IS NOT CEREMONY. Meta serves
 * roughly thirty days of history and no more, so a project left switched off for
 * five weeks has a hole that CANNOT be backfilled — the data is gone from Meta's
 * side by then. When somebody later asks why a client's August is missing, this
 * audit row is the only thing that can answer it.
 * ========================================================================= */

export interface SettingsResult {
  readonly ok: boolean;
  readonly error?: string;
}

const RETENTION_MONTHS = [6, 12, 24, 36, 60, 120];
const INTERVALS = [1, 2, 4, 6, 12, 24];

export async function saveSyncSettingsAction(input: {
  readonly projectId: string;
  readonly autoSyncEnabled: boolean;
  readonly intervalHours: number;
  readonly retentionMonths: number;
}): Promise<SettingsResult> {
  const user = await requireUser();

  /* ⚠️ ADMIN, NOT COORDINATOR. Turning collection off loses history that cannot
     be recovered; 099's policy refuses it too, and this returns a sentence
     rather than a database error. */
  if (!can({ role: user.role, id: user.id }, 'meta.sync.configure')) {
    return { ok: false, error: 'Only an Admin can change how a project syncs.' };
  }

  if (!INTERVALS.includes(input.intervalHours)) {
    return { ok: false, error: 'That is not one of the intervals.' };
  }
  if (!RETENTION_MONTHS.includes(input.retentionMonths)) {
    return { ok: false, error: 'That is not one of the retention periods.' };
  }

  const project = await getProject(user.id, input.projectId);
  if (!project) return { ok: false, error: 'That project is no longer available.' };

  await upsertSyncSettings(user.id, input.projectId, {
    autoSyncEnabled: input.autoSyncEnabled,
    intervalHours: input.intervalHours,
    retentionMonths: input.retentionMonths,
  });

  await auditAlone(user, {
    entityType: 'setting',
    entityId: null,
    action: input.autoSyncEnabled ? 'meta.sync.enabled' : 'meta.sync.paused',
    after: {
      project: project.name,
      autoSync: input.autoSyncEnabled,
      intervalHours: input.intervalHours,
      retentionMonths: input.retentionMonths,
    },
  }).catch(() => {
    console.error('[meta-sync-settings] the audit entry could not be written');
  });

  revalidatePath('/studio');
  return { ok: true };
}

/* ---- Rules --------------------------------------------------------------- */

export async function createSyncRuleAction(input: {
  readonly projectId: string;
  readonly name: string;
  readonly description: string;
  readonly platforms: readonly string[];
  readonly categories: readonly string[];
  readonly frequency: string;
  readonly runAt: string;
  readonly timezone: string;
  readonly runOnWeekday: number | null;
  readonly retryMinutes: number;
  readonly maxRetries: number;
}): Promise<SettingsResult> {
  const user = await requireUser();

  /* A rule only narrows or reschedules collection; it cannot switch it off. */
  if (!can({ role: user.role, id: user.id }, 'project.edit')) {
    return { ok: false, error: 'Only a Coordinator and above can create a sync rule.' };
  }

  const name = input.name.trim();
  if (name.length < 2 || name.length > 60) {
    return { ok: false, error: 'Give the rule a name between 2 and 60 characters.' };
  }

  if (!(SYNC_FREQUENCIES as readonly string[]).includes(input.frequency)) {
    return { ok: false, error: 'That is not one of the frequencies.' };
  }
  const frequency = input.frequency as SyncFrequency;

  /* ⚠️ A RULE THAT COLLECTS NOTHING WOULD REPORT "Successful" FOREVER while
     pulling nothing at all. 099's check constraint refuses it as well; this
     returns a sentence instead of a database error. */
  const categories = input.categories.filter((c) =>
    (SYNC_CATEGORIES as readonly string[]).includes(c),
  );
  if (categories.length === 0) {
    return { ok: false, error: 'Choose at least one kind of data for this rule to collect.' };
  }

  const platforms = input.platforms.filter((p) => p === 'facebook' || p === 'instagram');

  if (!/^\d{2}:\d{2}$/.test(input.runAt)) {
    return { ok: false, error: 'That is not a valid time.' };
  }

  const weekday = frequency === 'weekly' ? input.runOnWeekday : null;
  if (frequency === 'weekly' && (weekday === null || weekday < 1 || weekday > 7)) {
    return { ok: false, error: 'Choose which day of the week this rule runs.' };
  }

  const project = await getProject(user.id, input.projectId);
  if (!project) return { ok: false, error: 'That project is no longer available.' };

  try {
    await insertSyncRule(user.id, {
      projectId: input.projectId,
      name,
      description: input.description.trim().slice(0, 300),
      platforms,
      categories,
      frequency,
      runAt: input.runAt,
      timezone: input.timezone || 'Asia/Karachi',
      runOnWeekday: weekday,
      retryMinutes: [5, 15, 30, 60].includes(input.retryMinutes) ? input.retryMinutes : 15,
      maxRetries: Math.min(10, Math.max(0, input.maxRetries)),
      /* ⚠️ THE FIRST RUN IS THE NEXT ONE, not now. A rule created at four in the
         afternoon should not immediately pull — the person creating it can press
         Resync if they want that, and a rule that fires on creation makes the
         button feel like it did something twice. Floored at the cron's own
         interval; see `nextRunAfter`. */
      nextRunAt: new Date(nextRunAfter({ frequency }, nowMs())).toISOString(),
    });
  } catch {
    /* 099's `meta_sync_rules_name_unique`. */
    return { ok: false, error: 'A rule with that name already exists on this project.' };
  }

  revalidatePath('/studio');
  return { ok: true };
}

export async function setSyncRuleActiveAction(
  ruleId: string,
  isActive: boolean,
): Promise<SettingsResult> {
  const user = await requireUser();
  if (!can({ role: user.role, id: user.id }, 'project.edit')) {
    return { ok: false, error: 'Only a Coordinator and above can pause a sync rule.' };
  }

  const changed = await setSyncRuleActive(user.id, ruleId, isActive);
  if (!changed) return { ok: false, error: 'That rule is no longer available.' };

  revalidatePath('/studio');
  return { ok: true };
}

export async function deleteSyncRuleAction(ruleId: string): Promise<SettingsResult> {
  const user = await requireUser();
  if (!can({ role: user.role, id: user.id }, 'project.edit')) {
    return { ok: false, error: 'Only a Coordinator and above can delete a sync rule.' };
  }

  const removed = await deleteSyncRule(user.id, ruleId);
  if (!removed) return { ok: false, error: 'That rule is no longer available.' };

  revalidatePath('/studio');
  return { ok: true };
}
