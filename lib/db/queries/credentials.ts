import 'server-only';

import { dateOnly } from '../row-values';

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
  readonly username: string | null;
  /** Whether a secret is stored. **Never the secret itself** — see above. */
  readonly hasSecret: boolean;
  readonly url: string | null;
  /** The brand mark the person CHOSE for this credential, or null to work it out
   *  from the URL. Migration 051 — see `credentialService`. */
  readonly service: string | null;
  readonly notes: string | null;
  readonly expiresAt: string | null;
  readonly lastRotatedAt: string | null;
  readonly createdByName: string | null;
  readonly updatedByName: string | null;
  readonly updatedAt: string;
  readonly createdAt: string;

  /* ── Migration 057 ─────────────────────────────────────────────────────── */

  /**
   * `active` | `inactive` | `compromised`.
   *
   * ⚠️ ONE column, not two booleans — (deactivated AND compromised) is not a state
   * anybody means. And `compromised` is NOT a synonym for expired: `expiresAt`
   * says a secret will stop working, this says it must stop being used while it
   * still does.
   */
  readonly status: 'active' | 'inactive' | 'compromised';
  /** When the secret was last decrypted. Null means nobody has ever read it. */
  readonly lastUsedAt: string | null;
  /**
   * How many people hold a named grant on this credential (migration 050).
   *
   * ⚠️ Counted through the same RLS as everything else, so it is "grants you can
   * see". For an Admin that is all of them, which is the only reader who is shown
   * the number.
   */
  readonly sharedWith: number;

  /**
   * Who this credential is issued to. Migration 059.
   *
   * ⚠️ CUSTODY, NOT ACCESS, and the distinction is why migration 047 exists: before
   * it, being issued a credential let you read it, which granted a permission as a
   * side effect of a description. Nothing in RLS reads this. Who may decrypt is
   * rank plus `credential_grants`.
   *
   * ⚠️ REPLACES `issuedToId`/`issuedToName`, which held one person and are gone
   * from this type entirely as of 2026-08-25. They were left on it "harmlessly"
   * when 059 landed, and the harm showed up immediately: the form stopped
   * submitting `issuedToId` (the picker submits `issuedToIds`), so every save
   * wrote NULL to the old column — while the table, the details panel and the
   * project panel were all still reading it. Ticking Kashif and Lareeb saved both
   * and then displayed a dash. A field nobody maintains is worse than no field, so
   * the only way to keep three readers honest is to leave them nothing to read.
   */
  readonly holders: readonly { readonly id: string; readonly name: string }[];
}

