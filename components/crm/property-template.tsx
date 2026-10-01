'use client';

import * as React from 'react';
import {
  BadgeCheck, Building2, CalendarDays, Check, Copy, Download, FileSpreadsheet, FileText,
  HardHat, Info, Link2, Ruler, Tag,
} from 'lucide-react';

import { cv, OUTLINE, outlineStyle, SOLID, solidStyle, Select } from '@/components/crm/clients-ui';
import { Dialog } from '@/components/ui/dialog';
import { downloadBlob } from '@/lib/browser/download';
import {
  TEMPLATE_COLUMNS, TEMPLATE_GROUPS, type TemplateGroup,
} from '@/lib/domain/crm-property';
import { writeXlsx } from '@/lib/view/xlsx-write';
import { cn } from '@/lib/utils';

/* ============================================================================
 * DOWNLOAD THE IMPORT TEMPLATE — the owner's reference, 2026-09-27
 * ----------------------------------------------------------------------------
 * ── ⚠️ THE COPY SAYS WHAT THE FILE ACTUALLY CONTAINS ──────────────────────
 * The reference's Excel card promises "Dropdown validation" and an "Import
 * Guide (PDF)". Neither exists: `lib/view/xlsx-write.ts` is a dependency-free
 * writer with no data-validation support, and no guide has been written.
 *
 * So the ticks name what the file really carries — headers, an example row, a
 * notes row and sized columns. The layout is the owner's; the words are true.
 * The alternative is a person opening the sheet, finding no dropdowns, and
 * trusting nothing else this dialog said. (Same call as the Performance page's
 * "Sample data" becoming "Live data".)
 *
 * ── ⚠️ ONE LIST OF COLUMNS, SHARED WITH THE PARSER ────────────────────────
 * `TEMPLATE_COLUMNS` is what this writes AND what the importer matches on. A
 * template whose columns the importer does not recognise is worse than no
 * template — it is an instruction to build a file that will be rejected.
 * ========================================================================= */

const GROUP_ICON: Record<TemplateGroup, React.ComponentType<{ className?: string; style?: React.CSSProperties; 'aria-hidden'?: boolean }>> = {
  'Core details': Building2,
  Measurements: Ruler,
  Pricing: Tag,
  Availability: CalendarDays,
  Development: HardHat,
  'Linked references': Link2,
};

export interface TemplateProject {
  readonly id: string;
  readonly name: string;
  readonly marlaStandard: number;
}

