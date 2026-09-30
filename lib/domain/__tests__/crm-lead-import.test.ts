import { describe, expect, it } from 'vitest';

import {
  checkLeadRow,
  digitsOf,
  guessLeadMapping,
  LEAD_TEMPLATE_COLUMNS,
  readSource,
  toImportRows,
  type KnownContacts,
  type LeadImportOptions,
} from '@/lib/domain/crm-lead-import';
import { tallyImport } from '@/lib/domain/sheet-import';

/* ============================================================================
 * IMPORTING A LIST OF LEADS
 * ----------------------------------------------------------------------------
 * The interesting cases are all about what the importer REFUSES to do quietly:
 * create a second copy of somebody it already has, drop a number it could not
 * normalise, or let a spreadsheet assert a stage.
 * ========================================================================= */

const NOBODY: KnownContacts = { phones: new Set(), emails: new Set(), digits: new Set() };
const FRESH = { phones: new Set<string>(), emails: new Set<string>(), digits: new Set<string>() };
const OPTIONS: LeadImportOptions = { skipDuplicates: true, markTestData: false };

const errorsOf = (issues: readonly { severity: string; text: string }[]) =>
  issues.filter((i) => i.severity === 'error').map((i) => i.text);
const warningsOf = (issues: readonly { severity: string; text: string }[]) =>
  issues.filter((i) => i.severity === 'warning').map((i) => i.text);
const dupesOf = (issues: readonly { severity: string; text: string }[]) =>
  issues.filter((i) => i.severity === 'duplicate').map((i) => i.text);

describe('what a row must have', () => {
  it('refuses a row with no name', () => {
    const issues = checkLeadRow({ phone: '03001234567' }, 2, FRESH, NOBODY, OPTIONS);
    expect(errorsOf(issues).join(' ')).toContain('No name');
  });

  it('⚠️ refuses a row with no phone AND no email', () => {
    /* `crm_create_lead`'s own rule: "a lead with no way to reach them is not a
       lead; it is a row that will sit on somebody's desk forever showing as
       overdue". The wizard must refuse it before the database does, or 400 good
       rows die with one bad one. */
    const issues = checkLeadRow({ fullName: 'Ayesha' }, 2, FRESH, NOBODY, OPTIONS);
    expect(errorsOf(issues).join(' ')).toContain('No phone and no email');
  });

  it('accepts a row with only an email', () => {
    const issues = checkLeadRow(
      { fullName: 'Ayesha', email: 'a@example.com' }, 2, FRESH, NOBODY, OPTIONS);
    expect(errorsOf(issues)).toEqual([]);
  });

  it('refuses an email that is not one', () => {
    const issues = checkLeadRow(
      { fullName: 'Ayesha', email: 'ayesha at example' }, 2, FRESH, NOBODY, OPTIONS);
    expect(errorsOf(issues).join(' ')).toContain('not an email address');
  });

  it('⚠️ WARNS about an unreadable phone, never refuses it', () => {
    /* `toE164` returns null for an Islamabad landline — ten digits, no mobile
       pattern — and the raw value is stored regardless. Refusing the row would
       throw away a real enquiry because the number is not a mobile. */
    const issues = checkLeadRow(
      { fullName: 'Ayesha', phone: '051-1234567' }, 2, FRESH, NOBODY, OPTIONS);
    expect(errorsOf(issues)).toEqual([]);
    expect(warningsOf(issues).join(' ')).toContain('could not be read as a mobile');
  });

  it('refuses a channel it does not recognise', () => {
    const issues = checkLeadRow(
      { fullName: 'A', phone: '03001234567', source: 'Carrier pigeon' }, 2, FRESH, NOBODY, OPTIONS);
    expect(errorsOf(issues).join(' ')).toContain('not a channel we recognise');
  });
});

