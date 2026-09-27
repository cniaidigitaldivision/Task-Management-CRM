'use client';

import * as React from 'react';
import {
  AlertTriangle, ArrowRight, Check, Copy, FileSpreadsheet, Info, RefreshCw, Upload, XCircle,
} from 'lucide-react';

import { importPropertiesAction } from '@/app/actions/crm-properties';
import { cv, OUTLINE, outlineStyle, SOLID, solidStyle, Select } from '@/components/crm/clients-ui';
import { Dialog } from '@/components/ui/dialog';
import type { ProjectOption } from '@/components/crm/property-form';
import {
  areaLabel,
  areaSqft,
  checkImportRow,
  money,
  sizeLabel,
  statusLook,
  tallyImport,
  TEMPLATE_COLUMNS,
  type ImportIssue,
  type ImportOptions,
} from '@/lib/domain/crm-property';
import { cn } from '@/lib/utils';

/* ============================================================================
 * THE PROPERTIES PAGE'S DIALOGS
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-27: *"When you click on it, it should pop up the modal and do
 * anything right?"* — so everything happens here, on this page. Nothing
 * navigates away.
 *
 * ── ⚠️ NATIVE `<dialog>`, VIA components/ui/dialog.tsx ────────────────────
 * Never a hand-rolled `fixed inset-0`. The app shell's `.reveal-children`
 * animation ends on `transform: none`, which computes to an identity matrix and
 * makes the shell a containing block — a fixed overlay inside it filled the
 * 1540px page rather than the viewport, and the owner reported "nothing
 * appears" because the dialog had opened below the fold. A native dialog is put
 * in the browser's TOP LAYER, outside every containing block.
 * ========================================================================= */

/* The Add and Edit dialogs moved to `property-form.tsx` when the owner sent
   their own references: a four-step wizard and a tabbed editor are too much
   screen to share a file with the importer. */
export type { ProjectOption } from '@/components/crm/property-form';

/** The importer's own label-and-control pair. Small enough not to be worth
 *  sharing with the wizard, whose fields carry required marks and lock icons. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-[0.3rem]">
      <span className="text-[0.78rem] font-medium" style={{ color: cv('soft') }}>{label}</span>
      {children}
    </label>
  );
}

/* ---------------------------------------------------------------------------
 * The import wizard
 * ------------------------------------------------------------------------- */

export interface ParsedSheet {
  readonly headers: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

/** A CSV reader that copes with quotes, embedded commas and CRLF. */
export function parseCsv(text: string): ParsedSheet {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i += 1; } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === ',') { row.push(cell); cell = ''; continue; }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell); cell = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
      continue;
    }
    cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== '')) rows.push(row);

  const [headers = [], ...body] = rows;
  return { headers: headers.map((h) => h.trim()), rows: body };
}

/** Best guess at which sheet column is which field, by name. */
function guessMapping(headers: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const col of TEMPLATE_COLUMNS) {
    const want = col.header.toLowerCase().replace(/[^a-z]/g, '');
    const key = col.key.toLowerCase();
    const found = headers.findIndex((h) => {
      const norm = h.toLowerCase().replace(/[^a-z]/g, '');
      return norm === want || norm === key || norm.includes(key);
    });
    if (found >= 0) out[col.key] = found;
  }
  return out;
}

const STEP_META = [
  { key: 'upload', label: 'Upload', done: 'File uploaded', todo: 'Choose a file' },
  { key: 'map', label: 'Map columns', done: 'Columns mapped', todo: 'Match the headers' },
  { key: 'validate', label: 'Validate', done: 'Checked', todo: 'Check for issues' },
  { key: 'review', label: 'Review & import', done: 'Imported', todo: 'Confirm and import' },
] as const;
type Step = (typeof STEP_META)[number]['key'];