export function DownloadTemplateDialog({
  open, onClose, projects, onToast,
}: {
  open: boolean;
  onClose: () => void;
  projects: readonly TemplateProject[];
  onToast: (tone: 'ok' | 'error', text: string) => void;
}) {
  const [format, setFormat] = React.useState<'xlsx' | 'csv'>('xlsx');
  const [example, setExample] = React.useState(true);
  const [projectId, setProjectId] = React.useState(projects[0]?.id ?? '');
  const [copied, setCopied] = React.useState(false);

  const project = projects.find((p) => p.id === projectId) ?? projects[0];
  const headers = TEMPLATE_COLUMNS.map((c) => c.header);
  const fileName = `Taskly_Property_Import_Template.${format}`;

  function download() {
    const rows: string[][] = [];
    if (example) rows.push(TEMPLATE_COLUMNS.map((c) => c.example));
    /* ⚠️ The notes row is LAST and starts with a hash, so a careless import that
       forgets to delete it fails on the ID rather than creating a plot called
       "Unique within the project." */
    rows.push(TEMPLATE_COLUMNS.map((c, i) => (i === 0 ? `# ${c.note}` : c.note)));

    if (format === 'csv') {
      const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
      const body = [headers.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\r\n');
      downloadBlob(fileName, `﻿${body}`, 'text/csv;charset=utf-8');
    } else {
      const bytes = writeXlsx({
        name: 'Properties',
        header: headers,
        rows,
        widths: TEMPLATE_COLUMNS.map((c) => Math.max(14, Math.min(34, c.header.length + 6))),
      });
      downloadBlob(fileName, bytes, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    }
    onToast('ok', `${fileName} downloaded.`);
    onClose();
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Download property template"
      size="md"
      header={
        <div className="flex items-center gap-3">
          <span className="grid size-[2.6rem] shrink-0 place-items-center rounded-[0.55rem]" style={{ background: cv('tile') }}>
            <Download className="size-[1.25rem]" style={{ color: cv('tile-ink') }} aria-hidden="true" />
          </span>
          <span>
            <span className="block text-[1.25rem] font-bold leading-tight" style={{ color: cv('ink') }}>
              Download property template
            </span>
            <span className="block text-[0.86rem]" style={{ color: cv('soft') }}>
              Choose a format for bulk property uploads.
            </span>
          </span>
        </div>
      }
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(headers.join('\t')).then(() => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1800);
                onToast('ok', 'Column headers copied.');
              });
            }}
            className="inline-flex items-center gap-[0.35rem] text-[0.85rem] font-medium"
            style={{ color: cv('brand-ink') }}
          >
            {copied ? <Check className="size-[0.9rem]" strokeWidth={3} aria-hidden="true" /> : <Copy className="size-[0.9rem]" aria-hidden="true" />}
            Copy column headers
          </button>
          <span className="flex gap-2">
            <button type="button" onClick={onClose} className={`${OUTLINE} h-[2.4rem] px-4 text-[0.93rem]`} style={outlineStyle}>
              Cancel
            </button>
            <button type="button" onClick={download} className={`${SOLID} h-[2.4rem] px-5 text-[0.93rem]`} style={solidStyle}>
              <Download className="size-4" aria-hidden="true" /> Download template
            </button>
          </span>
        </div>
      }
    >
      <div className="space-y-[0.9rem]">
        <div className="grid gap-[0.7rem] sm:grid-cols-2">
          <FormatCard
            on={format === 'xlsx'}
            onPick={() => setFormat('xlsx')}
            icon={FileSpreadsheet}
            title="Excel (.xlsx)"
            recommended
            blurb="Sized columns, an example row and a notes row explaining each field."
            ticks={['One sheet, ready to fill', 'Example and notes included']}
          />
          <FormatCard
            on={format === 'csv'}
            onPick={() => setFormat('csv')}
            icon={FileText}
            title="CSV (.csv)"
            blurb="Simple file format with column headers only."
            ticks={['Data only', 'Lightweight file']}
          />
        </div>

        <section>
          <h4 className="text-[0.93rem] font-semibold" style={{ color: cv('ink') }}>Template includes</h4>
          <p className="mb-[0.45rem] text-[0.8rem]" style={{ color: cv('soft') }}>
            {TEMPLATE_COLUMNS.length} columns, grouped by category.
          </p>
          <div className="grid gap-[0.45rem] sm:grid-cols-3">
            {TEMPLATE_GROUPS.map((g) => {
              const Icon = GROUP_ICON[g];
              const n = TEMPLATE_COLUMNS.filter((c) => c.group === g).length;
              return (
                <span key={g} className="inline-flex items-center gap-[0.45rem] rounded-[0.45rem] border px-[0.6rem] py-[0.4rem] text-[0.82rem]"
                      style={{ borderColor: cv('line'), color: cv('ink') }}>
                  <Icon className="size-[0.95rem] shrink-0" style={{ color: cv('brand-ink') }} aria-hidden />
                  <span className="truncate">{g}</span>
                  <span className="ml-auto shrink-0 tabular-nums" style={{ color: cv('mute') }}>{n}</span>
                </span>
              );
            })}
          </div>
        </section>

        <section className="flex items-start justify-between gap-3">
          <span className="min-w-0">
            <span className="block text-[0.9rem] font-medium" style={{ color: cv('ink') }}>Include one example property</span>
            <span className="block text-[0.8rem]" style={{ color: cv('soft') }}>
              Adds a sample row so the expected shape of each column is obvious.
            </span>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={example}
            aria-label="Include one example property"
            onClick={() => setExample(!example)}
            className="relative inline-flex h-[1.4rem] w-[2.5rem] shrink-0 items-center rounded-full border transition-colors"
            style={example ? { background: cv('brand'), borderColor: 'transparent' } : { background: cv('pill'), borderColor: cv('line') }}
          >
            <span aria-hidden="true" className={cn('block size-[1.05rem] rounded-full bg-white shadow-[var(--shadow-sm)] transition-transform',
              example ? 'translate-x-[1.3rem]' : 'translate-x-[0.14rem]')} />
          </button>
        </section>

        <section>
          <h4 className="text-[0.93rem] font-semibold" style={{ color: cv('ink') }}>Project standard</h4>
          <p className="mb-[0.4rem] text-[0.8rem]" style={{ color: cv('soft') }}>
            The scheme this sheet is for, and the area standard its sizes will be read against.
          </p>
          <Select label="Project standard" value={projectId} onChange={setProjectId} className="h-[2.5rem] w-full">
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name} · {p.marlaStandard} sq ft per Marla</option>
            ))}
          </Select>
        </section>

        <p className="flex items-start gap-[0.45rem] rounded-[0.45rem] px-[0.6rem] py-[0.5rem] text-[0.82rem]"
           style={{ background: cv('pick'), color: cv('brand-ink') }}>
          <Info className="mt-[0.1rem] size-[0.95rem] shrink-0" aria-hidden="true" />
          Do not rename the column headers — the importer matches on them. Prices are plain numbers
          in PKR, and sizes are Marla{project ? ` read at ${project.marlaStandard} sq ft` : ''}.
        </p>

        <section>
          <h4 className="mb-[0.4rem] text-[0.93rem] font-semibold" style={{ color: cv('ink') }}>File preview</h4>
          <div className="flex items-center gap-[0.6rem] rounded-[0.5rem] border p-[0.6rem]" style={{ borderColor: cv('line'), background: cv('head') }}>
            <span className="grid size-[2.1rem] shrink-0 place-items-center rounded-[0.4rem]"
                  style={{ background: format === 'xlsx' ? cv('green-bg') : cv('pill') }}>
              {format === 'xlsx'
                ? <FileSpreadsheet className="size-[1.05rem]" style={{ color: cv('green') }} aria-hidden="true" />
                : <FileText className="size-[1.05rem]" style={{ color: cv('soft') }} aria-hidden="true" />}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[0.88rem] font-medium" style={{ color: cv('ink') }}>{fileName}</span>
              <span className="block text-[0.78rem]" style={{ color: cv('soft') }}>
                {TEMPLATE_COLUMNS.length} columns · {example ? 'example row and notes' : 'notes row only'}
              </span>
            </span>
          </div>
        </section>
      </div>
    </Dialog>
  );
}