const SELECT = `
  select c.id, c.label, c.kind, c.project_id, c.username,
         c.secret_encrypted <> '' as has_secret,
         c.url, c.service, c.notes, c.expires_at, c.last_rotated_at, c.updated_at,
         p.name        as project_name,
         cb.full_name  as created_by_name,
         ub.full_name  as updated_by_name,
         c.created_at, c.status, c.last_used_at,
         (select count(*) from public.credential_grants g
           where g.credential_id = c.id and g.effect = 'allow') as shared_with,
         /* ⚠️ jsonb rather than two parallel arrays of ids and names — those can
            come back different lengths if a user row vanishes mid-query, and the
            reader then pairs the wrong name to the wrong id. 'coalesce' because
            'jsonb_agg' over no rows is NULL, and a credential issued to nobody must
            read as an empty list rather than crash the mapper. */
         coalesce((
           select jsonb_agg(jsonb_build_object('id', hu.id, 'name', hu.full_name)
                            order by hu.full_name)
             from public.credential_holders h
             join public.users hu on hu.id = h.user_id
            where h.credential_id = c.id
         ), '[]'::jsonb) as holders
    from public.credentials c
    left join public.projects p  on p.id = c.project_id
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
    username: (row.username as string | null) ?? null,
    hasSecret: row.has_secret === true,
    url: (row.url as string | null) ?? null,
    service: (row.service as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    expiresAt: dateOnly(row.expires_at),
    lastRotatedAt: row.last_rotated_at ? new Date(row.last_rotated_at as string).toISOString() : null,
    createdByName: (row.created_by_name as string | null) ?? null,
    updatedByName: (row.updated_by_name as string | null) ?? null,
    updatedAt: new Date(row.updated_at as string).toISOString(),
    createdAt: new Date(row.created_at as string).toISOString(),
    /* Defaulted rather than asserted: migration 057 made the column NOT NULL,
       but a row read through an older projection would otherwise be undefined
       and render as an empty pill. */
    status: (row.status as CredentialRow['status']) ?? 'active',
    /* Nullable, unlike the two above — nobody may ever have read this secret. */
    lastUsedAt: row.last_used_at ? new Date(row.last_used_at as string).toISOString() : null,
    sharedWith: Number(row.shared_with ?? 0),
    holders: Array.isArray(row.holders)
      ? (row.holders as Array<Record<string, unknown>>).map((h) => ({
          id: h.id as string,
          name: (h.name as string | null) ?? 'Someone',
        }))
      : [],
  };
}

/** Everything this actor is allowed to see. The policy decides, not a filter. */
export async function listCredentials(actorId: string): Promise<CredentialRow[]> {
  const rows = await withUser(actorId, (tx) =>
    tx.unsafe(`${SELECT} order by c.label asc`),
  );
  return rows.map((row) => toRow(row as Record<string, unknown>));
}

/**
 * One credential, by id. Null when it does not exist OR is not visible to the
 * caller.
 *
 * ⚠️ The two are deliberately indistinguishable, which is the same rule
 * `revealCredential` follows: a reader trying ids must not be able to tell a
 * missing row from a forbidden one.
 *
 * ⚠️ Never carries the secret — `SELECT` projects `has_secret` and not
 * `secret_encrypted`. Decrypting is `revealCredential`, which is audited.
 */
export async function getCredential(
  actorId: string,
  id: string,
): Promise<CredentialRow | null> {
  const rows = await withUser(actorId, (tx) =>
    tx.unsafe(`${SELECT} where c.id = $1`, [id]),
  );
  const row = rows[0];
  return row ? toRow(row as Record<string, unknown>) : null;
}

export interface CredentialInput {
  readonly label: string;
  readonly kind: string;
  readonly projectId: string | null;
  /* ⚠️ NO `issuedToId`. Custody is `setCredentialHolders` — a credential can be
     issued to several people (059), and one column cannot hold two. The old one is
     NOT written here either: nothing reads it, and setting it to null on every
     save would erase what it used to say for no gain. Its column comment records
     that it is superseded. */
  readonly username: string | null;
  /** Plaintext in, sealed before it reaches SQL. Empty means "not recorded". */
  readonly secret: string;
  readonly url: string | null;
  /** A mark key, validated by the action against the real tables before it gets
   *  here. Null means "derive it". */
  readonly service: string | null;
  readonly notes: string | null;
  readonly expiresAt: string | null;
  /** Who it is issued to. Empty means nobody in particular. Migration 059. */
  readonly holderIds: readonly string[];
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
      (label, kind, project_id, username, secret_encrypted,
       url, service, notes, expires_at, created_by_id, updated_by_id)
    values
      (${input.label}, ${input.kind}, ${input.projectId},
       ${input.username}, ${sealed}, ${input.url}, ${input.service}, ${input.notes},
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
 *
 * ── ⚠️ RETURNS WHETHER A ROW WAS ACTUALLY WRITTEN, AND IT HAS TO ─────────────
 * This was `Promise<void>`, and that made an RLS refusal INVISIBLE. `credentials_update`
 * is `admin OR project owner`, so a Team Coordinator editing somebody else's
 * project updated nothing, no error was raised — an UPDATE that matches no row is
 * a successful UPDATE — and `saveCredentialAction` went on to report "Saved." The
 * person closed the dialog believing the password had changed.
 *
 * `returning id` turns "the policy refused this" into a value the action can read.
 * Found by checking what each button on the new Access panel would actually do,
 * rather than by seeing it fail.
 */
export async function updateCredential(
  actorId: string,
  id: string,
  input: CredentialInput,
): Promise<boolean> {
  const sealed = input.secret ? seal(input.secret) : null;

  const rows = await withUser(actorId, (tx) => tx`
    update public.credentials set
      label            = ${input.label},
      kind             = ${input.kind},
      project_id       = ${input.projectId},
      username         = ${input.username},
      secret_encrypted = coalesce(${sealed}, secret_encrypted),
      url              = ${input.url},
      service          = ${input.service},
      notes            = ${input.notes},
      expires_at       = ${input.expiresAt}
    where id = ${id}
    returning id
  `);
  return rows.length > 0;
}

/** Forget the stored secret but keep the record of the account.
 *
 *  ⚠️ Returns whether it happened, for the same reason as `updateCredential` —
 *  see the note there. Silently reporting "the stored password is gone" when the
 *  policy refused the update is the worst of the three: somebody would go on
 *  believing a live secret had been destroyed. */
export async function clearSecret(actorId: string, id: string): Promise<boolean> {
  const rows = await withUser(actorId, (tx) => tx`
    update public.credentials set secret_encrypted = ''
     where id = ${id}
    returning id
  `);
  return rows.length > 0;
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

/* ==========================================================================
 * NAMED PER-CREDENTIAL GRANTS — migration 050
 * --------------------------------------------------------------------------
 * Owner, 2026-08-24: *"In this modal only admins and super admins can add
 * someone and can delete someone from here."*
 *
 * ── ⚠️ THESE ONLY EVER ADD ACCESS ─────────────────────────────────────────
 * Rank is the floor (`app.can_read_credential`), so a Coordinator's access is not
 * represented here and cannot be taken away here. Revoking a grant that does not
 * exist changes nothing rather than removing rank — which is why `revoke` reports
 * whether it actually deleted a row instead of returning void.
 * ========================================================================== */

export interface CredentialGrantRow {
  readonly userId: string;
  /** `allow` — named in despite rank (050). `deny` — named OUT despite rank
   *  (052). One row per person per credential, so never both. */
  readonly effect: 'allow' | 'deny';
  readonly name: string;
  readonly role: string;
  readonly avatarUrl: string | null;
  readonly grantedByName: string | null;
  readonly grantedAt: string;
}

/** Who has been given this one credential, by name. Newest grant last, so the
 *  list reads in the order the decisions were made. */
export async function listCredentialGrants(
  actorId: string,
  credentialId: string,
): Promise<CredentialGrantRow[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select g.user_id, g.granted_at, g.effect,
           u.full_name as name, u.role, u.avatar_url,
           b.full_name as granted_by_name
      from public.credential_grants g
      join public.users u on u.id = g.user_id
      left join public.users b on b.id = g.granted_by_id
     where g.credential_id = ${credentialId}
     order by g.granted_at asc
  `);

  return rows.map((row) => ({
    userId: row.user_id as string,
    effect: row.effect === 'deny' ? 'deny' : 'allow',
    name: (row.name as string | null) ?? 'Unknown',
    role: row.role as string,
    avatarUrl: (row.avatar_url as string | null) ?? null,
    grantedByName: (row.granted_by_name as string | null) ?? null,
    grantedAt: new Date(row.granted_at as string).toISOString(),
  }));
}