export function ImportDialog({
  open,
  onClose,
  projects,
  existingCodes,
  onDone,
  onTemplate,
}: {
  open: boolean;
  onClose: () => void;
  projects: readonly ProjectOption[];
  /** Codes already on each project, so a clash is named before anything is sent. */
  existingCodes: Readonly<Record<string, readonly string[]>>;
  onDone: (message: string) => void;
  onTemplate: () => void;
}) {
  const [step, setStep] = React.useState<Step>('upload');
  const [projectId, setProjectId] = React.useState(projects[0]?.id ?? '');
  const [sheet, setSheet] = React.useState<ParsedSheet | null>(null);
  const [fileName, setFileName] = React.useState('');
  const [uploadedAt, setUploadedAt] = React.useState('');
  const [mapping, setMapping] = React.useState<Record<string, number>>({});
  const [options, setOptions] = React.useState<ImportOptions>({
    markTestData: true,
    skipUnchanged: true,
    /* ⚠️ OFF by default. A repeated Property ID is a mistake far more often than
       an intention, and the cost of guessing wrong is somebody's price
       overwritten without being asked. */
    updateMatching: false,
  });
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const project = projects.find((p) => p.id === projectId) ?? projects[0];
  const standard = project?.marlaStandard ?? 225;

  /* ⚠️ STATE, NOT A REF. Resetting when a prop changes is React's own
     "adjusting state during render" pattern, and it has to be state: a ref read
     or written during render is `react-hooks/refs`, and it is a real bug rather
     than a style rule — a ref does not schedule the re-render the reset needs,
     so under Strict Mode's double invocation the two can disagree. */
  const [wasOpen, setWasOpen] = React.useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) { setStep('upload'); setSheet(null); setFileName(''); setMapping({}); setError(null); }
  }

  async function pick(file: File) {
    setError(null);
    if (!file.name.toLowerCase().endsWith('.csv')) {
      /* ⚠️ HONEST ABOUT THE FORMAT. Reading .xlsx in the browser needs a parser
         this page does not carry, and a silent failure on a real sheet is worse
         than a sentence saying to save it as CSV first. */
      setError('Save the sheet as CSV and upload that — Excel’s “Save as → CSV” keeps every column.');
      return;
    }
    const parsed = parseCsv(await file.text());
    if (parsed.headers.length === 0 || parsed.rows.length === 0) {
      setError('That file had no rows under its header line.');
      return;
    }
    setFileName(file.name);
    setUploadedAt(new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Karachi', day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    }).format(new Date()));
    setSheet(parsed);
    setMapping(guessMapping(parsed.headers));
    setStep('map');
  }

  /* ── the rows, and what is wrong with them ──────────────────────────── */
  const checked = React.useMemo(() => {
    if (!sheet) return { rows: [] as Record<string, string>[], issues: [] as ImportIssue[] };
    const existing = new Set((existingCodes[projectId] ?? []).map((c) => c.toLowerCase()));
    const seen = new Set<string>();
    const rows: Record<string, string>[] = [];
    const issues: ImportIssue[] = [];

    sheet.rows.forEach((raw, i) => {
      const row: Record<string, string> = {};
      for (const c of TEMPLATE_COLUMNS) {
        const at = mapping[c.key];
        row[c.key] = at === undefined ? '' : (raw[at] ?? '').trim();
      }
      issues.push(...checkImportRow(row, i + 2, seen, existing, options, standard));
      const key = row.code.trim().toLowerCase();
      if (key) seen.add(key);
      row.status = (row.status || 'available').toLowerCase().replace(/\s+/g, '_');
      rows.push(row);
    });
    return { rows, issues };
  }, [sheet, mapping, options, projectId, existingCodes, standard]);

  const tally = tallyImport(checked.rows.length, checked.issues);
  const blocked = tally.errors > 0;

  async function confirm() {
    setBusy(true);
    setError(null);
    const result = await importPropertiesAction(projectId, standard, checked.rows, {
      markTestData: options.markTestData,
      updateMatching: options.updateMatching,
    });
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    onDone(result.message);
    onClose();
  }

  const at = STEP_META.findIndex((x) => x.key === step);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Import properties"
      size="lg"
      header={
        <div className="flex items-center gap-3">
          <span className="grid size-[2.6rem] shrink-0 place-items-center rounded-[0.55rem]" style={{ background: cv('tile') }}>
            <Upload className="size-[1.2rem]" style={{ color: cv('tile-ink') }} aria-hidden="true" />
          </span>
          <span>
            <span className="block text-[1.25rem] font-bold leading-tight" style={{ color: cv('ink') }}>Import properties</span>
            <span className="block text-[0.86rem]" style={{ color: cv('soft') }}>Upload a CSV inventory list</span>
          </span>
        </div>
      }
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button type="button" onClick={onTemplate}
                  className="inline-flex items-center gap-[0.35rem] text-[0.85rem] font-medium" style={{ color: cv('brand-ink') }}>
            <FileSpreadsheet className="size-[0.9rem]" aria-hidden="true" /> Download import template
          </button>
          <span className="flex gap-2">
            <button type="button" onClick={onClose} className={`${OUTLINE} h-[2.4rem] px-4 text-[0.93rem]`} style={outlineStyle}>
              Cancel
            </button>
            {at > 0 && (
              <button type="button" onClick={() => setStep(STEP_META[at - 1].key)}
                      className={`${OUTLINE} h-[2.4rem] px-4 text-[0.93rem]`} style={outlineStyle}>
                Back
              </button>
            )}
            {step === 'map' && (
              <button type="button" onClick={() => setStep('validate')} className={`${SOLID} h-[2.4rem] px-5 text-[0.93rem]`} style={solidStyle}>
                Validate rows
              </button>
            )}
            {step === 'validate' && (
              <button type="button" disabled={blocked} onClick={() => setStep('review')}
                      className={cn(`${SOLID} h-[2.4rem] px-5 text-[0.93rem]`, blocked && 'opacity-50')} style={solidStyle}>
                Review {tally.ready} {tally.ready === 1 ? 'property' : 'properties'}
                <ArrowRight className="size-4" aria-hidden="true" />
              </button>
            )}
            {step === 'review' && (
              <button type="button" disabled={busy || blocked} onClick={() => void confirm()}
                      className={`${SOLID} h-[2.4rem] px-5 text-[0.93rem]`} style={solidStyle}>
                {busy ? 'Importing…' : `Import ${tally.ready} properties`}
              </button>
            )}
          </span>
        </div>
      }
    >
      {/* the four steps, and what each one did */}
      <ol className="mb-4 flex flex-wrap items-start gap-x-[0.6rem] gap-y-2">
        {STEP_META.map((sm, i) => (
          <React.Fragment key={sm.key}>
            <li className="min-w-0">
              <span className="flex items-center gap-[0.45rem]">
                <span className="grid size-[1.6rem] shrink-0 place-items-center rounded-full text-[0.78rem] font-semibold"
                      style={i < at ? { background: cv('green-dot'), color: '#fff' }
                            : i === at ? { background: cv('brand'), color: cv('on-brand') }
                            : { background: cv('pill'), color: cv('mute') }}>
                  {i < at ? <Check className="size-[0.8rem]" strokeWidth={3} aria-hidden="true" /> : i + 1}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[0.86rem] font-medium" style={{ color: i <= at ? cv('ink') : cv('mute') }}>
                    {sm.label}
                  </span>
                  <span className="block truncate text-[0.72rem]" style={{ color: cv('mute') }}>
                    {i < at ? sm.done : sm.todo}
                  </span>
                </span>
              </span>
            </li>
            {i < STEP_META.length - 1 && (
              <span className="mt-[0.8rem] h-px w-[1.6rem]" style={{ background: cv('line') }} aria-hidden="true" />
            )}
          </React.Fragment>
        ))}
      </ol>

      {/* the file, once there is one */}
      {sheet && (
        <div className="mb-3 flex flex-wrap items-center gap-[0.7rem] rounded-[0.5rem] border p-[0.6rem]"
             style={{ borderColor: cv('line'), background: cv('strip') }}>
          <span className="grid size-[2.3rem] shrink-0 place-items-center rounded-[0.4rem]" style={{ background: cv('green-bg') }}>
            <FileSpreadsheet className="size-[1.1rem]" style={{ color: cv('green') }} aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[0.9rem] font-medium" style={{ color: cv('ink') }}>{fileName}</span>
            <span className="block text-[0.78rem]" style={{ color: cv('soft') }}>
              {sheet.rows.length} rows · Uploaded {uploadedAt}
            </span>
          </span>
          <button type="button" onClick={() => fileRef.current?.click()}
                  className="inline-flex items-center gap-[0.35rem] text-[0.84rem] font-medium" style={{ color: cv('brand-ink') }}>
            <RefreshCw className="size-[0.85rem]" aria-hidden="true" /> Replace file
          </button>
        </div>
      )}

      {sheet && (step === 'validate' || step === 'review') && (
        <div className="mb-3 grid gap-[0.5rem] sm:grid-cols-4">
          <Count label="Ready to import" value={tally.ready} tone="green" icon={Check} />
          <Count label="Warnings" value={tally.warnings} tone="amber" icon={AlertTriangle} />
          <Count label="Errors" value={tally.errors} tone="red" icon={XCircle} />
          <Count label="Duplicates" value={tally.duplicates} tone="grey" icon={Copy} />
        </div>
      )}

      {step === 'upload' && (
        <div className="space-y-3">
          <Field label="Import into">
            <Select label="Import into" value={projectId} onChange={setProjectId} className="h-[2.5rem] w-full">
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
          <button type="button" onClick={() => fileRef.current?.click()}
                  className="flex w-full flex-col items-center justify-center gap-2 rounded-[0.6rem] border border-dashed py-10 transition-colors hover:bg-[var(--cl-head)]"
                  style={{ borderColor: cv('brand-line') }}>
            <Upload className="size-6" style={{ color: cv('brand-ink') }} aria-hidden="true" />
            <span className="text-[0.95rem] font-medium" style={{ color: cv('ink') }}>Choose a CSV file</span>
            <span className="text-[0.8rem]" style={{ color: cv('mute') }}>
              The header row is what the columns are matched on.
            </span>
          </button>
        </div>
      )}

      {step === 'map' && sheet && (
        <div className="space-y-2">
          <h4 className="text-[0.93rem] font-semibold" style={{ color: cv('ink') }}>Column mapping preview</h4>
          <div className="max-h-[20rem] overflow-y-auto rounded-[0.5rem] border" style={{ borderColor: cv('line') }}>
            <table className="w-full text-[0.84rem]">
              <thead className="sticky top-0" style={{ background: cv('head') }}>
                <tr style={{ color: cv('soft') }}>
                  <th className="px-3 py-[0.45rem] text-left font-medium">File column</th>
                  <th className="px-3 py-[0.45rem] text-left font-medium">Maps to</th>
                  <th className="px-3 py-[0.45rem] text-left font-medium">Example</th>
                </tr>
              </thead>
              <tbody>
                {sheet.headers.map((h, i) => {
                  const mapped = TEMPLATE_COLUMNS.find((c) => mapping[c.key] === i);
                  return (
                    <tr key={`${h}-${i}`} className="border-t" style={{ borderColor: cv('grid') }}>
                      <td className="px-3 py-[0.35rem] font-medium" style={{ color: cv('ink') }}>
                        {h || `Column ${i + 1}`}
                      </td>
                      <td className="px-3 py-[0.3rem]">
                        <Select
                          label={`What ${h || `column ${i + 1}`} means`}
                          value={mapped?.key ?? ''}
                          onChange={(key) => setMapping((m) => {
                            const next = { ...m };
                            for (const [k, v] of Object.entries(next)) if (v === i) delete next[k];
                            if (key) next[key] = i;
                            return next;
                          })}
                          className="h-[2.1rem] w-full"
                        >
                          <option value="">Not imported</option>
                          {TEMPLATE_COLUMNS.map((c) => <option key={c.key} value={c.key}>{c.header}</option>)}
                        </Select>
                      </td>
                      <td className="px-3 py-[0.35rem]" style={{ color: cv('soft') }}>
                        {(sheet.rows[0]?.[i] ?? '').slice(0, 28) || '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-[0.78rem]" style={{ color: cv('mute') }}>
            Required: {TEMPLATE_COLUMNS.filter((c) => c.required).map((c) => c.header).join(' · ')}
          </p>
        </div>
      )}

      {step === 'validate' && (
        <div className="space-y-2">
          {checked.issues.length === 0 ? (
            <p className="flex items-center gap-2 rounded-[0.5rem] px-3 py-2 text-[0.88rem]"
               style={{ background: cv('green-soft'), color: cv('green') }}>
              <Check className="size-4" strokeWidth={3} aria-hidden="true" /> All {tally.ready} rows are usable.
            </p>
          ) : (
            <ul className="max-h-[18rem] space-y-1 overflow-y-auto rounded-[0.5rem] border p-3 text-[0.82rem]"
                style={{ borderColor: cv('line') }}>
              {checked.issues.slice(0, 200).map((is, i) => (
                <li key={`${is.line}-${i}`} className="flex items-start gap-[0.45rem]">
                  <span className="mt-[0.15rem] size-[0.55rem] shrink-0 rounded-full"
                        style={{ background: cv(is.severity === 'error' ? 'red-dot' : is.severity === 'warning' ? 'amber-dot' : 'grey-dot') }}
                        aria-hidden="true" />
                  <span style={{ color: cv('soft') }}>
                    <strong style={{ color: cv('ink') }}>Row {is.line}</strong> · {is.text}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {blocked && (
            <p className="text-[0.82rem]" style={{ color: cv('red') }}>
              Nothing is imported while there are errors. Warnings and duplicates do not block.
            </p>
          )}
        </div>
      )}

      {step === 'review' && (
        <div className="space-y-3">
          <section>
            <h4 className="mb-[0.45rem] text-[0.93rem] font-semibold" style={{ color: cv('ink') }}>Import options</h4>
            <ul className="space-y-[0.5rem]">
              <Option
                on={options.markTestData}
                onFlip={() => setOptions((c) => ({ ...c, markTestData: !c.markTestData }))}
                label="Mark all imported rows as test data"
                hint="Keeps them out of real reports and pipeline figures."
              />
              <Option
                on={options.skipUnchanged}
                onFlip={() => setOptions((c) => ({ ...c, skipUnchanged: !c.skipUnchanged }))}
                label="Skip unchanged records"
                hint="A row identical to what is stored is left alone."
              />
              <Option
                on={options.updateMatching}
                onFlip={() => setOptions((c) => ({ ...c, updateMatching: !c.updateMatching }))}
                label="Update matching property IDs"
                hint="Off, an existing ID is an error. On, the stored plot is overwritten."
              />
            </ul>
          </section>

          <p className="flex items-start gap-[0.45rem] rounded-[0.45rem] px-[0.6rem] py-[0.5rem] text-[0.82rem]"
             style={{ background: cv('pick'), color: cv('brand-ink') }}>
            <Info className="mt-[0.1rem] size-[0.95rem] shrink-0" aria-hidden="true" />
            Import cannot mark a property Sold without an authorised booking reference.
          </p>

          <div className="max-h-[14rem] overflow-auto rounded-[0.5rem] border" style={{ borderColor: cv('line') }}>
            <table className="w-full text-[0.8rem]">
              <thead>
                <tr style={{ background: cv('head'), color: cv('soft') }}>
                  {['ID', 'Plot', 'Block', 'Size', 'Area', 'Price', 'Status'].map((h) => (
                    <th key={h} className="px-2 py-[0.4rem] text-left font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {checked.rows.slice(0, 40).map((r, i) => (
                  <tr key={`${r.code}-${i}`} className="border-t" style={{ borderColor: cv('grid'), color: cv('ink') }}>
                    <td className="px-2 py-[0.3rem] font-medium">{r.code}</td>
                    <td className="px-2 py-[0.3rem]">{r.plotNumber}</td>
                    <td className="px-2 py-[0.3rem]">{r.block || '—'}</td>
                    <td className="px-2 py-[0.3rem]">{sizeLabel(Number(r.sizeMarla))}</td>
                    <td className="px-2 py-[0.3rem]">{areaLabel(areaSqft(Number(r.sizeMarla), standard))}</td>
                    <td className="px-2 py-[0.3rem] tabular-nums">
                      {money(Number(r.basePrice.replace(/[^0-9]/g, '')))}
                    </td>
                    <td className="px-2 py-[0.3rem]">{statusLook(r.status).label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <input ref={fileRef} type="file" accept=".csv,text/csv" className="sr-only"
             onChange={(e) => { const f = e.target.files?.[0]; if (f) void pick(f); e.target.value = ''; }} />

      {error ? (
        <p className="mt-3 flex items-start gap-2 text-[0.85rem]" style={{ color: cv('red') }}>
          <AlertTriangle className="mt-[0.1rem] size-4 shrink-0" aria-hidden="true" />
          {error}
        </p>
      ) : null}
    </Dialog>
  );
}

function Count({
  label, value, tone, icon: Icon,
}: {
  label: string;
  value: number;
  tone: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties; strokeWidth?: number; 'aria-hidden'?: boolean }>;
}) {
  return (
    <div className="flex items-center gap-[0.55rem] rounded-[0.5rem] border px-[0.6rem] py-[0.5rem]"
         style={{ borderColor: cv('line'), background: cv('surface') }}>
      <span className="grid size-[1.9rem] shrink-0 place-items-center rounded-[0.4rem]" style={{ background: cv(`${tone}-bg`) }}>
        <Icon className="size-[1rem]" style={{ color: cv(tone) }} strokeWidth={2.2} aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[0.74rem]" style={{ color: cv('soft') }}>{label}</span>
        <span className="block text-[1.15rem] font-bold leading-tight tabular-nums" style={{ color: cv(tone) }}>{value}</span>
      </span>
    </div>
  );
}

function Option({ on, onFlip, label, hint }: { on: boolean; onFlip: () => void; label: string; hint: string }) {
  return (
    <li className="flex items-start justify-between gap-3">
      <span className="min-w-0">
        <span className="block text-[0.88rem]" style={{ color: cv('ink') }}>{label}</span>
        <span className="block text-[0.78rem]" style={{ color: cv('soft') }}>{hint}</span>
      </span>
      <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={onFlip}
              className="relative mt-[0.15rem] inline-flex h-[1.35rem] w-[2.4rem] shrink-0 items-center rounded-full border transition-colors"
              style={on ? { background: cv('brand'), borderColor: 'transparent' } : { background: cv('pill'), borderColor: cv('line') }}>
        <span aria-hidden="true" className={cn('block size-[1rem] rounded-full bg-white shadow-[var(--shadow-sm)] transition-transform',
          on ? 'translate-x-[1.22rem]' : 'translate-x-[0.14rem]')} />
      </button>
    </li>
  );
}


/* ---------------------------------------------------------------------------
 * Share — customer-safe, and it writes nothing
 * ------------------------------------------------------------------------- */

export function ShareDialog({
  open,
  onClose,
  subject,
  text,
}: {
  open: boolean;
  onClose: () => void;
  subject: string;
  text: string;
}) {
  const [copied, setCopied] = React.useState(false);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Share property"
      description="Exactly what the customer receives. Internal notes, leads, bookings and payment history are not in it."
      size="md"
      footer={
        <div className="flex items-center justify-between gap-3">
          {/* ⚠️ The owner's rule, said on screen as well as enforced in code. */}
          <span className="text-[0.78rem]" style={{ color: cv('mute') }}>
            Sharing does not reserve the plot.
          </span>
          <span className="flex gap-2">
            <button type="button" onClick={onClose} className={`${OUTLINE} h-[2.4rem] px-4 text-[0.93rem]`} style={outlineStyle}>
              Close
            </button>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(text).then(() => {
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1800);
                });
              }}
              className={`${SOLID} h-[2.4rem] px-5 text-[0.93rem]`}
              style={solidStyle}
            >
              {copied ? <Check className="size-4" strokeWidth={3} aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </span>
        </div>
      }
    >
      <p className="mb-2 text-[0.9rem] font-semibold" style={{ color: cv('ink') }}>{subject}</p>
      <pre
        className="max-h-[22rem] overflow-auto whitespace-pre-wrap rounded-[0.5rem] border p-3 text-[0.85rem] leading-[1.6]"
        style={{ borderColor: cv('line'), background: cv('head'), color: cv('ink'), fontFamily: 'inherit' }}
      >
        {text}
      </pre>
    </Dialog>
  );
}

/* ---------------------------------------------------------------------------
 * Download the template
 * ------------------------------------------------------------------------- */

/** The header row, one example row, and a notes row explaining each column. */
export function templateCsv(): string {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [
    TEMPLATE_COLUMNS.map((c) => esc(c.header)).join(','),
    TEMPLATE_COLUMNS.map((c) => esc(c.example)).join(','),
    TEMPLATE_COLUMNS.map((c) => esc(c.note)).join(','),
  ].join('\r\n');
}

export function TemplateHint() {
  return (
    <span className="inline-flex items-center gap-[0.35rem] text-[0.78rem]" style={{ color: cv('mute') }}>
      <FileSpreadsheet className="size-[0.85rem]" aria-hidden="true" />
      CSV / Excel template
    </span>
  );
}
