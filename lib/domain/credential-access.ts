/* ============================================================================
 * WHO CAN OPEN ONE CREDENTIAL
 * ----------------------------------------------------------------------------
 * Rank plus named grants minus exclusions, worked out once.
 *
 * ── ⚠️ WHY THIS IS A MODULE AND NOT A `useMemo` ─────────────────────────────
 * Three screens now answer "who can see this password": the access dialogue's
 * list, the row of faces on the credential view, and the project panel's stack.
 * They had started to answer it separately — the dialogue merged rank rows with
 * grants and dropped the rank row of anybody excluded, while the project panel
 * merged them without the exclusion step, so an excluded Coordinator was still a
 * face in the stack.
 *
 * A stack that says somebody can read a password when they cannot is not a
 * cosmetic bug, so the derivation lives here, in one place, with tests.
 *
 * ── THE THREE STATES ────────────────────────────────────────────────────────
 *   effect null     here by RANK. Coordinator and above can open every credential
 *                   (migration 047). Not revocable — only excludable, which writes
 *                   a `deny` row (052).
 *   effect 'allow'  a Member named in by an Admin (050). Revocable.
 *   effect 'deny'   somebody with rank named OUT of this one credential (052).
 *                   Still LISTED, so "why can't Kashif see this" is answerable.
 *
 * ⚠️ RANK IS NOT THE BOUNDARY — `app.can_read_credential` is, and it is checked in
 * the database on every read. This decides what a list SHOWS. A list that disagrees
 * with the policy is a lie about access, which is why the ranks below are stated
 * once and imported rather than re-typed per component.
 * ========================================================================= */

/** Ranks that can open any credential — the floor from migration 047. Mirrors
 *  `credential.view` in the permission matrix and `app.can_read_credential`. */
export const CREDENTIAL_READER_RANKS: ReadonlySet<string> = new Set([
  'super_admin',
  'admin',
  'team_coordinator',
]);

/** Seniors first, then Members, so a list reads top-down. */
const RANK_ORDER = ['super_admin', 'admin', 'team_coordinator', 'member'];

export interface AccessPerson {
  readonly id: string;
  readonly name: string;
  readonly role?: string | null;
  readonly avatarUrl?: string | null;
}

export interface AccessGrant {
  readonly userId: string;
  readonly name: string;
  readonly role: string;
  readonly avatarUrl: string | null;
  readonly effect: 'allow' | 'deny';
  readonly grantedByName?: string | null;
}

export interface AccessRow {
  readonly userId: string;
  readonly name: string;
  readonly avatarUrl: string | null;
  readonly role: string;
  /** null when the person is here purely by rank. See the header. */
  readonly effect: 'allow' | 'deny' | null;
  readonly grantedByName: string | null;
}

/**
 * Everybody with a stake in one credential: rank rows, named grants and
 * exclusions, merged and ordered.
 *
 * ⚠️ A person with an exception appears ONCE. Their rank row is dropped in favour
 * of the grant row, because a Coordinator who has been excluded would otherwise be
 * listed twice — once as "can open it by rank" and once struck through, which is
 * two opposite answers to the same question.
 */
export function credentialReaders(
  people: readonly AccessPerson[],
  grants: readonly AccessGrant[],
): AccessRow[] {
  const byRank: AccessRow[] = people
    .filter((p) => CREDENTIAL_READER_RANKS.has(p.role ?? ''))
    .filter((p) => !grants.some((g) => g.userId === p.id))
    .map((p) => ({
      userId: p.id,
      name: p.name,
      avatarUrl: p.avatarUrl ?? null,
      role: p.role ?? 'member',
      effect: null,
      grantedByName: null,
    }));

  const named: AccessRow[] = grants.map((g) => ({
    userId: g.userId,
    name: g.name,
    avatarUrl: g.avatarUrl,
    role: g.role,
    effect: g.effect,
    grantedByName: g.grantedByName ?? null,
  }));

  /* Rank, then named, then excluded — which puts the exceptions at the bottom
     where they read as exceptions rather than as part of the ordinary list. */
  const weight = (r: AccessRow) => (r.effect === 'deny' ? 2 : r.effect === 'allow' ? 1 : 0);

  return [...byRank, ...named].sort((a, b) => {
    if (weight(a) !== weight(b)) return weight(a) - weight(b);
    const rank = RANK_ORDER.indexOf(a.role) - RANK_ORDER.indexOf(b.role);
    return rank !== 0 ? rank : a.name.localeCompare(b.name);
  });
}

/**
 * Just the people who can actually open it — for a row of faces, where there is no
 * room to draw the difference between "by rank" and "named in".
 *
 * ⚠️ Excludes `deny`. A struck-through name in a list is understood; a face in a
 * stack is not, so an excluded person must not be in it at all.
 */
export function credentialOpeners(rows: readonly AccessRow[]): AccessRow[] {
  return rows.filter((r) => r.effect !== 'deny');
}

/**
 * Who may still be named in: active Members with no exception row.
 *
 * ⚠️ Coordinators and above are deliberately absent. They can already open it, so
 * a grant would add nothing and could not be revoked — and migration 052's trigger
 * refuses an `allow` for anybody but a Member, so offering it would be offering a
 * button that raises.
 */
export function credentialGrantable(
  people: readonly AccessPerson[],
  grants: readonly AccessGrant[],
): AccessPerson[] {
  return people
    .filter((p) => (p.role ?? '') === 'member')
    .filter((p) => !grants.some((g) => g.userId === p.id));
}

/**
 * Whether one person can open it — the same answer the list gives, for a single
 * name. Used to tell a Member why they are looking at a credential.
 */
export function canOpenCredential(
  userId: string,
  role: string | null | undefined,
  grants: readonly AccessGrant[],
): boolean {
  const own = grants.find((g) => g.userId === userId);
  if (own) return own.effect === 'allow';
  return CREDENTIAL_READER_RANKS.has(role ?? '');
}