/**
 * Whether this person holds a named grant on this credential.
 *
 * ⚠️ Its own query rather than a scan of `listCredentialGrants`, because the
 * caller is `revealCredentialAction` deciding whether somebody may be handed a
 * password. That path should ask the narrowest question it can and should not
 * pull a list of other people's names to answer it.
 *
 * Runs as the caller: `credential_grants_select` lets somebody see their OWN row
 * (migration 050), which is exactly and only what this needs.
 */
export async function hasCredentialGrant(
  actorId: string,
  credentialId: string,
): Promise<boolean> {
  const rows = await withUser(actorId, (tx) => tx`
    select 1 from public.credential_grants
     where credential_id = ${credentialId} and user_id = ${actorId}
       and effect = 'allow'
     limit 1
  `);
  return rows.length > 0;
}

/**
 * Write an exception for one person on one credential.
 *
 * `effect: 'allow'` names a Member IN despite their rank; `'deny'` names somebody
 * at Coordinator or above OUT despite theirs. The primary key means a person holds
 * one row or none, so this is an upsert rather than an insert — changing your mind
 * about somebody REPLACES the previous decision instead of leaving two rows that
 * contradict each other.
 *
 * ⚠️ `granted_by_id` is overwritten on conflict, deliberately: the row records who
 * is answerable for its CURRENT state, and after somebody changes it that is them.
 * The audit log keeps the history; this column answers "who decided what it says
 * now".
 *
 * The database refuses two combinations outright — see the trigger in migration
 * 052: denying the Super Admin, and granting somebody who already has rank. Both
 * arrive here as a thrown error, which the action turns into a sentence.
 */
export async function setCredentialAccess(
  actorId: string,
  credentialId: string,
  userId: string,
  effect: 'allow' | 'deny',
): Promise<void> {
  await withUser(actorId, (tx) => tx`
    insert into public.credential_grants
      (credential_id, user_id, granted_by_id, effect)
    values (${credentialId}, ${userId}, ${actorId}, ${effect})
    on conflict (credential_id, user_id) do update
      set effect = ${effect},
          granted_by_id = ${actorId},
          granted_at = now()
  `);
}

/**
 * Remove any exception, returning this person to whatever their rank says.
 *
 * ⚠️ ONE FUNCTION, TWO OPPOSITE MEANINGS, so it returns which one happened:
 * clearing an `allow` takes access away, clearing a `deny` gives it back. Without
 * that the action would have to report "removed" for both, and "removed" is
 * actively misleading for the second — the person GAINED access.
 */
export async function clearCredentialAccess(
  actorId: string,
  credentialId: string,
  userId: string,
): Promise<'allow' | 'deny' | null> {
  const rows = await withUser(actorId, (tx) => tx`
    delete from public.credential_grants
     where credential_id = ${credentialId} and user_id = ${userId}
    returning effect
  `);
  const effect = rows[0]?.effect as string | undefined;
  if (effect === 'deny') return 'deny';
  if (effect === 'allow') return 'allow';
  return null;
}

