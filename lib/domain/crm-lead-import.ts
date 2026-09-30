/* ============================================================================
 * IMPORTING A LIST OF LEADS — LAYER 2
 * ----------------------------------------------------------------------------
 * Pure: no database, no clock, no React. A parsed sheet in, issues out.
 *
 * Owner, 2026-10-01: *"one more thing I want right now is to import a CSV or
 * Excel file… My focus right now is to make sure to properly import and export
 * the leads."*
 *
 * ── ⚠️ THE TEMPLATE AND THE PARSER READ THE SAME LIST ──────────────────────
 * The lesson the property importer paid for: a downloadable template whose
 * columns the importer does not recognise is worse than no template, because it
 * is an instruction to build a file that will be rejected. One `TEMPLATE_COLUMNS`
 * feeds the download, the header matcher and the validator.
 *
 * ── ⚠️ AND THE EXPORT USES THE SAME HEADERS ────────────────────────────────
 * The property round trip — export the catalogue, import that exact file —
 * found 338 errors the first time, every one of them a header or a format the
 * writer and the reader spelled differently. So the lead export writes these
 * headers verbatim for the columns it shares, and adds its own after them. An
 * exported file is a valid import file; the extra columns are ignored.
 *
 * ── ⚠️ WHAT AN IMPORT MAY NOT DO ───────────────────────────────────────────
 * It may not set a stage, an owner or a temperature, and the template has no
 * column for any of them.
 *
 *   · **Stage** — migration 167 refuses `won` on a lead nobody qualified, and
 *     the four qualifying answers cannot come off a spreadsheet honestly. Every
 *     imported lead opens at `new`, which is what `crm_create_lead` does for a
 *     lead typed in by hand.
 *   · **Owner** — who gets a lead is the rota's decision or the manager's, made
 *     in the wizard against live workload. A name in a column would let a sheet
 *     hand three hundred leads to one person.
 *   · **Temperature** — it is a judgement somebody makes after speaking to
 *     them. A sheet saying "Hot" is a sheet asserting a conversation happened.
 * ========================================================================= */

import { toE164 } from './phone';
import { SOURCE_OPTIONS } from './lead-source';
import type { ImportIssue } from './sheet-import';

export const LEAD_TEMPLATE_GROUPS = [
  'Who they are', 'What they want', 'Where it came from',
] as const;
export type LeadTemplateGroup = (typeof LEAD_TEMPLATE_GROUPS)[number];

export interface LeadTemplateColumn {
  readonly key: string;
  readonly header: string;
  readonly required: boolean;
  readonly example: string;
  readonly note: string;
  readonly group: LeadTemplateGroup;
}

/**
 * ⚠️ "REQUIRED" ON `phone` MEANS "PHONE **OR** EMAIL", and the note says so on
 * the template itself. `crm_create_lead` refuses a lead with neither — *"a lead
 * with no way to reach them is not a lead; it is a row that will sit on
 * somebody's desk forever showing as overdue"* — but either one satisfies it.
 * Marking both required would make the template refuse files the database
 * accepts.
 */
export const LEAD_TEMPLATE_COLUMNS: readonly LeadTemplateColumn[] = [
  { key: 'fullName', header: 'Full name', required: true, example: 'Ayesha Noor',
    note: 'A lead needs a name.', group: 'Who they are' },
  { key: 'phone', header: 'Phone', required: true, example: '0300 1234567',
    note: 'Phone or email — at least one.', group: 'Who they are' },
  { key: 'email', header: 'Email', required: false, example: 'ayesha@example.com',
    note: '', group: 'Who they are' },
  { key: 'city', header: 'City', required: false, example: 'Islamabad',
    note: '', group: 'Who they are' },
  { key: 'enquiry', header: 'What they asked for', required: false,
    example: '5 marla plot in Block A', note: 'Free text. Saved as the first note.',
    group: 'What they want' },
  { key: 'budget', header: 'Budget (PKR)', required: false, example: '4500000',
    note: 'Whole rupees, digits only.', group: 'What they want' },
  { key: 'source', header: 'Came from', required: false, example: 'Facebook',
    note: 'Blank becomes "Imported".', group: 'Where it came from' },
  { key: 'sourceDetail', header: 'Source detail', required: false,
    example: 'March property expo', note: 'Free text.', group: 'Where it came from' },
];

