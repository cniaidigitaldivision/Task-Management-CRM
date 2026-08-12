import 'server-only';

import { open, seal } from '@/lib/auth/secret-box';
import { withUser } from '../client';

/* ============================================================================
 * THE CREDENTIALS VAULT — owner request 2026-08-12, migration 023
 * ----------------------------------------------------------------------------
 * ── EVERY QUERY HERE RUNS AS THE CALLER ──────────────────────────────────────
 * `withUser`, never `withAppRole`. Row-level security is the whole security
 * model for this table (migration 023, `app.can_read_credential`), so a query
 * that ran as the app role would see every credential in the division and hand
 * the filtering job to whoever remembered to write a `where` clause.
 *
 * There is deliberately no "list everything" function, not even for a Super
 * Admin. `listCredentials` under a Super Admin's identity already returns
 * everything, because that is what the policy says — so a separate unscoped
 * function would only ever be a way to accidentally bypass the policy.
 *
 * ── THE SECRET IS DECRYPTED IN ONE PLACE, ON PURPOSE ─────────────────────────
 * `revealCredential` is the only function that returns plaintext. Everything
 * else returns `hasSecret: boolean` — enough to draw the interface, useless to
 * anybody who obtains the response. A list endpoint that quietly included
 * plaintext "because the page needed it later" is exactly how a vault leaks.
 * ========================================================================= */

export interface CredentialRow {
  readonly id: string;
  readonly label: string;
  readonly kind: string;
  readonly projectId: string | null;
  readonly projectName: string | null;
  readonly issuedToId: string | null;
  readonly issuedToName: string | null;
  readonly username: string | null;
  /** Whether a secret is stored. **Never the secret itself** — see above. */
  readonly hasSecret: boolean;
  readonly url: string | null;
  readonly notes: string | null;
  readonly expiresAt: string | null;
  readonly lastRotatedAt: string | null;
  readonly createdByName: string | null;
  readonly updatedByName: string | null;
  readonly updatedAt: string;
}

const SELECT = `
  select c.id, c.label, c.kind, c.project_id, c.issued_to_id, c.username,
         c.secret_encrypted <> '' as has_secret,
         c.url, c.notes, c.expires_at, c.last_rotated_at, c.updated_at,
         p.name        as project_name,
         t.full_name   as issued_to_name,
         cb.full_name  as created_by_name,
         ub.full_name  as updated_by_name
    from public.credentials c
    left join public.projects p  on p.id = c.project_id
    left join public.users    t  on t.id = c.issued_to_id
    left join public.users    cb on cb.id = c.created_by_id
    left join public.users    ub on ub.id = c.updated_by_id
`;

