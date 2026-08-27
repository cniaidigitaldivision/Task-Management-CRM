import { describe, expect, it } from 'vitest';

import {
  CREDENTIAL_READER_RANKS,
  canOpenCredential,
  credentialGrantable,
  credentialOpeners,
  credentialReaders,
  type AccessGrant,
  type AccessPerson,
} from '../credential-access';

/* ============================================================================
 * WHO CAN OPEN ONE CREDENTIAL
 * ----------------------------------------------------------------------------
 * The interesting cases are all about a person appearing twice, or appearing when
 * they should not — because on this list either one is a wrong answer to "who can
 * read this password".
 * ========================================================================= */

const HABIBA: AccessPerson = { id: 'u1', name: 'Umm-e-Habiba', role: 'admin' };
const AMMAR: AccessPerson = { id: 'u2', name: 'Ammar Ahmed', role: 'super_admin' };
const KASHIF: AccessPerson = { id: 'u3', name: 'Kashif Ali', role: 'team_coordinator' };
const DANIYAL: AccessPerson = { id: 'u4', name: 'Daniyal Khan', role: 'member' };
const LAREEB: AccessPerson = { id: 'u5', name: 'Lareeb Fatima', role: 'member' };
const TEAM = [HABIBA, AMMAR, KASHIF, DANIYAL, LAREEB];

const grant = (p: AccessPerson, effect: 'allow' | 'deny', by = 'Umm-e-Habiba'): AccessGrant => ({
  userId: p.id,
  name: p.name,
  role: p.role ?? 'member',
  avatarUrl: null,
  effect,
  grantedByName: by,
});

describe('the reader ranks', () => {
  it('are Coordinator and above, matching migration 047', () => {
    expect([...CREDENTIAL_READER_RANKS].sort()).toEqual(['admin', 'super_admin', 'team_coordinator']);
  });

  it('do not include a Member', () => {
    /* The whole reason grants exist. If this ever flips, every credential in the
       vault becomes readable by everybody and no test but this one would notice. */
    expect(CREDENTIAL_READER_RANKS.has('member')).toBe(false);
  });
});

describe('credentialReaders', () => {
  it('lists everybody with rank when there are no grants', () => {
    const rows = credentialReaders(TEAM, []);
    expect(rows.map((r) => r.name)).toEqual(['Ammar Ahmed', 'Umm-e-Habiba', 'Kashif Ali']);
    expect(rows.every((r) => r.effect === null)).toBe(true);
  });

  it('orders seniors first', () => {
    const rows = credentialReaders([KASHIF, HABIBA, AMMAR], []);
    expect(rows.map((r) => r.role)).toEqual(['super_admin', 'admin', 'team_coordinator']);
  });

  it('adds a named Member after the ranks', () => {
    const rows = credentialReaders(TEAM, [grant(DANIYAL, 'allow')]);
    expect(rows.map((r) => r.name)).toEqual([
      'Ammar Ahmed',
      'Umm-e-Habiba',
      'Kashif Ali',
      'Daniyal Khan',
    ]);
    expect(rows.at(-1)).toMatchObject({ effect: 'allow', grantedByName: 'Umm-e-Habiba' });
  });

  it('lists an excluded Coordinator ONCE, as excluded', () => {
    /* ⚠️ The bug this function exists to prevent: merging rank rows and grants
       without dropping the overridden rank row put Kashif in the list twice — once
       able to open it and once not. */
    const rows = credentialReaders(TEAM, [grant(KASHIF, 'deny')]);
    const kashif = rows.filter((r) => r.userId === KASHIF.id);
    expect(kashif).toHaveLength(1);
    expect(kashif[0].effect).toBe('deny');
  });

  it('puts exclusions last, after the people who can open it', () => {
    const rows = credentialReaders(TEAM, [grant(KASHIF, 'deny'), grant(DANIYAL, 'allow')]);
    expect(rows.map((r) => r.effect)).toEqual([null, null, 'allow', 'deny']);
  });

  it('leaves out a Member who has not been named', () => {
    const rows = credentialReaders(TEAM, []);
    expect(rows.some((r) => r.userId === DANIYAL.id)).toBe(false);
    expect(rows.some((r) => r.userId === LAREEB.id)).toBe(false);
  });

  it('does not invent rows from an empty team', () => {
    /* The vault page loads its people list for every rank, but the project page
       loads it only for somebody who may edit the project — so an empty list is a
       real state and must not read as "nobody has access". */
    expect(credentialReaders([], [])).toEqual([]);
  });

  it('carries the avatar through, and null when there is none', () => {
    const withFace = { ...KASHIF, avatarUrl: '/a.png' };
    expect(credentialReaders([withFace], [])[0].avatarUrl).toBe('/a.png');
    expect(credentialReaders([KASHIF], [])[0].avatarUrl).toBeNull();
  });
});

describe('credentialOpeners', () => {
  it('drops the excluded, so no face implies access it does not have', () => {
    const rows = credentialReaders(TEAM, [grant(KASHIF, 'deny'), grant(DANIYAL, 'allow')]);
    expect(credentialOpeners(rows).map((r) => r.name)).toEqual([
      'Ammar Ahmed',
      'Umm-e-Habiba',
      'Daniyal Khan',
    ]);
  });

  it('keeps rank rows and named rows alike', () => {
    const rows = credentialReaders([KASHIF, DANIYAL], [grant(DANIYAL, 'allow')]);
    expect(credentialOpeners(rows)).toHaveLength(2);
  });
});

describe('credentialGrantable', () => {
  it('offers Members only', () => {
    expect(credentialGrantable(TEAM, []).map((p) => p.name)).toEqual([
      'Daniyal Khan',
      'Lareeb Fatima',
    ]);
  });

  it('drops anybody who already has a row, allow or deny', () => {
    const left = credentialGrantable(TEAM, [grant(DANIYAL, 'allow'), grant(LAREEB, 'deny')]);
    expect(left).toEqual([]);
  });

  it('never offers a Coordinator, whose grant the trigger would refuse', () => {
    expect(credentialGrantable([KASHIF, AMMAR, HABIBA], [])).toEqual([]);
  });
});

describe('canOpenCredential', () => {
  it('is true for a Coordinator with no grant row', () => {
    expect(canOpenCredential(KASHIF.id, 'team_coordinator', [])).toBe(true);
  });

  it('is false for a Member with no grant row', () => {
    expect(canOpenCredential(DANIYAL.id, 'member', [])).toBe(false);
  });

  it('is true for a Member who was named in', () => {
    expect(canOpenCredential(DANIYAL.id, 'member', [grant(DANIYAL, 'allow')])).toBe(true);
  });

  it('is false for a Coordinator who was named out', () => {
    /* An exclusion beats rank — which is the point of migration 052. */
    expect(canOpenCredential(KASHIF.id, 'team_coordinator', [grant(KASHIF, 'deny')])).toBe(false);
  });

  it('is not fooled by somebody else’s grant', () => {
    expect(canOpenCredential(LAREEB.id, 'member', [grant(DANIYAL, 'allow')])).toBe(false);
  });
});