describe('recognising somebody we already have', () => {
  const known: KnownContacts = {
    phones: new Set(['+923001234567']),
    emails: new Set(['ayesha@example.com']),
    digits: new Set(['0511234567']),
  };

  it('matches on the normalised phone', () => {
    const issues = checkLeadRow(
      { fullName: 'A', phone: '0300 123 4567' }, 2, FRESH, known, OPTIONS);
    expect(dupesOf(issues).join(' ')).toContain('already a lead');
  });

  it('matches on the email', () => {
    const issues = checkLeadRow(
      { fullName: 'A', email: 'AYESHA@example.com' }, 2, FRESH, known, OPTIONS);
    expect(dupesOf(issues).join(' ')).toContain('already a lead');
  });

  it('⚠️ matches on bare digits, which is what a round trip needs', () => {
    /* THE CASE A ROUND TRIP FOUND. `051-1234567` has no E.164 form and this
       lead has no email, so matching on those two alone would offer to create a
       second copy of somebody already in the file — every time the export is
       imported back. */
    const issues = checkLeadRow(
      { fullName: 'A', phone: '051 1234567' }, 2, FRESH, known, OPTIONS);
    expect(dupesOf(issues).join(' ')).toContain('already a lead');
  });

  it('⚠️ says so when a row has no identity to match on at all', () => {
    /* No digits and no email: nothing could ever recognise this person, so
       importing the same file twice makes two of them. Said while somebody can
       still add a column, rather than discovered afterwards. */
    const issues = checkLeadRow(
      { fullName: 'A', phone: '(demo — no number)' }, 2, FRESH, known, OPTIONS);
    expect(warningsOf(issues).join(' ')).toContain('cannot tell whether this person is already here');
  });

  it('spots a repeat WITHIN one sheet', () => {
    const seen = { phones: new Set(['+923009999999']), emails: new Set<string>(), digits: new Set<string>() };
    const issues = checkLeadRow(
      { fullName: 'A', phone: '03009999999' }, 5, seen, NOBODY, OPTIONS);
    expect(dupesOf(issues).join(' ')).toContain('more than once in this sheet');
  });

  it('⚠️ blocks instead of skipping when skipping is turned off', () => {
    const issues = checkLeadRow(
      { fullName: 'A', phone: '03001234567' }, 2, FRESH, known,
      { ...OPTIONS, skipDuplicates: false });
    expect(errorsOf(issues).join(' ')).toContain('already a lead');
  });
});

describe('the header matcher', () => {
  it('matches the template exactly', () => {
    const headers = LEAD_TEMPLATE_COLUMNS.map((c) => c.header);
    const map = guessLeadMapping(headers);
    expect(Object.keys(map).sort()).toEqual(LEAD_TEMPLATE_COLUMNS.map((c) => c.key).sort());
  });

  it('⚠️ matches an export of this product, extra columns and all', () => {
    /* The export writes the template's headers verbatim and then adds Stage,
       Owner, Project and the rest. Every importable column must still be found,
       and none of the extras may be mistaken for one. */
    const headers = [...LEAD_TEMPLATE_COLUMNS.map((c) => c.header),
      'Stage', 'Temperature', 'Owner', 'Project', 'Form',
      'Next action', 'Next action due', 'Enquired', 'Last activity'];
    const map = guessLeadMapping(headers);
    expect(Object.keys(map)).toHaveLength(LEAD_TEMPLATE_COLUMNS.length);
    for (const [, index] of Object.entries(map)) {
      expect(index).toBeLessThan(LEAD_TEMPLATE_COLUMNS.length);
    }
  });

  it('matches somebody else’s spelling', () => {
    const map = guessLeadMapping(['Name', 'Mobile Number', 'E-mail', 'Town', 'Remarks']);
    expect(map.fullName).toBe(0);
    expect(map.phone).toBe(1);
    expect(map.email).toBe(2);
    expect(map.city).toBe(3);
    expect(map.enquiry).toBe(4);
  });

  it('leaves a field unmapped rather than guessing', () => {
    const map = guessLeadMapping(['Reference', 'Colour', 'Widget size']);
    expect(map.fullName).toBeUndefined();
    expect(map.phone).toBeUndefined();
  });
});

