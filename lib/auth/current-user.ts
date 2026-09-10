import 'server-only';

import { cache } from 'react';
import { redirect } from 'next/navigation';

import { MFA_REQUIRED_ROLES, type Role, type Theme } from '@/lib/domain/constants';
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
 * A dead cookie is cleared on the way out where that is permitted. Leaving it in
 * place means the browser keeps presenting a token that will never work again,
 * and every future request pays for a database lookup to be told so.
 *
 * ⚠️ **The clear is best-effort and must stay that way.** A page render cannot
 * write cookies in Next.js, so `clearSessionCookie()` fails here and reports it
 * rather than throwing — see the note on that function. When it threw, this
 * function returned **HTTP 500 on every protected page** instead of redirecting,
 * for anybody whose account was in a non-active state. The redirect is the
 * contract; the cookie is housekeeping.
 */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (user) return user;

  const outcome = await sessionOutcome();
  if (outcome !== 'not_found') await clearSessionCookie();
  redirect(`/login?reason=${outcome}`);
}

/**
 * The guard, plus FR-145: a privileged account with no second factor gets no
 * further than the enrolment screen.
 *
 * ── WHY THIS IS NOT INSIDE `requireUser()` ───────────────────────────────────
 * The enrolment page calls `requireUser()` itself — it has to, since there is no
 * way to enrol without being signed in. Putting the check there would redirect
 * that page to itself, forever. So the check lives at the boundary it actually
 * protects: the authenticated application group. `/mfa-setup` sits outside it.
 *
 * Until this existed, FR-145's "signed in only as far as the enrolment screen"
 * was a redirect and a convention. A convention is not a control: typing
 * /dashboard walked straight past it.
 *
 * ── WHY IT IS `cache()`d ─────────────────────────────────────────────────────
 * The (app) layout calls this, and every rank-gated route now calls it twice more
 * — once in its segment layout, once in its page. The factor count is a database
 * round trip, and running it three times per navigation for every privileged
 * account is three times the latency for one answer that cannot change mid-render.
 * Deduplicating it also removed a duplicate that predates the segment layouts.
 */
export const requireEnrolledUser = cache(async (): Promise<CurrentUser> => {
  const user = await requireUser();
  if (!MFA_REQUIRED_ROLES.includes(user.role)) return user;

  const rows = await withAppRole(
    (tx) => tx`select count(*) as n from app.auth_verified_factors(${user.id})`,
  );
  if (Number(rows[0]?.n ?? 0) === 0) redirect('/mfa-setup');

  return user;
});

/**
 * The guard, plus a rank floor.
 *
 * ── WHY HIDING THE NAV ITEM IS NOT ENOUGH ────────────────────────────────────
 * `sectionsForRole()` already omits Team, Workload, Reports and Settings from a
 * Member's sidebar, and its own comment says so: "hiding a nav item is
 * convenience, never security" (NFR-006). Typing the URL reached the page
 * anyway, and while row-level security meant a Member saw only their own row —
 * so nothing leaked — they were looking at a screen built to answer a question
 * they are not entitled to ask, with one row in it.
 *
 * Found by the signed-in smoke test, which fetches every route as a Member. A
 * build cannot find this and neither can a click-through, because the sidebar
 * never offers the link.
 *
 * Redirects rather than showing a 403: there is nothing useful the person can do
 * with a refusal, and their own starting screen is one navigation away.
 *
 * ── ⚠️ A RANK-GATED ROUTE MUST ALSO CALL THIS IN A SEGMENT `layout.tsx` ───────
 * `loading.tsx` puts the page inside a Suspense boundary, and Next.js answers a
 * suspended render by *streaming* — headers go out before the page body has run.
 * A `redirect()` from inside that boundary therefore cannot be an HTTP 307; it is
 * delivered inside the stream, so the response is **200 with a rendered skeleton
 * of a screen the reader is not entitled to**, followed by a client-side bounce.
 *
 * Measured, not assumed: adding the skeletons turned all five rank-gated routes
 * from 307 to 200 in the signed-in smoke test, and removing one `loading.tsx`
 * turned that one back. A layout renders *outside* its own segment's boundary, so
 * the same call there refuses before a single byte is sent.
 *
 * Both calls stay. The layout is what makes the refusal a real redirect; the page
 * is the security boundary and the thing that returns the actor. Deleting either
 * leaves something broken, and the page's copy is the one a future route will be
 * written with, so it must remain sufficient on its own.
 */
