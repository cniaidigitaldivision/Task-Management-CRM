'use client';

import * as React from 'react';
import { ChevronDown, Download, Globe, Upload } from 'lucide-react';

import { exportLeadsAction } from '@/app/actions/crm-leads';
import { IntakeKeysDialog } from '@/components/crm/intake-keys-dialog';
import { useToast } from '@/components/ui/toast';
import {
  downloadBlob,
  LeadImportDialog,
  type ImportProject,
  type ImportSalesperson,
} from '@/components/crm/lead-import-dialog';
import { LEAD_TEMPLATE_COLUMNS } from '@/lib/domain/crm-lead-import';
import { sourceLabel } from '@/lib/domain/lead-source';
import { stageLabel, temperatureLabel } from '@/lib/domain/crm-stages';
import type { CrmLeadExportRow } from '@/lib/db/queries/crm-leads';
import { cn } from '@/lib/utils';

/* ============================================================================
 * IMPORT AND EXPORT, AS A PAIR
 * ----------------------------------------------------------------------------
 * Owner, 2026-10-01: *"My focus right now is to make sure to properly import
 * and export the leads."*
 *
 * ── ⚠️ THE EXPORT IS A VALID IMPORT FILE, AND THAT IS NOT A COINCIDENCE ────
 * The property importer's round trip — export the catalogue, import that exact
 * file — found **338 errors** the first time, every one of them a header or a
 * format the writer and the reader spelled differently ("Plot / unit" against
 * "Plot / unit number"; `"5 Marla"` against `5`). So the first eight columns
 * here are `LEAD_TEMPLATE_COLUMNS` headers, verbatim and in order, carrying raw
 * values. Everything after them is context a person wants in a spreadsheet and
 * the importer ignores.
 *
 * ⚠️ WHICH MEANS THE ROUND TRIP IS PARTIAL ON PURPOSE. Stage, owner and
 * temperature come OUT and cannot go back IN — a sheet must not be able to mark
 * somebody Won, or Hot, or hand them to a named person. `lib/domain/
 * crm-lead-import.ts` says why for each. The export says so in its own column
 * order rather than pretending otherwise.
 * ========================================================================= */

/** The columns the importer reads back, then the ones it does not. */
const EXTRA_COLUMNS = [
  'Stage', 'Temperature', 'Owner', 'Project', 'Form',
  'Next action', 'Next action due', 'Enquired', 'Last activity',
] as const;

