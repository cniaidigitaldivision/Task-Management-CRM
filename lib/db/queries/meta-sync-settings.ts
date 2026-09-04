import 'server-only';

import type {
  SyncFrequency,
  SyncRule,
  SyncRun,
  SyncSettings,
} from '@/lib/domain/meta-sync-settings';
import { DEFAULT_SETTINGS } from '@/lib/domain/meta-sync-settings';

import { withUser } from '../client';

/* ============================================================================
 * SETTINGS & SYNC — migration 099
 * ----------------------------------------------------------------------------
 * Everything the Settings & Sync tab reads, and the writes it makes. RLS decides
 * scope throughout: `withUser` sets `app.user_id` and 099's policies do the
 * rest, so there is no second visibility rule here to drift from
 * `app.project_is_visible`.
 * ========================================================================= */

function isoText(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function isoOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : isoText(value);
}

/* ---- Settings ------------------------------------------------------------ */

/**
 * A project's sync switches.
 *
 * ⚠️ RETURNS THE DEFAULTS RATHER THAN NULL when no row exists, and the defaults
 * are the real ones — `DEFAULT_SETTINGS.intervalHours` is the cron's own
 * interval from `vercel.json`. Every project has no row the moment 099 commits,
 * so a null here would mean every caller writing the same fallback and one of
 * them eventually getting it wrong.
 */
export async function syncSettingsForProject(
  actorId: string,
  projectId: string,
): Promise<SyncSettings> {
  return withUser(actorId, async (tx) => {
    const rows = await tx`
      select s.*,
             p.full_name as paused_by_name,
             u.full_name as updated_by_name
        from public.meta_sync_settings s
        left join public.users p on p.id = s.paused_by_id
        left join public.users u on u.id = s.updated_by_id
       where s.project_id = ${projectId}::uuid
    `;
    if (rows.length === 0) return DEFAULT_SETTINGS;

    const r = rows[0] as Record<string, unknown>;
    return {
      autoSyncEnabled: r.auto_sync_enabled as boolean,
      intervalHours: Number(r.interval_hours ?? DEFAULT_SETTINGS.intervalHours),
      retentionMonths: Number(r.retention_months ?? DEFAULT_SETTINGS.retentionMonths),
      pausedAt: isoOrNull(r.paused_at),
      pausedByName: (r.paused_by_name as string | null) ?? null,
      updatedAt: isoOrNull(r.updated_at),
      updatedByName: (r.updated_by_name as string | null) ?? null,
    };
  });
}

/**
 * ⚠️ THE UPSERT NEEDS SELECT, INSERT *AND* UPDATE POLICIES. Missing the last one
 * fails with a message about the INSERT, which sends you looking in the wrong
 * place — 099's `meta_sync_settings_write` is `for all`, which covers all three.
 *
 * ⚠️ AND NO BACKTICK MAY APPEAR INSIDE THE SQL BELOW. It is a tagged template
 * literal, so a backtick in a comment TERMINATES THE STRING — which is exactly
 * what this note used to do from inside the query, and it failed as four
 * unrelated syntax errors on the following lines.
 */
export async function upsertSyncSettings(
  actorId: string,
  projectId: string,
  input: {
    readonly autoSyncEnabled: boolean;
    readonly intervalHours: number;
    readonly retentionMonths: number;
  },
): Promise<void> {
  await withUser(
    actorId,
    (tx) => tx`
      insert into public.meta_sync_settings
        (project_id, auto_sync_enabled, interval_hours, retention_months,
         paused_at, paused_by_id, updated_at, updated_by_id)
      values (
        ${projectId}::uuid, ${input.autoSyncEnabled}, ${input.intervalHours},
        ${input.retentionMonths},
        ${input.autoSyncEnabled ? null : new Date().toISOString()},
        ${input.autoSyncEnabled ? null : actorId}::uuid,
        now(), ${actorId}::uuid
      )
      on conflict (project_id) do update
        set auto_sync_enabled = excluded.auto_sync_enabled,
            interval_hours    = excluded.interval_hours,
            retention_months  = excluded.retention_months,
            paused_at         = excluded.paused_at,
            paused_by_id      = excluded.paused_by_id,
            updated_at        = now(),
            updated_by_id     = ${actorId}::uuid
    `,
  );
}

/* ---- Rules --------------------------------------------------------------- */

function toRule(row: Record<string, unknown>): SyncRule {
  return {
    id: row.id as string,
    name: row.name as string,
    description: (row.description as string) ?? '',
    /* `text[]` arrives as a real JS array; the guard is for a row read through a
       narrower select, where an undefined would crash `.map` in the drawer. */
    platforms: Array.isArray(row.platforms) ? (row.platforms as string[]) : [],
    categories: Array.isArray(row.categories) ? (row.categories as string[]) : [],
    frequency: row.frequency as SyncFrequency,
    /* ⚠️ postgres.js hands a `time` back as "02:00:00"; the UI wants "02:00" and
       an <input type="time"> refuses the seconds. */
    runAt: String(row.run_at).slice(0, 5),
    timezone: row.timezone as string,
    runOnWeekday: row.run_on_weekday === null || row.run_on_weekday === undefined
      ? null
      : Number(row.run_on_weekday),
    retryMinutes: Number(row.retry_minutes ?? 15),
    maxRetries: Number(row.max_retries ?? 3),
    isActive: row.is_active as boolean,
    nextRunAt: isoText(row.next_run_at),
    lastRunAt: isoOrNull(row.last_run_at),
    lastOutcome: (row.last_outcome as 'ok' | 'failed' | null) ?? null,
    lastError: (row.last_error as string | null) ?? null,
    runCount: Number(row.run_count ?? 0),
    failureCount: Number(row.failure_count ?? 0),
    createdByName: (row.created_by_name as string | null) ?? null,
  };
}

