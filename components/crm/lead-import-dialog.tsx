'use client';

import * as React from 'react';
import {
  AlertTriangle, ArrowRight, Building2, Check, Copy, FileSpreadsheet, RefreshCw,
  Upload, Users, XCircle,
} from 'lucide-react';

import { importLeadsAction, knownContactsAction } from '@/app/actions/crm-leads';
import { Dialog } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { readXlsx } from '@/lib/view/xlsx-read';
import { parseCsv } from '@/components/crm/properties-dialogs';
import {
  checkLeadRow,
  digitsOf,
  guessLeadMapping,
  LEAD_TEMPLATE_COLUMNS,
  LEAD_TEMPLATE_GROUPS,
  toImportRows,
  type LeadImportOptions,
} from '@/lib/domain/crm-lead-import';
import { tallyImport, type ImportIssue } from '@/lib/domain/sheet-import';
import { toE164 } from '@/lib/domain/phone';
import { cn } from '@/lib/utils';

/* ============================================================================
 * IMPORT A LIST OF LEADS
 * ----------------------------------------------------------------------------
 * Owner, 2026-10-01: *"one more thing I want right now is to import a CSV or
 * Excel file… My focus right now is to make sure to properly import and export
 * the leads."*
 *
 * ── ⚠️ THE SAME FOUR STEPS AS THE PROPERTY IMPORTER ────────────────────────
 * Upload → Map columns → Validate → Review, with the four count tiles and one
 * constant height. That shape was drawn by the owner and built once already;
 * a second importer with its own idea of the order would make the product feel
 * like two products, and the person using both is the same person.
 *
 * ⚠️ BUT NOT THE SAME TOKENS. The property dialogs use `cv()`, which reads
 * `--cl-*` variables scoped to `.prop-ui` / `.clients-ui`. A native `<dialog>`
 * is painted in the TOP LAYER but still inherits custom properties down the DOM
 * tree — so those resolve there and would resolve to NOTHING here, where no
 * such ancestor exists. This uses the ordinary semantic tokens, which is what
 * the lead desk around it uses anyway.
 *
 * ── ⚠️ WHO GETS THE LEADS IS PART OF THE IMPORT, NOT AN AFTERTHOUGHT ───────
 * The owner's rule: a salesperson importing keeps the list; a manager picks one
 * or more salespeople and the rota shares it between exactly those. So Review
 * asks, and `app.crm_import_leads` enforces it — a salesperson who tampers with
 * the request is refused by the database, not by this file.
 * ========================================================================= */

const STEP_META = [
  { key: 'upload', label: 'Upload', done: 'File uploaded', todo: 'Choose a file' },
  { key: 'map', label: 'Map columns', done: 'Columns mapped', todo: 'Match the headers' },
  { key: 'validate', label: 'Validate', done: 'Checked', todo: 'Check for issues' },
  { key: 'review', label: 'Review & import', done: 'Imported', todo: 'Confirm and import' },
] as const;
type Step = (typeof STEP_META)[number]['key'];

export interface ImportProject {
  readonly id: string;
  readonly name: string;
}

export interface ImportSalesperson {
  readonly id: string;
  readonly name: string;
  readonly openLeads: number;
}