/** header (normalised) → key, for matching a sheet's own spelling. */
function normalise(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Best guess at which sheet column is which field.
 *
 * ⚠️ IT ALSO MATCHES WORDS THE TEMPLATE DOES NOT USE, because the file being
 * imported is usually somebody else's. "Mobile", "Contact number" and "Cell"
 * are all the phone column; "Name" is the name. The template's own header wins
 * where both are present.
 */
const ALIASES: Readonly<Record<string, readonly string[]>> = {
  fullName: ['name', 'fullname', 'customername', 'clientname', 'leadname'],
  phone: ['phone', 'mobile', 'mobileno', 'mobilenumber', 'contact', 'contactnumber', 'cell', 'cellno', 'whatsapp'],
  email: ['email', 'emailaddress', 'mail'],
  city: ['city', 'town', 'location'],
  enquiry: ['enquiry', 'inquiry', 'message', 'requirement', 'notes', 'comment', 'remarks'],
  budget: ['budget', 'budgetpkr', 'price', 'amount'],
  source: ['source', 'camefrom', 'channel', 'platform', 'leadsource'],
  sourceDetail: ['sourcedetail', 'sourcedetails', 'campaign', 'detail'],
};

export function guessLeadMapping(headers: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  const norm = headers.map(normalise);

  for (const col of LEAD_TEMPLATE_COLUMNS) {
    /* The template's own header first — an exact match is never a guess. */
    let found = norm.indexOf(normalise(col.header));
    if (found < 0) found = norm.indexOf(normalise(col.key));
    if (found < 0) {
      for (const alias of ALIASES[col.key] ?? []) {
        found = norm.indexOf(alias);
        if (found >= 0) break;
      }
    }
    if (found >= 0) out[col.key] = found;
  }
  return out;
}

/** Every channel a sheet may name, by its own label — "Facebook", "Walk-in". */
const SOURCE_BY_LABEL = new Map<string, string>(
  SOURCE_OPTIONS.map((o) => [normalise(o.label), o.value]),
);

/**
 * What a sheet cell means as a channel, or null if it means nothing.
 *
 * ⚠️ IT TAKES THE LABEL **AND** THE ENUM VALUE. A person filling the template
 * writes "Walk-in"; a file exported from this product writes "Walk-in" too, and
 * somebody editing a CSV by hand may well type `walk_in`. All three are the
 * same answer and refusing one of them is refusing somebody their own data.
 */
export function readSource(raw: string | null | undefined): string | null {
  const text = (raw ?? '').trim();
  if (!text) return null;
  const key = normalise(text);
  return SOURCE_BY_LABEL.get(key)
    ?? SOURCE_OPTIONS.find((o) => normalise(o.value) === key)?.value
    ?? null;
}

export interface LeadImportOptions {
  /** Rows matching somebody already on this project are skipped, not refused. */
  readonly skipDuplicates: boolean;
  readonly markTestData: boolean;
}

/** What is already on the project, so a row can be recognised as a repeat. */
export interface KnownContacts {
  readonly phones: ReadonlySet<string>;
  readonly emails: ReadonlySet<string>;
}

/**
 * Check one row.
 *
 * ⚠️ ERRORS, WARNINGS AND DUPLICATES ARE THREE ANSWERS — see `sheet-import.ts`.
 * An error means the row cannot become a lead. A warning means it can and
 * somebody should look. A duplicate means we already know this person, which
 * blocks or skips depending on the option.
 *
 * ⚠️ AN UNREADABLE PHONE IS A WARNING, NEVER AN ERROR. `toE164` deliberately
 * returns null rather than guessing — an Islamabad landline is ten digits and
 * matches no mobile pattern — and the raw value is stored regardless. Refusing
 * those rows would throw away real enquiries because the number is not a
 * mobile; `lib/domain/phone.ts` settled this argument already.
 */
export function checkLeadRow(
  row: Readonly<Record<string, string>>,
  line: number,
  seen: { readonly phones: ReadonlySet<string>; readonly emails: ReadonlySet<string> },
  known: KnownContacts,
  options: LeadImportOptions,
): readonly ImportIssue[] {
  const out: ImportIssue[] = [];
  const err = (text: string) => out.push({ line, severity: 'error', text });
  const warn = (text: string) => out.push({ line, severity: 'warning', text });
  const dup = (text: string) => out.push({ line, severity: 'duplicate', text });

  const name = (row.fullName ?? '').trim();
  const rawPhone = (row.phone ?? '').trim();
  const email = (row.email ?? '').trim().toLowerCase();

  if (!name) err('No name. A lead needs one.');
  if (!rawPhone && !email) {
    err('No phone and no email — there would be no way to contact this person.');
  }

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    err(`"${row.email}" is not an email address.`);
  }

  const e164 = rawPhone ? toE164(rawPhone) : null;
  if (rawPhone && !e164) {
    /* ⚠️ SAID PLAINLY, because the row DOES import. Somebody reading "could not
       be read" and nothing else would reasonably assume it was dropped. */
    warn(`"${rawPhone}" could not be read as a mobile number. It will be saved exactly as written, but WhatsApp will not reach it.`);
  }

  if ((row.budget ?? '').trim() && !/^[0-9][0-9,\s.]*$/.test(row.budget.trim())) {
    err(`Budget "${row.budget}" is not a number.`);
  }

  const source = (row.source ?? '').trim();
  if (source && readSource(source) === null) {
    err(`"${source}" is not a channel we recognise. Leave it blank for "Imported".`);
  }

  /* ── Already known? ──────────────────────────────────────────────────── */
  const inSheet = (e164 && seen.phones.has(e164)) || (email && seen.emails.has(email));
  const onProject = (e164 && known.phones.has(e164)) || (email && known.emails.has(email));

  if (inSheet) {
    dup(`${name || rawPhone || email} appears more than once in this sheet.`);
  } else if (onProject) {
    if (options.skipDuplicates) {
      dup(`${name || rawPhone || email} is already a lead on this project — this row will be skipped.`);
    } else {
      err(`${name || rawPhone || email} is already a lead on this project. Turn on "Skip people we already have" to leave them alone.`);
    }
  }

  return out;
}