describe('the channel column', () => {
  it('takes the label a person would write', () => {
    expect(readSource('Walk-in')).toBe('walk_in');
    expect(readSource('Facebook')).toBe('facebook');
  });

  it('takes the enum value somebody editing a CSV would write', () => {
    expect(readSource('walk_in')).toBe('walk_in');
    expect(readSource('meta_lead_ad')).toBe('meta_lead_ad');
  });

  it('returns null for nonsense, so the row can be refused', () => {
    expect(readSource('Carrier pigeon')).toBeNull();
    expect(readSource('')).toBeNull();
  });
});

describe('what reaches the writer', () => {
  const rows: Array<Record<string, string>> = [
    { fullName: ' Ayesha Noor ', phone: '0300 1234567', email: 'A@Example.com ',
      city: 'Islamabad', budget: '4,500,000', source: 'Walk-in', enquiry: '5 marla' },
    { fullName: 'Bad Row', phone: '' },
    { fullName: 'Sana', phone: '03211234567', budget: 'lots' },
  ];

  it('trims, lower-cases the email and reads the budget through commas', () => {
    const [first] = toImportRows(rows, new Set([3, 4]));
    expect(first.fullName).toBe('Ayesha Noor');
    expect(first.email).toBe('a@example.com');
    expect(first.budget).toBe(4500000);
    expect(first.phoneE164).toBe('+923001234567');
    expect(first.source).toBe('walk_in');
  });

  it('⚠️ leaves out the lines the caller said to skip', () => {
    /* Rows with errors, and duplicates when skipping is on. This does NOT
       re-check them: two checks that disagree is worse than one that is wrong. */
    const out = toImportRows(rows, new Set([3]));
    expect(out.map((r) => r.fullName)).toEqual(['Ayesha Noor', 'Sana']);
  });

  it('⚠️ defaults the channel to "import", not "manual"', () => {
    /* `manual` would claim a salesperson typed this person in here. Somebody
       typed them into a spreadsheet somewhere else, and where they originally
       came from is not recorded. */
    const [, sana] = toImportRows(rows, new Set([3]));
    expect(sana.source).toBe('import');
  });

  it('refuses a budget that is not a number rather than writing a wrong one', () => {
    const [, sana] = toImportRows(rows, new Set([3]));
    expect(sana.budget).toBeNull();
  });

  it('⚠️ carries no stage, owner or temperature at all', () => {
    /* Not "carries them as null" — the shape has no field for them, so no
       future edit can quietly start honouring a Stage column in a sheet. */
    const [first] = toImportRows(rows, new Set([3, 4]));
    expect(Object.keys(first).sort()).toEqual([
      'budget', 'city', 'email', 'enquiry', 'fullName', 'phone', 'phoneE164', 'source', 'sourceDetail',
    ]);
  });
});

describe('digitsOf', () => {
  it('strips everything that is not a digit', () => {
    expect(digitsOf('+92 (300) 123-4567')).toBe('923001234567');
  });

  it('⚠️ refuses fewer than seven digits, which is not a phone number', () => {
    expect(digitsOf('123')).toBeNull();
    expect(digitsOf('(demo — no number)')).toBeNull();
  });
});

describe('the count tiles', () => {
  it('⚠️ counts ROWS as ready and ISSUES as errors', () => {
    /* One row can carry three errors; it is still one row that will not import.
       Counting issues for `ready` would make "148 of 150" arithmetic that does
       not add up, and a reader checking it would be right to distrust the rest
       of the screen. */
    const issues = [
      { line: 2, severity: 'error' as const, text: 'a' },
      { line: 2, severity: 'error' as const, text: 'b' },
      { line: 3, severity: 'warning' as const, text: 'c' },
    ];
    expect(tallyImport(10, issues)).toEqual({ ready: 9, errors: 2, warnings: 1, duplicates: 0 });
  });
});
