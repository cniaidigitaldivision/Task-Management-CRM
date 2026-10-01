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

  it('⚠️ WARNS about a channel it does not recognise, and lets the row in', () => {
    /* This asserted an ERROR until 2026-10-01, and the owner was right that it
       should not be one: *"if something is missing let it go with that."* The
       word is kept in the source detail, so nothing is lost and no figure in
       the Which-app report is invented. */
    const issues = checkLeadRow(
      { fullName: 'A', phone: '03001234567', source: 'Carrier pigeon' }, 2, FRESH, NOBODY, OPTIONS);
    expect(errorsOf(issues)).toEqual([]);
    expect(warningsOf(issues).join(' ')).toContain('not a channel we recognise');
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

/* ============================================================================
 * "IF SOMETHING IS MISSING, LET IT GO"
 * ----------------------------------------------------------------------------
 * Owner, 2026-10-01, with a two-row file and one good row in it: *"Each time
 * it's showing me the error and not letting me upload it. How can I upload it
 * and how can I resolve it? I want that if something is missing let it go with
 * that. For example, email is missing. Let it go."*
 *
 * ── ⚠️ ONLY TWO THINGS ARE WORTH REFUSING A PERSON OVER ────────────────────
 * A name, and some way to contact them — because `crm_create_lead` refuses a
 * row without either, so the wizard cannot be more permissive than the writer.
 * Everything else is dropped and the lead goes in. Every real list has a blank
 * cell in it somewhere, and an importer that stops for one is an importer
 * somebody gives up on.
 * ========================================================================= */
describe('a row that is missing something', () => {
  /** The error TEXTS, so an assertion reads the message and not "[object Object]". */
  const ok = (row: Record<string, string>) =>
    checkLeadRow(row, 2, FRESH, NOBODY, OPTIONS)
      .filter((i) => i.severity === 'error')
      .map((i) => i.text);

  it('⚠️ a budget that is not a number does not refuse the person', () => {
    expect(ok({ fullName: 'A', phone: '03001234567', budget: 'around 45 lakh' })).toEqual([]);
  });

  it('⚠️ an address that is not an email does not refuse the person', () => {
    expect(ok({ fullName: 'A', phone: '03001234567', email: 'n/a' })).toEqual([]);
  });

  it('⚠️ a channel we do not recognise does not refuse the person', () => {
    expect(ok({ fullName: 'A', phone: '03001234567', source: 'Property expo' })).toEqual([]);
  });

  it('⚠️ but a bad email with NO phone still does, because nothing is left', () => {
    /* There would be no way to contact them, and `crm_create_lead` raises CRM04
       — so letting this through would mean the counts said "ready" about a row
       the database then refused. */
    expect(ok({ fullName: 'A', email: 'n/a' }).join(' ')).toContain('only way to contact');
  });

  it('still refuses a row with no name at all', () => {
    expect(ok({ phone: '03001234567' }).join(' ')).toContain('No name');
  });
});

describe('what the warnings promised actually happens', () => {
  /* ⚠️ THE TWO HALVES MUST AGREE. If the screen says an email will be left out
     and `toImportRows` writes it through anyway, the row is refused at import
     time — after the counts have already called it ready. */
  const rows: Array<Record<string, string>> = [
    { fullName: 'A', phone: '03001234567', email: 'not-an-email',
      budget: 'about 40 lakh', source: 'Property expo', sourceDetail: 'March' },
  ];

  it('drops an email it warned about', () => {
    expect(toImportRows(rows, new Set()) [0].email).toBeNull();
  });

  it('drops a budget it warned about', () => {
    expect(toImportRows(rows, new Set())[0].budget).toBeNull();
  });

  it('⚠️ files an unknown channel as "import" and KEEPS the word', () => {
    /* Filing it as a channel would invent a figure in "Which app the leads came
       from"; throwing it away would lose a real fact about where they came
       from. It goes in the detail, where it can still be read and searched. */
    const [row] = toImportRows(rows, new Set());
    expect(row.source).toBe('import');
    expect(row.sourceDetail).toBe('Property expo · March');
  });

  it('keeps a good email and a good budget', () => {
    const [row] = toImportRows(
      [{ fullName: 'A', phone: '03001234567', email: 'a@b.com', budget: '4,500,000' }],
      new Set());
    expect(row.email).toBe('a@b.com');
    expect(row.budget).toBe(4500000);
  });
});

describe('⚠️ the template this product hands out', () => {
  /* THE BUG THE OWNER FOUND. The template used to carry a third row of guidance
     — "Required. Phone or email — at least one." — and the importer reads every
     row under the header as a person, so downloading the template and uploading
     it unchanged produced two errors quoting our own help text back as somebody's
     name and budget. A template that fails its own importer is an instruction to
     build a file that will be rejected. */
  const headers = LEAD_TEMPLATE_COLUMNS.map((c) => c.header);
  const example = LEAD_TEMPLATE_COLUMNS.map((c) => c.example);

  it('maps its own headers with no help', () => {
    const map = guessLeadMapping(headers);
    expect(Object.keys(map)).toHaveLength(LEAD_TEMPLATE_COLUMNS.length);
  });

  it('⚠️ has an example row that imports without a single error', () => {
    const map = guessLeadMapping(headers);
    const row: Record<string, string> = {};
    for (const [key, i] of Object.entries(map)) row[key] = example[i];
    const issues = checkLeadRow(row, 2, FRESH, NOBODY, OPTIONS);
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('⚠️ carries no row whose cells are the column NOTES', () => {
    /* The notes are guidance for a person and belong on screen. This asserts
       they are not in the data, by checking the example row shares no cell with
       the note text. */
    const notes = LEAD_TEMPLATE_COLUMNS.map((c) => c.note).filter(Boolean);
    for (const cell of example) {
      expect(notes).not.toContain(cell);
    }
  });
});