export async function requireRole(minimum: Role): Promise<CurrentUser> {
  // Inherits the enrolment check — a rank floor on top of an unenrolled session
  // would let a privileged account past the very screen it was sent to.
  const user = await requireEnrolledUser();
  const rank: Readonly<Record<Role, number>> = {
    super_admin: 4,
    admin: 3,
    team_coordinator: 2,
    member: 1,
  };
  if (rank[user.role] < rank[minimum]) {
    redirect(user.role === 'member' ? '/my-work' : '/dashboard');
  }
  return user;
}

/* ============================================================================
 * WHICH DEPARTMENT IS ASKING — migration 117
 * ----------------------------------------------------------------------------
 * ⚠️ A SEPARATE LOOKUP, NOT TWO MORE COLUMNS ON `session_resolve`. Widening that
 * function means DROP and re-CREATE — its return type is fixed — on the one code
 * path that decides whether anybody can sign in at all. The cost avoided is a
 * single primary-key lookup, memoised per request; the risk avoided is the whole
 * team locked out by a migration. `where-the-slowness-actually-is` says plainly
 * that this application's slowness has been payload size and the router cache,
 * never a query like this one.
 *
 * ⚠️ AND IT IS NOT THE FLOOR. Migrations 117 and 118 decide who reads a lead;
 * this decides whether a page and a nav item are DRAWN. A caller who forgot it
 * would show somebody an empty screen, not somebody else's data.
 * ========================================================================= */

export interface ActingDepartment {
  /** The stable key — `sales`, `digital`, … — or null if unassigned. */
  readonly key: string | null;
  readonly name: string | null;
  /** True only for the manager OF THAT department. Not an app rank. */
  readonly isManager: boolean;
}

const NO_DEPARTMENT: ActingDepartment = { key: null, name: null, isManager: false };

export const getCurrentDepartment = cache(async (): Promise<ActingDepartment> => {
  const user = await getCurrentUser();
  if (!user) return NO_DEPARTMENT;

  try {
    const rows = await withAppRole((tx) => tx`
      select d.key, d.name, u.department_role::text as department_role
        from public.users u
        join public.departments d on d.id = u.department_id
       where u.id = ${user.id}::uuid
    `);
    const row = rows[0];
    if (!row) return NO_DEPARTMENT;

    return {
      key: String(row.key),
      name: String(row.name),
      isManager: row.department_role === 'manager',
    };
  } catch {
    /* ⚠️ FAILS CLOSED, and closed means "no department" — which grants nothing.
       The same stance as getCurrentUser: nobody is thrown into a screen on a
       maybe. */
    return NO_DEPARTMENT;
  }
});

/**
 * May this session use the Campaign & Lead Desk?
 *
 * ⚠️ THIS MIRRORS `app.crm_is_open_to_caller()` IN MIGRATION 118, and the
 * database is the one that matters. Kept in step by hand because there is no way
 * to share an expression across TypeScript and a policy — so if one changes, the
 * other must, and the worst case if they drift is a page that draws and then
 * shows nothing rather than a page that leaks.
 *
 * Owner, 2026-09-10: *"all this CRM belongs to the sales manager and the
 * salespersons. Plus admin and super admin are by default added."*
 */
export function crmIsOpenTo(user: CurrentUser, department: ActingDepartment): boolean {
  return user.role === 'admin' || user.role === 'super_admin' || department.key === 'sales';
}

/** The guard for every CRM page. Sends anybody else where they belong. */
export async function requireCrmAccess(): Promise<{
  user: CurrentUser;
  department: ActingDepartment;
}> {
  const user = await requireEnrolledUser();
  const department = await getCurrentDepartment();

  if (!crmIsOpenTo(user, department)) {
    redirect(user.role === 'member' ? '/my-work' : '/dashboard');
  }
  return { user, department };
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
