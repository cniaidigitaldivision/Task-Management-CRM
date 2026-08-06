import 'server-only';

import { cache } from 'react';
import { redirect } from 'next/navigation';

import type { Role, Theme } from '@/lib/domain/constants';
import { withAppRole } from '@/lib/db/client';

import { clearSessionCookie, readSessionTokenHash } from './session';

/* ============================================================================
 * THE SIGNED-IN USER — the single entry point for "who is asking?"
 * ----------------------------------------------------------------------------
 * Every page, every layout and every server action gets its actor from here and
 * nowhere else. That is not tidiness; it is the reason the authorisation model
 * can be trusted. If two places could construct an actor, one of them would
 * eventually construct one that skipped a check.
 *
 * ── WHY React `cache()` AND NOT A MODULE-LEVEL VARIABLE ──────────────────────
 * A layout, a page and three server components in one render all want the
 * current user. Without deduplication that is five session lookups per
 * navigation. `cache()` scopes the memo to a single request — a module-level
 * variable would leak one user's identity into another user's request, which on
 * a server rendering many people at once is the worst bug in this entire file.
 *
 * ── FAIL CLOSED, ALWAYS ─────────────────────────────────────────────────────
 * `getCurrentUser()` returns null on anything unexpected. `requireUser()`
 * redirects. Nothing here throws a user into the application on a maybe.
 * ========================================================================= */

export interface CurrentUser {
  readonly id: string;
  readonly sessionId: string;
  readonly fullName: string;
  readonly email: string;
  readonly role: Role;
  readonly roleTitle: string | null;
  readonly avatarUrl: string | null;
  readonly theme: Theme;
  readonly timezone: string;
  readonly weeklyCapacityPoints: number;
  readonly maxConcurrentTasks: number;
  readonly stepUpVerifiedAt: Date | null;
}

export type SessionOutcome = 'ok' | 'not_found' | 'revoked' | 'expired' | 'idle' | 'inactive';

/** How much the sliding window is extended by on activity. doc 16 §4. */
const SLIDE_MINUTES: Readonly<Record<Role, number>> = {
  super_admin: 8 * 60,
  admin: 24 * 60,
  team_coordinator: 7 * 24 * 60,
  member: 7 * 24 * 60,
};

/**
 * Resolve the cookie. Returns null when there is no usable session.
 *
 * Memoised per request. Not exported un-memoised — a caller who wanted a "fresh"
 * read would be asking for a second identity within one render, and there is no
 * legitimate reason to want that.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const hash = await readSessionTokenHash();
  if (!hash) return null;

  const rows = await withAppRole((tx) => tx`select * from app.session_resolve(${hash})`);
  const row = rows[0];
  if (!row || row.outcome !== 'ok') return null;

  return {
    id: row.user_id as string,
    sessionId: row.session_id as string,
    fullName: row.full_name as string,
    email: row.email as string,
    role: row.role as Role,
    roleTitle: (row.role_title as string | null) ?? null,
    avatarUrl: (row.avatar_url as string | null) ?? null,
    theme: row.theme as Theme,
    timezone: row.timezone as string,
    weeklyCapacityPoints: Number(row.weekly_capacity_points ?? 36),
    maxConcurrentTasks: Number(row.max_concurrent_tasks ?? 5),
    stepUpVerifiedAt: (row.step_up_verified_at as Date | null) ?? null,
  };
});

/**
 * Why the session was refused. Used by the layout to send someone to the right
 * screen with the right sentence — "you were signed out for inactivity" is a
 * different message from "your account has been suspended", and telling someone
 * the wrong one wastes their time and generates a support message.
 */
export async function sessionOutcome(): Promise<SessionOutcome> {
  const hash = await readSessionTokenHash();
  if (!hash) return 'not_found';
  const rows = await withAppRole((tx) => tx`select outcome from app.session_resolve(${hash})`);
  return ((rows[0]?.outcome as SessionOutcome) ?? 'not_found');
}

/**
 * The guard. Use this at the top of every protected page and every server
 * action that changes anything.
 *
 * A dead cookie is cleared on the way out. Leaving it in place means the browser
 * keeps presenting a token that will never work again, and every future request
 * pays for a database lookup to be told so.
 */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (user) return user;

  const outcome = await sessionOutcome();
  if (outcome !== 'not_found') await clearSessionCookie();
  redirect(`/login?reason=${outcome}`);
}

/** Slide the window. Fire-and-forget: a failure here must never block a page. */
export async function touchSession(user: CurrentUser): Promise<void> {
  try {
    await withAppRole(
      (tx) => tx`select app.session_touch(${user.sessionId}, ${SLIDE_MINUTES[user.role]})`,
    );
  } catch {
    /* A page render is not the place to surface a bookkeeping failure. */
  }
}

/** FR-149. The step-up is valid for ten minutes (SYSTEM_DEFAULTS). */
export function stepUpIsFresh(user: CurrentUser, nowMs: number): boolean {
  if (!user.stepUpVerifiedAt) return false;
  return nowMs - user.stepUpVerifiedAt.getTime() <= 10 * 60 * 1000;
}
