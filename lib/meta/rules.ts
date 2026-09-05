import 'server-only';

import { withAppRole } from '@/lib/db/client';
import { nextRunAfter, type SyncFrequency } from '@/lib/domain/meta-sync-settings';
import { nowMs } from '@/lib/now';

import { runMetaSync, type AccountSyncResult } from './sync';

/* ============================================================================
 * RUNNING THE SYNC RULES — owner, 2026-09-04
 * ----------------------------------------------------------------------------
 * The Sync Schedule Manager promises that a rule runs on its schedule. This is
 * what makes that true; without it the tab would store intentions.
 *
 * ── ⚠️ A PROJECT WITH NO ACTIVE RULE KEEPS THE DEFAULT PULL, UNCHANGED ──────
 * The standing instruction on this codebase is not to disturb a working thing,
 * and the two-hourly pull works — 407 metric rows and 50 posts, collected. So:
 *
 *     no active rules  → the default pull, exactly as before
 *     active rules     → only the rules that are due, scoped to their categories
 *
 * Every project has no rules the moment 099 commits, which means this cannot
 * make any project worse off on the day it ships.
 *
 * ── ⚠️ THE READS GO THROUGH SECURITY DEFINER FUNCTIONS ─────────────────────
 * A cron has no session, so `app.current_user_id()` is NULL, every policy
 * evaluates false, and a direct read returns ZERO ROWS WITH NO ERROR — the job
 * then reports a clean success having done nothing. That has happened three
 * times on this feature already (094, 095 and 097 all exist because of it).
 * ========================================================================= */

export interface RuleRunResult {
  readonly ruleId: string;
  readonly ruleName: string;
  readonly projectName: string;
  readonly outcome: 'ok' | 'failed';
  readonly accounts: number;
  readonly daysWritten: number;
  readonly postsWritten: number;
  readonly error?: string;
  readonly nextRunAt: string;
}

interface DueRule {
  readonly ruleId: string;
  readonly projectName: string;
  readonly name: string;
  readonly platforms: readonly string[];
  readonly categories: readonly string[];
  readonly frequency: SyncFrequency;
  /* ⚠️ THE ANCHOR, carried from `app.meta_sync_rules_due` (migration 101).
     Without it the runner recomputes an unanchored next-run on every execution
     and the rule drifts off the time it was saved with — silently undoing the
     fix, since the first run is what moves it. */
  readonly runAt: string;
  readonly runOnWeekday: number | null;
}

async function dueRules(at: Date): Promise<DueRule[]> {
  const rows = await withAppRole((tx) => tx`
    select * from app.meta_sync_rules_due(${at.toISOString()}::timestamptz)
  `);

  return (rows as Array<Record<string, unknown>>).map((r) => ({
    ruleId: String(r.rule_id),
    projectName: String(r.project_name),
    name: String(r.name),
    platforms: Array.isArray(r.platforms) ? (r.platforms as string[]) : [],
    categories: Array.isArray(r.categories) ? (r.categories as string[]) : [],
    frequency: String(r.frequency) as SyncFrequency,
    /* postgres.js hands a `time` back as "02:00:00"; the domain wants "02:00". */
    runAt: String(r.run_at).slice(0, 5),
    runOnWeekday:
      r.run_on_weekday === null || r.run_on_weekday === undefined
        ? null
        : Number(r.run_on_weekday),
  }));
}

/**
 * The projects still on the default two-hourly pull.
 *
 * ⚠️ NAMES, BECAUSE `runMetaSync` FILTERS BY NAME — see its option comment for
 * why the account reader cannot be changed to return an id without dropping a
 * function the live cron depends on.
 */
export async function projectsOnDefaultSync(): Promise<string[]> {
  const rows = await withAppRole((tx) => tx`
    select project_name from app.meta_projects_on_default_sync()
  `);
  return (rows as Array<Record<string, unknown>>).map((r) => String(r.project_name));
}

async function record(
  ruleId: string,
  next: Date,
  outcome: 'ok' | 'failed',
  error: string | null,
): Promise<void> {
  await withAppRole((tx) => tx`
    select app.record_rule_run(
      ${ruleId}::uuid, ${next.toISOString()}::timestamptz, ${outcome}, ${error}
    )
  `);
}

/**
 * Run every rule that is due.
 *
 * ⚠️ SEQUENTIAL AND PER-RULE ISOLATED, for the same reason `runMetaSync` is:
 * Meta rate-limits per app, and one rule's failure must not cost every other
 * client their collection.
 */
export async function runDueRules(): Promise<RuleRunResult[]> {
  const at = new Date(nowMs());
  const rules = await dueRules(at);
  const out: RuleRunResult[] = [];

  for (const rule of rules) {
    /* ⚠️ COMPUTED FROM NOW, NOT FROM THE MISSED DUE TIME, and floored at the
       cron's own interval — see `nextRunAfter`. A rule overdue by a fortnight
       must next run at its next natural time, not three hundred times catching
       up; and one asking for "hourly" must not be scheduled sooner than the job
       that would run it, or its status reads "Overdue" forever. */
    const next = new Date(
      nextRunAfter(
        { frequency: rule.frequency, runAt: rule.runAt, runOnWeekday: rule.runOnWeekday },
        nowMs(),
      ),
    );

    try {
      const results = await runMetaSync({
        projectName: rule.projectName,
        categories: rule.categories,
      });

      /* A rule covering only Facebook must not report Instagram's outcome. */
      const scoped =
        rule.platforms.length === 0
          ? results
          : results.filter((r) => rule.platforms.includes(r.platform));

      const failed = scoped.filter((r: AccountSyncResult) => r.outcome === 'failed');

      await record(
        rule.ruleId,
        next,
        failed.length > 0 ? 'failed' : 'ok',
        /* ⚠️ Meta's own message, verbatim. A guessed cause sends somebody to the
           wrong place; "(#190) This method must be called with a Page Access
           Token" tells them exactly what is wrong. */
        failed.length > 0 ? (failed[0].error ?? 'An account failed.') : null,
      );

      out.push({
        ruleId: rule.ruleId,
        ruleName: rule.name,
        projectName: rule.projectName,
        outcome: failed.length > 0 ? 'failed' : 'ok',
        accounts: scoped.length,
        daysWritten: scoped.reduce((n, r) => n + r.daysWritten, 0),
        postsWritten: scoped.reduce((n, r) => n + r.postsWritten, 0),
        error: failed.length > 0 ? (failed[0].error ?? undefined) : undefined,
        nextRunAt: next.toISOString(),
      });
    } catch (error) {
      /* ⚠️ RECORDED AND SWALLOWED, never rethrown: one rule throwing must not
         abandon the rules after it in the loop. */
      const message = error instanceof Error ? error.message : 'The rule threw.';
      await record(rule.ruleId, next, 'failed', message).catch(() => {
        console.error('[meta-rules] could not record a failure');
      });

      out.push({
        ruleId: rule.ruleId,
        ruleName: rule.name,
        projectName: rule.projectName,
        outcome: 'failed',
        accounts: 0,
        daysWritten: 0,
        postsWritten: 0,
        error: message,
        nextRunAt: next.toISOString(),
      });
    }
  }

  return out;
}

