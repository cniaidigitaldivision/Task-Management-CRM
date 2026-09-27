'use client';

import * as React from 'react';
import { AlertTriangle, ArrowRight, Check, Copy, FileSpreadsheet, Upload } from 'lucide-react';

import { importPropertiesAction } from '@/app/actions/crm-properties';
import { cv, OUTLINE, outlineStyle, SOLID, solidStyle, Select } from '@/components/crm/clients-ui';
import { Dialog } from '@/components/ui/dialog';
import type { ProjectOption } from '@/components/crm/property-form';
import {
  areaLabel,
  areaSqft,
  money,
  SELECTABLE_STATUSES,
  sizeLabel,
  statusLook,
  TEMPLATE_COLUMNS,
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

type Step = 'upload' | 'map' | 'validate' | 'preview' | 'done';

const STEPS: readonly { readonly key: Step; readonly label: string }[] = [
  { key: 'upload', label: 'Upload' },
  { key: 'map', label: 'Map columns' },
  { key: 'validate', label: 'Validate' },
  { key: 'preview', label: 'Preview' },
  { key: 'done', label: 'Confirm' },
];

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

export function ImportDialog({
  open,
  onClose,
  projects,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  projects: readonly ProjectOption[];
  onDone: (message: string) => void;
}) {
  const [step, setStep] = React.useState<Step>('upload');
  const [projectId, setProjectId] = React.useState(projects[0]?.id ?? '');
  const [sheet, setSheet] = React.useState<ParsedSheet | null>(null);
  const [fileName, setFileName] = React.useState('');
  const [mapping, setMapping] = React.useState<Record<string, number>>({});
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const standard = projects.find((p) => p.id === projectId)?.marlaStandard ?? 225;

  function reset() {
    setStep('upload');
    setSheet(null);
    setFileName('');
    setMapping({});
    setError(null);
  }

  async function pick(file: File) {
    setError(null);
    const name = file.name.toLowerCase();
    if (!name.endsWith('.csv')) {
      /* ⚠️ HONEST ABOUT THE FORMAT. Reading .xlsx in the browser needs a
         parser this page does not carry, and a silent failure on a real sheet
         is worse than a sentence saying "save it as CSV first". */
      setError('Save the sheet as CSV and upload that. Excel’s “Save as → CSV” keeps every column.');
      return;
    }
    const text = await file.text();
    const parsed = parseCsv(text);
    if (parsed.headers.length === 0 || parsed.rows.length === 0) {
      setError('That file had no rows under its header line.');
      return;
    }
    setFileName(file.name);
    setSheet(parsed);
    setMapping(guessMapping(parsed.headers));
    setStep('map');
  }

  /* ── validation, row by row, in the browser so a fix costs no round trip ── */
  const checked = React.useMemo(() => {
    if (!sheet) return { rows: [] as Record<string, string>[], problems: [] as string[] };
    const problems: string[] = [];
    const rows: Record<string, string>[] = [];
    const seen = new Set<string>();

    sheet.rows.forEach((raw, i) => {
      const line = i + 2;
      const get = (key: string) => {
        const at = mapping[key];
        return at === undefined ? '' : (raw[at] ?? '').trim();
      };
      const row: Record<string, string> = {};
      for (const c of TEMPLATE_COLUMNS) row[c.key] = get(c.key);

      if (!row.code) problems.push(`Row ${line}: no Property ID.`);
      if (!row.plotNumber) problems.push(`Row ${line}: no plot number.`);
      const marla = Number(row.sizeMarla);
      if (!Number.isFinite(marla) || marla <= 0) problems.push(`Row ${line}: size “${row.sizeMarla || '—'}” is not a number of Marla.`);
      if (!/[0-9]/.test(row.basePrice)) problems.push(`Row ${line}: base price “${row.basePrice || '—'}” is not a number.`);

      const key = row.code.toLowerCase();
      if (key && seen.has(key)) problems.push(`Row ${line}: ${row.code} appears more than once in this sheet.`);
      seen.add(key);

      const status = (row.status || 'available').toLowerCase().replace(/\s+/g, '_');
      if (!SELECTABLE_STATUSES.includes(status as never)) {
        problems.push(`Row ${line}: “${row.status}” is not one of Available, Reserved, Sold, On hold or Blocked.`);
      }
      row.status = status;
      rows.push(row);
    });

    return { rows, problems };
  }, [sheet, mapping]);

  async function confirm() {
    setBusy(true);
    setError(null);
    const result = await importPropertiesAction(projectId, standard, checked.rows);
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    onDone(result.message);
    reset();
    onClose();
  }

  const at = STEPS.findIndex((s) => s.key === step);

  return (
    <Dialog
      open={open}
      onClose={() => { reset(); onClose(); }}
      title="Import properties"
      description="Upload a sheet, check what it says, then confirm. Nothing is written until the last step."
      size="lg"
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-[0.78rem]" style={{ color: cv('mute') }}>
            {sheet ? `${fileName} · ${sheet.rows.length} rows` : 'CSV, with a header line.'}
          </span>
          <span className="flex gap-2">
            {step !== 'upload' && (
              <button type="button" onClick={() => setStep(STEPS[Math.max(0, at - 1)].key)} className={`${OUTLINE} h-[2.4rem] px-4 text-[0.93rem]`} style={outlineStyle}>
                Back
              </button>
            )}
            {step === 'map' && (
              <button type="button" onClick={() => setStep('validate')} className={`${SOLID} h-[2.4rem] px-5 text-[0.93rem]`} style={solidStyle}>
                Validate rows
              </button>
            )}
            {step === 'validate' && (
              <button
                type="button"
                disabled={checked.problems.length > 0}
                onClick={() => setStep('preview')}
                className={`${SOLID} h-[2.4rem] px-5 text-[0.93rem]`}
                style={solidStyle}
              >
                Preview changes
              </button>
            )}
            {step === 'preview' && (
              <button type="button" disabled={busy} onClick={() => void confirm()} className={`${SOLID} h-[2.4rem] px-5 text-[0.93rem]`} style={solidStyle}>
                {busy ? 'Importing…' : `Import ${checked.rows.length} properties`}
              </button>
            )}
          </span>
        </div>
      }
    >
      {/* the six steps, always visible, so nobody wonders how far they are */}
      <ol className="mb-4 flex flex-wrap items-center gap-x-[0.55rem] gap-y-2 text-[0.78rem]">
        {STEPS.map((s, i) => (
          <React.Fragment key={s.key}>
            <li
              className="inline-flex items-center gap-[0.4rem] rounded-full px-[0.6rem] py-[0.2rem] font-medium"
              style={{
                background: i <= at ? cv('tile') : 'transparent',
                color: i <= at ? cv('tile-ink') : cv('mute'),
              }}
            >
              <span className="grid size-[1.15rem] place-items-center rounded-full text-[0.65rem]"
                    style={{ background: i < at ? cv('green-dot') : i === at ? cv('brand') : cv('pill'),
                             color: i <= at ? '#fff' : cv('mute') }}>
                {i < at ? <Check className="size-[0.7rem]" strokeWidth={3} aria-hidden="true" /> : i + 1}
              </span>
              {s.label}
            </li>
            {i < STEPS.length - 1 && <ArrowRight className="size-[0.8rem]" style={{ color: cv('mute') }} aria-hidden="true" />}
          </React.Fragment>
        ))}
      </ol>

      {step === 'upload' && (
        <div className="space-y-3">
          <Field label="Import into">
            <Select label="Import into" value={projectId} onChange={setProjectId} className="h-[2.5rem] w-full">
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Select>
          </Field>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex w-full flex-col items-center justify-center gap-2 rounded-[0.6rem] border border-dashed py-10 transition-colors hover:bg-[var(--cl-head)]"
            style={{ borderColor: cv('brand-line') }}
          >
            <Upload className="size-6" style={{ color: cv('brand-ink') }} aria-hidden="true" />
            <span className="text-[0.95rem] font-medium" style={{ color: cv('ink') }}>Choose a CSV file</span>
            <span className="text-[0.8rem]" style={{ color: cv('mute') }}>
              Or download the template first — the header row is what the columns are matched on.
            </span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void pick(f); e.target.value = ''; }}
          />
        </div>
      )}

      {step === 'map' && sheet && (
        <div className="space-y-2">
          <p className="text-[0.85rem]" style={{ color: cv('soft') }}>
            These were matched by name. Change any that are wrong — a column set to “Not imported” is ignored.
          </p>
          <div className="max-h-[22rem] overflow-y-auto rounded-[0.5rem] border" style={{ borderColor: cv('line') }}>
            {TEMPLATE_COLUMNS.map((c) => (
              <div key={c.key} className="flex items-center gap-3 border-b px-3 py-[0.45rem] last:border-b-0" style={{ borderColor: cv('grid') }}>
                <span className="w-[11rem] shrink-0 text-[0.85rem]" style={{ color: cv('ink') }}>
                  {c.header}
                  {c.required && <span style={{ color: cv('red') }}> *</span>}
                </span>
                <Select
                  label={c.header}
                  value={mapping[c.key] === undefined ? '' : String(mapping[c.key])}
                  onChange={(v) => setMapping((m) => {
                    const next = { ...m };
                    if (v === '') delete next[c.key]; else next[c.key] = Number(v);
                    return next;
                  })}
                  className="h-[2.3rem] flex-1"
                >
                  <option value="">Not imported</option>
                  {sheet.headers.map((h, i) => (
                    <option key={`${h}-${i}`} value={String(i)}>{h || `Column ${i + 1}`}</option>
                  ))}
                </Select>
              </div>
            ))}
          </div>
        </div>
      )}

      {step === 'validate' && (
        <div className="space-y-2">
          {checked.problems.length === 0 ? (
            <p className="flex items-center gap-2 rounded-[0.5rem] px-3 py-2 text-[0.88rem]" style={{ background: cv('green-soft'), color: cv('green') }}>
              <Check className="size-4" strokeWidth={3} aria-hidden="true" />
              All {checked.rows.length} rows are usable.
            </p>
          ) : (
            <>
              <p className="flex items-center gap-2 text-[0.88rem] font-medium" style={{ color: cv('red') }}>
                <AlertTriangle className="size-4" aria-hidden="true" />
                {checked.problems.length} {checked.problems.length === 1 ? 'problem' : 'problems'} — nothing will be imported until they are fixed.
              </p>
              <ul className="max-h-[20rem] space-y-1 overflow-y-auto rounded-[0.5rem] border p-3 text-[0.82rem]" style={{ borderColor: cv('line'), color: cv('soft') }}>
                {checked.problems.slice(0, 200).map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {step === 'preview' && (
        <div className="space-y-2">
          <p className="text-[0.85rem]" style={{ color: cv('soft') }}>
            The first rows as they will be saved. A Property ID that already exists on this project is
            <strong> updated</strong>, not duplicated.
          </p>
          <div className="max-h-[22rem] overflow-auto rounded-[0.5rem] border" style={{ borderColor: cv('line') }}>
            <table className="w-full text-[0.8rem]">
              <thead>
                <tr style={{ background: cv('head'), color: cv('soft') }}>
                  {['ID', 'Plot', 'Block', 'Size', 'Area', 'Price', 'Status'].map((h) => (
                    <th key={h} className="px-2 py-[0.4rem] text-left font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {checked.rows.slice(0, 50).map((r, i) => (
                  <tr key={`${r.code}-${i}`} className="border-t" style={{ borderColor: cv('grid'), color: cv('ink') }}>
                    <td className="px-2 py-[0.35rem] font-medium">{r.code}</td>
                    <td className="px-2 py-[0.35rem]">{r.plotNumber}</td>
                    <td className="px-2 py-[0.35rem]">{r.block || '—'}</td>
                    <td className="px-2 py-[0.35rem]">{sizeLabel(Number(r.sizeMarla))}</td>
                    <td className="px-2 py-[0.35rem]">{areaLabel(areaSqft(Number(r.sizeMarla), standard))}</td>
                    <td className="px-2 py-[0.35rem] tabular-nums">{money(Number(r.basePrice.replace(/[^0-9]/g, '')))}</td>
                    <td className="px-2 py-[0.35rem]">{statusLook(r.status).label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {checked.rows.length > 50 && (
            <p className="text-[0.78rem]" style={{ color: cv('mute') }}>
              Showing the first 50 of {checked.rows.length}.
            </p>
          )}
        </div>
      )}

      {error ? (
        <p className="mt-3 flex items-start gap-2 text-[0.85rem]" style={{ color: cv('red') }}>
          <AlertTriangle className="mt-[0.1rem] size-4 shrink-0" aria-hidden="true" />
          {error}
        </p>
      ) : null}
    </Dialog>
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