export function LeadImportDialog({
  open,
  onClose,
  projects,
  initialProjectId,
  /** Empty for a salesperson — migration 120's guard, read rather than re-decided. */
  salesTeam,
}: {
  open: boolean;
  onClose: () => void;
  projects: readonly ImportProject[];
  initialProjectId: string | null;
  salesTeam: readonly ImportSalesperson[];
}) {
  const toast = useToast();
  const fileRef = React.useRef<HTMLInputElement>(null);

  const [step, setStep] = React.useState<Step>('upload');
  const [projectId, setProjectId] = React.useState(initialProjectId ?? projects[0]?.id ?? '');
  const [sheet, setSheet] = React.useState<{ headers: readonly string[]; rows: readonly (readonly string[])[] } | null>(null);
  const [fileName, setFileName] = React.useState('');
  const [uploadedAt, setUploadedAt] = React.useState('');
  const [mapping, setMapping] = React.useState<Record<string, number>>({});
  const [known, setKnown] = React.useState<{
    phones: Set<string>; emails: Set<string>; digits: Set<string>;
  }>({ phones: new Set(), emails: new Set(), digits: new Set() });
  const [options, setOptions] = React.useState<LeadImportOptions>({
    skipDuplicates: true,
    markTestData: false,
  });
  const [chosen, setChosen] = React.useState<readonly string[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  /* ⚠️ THE PROJECT'S CONTACTS ARRIVE IN ONE QUERY, WHEN THE PROJECT CHANGES.
     Re-reading per row would be a round trip per row; re-reading per render
     would be a round trip per keystroke. */
  React.useEffect(() => {
    if (!open || !projectId) return;
    let live = true;
    void knownContactsAction(projectId).then((r) => {
      if (!live) return;
      setKnown({
        phones: new Set(r.phones),
        emails: new Set(r.emails),
        digits: new Set(r.digits),
      });
    });
    return () => { live = false; };
  }, [open, projectId]);

  /* ⚠️ RESET ON THE WAY OUT, NOT IN AN EFFECT WATCHING `open`. That effect was
     the obvious shape and `react-hooks/set-state-in-effect` is right to refuse
     it: six synchronous setState calls in an effect body is six cascading
     renders of a dialog that is already closing, to clear state nobody can see.
     Closing is an EVENT, so it is handled where the event happens — and every
     route out of this dialog goes through here, including Escape and the
     backdrop, because `Dialog` is given this and not the raw `onClose`. */
  const close = React.useCallback(() => {
    setStep('upload');
    setSheet(null);
    setFileName('');
    setMapping({});
    setChosen([]);
    setError(null);
    onClose();
  }, [onClose]);

  async function onFile(file: File | null) {
    if (!file) return;
    setError(null);
    const name = file.name.toLowerCase();
    let parsed: { headers: readonly string[]; rows: readonly (readonly string[])[] };
    try {
      if (name.endsWith('.xlsx')) {
        /* ⚠️ EXCEL IS READ IN THE TAB, not uploaded anywhere. `lib/view/xlsx-read`
           unzips it with the browser's own DecompressionStream. */
        /* ⚠️ `readXlsx` RETURNS ROWS, NOT A SHEET — the header row is the first
           of them, exactly as `parseCsv` splits it out. */
        const rows = await readXlsx(new Uint8Array(await file.arrayBuffer()));
        const [head = [], ...body] = rows;
        parsed = { headers: head.map((h) => h.trim()), rows: body };
      } else if (name.endsWith('.csv') || name.endsWith('.txt')) {
        parsed = parseCsv(await file.text());
      } else if (name.endsWith('.xls')) {
        setError('That is the older .xls format. Open it in Excel and use “Save as → .xlsx” or “Save as → CSV”.');
        return;
      } else {
        setError('Upload an Excel (.xlsx) or CSV file.');
        return;
      }
    } catch {
      setError('That file could not be read. If it came from Excel, try “Save as → CSV”.');
      return;
    }

    if (parsed.rows.length === 0) {
      setError('That file has a header row and nothing under it.');
      return;
    }

    setSheet(parsed);
    setFileName(file.name);
    setUploadedAt(new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Karachi', hour: '2-digit', minute: '2-digit' }));
    setMapping(guessLeadMapping(parsed.headers));
    setStep('map');
  }

  /* ── What the sheet says, as records ──────────────────────────────────── */
  const records = React.useMemo(() => {
    if (!sheet) return [];
    return sheet.rows.map((cells) => {
      const row: Record<string, string> = {};
      for (const [key, index] of Object.entries(mapping)) {
        row[key] = String(cells[index] ?? '').trim();
      }
      return row;
    });
  }, [sheet, mapping]);

  const issues = React.useMemo(() => {
    const out: ImportIssue[] = [];
    const seenPhones = new Set<string>();
    const seenEmails = new Set<string>();
    const seenDigits = new Set<string>();
    records.forEach((row, i) => {
      out.push(...checkLeadRow(
        row, i + 2,
        { phones: seenPhones, emails: seenEmails, digits: seenDigits },
        known, options,
      ));
      const e164 = row.phone ? toE164(row.phone) : null;
      const digits = digitsOf(row.phone);
      if (e164) seenPhones.add(e164);
      if (digits) seenDigits.add(digits);
      if (row.email) seenEmails.add(row.email.trim().toLowerCase());
    });
    return out;
  }, [records, known, options]);

  const tally = tallyImport(records.length, issues);

  /* ⚠️ A SKIPPED DUPLICATE IS NOT IMPORTED, AND THE NUMBER SAYS SO. Counting it
     as ready would promise 500 and write 480, which reads as the import having
     failed quietly. */
  const skipLines = React.useMemo(() => {
    const out = new Set<number>();
    for (const issue of issues) {
      if (issue.severity === 'error') out.add(issue.line);
      if (issue.severity === 'duplicate' && options.skipDuplicates) out.add(issue.line);
    }
    return out;
  }, [issues, options.skipDuplicates]);

  const willImport = Math.max(0, records.length - skipLines.size);
  const blocked = tally.errors > 0 || willImport === 0;
  const canShare = salesTeam.length > 0;

  async function confirm() {
    setBusy(true);
    setError(null);
    const rows = toImportRows(records, skipLines);
    const result = await importLeadsAction(projectId, rows, canShare ? chosen : [], {
      markTestData: options.markTestData,
    });
    setBusy(false);
    if (!result.ok) { setError(result.error ?? 'Nothing was imported.'); return; }

    const parts = [`Imported ${result.created} ${result.created === 1 ? 'lead' : 'leads'}`];
    if (result.skipped) parts.push(`${result.skipped} already on this project`);
    if (result.unassigned) parts.push(`${result.unassigned} left unassigned — nobody chosen was in the rota`);
    toast({ tone: result.unassigned ? 'error' : 'ok', text: `${parts.join('. ')}.` });
    close();
  }

  const at = STEP_META.findIndex((x) => x.key === step);

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Import leads"
      size="lg"
      header={
        <div className="flex items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-primary/10">
            <Upload className="size-5 text-accent-primary" aria-hidden="true" />
          </span>
          <span>
            <span className="block text-h3 font-semibold leading-tight text-text-primary">Import leads</span>
            <span className="block text-caption text-text-secondary">
              Upload a CSV or Excel list of people who have enquired
            </span>
          </span>
        </div>
      }
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => downloadLeadTemplate()}
            className="inline-flex items-center gap-1.5 text-body-sm font-medium text-text-brand underline-offset-2 hover:underline"
          >
            <FileSpreadsheet className="size-4" aria-hidden="true" /> Download import template
          </button>
          <span className="flex flex-wrap gap-2">
            <Ghost onClick={close}>Cancel</Ghost>
            {at > 0 && <Ghost onClick={() => setStep(STEP_META[at - 1].key)}>Back</Ghost>}
            {step === 'map' && (
              <Primary onClick={() => setStep('validate')}>Validate rows</Primary>
            )}
            {step === 'validate' && (
              <Primary disabled={blocked} onClick={() => setStep('review')}>
                Review {willImport} {willImport === 1 ? 'lead' : 'leads'}
                <ArrowRight className="size-4" aria-hidden="true" />
              </Primary>
            )}
            {step === 'review' && (
              <Primary disabled={busy || blocked} onClick={() => void confirm()}>
                {busy ? 'Importing…' : `Import ${willImport} ${willImport === 1 ? 'lead' : 'leads'}`}
              </Primary>
            )}
          </span>
        </div>
      }
    >
      <ol className="mb-4 flex flex-wrap items-start gap-x-2.5 gap-y-2">
        {STEP_META.map((sm, i) => (
          <React.Fragment key={sm.key}>
            <li className="min-w-0">
              <span className="flex items-center gap-1.5">
                <span
                  className={cn(
                    'grid size-6 shrink-0 place-items-center rounded-full text-micro font-semibold',
                    i < at ? 'bg-feedback-success text-white'
                      : i === at ? 'bg-accent-primary text-white'
                        : 'bg-bg-subtle text-text-tertiary',
                  )}
                >
                  {i < at ? <Check className="size-3" strokeWidth={3} aria-hidden="true" /> : i + 1}
                </span>
                <span className="min-w-0">
                  <span className={cn('block truncate text-caption font-medium',
                    i <= at ? 'text-text-primary' : 'text-text-tertiary')}>
                    {sm.label}
                  </span>
                  <span className="block truncate text-micro text-text-tertiary">
                    {i < at ? sm.done : sm.todo}
                  </span>
                </span>
              </span>
            </li>
            {i < STEP_META.length - 1 && (
              <span className="mt-3 h-px w-6 bg-border-default" aria-hidden="true" />
            )}
          </React.Fragment>
        ))}
      </ol>

      {/* ⚠️ THE PROJECT STAYS ON SCREEN THE WHOLE WAY THROUGH, and stays
          editable. Owner, on the property importer: *"where I can link that
          imported sheet with the project, there is no option over there."*
          Changing it re-runs the duplicate check against the NEW project's
          contacts, which the effect above already depends on. */}
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-accent-primary/40 bg-[color-mix(in_oklab,var(--accent-primary)_6%,transparent)] px-3 py-2">
        <span className="inline-flex items-center gap-1.5 text-body-sm font-medium text-text-brand">
          <Building2 className="size-4" aria-hidden="true" />
          Importing into
        </span>
        <select
          aria-label="Import into"
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          className="min-h-[2.2rem] min-w-[14rem] flex-1 rounded-lg border border-border-subtle bg-bg-surface px-2 text-body-sm text-text-primary focus:border-accent-primary focus:outline-none"
        >
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      {sheet && (
        <div className="mb-3 flex flex-wrap items-center gap-2.5 rounded-xl border border-border-default bg-bg-subtle p-2.5">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-feedback-success/10">
            <FileSpreadsheet className="size-4.5 text-feedback-success" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-body-sm font-medium text-text-primary">{fileName}</span>
            <span className="block text-caption text-text-secondary">
              {sheet.rows.length} rows · Uploaded {uploadedAt}
            </span>
          </span>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-1.5 text-caption font-medium text-text-brand underline-offset-2 hover:underline"
          >
            <RefreshCw className="size-3.5" aria-hidden="true" /> Replace file
          </button>
        </div>
      )}

      {sheet && (step === 'validate' || step === 'review') && (
        <div className="mb-3 grid gap-2 sm:grid-cols-4">
          <Count label="Ready to import" value={willImport} tone="green" icon={Check} />
          <Count label="Warnings" value={tally.warnings} tone="amber" icon={AlertTriangle} />
          <Count label="Errors" value={tally.errors} tone="red" icon={XCircle} />
          <Count label="Already here" value={tally.duplicates} tone="grey" icon={Copy} />
        </div>
      )}

      {/* ⚠️ ONE HEIGHT FOR EVERY STEP. Owner: *"the heights of the tabs should
          not change — in each tab on the modal, the height should be constant."*
          Without a floor the dialog grows and shrinks as somebody moves through
          it, which moves the footer buttons out from under the cursor between
          one press and the next — and a native dialog re-centres, so the
          content jumps as well. */}
      <div className="min-h-[21rem]">
        {step === 'upload' && (
          <label className="flex h-[19rem] cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border-default bg-bg-subtle text-center transition-colors hover:border-accent-primary">
            <Upload className="size-8 text-text-tertiary" aria-hidden="true" />
            <span className="text-body-sm font-medium text-text-primary">Upload a sheet…</span>
            <span className="max-w-sm text-caption leading-relaxed text-text-secondary">
              .xlsx or .csv — the header row is what the columns are matched on. Nothing is written
              until you have seen the counts.
            </span>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="sr-only"
              onChange={(e) => void onFile(e.target.files?.[0] ?? null)}
            />
          </label>
        )}

        {step === 'map' && sheet && (
          <div className="space-y-2">
            <p className="text-caption leading-relaxed text-text-secondary">
              Each row below is a field we can fill. Anything left as “Not in this file” is simply
              not imported — only a name and a way to contact them are needed.
            </p>
            <div className="max-h-[17rem] space-y-1.5 overflow-y-auto pr-1">
              {LEAD_TEMPLATE_COLUMNS.map((col) => (
                <div key={col.key} className="flex flex-wrap items-center gap-2 rounded-lg border border-border-subtle px-2.5 py-1.5">
                  <span className="min-w-[9rem] flex-1 text-body-sm text-text-primary">
                    {col.header}
                    {col.required && <span className="ml-1 text-feedback-error" aria-hidden="true">*</span>}
                  </span>
                  <select
                    aria-label={`Which column holds ${col.header}`}
                    value={mapping[col.key] ?? -1}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setMapping((m) => {
                        const next = { ...m };
                        if (v < 0) delete next[col.key];
                        else next[col.key] = v;
                        return next;
                      });
                    }}
                    className="min-h-[2rem] min-w-[11rem] rounded-lg border border-border-subtle bg-bg-surface px-2 text-caption text-text-primary focus:border-accent-primary focus:outline-none"
                  >
                    <option value={-1}>Not in this file</option>
                    {sheet.headers.map((h, i) => (
                      <option key={`${h}-${i}`} value={i}>{h || `Column ${i + 1}`}</option>
                    ))}
                  </select>
                  {/* The first row's value, so a wrong guess is obvious. */}
                  <span className="min-w-0 max-w-[10rem] truncate text-micro text-text-tertiary">
                    {mapping[col.key] === undefined
                      ? col.note || '—'
                      : String(sheet.rows[0]?.[mapping[col.key]] ?? '') || '(blank)'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {step === 'validate' && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-4">
              <Switch
                on={options.skipDuplicates}
                onToggle={() => setOptions((o) => ({ ...o, skipDuplicates: !o.skipDuplicates }))}
                label="Skip people we already have"
                hint="Matched on the number, the email, or the bare digits — on this project only."
              />
              <Switch
                on={options.markTestData}
                onToggle={() => setOptions((o) => ({ ...o, markTestData: !o.markTestData }))}
                label="Mark these as test data"
                hint="Keeps them out of the reports."
              />
            </div>
            <div className="max-h-[13rem] space-y-1 overflow-y-auto pr-1">
              {issues.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border-default px-3 py-6 text-center text-caption text-text-secondary">
                  Nothing to report. All {records.length} rows can be imported.
                </p>
              ) : (
                issues.slice(0, 200).map((issue, i) => (
                  <p
                    key={`${issue.line}-${i}`}
                    className={cn(
                      'rounded-lg px-2.5 py-1.5 text-caption leading-relaxed',
                      issue.severity === 'error' ? 'bg-feedback-error/10 text-text-primary'
                        : issue.severity === 'warning' ? 'bg-accent-gold/10 text-text-primary'
                          : 'bg-bg-subtle text-text-secondary',
                    )}
                  >
                    <strong className="font-semibold">Row {issue.line}</strong> · {issue.text}
                  </p>
                ))
              )}
              {issues.length > 200 && (
                <p className="px-2.5 text-caption text-text-tertiary">
                  …and {issues.length - 200} more. Fix these first — the rest are usually the same
                  problem.
                </p>
              )}
            </div>
          </div>
        )}

        {step === 'review' && (
          <div className="space-y-3">
            <p className="text-body-sm leading-relaxed text-text-primary">
              <strong>{willImport}</strong> {willImport === 1 ? 'lead' : 'leads'} will be added to{' '}
              <strong>{projects.find((p) => p.id === projectId)?.name ?? 'this project'}</strong>.
              {tally.duplicates > 0 && options.skipDuplicates && (
                <> {tally.duplicates} we already have {tally.duplicates === 1 ? 'is' : 'are'} being left alone.</>
              )}
            </p>

            {/* ── ⚠️ WHO WORKS THEM — THE OWNER'S OWN RULE ─────────────────
                *"if a salesperson imports, all the leads are theirs. If a
                manager imports, they pick one or more salespeople and the leads
                are distributed among only those."*

                ⚠️ THE CONTROL IS ABSENT, NOT DISABLED, FOR A SALESPERSON. An
                empty roster means migration 120 would refuse the write anyway;
                drawing a greyed-out picker would be telling them about a
                decision they are not being asked to make. */}
            {canShare ? (
              <div className="rounded-xl border border-border-default p-3">
                <p className="flex items-center gap-1.5 text-body-sm font-medium text-text-primary">
                  <Users className="size-4 text-text-secondary" aria-hidden="true" />
                  Who works these leads?
                </p>
                <p className="mb-2 mt-0.5 text-caption leading-relaxed text-text-secondary">
                  Pick nobody and they all stay with you. Pick one or more and they are shared out
                  between exactly those people — fewest open leads first, one at a time.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {salesTeam.map((person) => {
                    const on = chosen.includes(person.id);
                    return (
                      <button
                        key={person.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setChosen((c) =>
                          c.includes(person.id) ? c.filter((x) => x !== person.id) : [...c, person.id])}
                        className={cn(
                          'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-caption font-medium transition-colors',
                          on
                            ? 'border-accent-primary bg-[color-mix(in_oklab,var(--accent-primary)_10%,transparent)] text-text-primary'
                            : 'border-border-subtle text-text-secondary hover:border-border-default hover:text-text-primary',
                        )}
                      >
                        {on && <Check className="size-3.5" aria-hidden="true" />}
                        {person.name}
                        <span className="text-text-tertiary">· {person.openLeads} open</span>
                      </button>
                    );
                  })}
                </div>
                {chosen.length > 0 && (
                  /* ⚠️ NOT "roughly N each", WHICH IS USUALLY WRONG. The rota
                     gives every lead to whoever holds the fewest open ones at
                     that moment, so with one person eight leads lighter than
                     another a batch of three goes entirely to them — correctly.
                     Promising an even split and then delivering 3–0 makes a
                     working rota look broken. */
                  <p className="mt-2 text-caption leading-relaxed text-text-secondary">
                    Shared between {chosen.length} {chosen.length === 1 ? 'person' : 'people'} by
                    workload, not evenly — whoever is lightest gets the next one, each time. If one
                    of them is well behind, most of these will go to them.
                  </p>
                )}
              </div>
            ) : (
              <p className="rounded-xl border border-border-default bg-bg-subtle px-3 py-2.5 text-caption leading-relaxed text-text-secondary">
                These will all be yours to work. Handing leads to other people is a manager&rsquo;s
                decision, and the database enforces that rather than this screen.
              </p>
            )}

            {/* ⚠️ SAID PLAINLY, BECAUSE IT SURPRISES PEOPLE. A sheet cannot set a
                stage, an owner by name, or a temperature — see the header of
                `lib/domain/crm-lead-import.ts` for why each one is refused. */}
            <p className="text-caption leading-relaxed text-text-tertiary">
              Every imported lead opens at <strong>New</strong> with no temperature set. A sheet
              cannot mark somebody Won, Hot, or assign them by name — those are judgements made
              after a conversation.
            </p>
          </div>
        )}
      </div>

      {error && (
        <p className="mt-3 rounded-lg bg-feedback-error/10 px-3 py-2 text-caption leading-relaxed text-text-primary">
          {error}
        </p>
      )}
    </Dialog>
  );
}

/* ---------------------------------------------------------------------------
 * The template
 * ------------------------------------------------------------------------- */

/**
 * ⚠️ WRITTEN FROM `LEAD_TEMPLATE_COLUMNS`, WHICH THE PARSER ALSO READS. The
 * property importer's round trip found 338 errors the first time because the
 * writer and the reader spelled the headers differently. One list, two readers.
 */
export function downloadLeadTemplate(): void {
  const headers = LEAD_TEMPLATE_COLUMNS.map((c) => c.header);
  const example = LEAD_TEMPLATE_COLUMNS.map((c) => c.example);
  const notes = LEAD_TEMPLATE_COLUMNS.map((c) =>
    [c.required ? 'Required.' : '', c.note].filter(Boolean).join(' '));

  const csv = [headers, example, notes]
    .map((row) => row.map(csvCell).join(','))
    .join('\r\n');

  /* ⚠️ A BOM, OR EXCEL READS IT AS LATIN-1. Without it a name with an accent or
     an Urdu character opens as mojibake, and the person fixes it by retyping. */
  downloadBlob('lead-import-template.csv', `﻿${csv}`, 'text/csv;charset=utf-8');
}

export const LEAD_TEMPLATE_HELP = LEAD_TEMPLATE_GROUPS.map((group) => ({
  group,
  columns: LEAD_TEMPLATE_COLUMNS.filter((c) => c.group === group),
}));

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function downloadBlob(name: string, body: string, type: string): void {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/* ---------------------------------------------------------------------------
 * Small parts
 * ------------------------------------------------------------------------- */

function Ghost({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-[2.4rem] items-center rounded-xl border border-border-default px-4 text-body-sm font-medium text-text-primary transition-colors hover:bg-bg-subtle"
    >
      {children}
    </button>
  );
}

function Primary({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex min-h-[2.4rem] items-center gap-1.5 rounded-xl bg-accent-primary px-5 text-body-sm font-semibold text-white transition-opacity',
        disabled ? 'cursor-not-allowed opacity-50' : 'hover:opacity-90',
      )}
    >
      {children}
    </button>
  );
}