export function LeadSheetButtons({
  projects,
  selectedProjectId,
  selectedProjectName,
  salesTeam,
  filters,
  total,
  mine = false,
}: {
  projects: readonly ImportProject[];
  selectedProjectId: string | null;
  selectedProjectName: string;
  salesTeam: readonly ImportSalesperson[];
  filters: { stage: string | null; source: string | null; temperature: string | null };
  total: number;
  /** True on a personal desk: the export answers "mine", like the screen. */
  mine?: boolean;
}) {
  const toast = useToast();
  const [importing, setImporting] = React.useState(false);
  const [connecting, setConnecting] = React.useState(false);
  const [menu, setMenu] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!menu) return;
    const away = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setMenu(false);
    };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', key);
    };
  }, [menu]);

  async function exportAs(format: 'csv' | 'xlsx') {
    setBusy(true);
    setMenu(false);
    const result = await exportLeadsAction(selectedProjectId, {
      stage: filters.stage,
      source: filters.source,
      temperature: filters.temperature,
      mine,
    });
    setBusy(false);

    if (!result.ok || !result.rows) {
      toast({ tone: 'error', text: result.error ?? 'Those leads could not be read.' });
      return;
    }
    if (result.rows.length === 0) {
      toast({ tone: 'error', text: 'Nothing matches these filters, so there is nothing to export.' });
      return;
    }

    const stem = `${selectedProjectName.replace(/[^\w\- ]+/g, '').trim() || 'leads'} — leads`;
    if (format === 'csv') {
      downloadBlob(`${stem}.csv`, `﻿${toCsv(result.rows)}`, 'text/csv;charset=utf-8');
    } else {
      downloadBlob(
        `${stem}.xls`,
        toExcelHtml(result.rows),
        'application/vnd.ms-excel;charset=utf-8',
      );
    }
    toast({ tone: 'ok', text: `Exported ${result.rows.length} ${result.rows.length === 1 ? 'lead' : 'leads'}.` });
  }

  return (
    <div ref={ref} className="relative flex items-center gap-2">
      {/* ── ⚠️ ONLY WHERE LEADS CAN BE HANDED OUT ────────────────────────
          A key files leads into a project and the rota gives them to whoever
          is lightest. Issuing one is a manager's decision, and 277 refuses a
          salesperson anyway — so the button is absent rather than drawn and
          then refused. `salesTeam` is empty for a salesperson by migration
          120's own guard, which is the same signal the share-out uses. */}
      {salesTeam.length > 0 && (
        <button
          type="button"
          onClick={() => setConnecting(true)}
          className="inline-flex min-h-[2.6rem] items-center gap-1.5 rounded-xl border border-border-subtle bg-bg-surface px-3 text-micro font-medium text-text-primary transition-colors hover:border-border-default"
        >
          <Globe className="size-4 text-text-tertiary" aria-hidden="true" />
          Website form
        </button>
      )}

      <button
        type="button"
        onClick={() => setImporting(true)}
        className="inline-flex min-h-[2.6rem] items-center gap-1.5 rounded-xl border border-border-subtle bg-bg-surface px-3 text-micro font-medium text-text-primary transition-colors hover:border-border-default"
      >
        <Upload className="size-4 text-text-tertiary" aria-hidden="true" />
        Import
      </button>

      <button
        type="button"
        onClick={() => setMenu(!menu)}
        disabled={busy || total === 0}
        aria-haspopup="menu"
        aria-expanded={menu}
        className={cn(
          'inline-flex min-h-[2.6rem] items-center gap-1.5 rounded-xl border bg-bg-surface px-3 text-micro font-medium text-text-primary transition-colors',
          menu ? 'border-border-strong' : 'border-border-subtle hover:border-border-default',
          (busy || total === 0) && 'cursor-not-allowed opacity-50',
        )}
      >
        <Download className="size-4 text-text-tertiary" aria-hidden="true" />
        {busy ? 'Exporting…' : 'Export'}
        <ChevronDown className={cn('size-3.5 text-text-tertiary transition-transform', menu && 'rotate-180')} aria-hidden="true" />
      </button>

      {menu && (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-1.5 w-[16rem] rounded-xl border border-border-default bg-bg-surface py-1 shadow-[0_8px_28px_rgb(6_35_42_/_0.14)]"
        >
          {/* ⚠️ THE NUMBER IS THE FILTERED ONE, and it is on the button rather
              than in a note underneath. Somebody exporting while a filter is on
              gets a file about the question they asked, and the label says so
              before they press it rather than after they open it. */}
          <p className="px-3 py-1.5 text-micro leading-relaxed text-text-secondary">
            {total.toLocaleString('en-GB')} {total === 1 ? 'lead' : 'leads'} match what is on screen.
          </p>
          <MenuItem onClick={() => void exportAs('xlsx')}>These leads (Excel)</MenuItem>
          <MenuItem onClick={() => void exportAs('csv')}>These leads (CSV)</MenuItem>
        </div>
      )}

      <IntakeKeysDialog
        open={connecting}
        onClose={() => setConnecting(false)}
        projects={projects}
        initialProjectId={selectedProjectId}
        /* ⚠️ READ IN THE BROWSER, so the snippet shows the host somebody is
           actually using — localhost while testing, the real domain in
           production. A constant here would hand out a snippet that posts to
           the wrong place from whichever of the two is not hard-coded. */
        baseUrl={typeof window === 'undefined' ? '' : window.location.origin}
      />

      <LeadImportDialog
        open={importing}
        onClose={() => setImporting(false)}
        projects={projects}
        initialProjectId={selectedProjectId}
        salesTeam={salesTeam}
      />
    </div>
  );
}

