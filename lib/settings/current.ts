import 'server-only';

import { cache } from 'react';

import { withAppRole } from '@/lib/db/client';
import { fromStorageKey } from '@/lib/db/queries/settings';
import {
  mergeSettings,
  type SettingKey,
  type SettingValue,
} from '@/lib/domain/settings';

/* ============================================================================
 * THE LIVE SETTINGS — FR-057
 * ----------------------------------------------------------------------------
 * One accessor, so that "changed on the Settings screen" and "used by the
 * engine" cannot drift apart. Before this existed, every consumer imported
 * SYSTEM_DEFAULTS directly, which meant an override could be saved, audited and
 * displayed as changed while nothing behaved differently — a setting that
 * pretends to work is worse than one that is honestly read-only.
 *
 * ── CACHED PER REQUEST ───────────────────────────────────────────────────────
 * React's `cache()`, so a page that reads the thresholds in four places makes
 * one query. Not a module-level cache: that would hold a stale value for the
 * life of the server process, and the first thing anybody does after changing a
 * setting is reload the page to check it took.
 *
 * ── IT FALLS BACK RATHER THAN THROWS ─────────────────────────────────────────
 * Through `app.settings_effective()`, which is readable without an identity
 * (migration 017) because the login screen displays the lock threshold. If that
 * read fails for any reason the shipped defaults are returned. The alternative
 * is taking the login page down over a configuration lookup, and the defaults
 * are by definition a safe answer.
 * ========================================================================= */

const SHIPPED = mergeSettings(new Map());

export const getSettings = cache(
  async (): Promise<Record<SettingKey, SettingValue>> => {
    try {
      const rows = await withAppRole((tx) => tx`select app.settings_effective() as settings`);
      const raw = (rows[0]?.settings ?? {}) as Record<string, unknown>;
      return mergeSettings(
        new Map(Object.entries(raw).map(([key, value]) => [fromStorageKey(key), value])),
      );
    } catch {
      return SHIPPED;
    }
  },
);

/** For a call site that wants one number and would otherwise destructure. */
export async function getSetting<K extends SettingKey>(
  key: K,
): Promise<Record<SettingKey, SettingValue>[K]> {
  return (await getSettings())[key];
}