function FormatCard({
  on, onPick, icon: Icon, title, blurb, ticks, recommended,
}: {
  on: boolean;
  onPick: () => void;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties; 'aria-hidden'?: boolean }>;
  title: string;
  blurb: string;
  ticks: readonly string[];
  recommended?: boolean;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onPick}
      className="flex flex-col gap-[0.4rem] rounded-[0.55rem] border p-[0.75rem] text-left transition-colors"
      style={on
        ? { borderColor: cv('brand-line'), background: cv('pick'), borderWidth: '0.12rem' }
        : { borderColor: cv('line'), background: cv('surface') }}
    >
      <span className="flex items-center gap-[0.5rem]">
        <span className="grid size-[1.1rem] shrink-0 place-items-center rounded-full border"
              style={{ borderColor: on ? cv('brand') : cv('line'), background: on ? cv('brand') : 'transparent' }}>
          {on && <span className="size-[0.4rem] rounded-full bg-white" aria-hidden="true" />}
        </span>
        <Icon className="size-[1.15rem]" style={{ color: on ? cv('brand-ink') : cv('soft') }} aria-hidden />
        <span className="text-[0.95rem] font-semibold" style={{ color: cv('ink') }}>{title}</span>
      </span>
      {recommended && (
        <span className="w-fit rounded-full px-[0.5rem] py-[0.12rem] text-[0.72rem] font-medium"
              style={{ background: cv('green-bg'), color: cv('green') }}>
          Recommended
        </span>
      )}
      <span className="text-[0.8rem]" style={{ color: cv('soft') }}>{blurb}</span>
      <span className="mt-[0.1rem] space-y-[0.2rem]">
        {ticks.map((t) => (
          <span key={t} className="flex items-center gap-[0.35rem] text-[0.78rem]" style={{ color: cv('soft') }}>
            <BadgeCheck className="size-[0.85rem] shrink-0" style={{ color: on ? cv('green-dot') : cv('mute') }} aria-hidden="true" />
            {t}
          </span>
        ))}
      </span>
    </button>
  );
}