/** One row, ready for the writer. Everything already normalised. */
export interface LeadImportRow {
  readonly fullName: string;
  readonly phone: string | null;
  readonly phoneE164: string | null;
  readonly email: string | null;
  readonly city: string | null;
  readonly enquiry: string | null;
  readonly budget: number | null;
  readonly source: string;
  readonly sourceDetail: string | null;
}

/**
 * The rows that will actually be written.
 *
 * ⚠️ NORMALISED HERE, IN THE BROWSER, AND NOT AGAIN IN SQL. `toE164` is the
 * product's one phone parser and it is TypeScript; a second implementation in
 * plpgsql would be a second opinion about which numbers are reachable. So the
 * wizard sends what it has already decided, exactly as the property importer
 * does.
 *
 * ⚠️ AND ROWS WITH ERRORS ARE NOT HERE. The caller passes the lines that
 * survived validation; this does not re-check them, because two checks that
 * disagree is worse than one that is wrong.
 */
export function toImportRows(
  rows: ReadonlyArray<Readonly<Record<string, string>>>,
  skipLines: ReadonlySet<number>,
): readonly LeadImportRow[] {
  const out: LeadImportRow[] = [];
  rows.forEach((row, i) => {
    const line = i + 2; /* the header is line 1, as a person counts a sheet */
    if (skipLines.has(line)) return;

    const rawPhone = (row.phone ?? '').trim();
    const email = (row.email ?? '').trim().toLowerCase();
    const budgetText = (row.budget ?? '').replace(/[,\s]/g, '').trim();
    const budget = budgetText ? Number(budgetText) : NaN;

    out.push({
      fullName: (row.fullName ?? '').trim(),
      phone: rawPhone || null,
      phoneE164: rawPhone ? toE164(rawPhone) : null,
      email: email || null,
      city: (row.city ?? '').trim() || null,
      enquiry: (row.enquiry ?? '').trim() || null,
      budget: Number.isFinite(budget) && budget > 0 ? Math.round(budget) : null,
      /* ⚠️ `import` IS THE HONEST DEFAULT, not `manual`. Somebody typed this
         person into a spreadsheet somewhere else; where they originally came
         from is not recorded, and `manual` would claim a salesperson entered
         them here. */
      source: readSource(row.source) ?? 'import',
      sourceDetail: (row.sourceDetail ?? '').trim() || null,
    });
  });
  return out;
}
