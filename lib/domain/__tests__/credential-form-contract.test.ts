import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/* ============================================================================
 * EVERY FIELD ON THE CREDENTIAL FORM MUST BE READ BY THE ACTION
 * ----------------------------------------------------------------------------
 * ── WHY THIS TEST EXISTS ─────────────────────────────────────────────────────
 * On 2026-08-25 the single "Issued to" select became a checkbox picker, because
 * the owner asked to name several people: *"I have to assign only Kashif and Larip
 * so how can I select them?"* The picker submits one hidden input per person under
 * `issuedToIds`. The action was updated to read that — and its old
 * `optional(form, 'issuedToId')` line was left in place.
 *
 * Nothing failed. `FormData.get` of a field that does not exist returns null, so
 * every save wrote NULL over `credentials.issued_to_id` — while the vault table,
 * the details panel and the project panel were all still displaying that column.
 * Ticking two people saved both to `credential_holders` and then showed a dash.
 *
 * ⚠️ NEITHER TYPESCRIPT NOR A UNIT TEST CAN SEE THIS. The link between a control
 * and a server action is a string in two files, and both sides compiled perfectly.
 * The only place the two can be compared is here.
 *
 * The test is deliberately blunt: a `name=` on the form that the action never
 * mentions is either a field being silently dropped or a leftover. Both are worth
 * failing over.
 * ========================================================================= */

const ROOT = join(import.meta.dirname, '..', '..', '..');
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), 'utf8');

const FORM = read('components', 'vault', 'credential-dialog.tsx');
const ACTION = read('app', 'actions', 'credentials.ts');

/** Every `name="…"` the form renders. */
const fields = [...FORM.matchAll(/name="([a-zA-Z]+)"/g)].map((m) => m[1]);

/**
 * The action reads through `optional`/`str`/`optionalDate` helpers as well as
 * `form.get` directly, so the key is looked for as a quoted string anywhere in the
 * file rather than as a particular call.
 *
 * ⚠️ Comments are stripped first. This file explains its own fields at length, and
 * a key that survives only in prose is exactly the dead reference being hunted —
 * `issuedToId` was still named in a comment claiming it was "still written".
 */
const code = ACTION.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('the credential form and its action', () => {
  it('renders the fields it is expected to', () => {
    /* A guard on the guard: if the form is rewritten and the regex stops matching,
       an empty list would make every assertion below vacuously pass. */
    expect(fields).toContain('label');
    expect(fields).toContain('secret');
    expect(fields.length).toBeGreaterThan(8);
  });

  it.each([...new Set(fields)].filter((f) => f !== 'id'))(
    'has the action read %s',
    (field) => {
      expect(code).toContain(`'${field}'`);
    },
  );

  it('reads the picker with getAll, not get', () => {
    /* ⚠️ `get` returns only the FIRST value. The picker renders one hidden input
       per person, so a single `get` keeps Kashif and silently drops everybody
       ticked after him — a save that reports success and loses data. */
    expect(code).toMatch(/getAll\(\s*'issuedToIds'\s*\)/);
    expect(code).not.toMatch(/\bget\(\s*'issuedToIds'\s*\)/);
  });

  it('no longer names the superseded single-holder field', () => {
    /* Migration 059: custody is `credential_holders`, and one column cannot hold
       two people. Reading `issuedToId` again would parse null on every save. */
    expect(code).not.toContain("'issuedToId'");
    expect(FORM).not.toContain('name="issuedToId"');
  });
});

describe('nothing displays the superseded column', () => {
  /* The other half of the same bug: the column stopped being written, and three
     components were still reading it. `CredentialRow` no longer carries it, so
     TypeScript catches this now — but only while the field stays off the type,
     and putting it back "harmlessly" is exactly what happened last time. */
  it.each([
    ['components/vault/vault-table.tsx'],
    ['components/vault/credential-details.tsx'],
    ['components/project/project-credentials.tsx'],
  ])('%s reads holders instead', (path) => {
    const source = read(...path.split('/'));
    expect(source).not.toContain('issuedToName');
    expect(source).toContain('holders');
  });

  it('the query neither selects nor writes issued_to_id', () => {
    const query = read('lib', 'db', 'queries', 'credentials.ts');
    const code = query.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code).not.toContain('issued_to_id');
    expect(code).toContain('credential_holders');
  });
});