export async function syncRulesForProject(
  actorId: string,
  projectId: string,
): Promise<readonly SyncRule[]> {
  return withUser(actorId, async (tx) => {
    const rows = await tx`
      select r.*, u.full_name as created_by_name
        from public.meta_sync_rules r
        left join public.users u on u.id = r.created_by_id
       where r.project_id = ${projectId}::uuid
       order by r.is_active desc, r.next_run_at
    `;
    return rows.map((r) => toRule(r as Record<string, unknown>));
  });
}

export async function insertSyncRule(
  actorId: string,
  input: {
    readonly projectId: string;
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
    readonly nextRunAt: string;
  },
): Promise<string> {
  return withUser(actorId, async (tx) => {
    const rows = await tx`
      insert into public.meta_sync_rules
        (project_id, name, description, platforms, categories, frequency,
         run_at, timezone, run_on_weekday, retry_minutes, max_retries,
         next_run_at, created_by_id)
      values (
        ${input.projectId}::uuid, ${input.name}, ${input.description},
        ${input.platforms as string[]}::text[], ${input.categories as string[]}::text[],
        ${input.frequency}, ${input.runAt}::time, ${input.timezone},
        ${input.runOnWeekday}, ${input.retryMinutes}, ${input.maxRetries},
        ${input.nextRunAt}::timestamptz, ${actorId}::uuid
      )
      returning id
    `;
    return rows[0].id as string;
  });
}

export async function setSyncRuleActive(
  actorId: string,
  ruleId: string,
  isActive: boolean,
): Promise<boolean> {
  return withUser(actorId, async (tx) => {
    const rows = await tx`
      update public.meta_sync_rules
         set is_active = ${isActive}, updated_at = now()
       where id = ${ruleId}::uuid
      returning id
    `;
    return rows.length > 0;
  });
}

export async function deleteSyncRule(actorId: string, ruleId: string): Promise<boolean> {
  return withUser(actorId, async (tx) => {
    const rows = await tx`
      delete from public.meta_sync_rules where id = ${ruleId}::uuid returning id
    `;
    return rows.length > 0;
  });
}

/* ---- Runs ---------------------------------------------------------------- */

/**
 * The project's sync history — the Activity Log, and the success rate.
 *
 * ⚠️ JOINED THROUGH `meta_accounts` BECAUSE `meta_sync_runs` HAS NO PROJECT
 * COLUMN. It is keyed on the account, which is right — an account belongs to
 * exactly one project — but it means the RLS that scopes this is
 * `meta_accounts`', not the runs table's. Reading the runs table directly would
 * return every project's runs.
 */
export async function syncRunsForProject(
  actorId: string,
  projectId: string,
  limit = 100,
): Promise<readonly SyncRun[]> {
  return withUser(actorId, async (tx) => {
    const rows = await tx`
      select r.id, r.started_at, r.finished_at, r.outcome,
             r.days_written, r.posts_written, r.error,
             coalesce(a.display_name, a.username, a.meta_object_id) as account_name,
             p.slug as platform
        from public.meta_sync_runs r
        join public.meta_accounts a on a.id = r.meta_account_id
        join public.platforms     p on p.id = a.platform_id
       where a.project_id = ${projectId}::uuid
       order by r.started_at desc
       limit ${limit}
    `;

    return rows.map((raw) => {
      const r = raw as Record<string, unknown>;
      return {
        id: r.id as string,
        accountName: r.account_name as string,
        platform: r.platform as string,
        startedAt: isoText(r.started_at),
        finishedAt: isoOrNull(r.finished_at),
        outcome: r.outcome as 'ok' | 'failed',
        daysWritten: Number(r.days_written ?? 0),
        postsWritten: Number(r.posts_written ?? 0),
        error: (r.error as string | null) ?? null,
      };
    });
  });
}

/* ---- The permission log -------------------------------------------------- */

export interface PermissionEvent {
  readonly id: string;
  readonly actorName: string | null;
  readonly actorEmail: string;
  readonly actorRole: string;
  readonly action: string;
  readonly entityType: string;
  readonly outcome: string;
  readonly reason: string | null;
  readonly createdAt: string;
}

/**
 * Who did what to access and credentials.
 *
 * ⚠️ IT READS `audit_log`, WHICH ALREADY EXISTS — 370 rows and growing. The
 * reference implies a Meta-specific permission log; building a second audit
 * table for one tab would give the division two places to look when answering
 * "who changed that?", and they would disagree the first time one of them was
 * missed.
 *
 * ⚠️ AND IT IS NOT SCOPED TO A PROJECT. Granting somebody a role is not an act
 * on a project — the entity types below are account-level. Scoping it to the
 * selected project would show an empty table and imply nothing had happened.
 */
export async function permissionEvents(
  actorId: string,
  limit = 60,
): Promise<readonly PermissionEvent[]> {
  return withUser(actorId, async (tx) => {
    const rows = await tx`
      select l.id, l.actor_email, l.actor_role, l.action, l.entity_type,
             l.outcome, l.reason, l.created_at,
             u.full_name as actor_name
        from public.audit_log l
        left join public.users u on u.id = l.actor_id
       where l.entity_type in ('security', 'credential', 'user', 'setting')
       order by l.created_at desc
       limit ${limit}
    `;

    return rows.map((raw) => {
      const r = raw as Record<string, unknown>;
      return {
        id: r.id as string,
        actorName: (r.actor_name as string | null) ?? null,
        actorEmail: r.actor_email as string,
        actorRole: String(r.actor_role),
        action: r.action as string,
        entityType: r.entity_type as string,
        outcome: String(r.outcome),
        reason: (r.reason as string | null) ?? null,
        createdAt: isoText(r.created_at),
      };
    });
  });
}