function MenuItem({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center px-3 py-2 text-left text-body-sm text-text-primary transition-colors hover:bg-bg-subtle"
    >
      {children}
    </button>
  );
}

/* ---------------------------------------------------------------------------
 * The two writers
 * ------------------------------------------------------------------------- */

/**
 * One row, as the columns.
 *
 * ⚠️ RAW VALUES IN THE IMPORTABLE COLUMNS. The budget goes out as `4500000`,
 * not `PKR 4,500,000`, and the phone as it was typed. A formatted number is a
 * number the importer refuses, which is the other half of the 338-error round
 * trip: the writer was being helpful and the reader could not read it.
 */
function cells(row: CrmLeadExportRow): readonly string[] {
  return [
    row.fullName ?? '',
    row.phone ?? row.phoneE164 ?? '',
    row.email ?? '',
    row.city ?? '',
    row.enquiry ?? '',
    row.budget === null ? '' : String(row.budget),
    /* ⚠️ THE LABEL, NOT THE ENUM. `readSource` accepts both spellings, so the
       file stays readable AND re-importable. */
    sourceLabel(row.source),
    row.sourceDetail ?? '',
    /* ── from here on, context the importer ignores ─────────────────────── */
    stageLabel(row.stage),
    row.temperature ? temperatureLabel(row.temperature) : '',
    row.ownerName ?? 'Unassigned',
    row.projectName,
    row.formName ?? '',
    row.nextAction ?? '',
    row.nextActionAt ? karachi(row.nextActionAt) : '',
    karachi(row.submittedAt),
    row.lastActivityAt ? karachi(row.lastActivityAt) : '',
  ];
}

const HEADERS = [...LEAD_TEMPLATE_COLUMNS.map((c) => c.header), ...EXTRA_COLUMNS];

/** ⚠️ KARACHI, and written the way a Pakistani reader writes a date. A UTC
 *  timestamp in a spreadsheet is a date somebody will read as local and be
 *  wrong about for five hours every evening. */
function karachi(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    timeZone: 'Asia/Karachi',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function toCsv(rows: readonly CrmLeadExportRow[]): string {
  return [HEADERS, ...rows.map(cells)]
    .map((row) => row.map(csvCell).join(','))
    .join('\r\n');
}

/**
 * Excel, without a library.
 *
 * ⚠️ AN HTML TABLE SAVED AS .xls, WHICH EXCEL OPENS NATIVELY. There is no .xlsx
 * WRITER in this product — `lib/view/xlsx-read.ts` only reads — and pulling in a
 * writer for one button is a lot of bytes on every page that imports this. The
 * file opens in Excel, in Numbers and in Google Sheets.
 *
 * ⚠️ AND EVERY CELL IS `mso-number-format:\@`, WHICH MEANS TEXT. Without it
 * Excel helpfully turns `0300 1234567` into the number 3001234567 and drops the
 * leading zero — on the one column the importer needs back intact.
 */
export function toExcelHtml(rows: readonly CrmLeadExportRow[]): string {
  const esc = (v: string) =>
    v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const head = HEADERS.map((h) => `<th>${esc(h)}</th>`).join('');
  const body = rows
    .map((r) => `<tr>${cells(r).map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`)
    .join('');
  return `<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head>`
    + `<meta charset="utf-8"><style>td,th{mso-number-format:"\\@";}`
    + `th{background:#e8f0ef;font-weight:bold;}</style></head>`
    + `<body><table border="1">${head ? `<thead><tr>${head}</tr></thead>` : ''}`
    + `<tbody>${body}</tbody></table></body></html>`;
}
