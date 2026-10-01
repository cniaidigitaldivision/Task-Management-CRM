import 'server-only';

import { withUser } from '../client';

/* ============================================================================
 * INTAKE KEYS — LAYER 1
 * ----------------------------------------------------------------------------
 * Who may file a lead into a project from outside. Migration 277.
 *
 * ── ⚠️ NO AUTHORISATION CODE IN THIS FILE ─────────────────────────────────
 * Everything runs through `withUser`, and 277's policies decide: an Admin sees
 * every key, a manager sees their own projects', a salesperson sees none. The
 * minting and withdrawing functions check again inside themselves, so a screen
 * that got this wrong would be refused by the database rather than obeyed.
 * ========================================================================= */

export interface CrmIntakeKey {
  readonly id: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly label: string;
  /** The first twelve characters. The rest exists only as a hash. */
  readonly prefix: string;
  readonly isEnabled: boolean;
  readonly revokedAt: string | null;
  readonly defaultSource: string;
  readonly allowedOrigins: readonly string[];
  readonly hourlyLimit: number;
  readonly accepted: number;
  readonly refused: number;
  /** Why the most recent call failed, or null when the last one worked. */
  readonly lastRefusal: string | null;
  readonly lastUsedAt: string | null;
  readonly createdAt: string;
}

const iso = (value: unknown): string | null =>
  value ? new Date(value as string).toISOString() : null;

/**
 * Every key the reader may see, newest first.
 *
 * ⚠️ `app.crm_project_name()`, NEVER a join to `public.projects`. That table's
 * policy is project MEMBERSHIP, and a sales manager is not a member of the
 * schemes they sell — the join returns nothing for exactly the person this
 * screen is for. The ninth occurrence of this bug was two weeks ago.
 */
export async function listIntakeKeys(
  actorId: string,
  projectId: string | null,
): Promise<readonly CrmIntakeKey[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select k.id, k.project_id, k.label, k.key_prefix, k.is_enabled, k.revoked_at,
           k.default_source::text as default_source, k.allowed_origins,
           k.hourly_limit, k.accepted, k.refused, k.last_refusal,
           k.last_used_at, k.created_at,
           app.crm_project_name(k.project_id) as project_name
      from public.crm_intake_keys k
     where (${projectId}::uuid is null or k.project_id = ${projectId}::uuid)
     order by k.is_enabled desc, k.created_at desc
  `);

  return (rows as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    projectId: String(r.project_id),
    projectName: String(r.project_name ?? ''),
    label: String(r.label ?? ''),
    prefix: String(r.key_prefix ?? ''),
    isEnabled: Boolean(r.is_enabled),
    revokedAt: iso(r.revoked_at),
    defaultSource: String(r.default_source ?? 'website'),
    allowedOrigins: ((r.allowed_origins as string[] | null) ?? []).map(String),
    hourlyLimit: Number(r.hourly_limit ?? 0),
    accepted: Number(r.accepted ?? 0),
    refused: Number(r.refused ?? 0),
    lastRefusal: (r.last_refusal as string | null) ?? null,
    lastUsedAt: iso(r.last_used_at),
    createdAt: new Date(r.created_at as string).toISOString(),
  }));
}