/* ============================================================================
 * MIGRATION 057 · STATE, AND THE TWO HISTORIES THE DRAWER SHOWS
 * ========================================================================= */

/**
 * Retire a credential, flag it as leaked, or put it back in use.
 *
 * ── ⚠️ NOT A DELETE, AND THE DIFFERENCE MATTERS ─────────────────────────────
 * The secret is kept. "We changed the client's password and this is what it used
 * to be" is a real thing to need, and deleting is a separate, separately audited
 * act with its own permission. Deactivating is reversible; deleting is not.
 *
 * ⚠️ Runs as the caller, so migration 058's admin-only UPDATE policy decides. A
 * Coordinator gets zero rows back rather than an exception, which is why the
 * return value is a boolean and not void — the action reports a refusal instead of
 * saying "saved" to somebody nothing happened for. That exact bug shipped once on
 * `updateCredential`.
 */
export async function setCredentialStatus(
  actorId: string,
  id: string,
  status: 'active' | 'inactive' | 'compromised',
): Promise<boolean> {
  const rows = await withUser(actorId, (tx) => tx`
    update public.credentials
       set status = ${status}::public.credential_status,
           updated_at = now(),
           updated_by_id = ${actorId}
     where id = ${id}
    returning id
  `);
  return rows.length > 0;
}

/** Stamp `last_used_at`. Called by the reveal, and deliberately nothing else. */
export async function markCredentialUsed(actorId: string, id: string): Promise<void> {
  /* ⚠️ Best-effort and never fatal. The secret is already decrypted and on its way
     to the person; failing the whole reveal because a display cache could not be
     written would be the wrong trade. The audit row is the one that matters and it
     is written separately. */
  await withUser(actorId, (tx) => tx`
    update public.credentials set last_used_at = now() where id = ${id}
  `).catch(() => undefined);
}

export interface CredentialEventRow {
  readonly at: string;
  readonly actorName: string | null;
  readonly eventType: string;
  readonly severity: string;
}

/**
 * Who has read this credential, and when.
 *
 * ── ⚠️ FROM `security_events`, WHICH IS THE TRAIL — NOT FROM `last_used_at` ──
 * That column is a display cache of the latest timestamp and records no actor.
 * This is the record, and now that the step-up prompt is gone (owner's decision,
 * 2026-08-25) it is the only control left on a reveal. So the Activity Log tab is
 * not decoration: it is the thing somebody reviews.
 *
 * ⚠️ Read through `withUser`, so RLS on `security_events` decides who may see it.
 * Somebody who cannot read the log gets an empty list rather than an error — the
 * tab then says so, which is better than a failure on a page that otherwise works.
 */
export async function listCredentialEvents(
  actorId: string,
  id: string,
  limit = 25,
): Promise<CredentialEventRow[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select s.created_at, s.event_type, s.severity, u.full_name as actor_name
      from public.security_events s
      left join public.users u on u.id = s.user_id
     where s.details ->> 'credentialId' = ${id}
     order by s.created_at desc
     limit ${limit}
  `);

  return (rows as Array<Record<string, unknown>>).map((r) => ({
    at: new Date(r.created_at as string).toISOString(),
    actorName: (r.actor_name as string | null) ?? null,
    eventType: r.event_type as string,
    severity: String(r.severity ?? 'info'),
  }));
}

/**
 * Replace who a credential is issued to.
 *
 * ── ⚠️ DELETE-THEN-INSERT, IN ONE TRANSACTION ───────────────────────────────
 * Diffing the two sets would be fewer writes and is not worth it: this is a
 * handful of rows, and a diff has to get "was there, still there" right or it
 * deletes somebody it meant to keep. Replacing wholesale cannot be subtly wrong.
 *
 * ⚠️ Both statements run inside `withUser`'s transaction, so a failure halfway
 * cannot leave a credential issued to nobody. Without that, the delete could
 * commit and the insert fail, silently unassigning everybody.
 *
 * ⚠️ Writes are Admin-only by policy (migration 059, matching 058). A Coordinator
 * gets zero rows affected rather than an exception — the caller has already been
 * refused by `credential.manage` before reaching here, so this is the second of
 * two agreeing gates rather than the only one.
 */
export async function setCredentialHolders(
  actorId: string,
  credentialId: string,
  userIds: readonly string[],
): Promise<void> {
  await withUser(actorId, async (tx) => {
    await tx`delete from public.credential_holders where credential_id = ${credentialId}`;
    if (userIds.length === 0) return;
    /* One statement for all of them. `select unnest` rather than a loop so the
       whole set lands in a single round trip. */
    await tx`
      insert into public.credential_holders (credential_id, user_id)
      select ${credentialId}, u
        from unnest(${[...userIds]}::uuid[]) as u
      on conflict do nothing
    `;
  });
}