const TONES = {
  green: 'text-feedback-success',
  amber: 'text-accent-gold',
  red: 'text-feedback-error',
  grey: 'text-text-tertiary',
} as const;

function Count({
  label,
  value,
  tone,
  icon: Icon,
}: {
  label: string;
  value: number;
  tone: keyof typeof TONES;
  icon: typeof Check;
}) {
  return (
    <div className="rounded-xl border border-border-default px-3 py-2">
      <span className="flex items-center gap-1.5 text-caption text-text-secondary">
        <Icon className={cn('size-3.5', TONES[tone])} aria-hidden="true" />
        {label}
      </span>
      <span className="mt-0.5 block text-h3 font-semibold tabular-nums text-text-primary">
        {value}
      </span>
    </div>
  );
}

function Switch({
  on,
  onToggle,
  label,
  hint,
}: {
  on: boolean;
  onToggle: () => void;
  label: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onToggle}
      className="flex min-w-[13rem] flex-1 items-start gap-2 rounded-lg border border-border-subtle px-2.5 py-2 text-left transition-colors hover:border-border-default"
    >
      <span
        aria-hidden="true"
        className={cn(
          'mt-0.5 grid size-4 shrink-0 place-items-center rounded border',
          on ? 'border-accent-primary bg-accent-primary text-white' : 'border-border-default',
        )}
      >
        {on && <Check className="size-3" strokeWidth={3} />}
      </span>
      <span className="min-w-0">
        <span className="block text-caption font-medium text-text-primary">{label}</span>
        <span className="block text-micro leading-relaxed text-text-secondary">{hint}</span>
      </span>
    </button>
  );
}
