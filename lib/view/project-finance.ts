import type { ProjectRow } from '@/lib/db/queries/types';

/* ============================================================================
 * STRIPPING MONEY BEFORE IT CROSSES TO THE BROWSER
 * ----------------------------------------------------------------------------
 * Owner, 2026-08-19: *"this monthly fee or any financial thing should only be
 * visible to super admin and admin only. It will not be visible to any coordinator
 * or anyone else on the team."*
 *
 * ── ⚠️ NOT RENDERING A FIELD IS NOT THE SAME AS NOT SENDING IT ────────────────
 * The first attempt gated the fee on `project.view_finance` at every render site and
 * stopped there. Then a check of the actual response found `50000` in the HTML of
 * `/projects` — because `ProjectsWorkspace` is a Client Component and the whole
 * `ProjectRow` is serialised into the RSC payload to reach it. Nothing displayed it;
 * anybody could read it in DevTools or `view-source`, including the Coordinator the
 * owner specifically named.
 *
 * So the value is removed on the SERVER, before it is handed to any component. The
 * render-site gates stay — belt and braces, and they are what stops an Admin's own
 * screen showing money in places it does not belong — but this is the one that makes
 * the statement true.
 *
 * ── WHAT THIS IS AND IS NOT ──────────────────────────────────────────────────
 * This closes the accidental leak. It is NOT a confidentiality boundary against a
 * determined Coordinator: row-level security still lets them select
 * `projects.monthly_fee_pkr` through any query they can reach, and closing that
 * needs a column-level REVOKE, which is a schema change and its own piece of work.
 * The distinction is worth keeping straight rather than believing this does more
 * than it does.
 * ========================================================================= */

/**
 * The same row with every financial field nulled, unless the reader may see them.
 *
 * ⚠️ Returns the array unchanged when the reader IS allowed, rather than mapping
 * over it pointlessly — the common case on this screen is an Admin.
 */
export function redactFinance<T extends Pick<ProjectRow, 'monthlyFeePkr'>>(
  projects: readonly T[],
  canSeeFinance: boolean,
): readonly T[] {
  if (canSeeFinance) return projects;
  return projects.map((project) => redactOne(project, false));
}

/** One row. Same rule, for the detail page which reads a single project. */
export function redactOne<T extends Pick<ProjectRow, 'monthlyFeePkr'>>(
  project: T,
  canSeeFinance: boolean,
): T {
  if (canSeeFinance) return project;
  /* Null, not 0 or omitted. `monthlyFeePkr` is already nullable and every consumer
     handles null as "no fee recorded", so nulling it needs no new branch anywhere.
     Deleting the key would break the type; zero would be a lie a total could add up. */
  return { ...project, monthlyFeePkr: null };
}