function toRow(row: Record<string, unknown>): CredentialRow {
  return {
    id: row.id as string,
    label: row.label as string,
    kind: row.kind as string,
    projectId: (row.project_id as string | null) ?? null,
    projectName: (row.project_name as string | null) ?? null,
    issuedToId: (row.issued_to_id as string | null) ?? null,
    issuedToName: (row.issued_to_name as string | null) ?? null,
    username: (row.username as string | null) ?? null,
    hasSecret: row.has_secret === true,
    url: (row.url as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    expiresAt: row.expires_at ? String(row.expires_at).slice(0, 10) : null,
    lastRotatedAt: row.last_rotated_at ? new Date(row.last_rotated_at as string).toISOString() : null,
    createdByName: (row.created_by_name as string | null) ?? null,
    updatedByName: (row.updated_by_name as string | null) ?? null,
    updatedAt: new Date(row.updated_at as string).toISOString(),
  };
}

/** Everything this actor is allowed to see. The policy decides, not a filter. */
export async function listCredentials(actorId: string): Promise<CredentialRow[]> {
  const rows = await withUser(actorId, (tx) =>
    tx.unsafe(`${SELECT} order by c.label asc`),
  );
  return rows.map((row) => toRow(row as Record<string, unknown>));
}

export interface CredentialInput {
  readonly label: string;
  readonly kind: string;
  readonly projectId: string | null;
  readonly issuedToId: string | null;
  readonly username: string | null;
  /** Plaintext in, sealed before it reaches SQL. Empty means "not recorded". */
  readonly secret: string;
  readonly url: string | null;
  readonly notes: string | null;
  readonly expiresAt: string | null;
}

/**
 * Store a credential.
 *
 * `seal()` happens here rather than in the action, so there is no path from a
 * form to the table that could carry plaintext. The table would refuse it anyway
 * — `credentials_secret_is_sealed` makes that a database invariant — but a
 * refusal at insert time is a bug report, whereas sealing here is the design.
 */
export async function createCredential(
  actorId: string,
  input: CredentialInput,
): Promise<string> {
  const sealed = input.secret ? seal(input.secret) : '';

  const rows = await withUser(actorId, (tx) => tx`
    insert into public.credentials
      (label, kind, project_id, issued_to_id, username, secret_encrypted,
       url, notes, expires_at, created_by_id, updated_by_id)
    values
      (${input.label}, ${input.kind}, ${input.projectId}, ${input.issuedToId},
       ${input.username}, ${sealed}, ${input.url}, ${input.notes},
       ${input.expiresAt}, ${actorId}, ${actorId})
    returning id
  `);
  return rows[0].id as string;
}

/**
 * Update one.
 *
 * An **empty** `secret` leaves the stored one alone rather than clearing it —
 * otherwise editing a label would silently destroy the password, since a form
 * never renders the existing secret back into the field. Clearing is a separate,
 * explicit act (`clearSecret`).
 */
export async function updateCredential(
  actorId: string,
  id: string,
  input: CredentialInput,
): Promise<void> {
  const sealed = input.secret ? seal(input.secret) : null;

  await withUser(actorId, (tx) => tx`
    update public.credentials set
      label            = ${input.label},
      kind             = ${input.kind},
      project_id       = ${input.projectId},
      issued_to_id     = ${input.issuedToId},
      username         = ${input.username},
      secret_encrypted = coalesce(${sealed}, secret_encrypted),
      url              = ${input.url},
      notes            = ${input.notes},
      expires_at       = ${input.expiresAt}
    where id = ${id}
  `);
}

/** Forget the stored secret but keep the record of the account. */
export async function clearSecret(actorId: string, id: string): Promise<void> {
  await withUser(actorId, (tx) => tx`
    update public.credentials set secret_encrypted = '' where id = ${id}
  `);
}

export async function deleteCredential(actorId: string, id: string): Promise<boolean> {
  const rows = await withUser(actorId, (tx) => tx`
    delete from public.credentials where id = ${id} returning id
  `);
  return rows.length > 0;
}

/**
 * The one function that returns plaintext.
 *
 * Returns null when the row is not visible to this actor — the policy makes that
 * indistinguishable from "does not exist", which is the right answer to give
 * somebody probing ids.
 *
 * The caller is responsible for the step-up check and the audit event. Both live
 * in the action rather than here because this layer has no notion of a session,
 * and a security control that depends on the caller remembering is the one thing
 * this file cannot enforce — which is why `credential.reveal` is in
 * `STEP_UP_ACTIONS` and there is exactly one caller.
 */
export async function revealCredential(
  actorId: string,
  id: string,
): Promise<{ label: string; username: string | null; secret: string } | null> {
  const rows = await withUser(actorId, (tx) => tx`
    select label, username, secret_encrypted
      from public.credentials where id = ${id}
  `);

  const row = rows[0];
  if (!row) return null;

  const stored = row.secret_encrypted as string;
  return {
    label: row.label as string,
    username: (row.username as string | null) ?? null,
    /* `open()` passes a legacy plaintext value through unchanged. Nothing here can
       be legacy — the table has refused unsealed values since it was created —
       but using the shared box keeps key rotation working the same way it does
       for authenticator secrets. */
    secret: stored ? open(stored) : '',
  };
}
