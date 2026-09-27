'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  Building2, ChevronDown, ChevronLeft, ChevronRight, CircleSlash, Clock, Download,
  Eye, FileText, Home, Info, LayoutList, Link2, Map as MapIcon, Pencil, Plus, Share2, SlidersHorizontal,
  Search, Tag, Upload,
} from 'lucide-react';

import {
  createPropertyAction, setPropertyStatusAction,
  sharePropertyListAction, updatePropertyAction, type PropertyForm,
} from '@/app/actions/crm-properties';
import { cv, OUTLINE, outlineStyle, SOLID, solidStyle, Select, Square, SQUARE } from '@/components/crm/clients-ui';
import { ImportDialog, ShareDialog } from '@/components/crm/properties-dialogs';
import { SharePropertyDialog } from '@/components/crm/property-share';
import { DownloadTemplateDialog } from '@/components/crm/property-template';
import { PropertySiteMap } from '@/components/crm/property-site-map';
import {
  AddPropertyWizard, EditPropertyDialog, type ProjectOption,
} from '@/components/crm/property-form';
import { Dialog } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { downloadBlob } from '@/lib/browser/download';
import type { PropertyRow } from '@/lib/db/queries/crm-properties';
import {
  areaLabel, characterChips, countProperties, displayArea, filterProperties, money,
  PRICE_BANDS, SELECTABLE_STATUSES, sizeLabel, statusLook,
  type PropertyFilters,
} from '@/lib/domain/crm-property';
import { writeXlsx } from '@/lib/view/xlsx-write';
import { cn } from '@/lib/utils';

/* ============================================================================
 * PROPERTIES — the owner's reference, 2026-09-27
 * ----------------------------------------------------------------------------
 * ── ⚠️ EVERY CONTROL ON THIS PAGE IS CLIENT STATE — Rule Zero, laws 1–3 ───
 * Tabs, filters, search, selection, paging, the panel and every dialog. The
 * server is touched only by a WRITE. Pressing "Available" must not re-run a
 * 150-row query to hide 68 rows that are already in the browser.
 *
 * ── ⚠️ AND THE PANEL IS DRAWN FROM THE ROW ────────────────────────────────
 * `crmPropertyBoard` already returned this plot's documents, linked items and
 * payment stages, so clicking down the list costs nothing at all.
 *
 * ── ⚠️ THE CARDS ARE NOT BUTTONS; THE TABS ARE ────────────────────────────
 * Owner: *"The above cards are not clickable. The buttons below (All,
 * Properties, Available, Reserved, Sold, and On Hold) should be clickable."*
 * So the tiles are plain `<div>`s with no hover and no cursor change — a card
 * that looks pressable and is not is worse than one that plainly is not.
 * ========================================================================= */

type Tab = 'all' | 'available' | 'reserved' | 'sold' | 'held';
type Dialog =
  | { kind: 'add' }
  | { kind: 'edit'; id: string }
  | { kind: 'import' }
  | { kind: 'share'; id: string }
  | { kind: 'share-list'; text: string }
  | { kind: 'template' }
  | null;

const PER_PAGE = 25;
const CHECK = 'size-[1.05rem] shrink-0 cursor-pointer rounded-[0.25rem]';
const checkStyle = { accentColor: 'var(--cl-brand)' } as const;

const TABS: readonly { readonly key: Tab; readonly label: string }[] = [
  { key: 'all', label: 'All properties' },
  { key: 'available', label: 'Available' },
  { key: 'reserved', label: 'Reserved' },
  { key: 'sold', label: 'Sold' },
  { key: 'held', label: 'On hold' },
];

function dayLabel(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  /* ⚠️ `en-US`, NOT `en-GB`. British English abbreviates September to
     "Sept" — four letters — and the column came out reading "21 Sept 2026"
     where the owner's reference says "21 Sep 2026". It also disagrees with
     every other month on the same screen, which is how this shipped once
     before on another page. */
  /* ⚠️ ASSEMBLED, not formatted whole. `en-US` gives the right three-letter
     month but puts it first ("Sep 21, 2026"); `en-GB` gives the right order and
     writes "Sept". Neither locale produces the reference's "21 Sep 2026", so the
     parts are taken from en-US and put in the owner's order. */
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Karachi', day: '2-digit', month: 'short', year: 'numeric',
  }).formatToParts(d);
  const get = (t: string) => parts.find((x) => x.type === t)?.value ?? '';
  return `${get('day')} ${get('month')} ${get('year')}`;
}

export function PropertiesBoard({
  properties,
  projects,
  nowMs,
  viewerName,
}: {
  properties: readonly PropertyRow[];
  projects: readonly ProjectOption[];
  nowMs: number;
  viewerName: string;
}) {
  const toast = useToast();

  const [tab, setTab] = React.useState<Tab>('all');
  const [view, setView] = React.useState<'table' | 'map'>('table');
  const [filters, setFilters] = React.useState<PropertyFilters>({});
  const [more, setMore] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [picked, setPicked] = React.useState<ReadonlySet<string>>(new Set());
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [dialog, setDialog] = React.useState<Dialog>(null);
  const [busy, setBusy] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);

  const set = (patch: Partial<PropertyFilters>) => {
    setFilters((c) => ({ ...c, ...patch }));
    setPage(1);
  };

  /* ── the rows on screen ─────────────────────────────────────────────── */
  const visible = React.useMemo(() => {
    /* Inlined rather than computed above: `tabFilter` derived from `tab` outside
       the memo reads as a missing dependency, and silencing the rule is how a
       stale filter ships. */
    const tabFilter: PropertyFilters = tab === 'all' || tab === 'held' ? {} : { tab };
    const base = filterProperties(properties, { ...filters, ...tabFilter, search });
    /* "On hold" is one tab over two states, as the card is one figure over two. */
    return tab === 'held'
      ? base.filter((r) => r.status === 'on_hold' || r.status === 'blocked')
      : base;
  }, [properties, filters, search, tab]);

  /* ⚠️ The cards count the WHOLE catalogue, not the filtered view. They are the
     scheme's inventory; narrowing them with a search would make "Total
     inventory" mean "total matching", which is a different question. */
  const cards = React.useMemo(() => countProperties(properties), [properties]);

  const pages = Math.max(1, Math.ceil(visible.length / PER_PAGE));
  const current = Math.min(page, pages);
  const rows = visible.slice((current - 1) * PER_PAGE, current * PER_PAGE);

  const open = React.useMemo(
    () => visible.find((r) => r.id === openId) ?? rows[0] ?? null,
    [visible, rows, openId],
  );

  /* The filter lists are the DATA — a block appears the moment its first plot
     does. Only Status and Price range are fixed, because both are closed sets. */
  const facets = React.useMemo(() => {
    const uniq = (xs: (string | null)[]) =>
      [...new Set(xs.filter((x): x is string => Boolean(x && x.trim())))].sort();
    return {
      blocks: uniq(properties.map((r) => r.block)),
      sizes: [...new Set(properties.map((r) => sizeLabel(r.sizeMarla)))]
        .filter((s) => s !== '—')
        .sort((a, b) => (Number(a.split(' ')[0]) || 0) - (Number(b.split(' ')[0]) || 0)),
      kinds: uniq(properties.map((r) => r.kind)),
      facings: uniq(properties.map((r) => r.facing)),
      categories: uniq(properties.map((r) => r.category)),
    };
  }, [properties]);

  /** Whichever project most of the drawn plots belong to, or the chosen one. */
  const mapTitle = React.useMemo(() => {
    if (filters.projectId && filters.projectId !== 'all') {
      return projects.find((p) => p.id === filters.projectId)?.name ?? 'All projects';
    }
    const count = new Map<string, number>();
    for (const r of visible) count.set(r.projectName, (count.get(r.projectName) ?? 0) + 1);
    const [top] = [...count.entries()].sort((a, b) => b[1] - a[1]);
    if (!top) return 'All projects';
    return count.size > 1 ? `${top[0]} + ${count.size - 1} more` : top[0];
  }, [visible, filters.projectId, projects]);

  const codesByProject = React.useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const r of properties) (out[r.projectId] ??= []).push(r.code);
    return out;
  }, [properties]);

  const allOnPagePicked = rows.length > 0 && rows.every((r) => picked.has(r.id));

  function toggle(id: string) {
    setPicked((c) => {
      const next = new Set(c);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  /* ── writes ─────────────────────────────────────────────────────────── */
  async function add(form: PropertyForm, draft: boolean) {
    setBusy(true);
    setFormError(null);
    const result = await createPropertyAction(form);
    setBusy(false);
    if (!result.ok) { setFormError(result.error); return; }
    toast({ tone: 'ok', text: draft ? 'Saved as a draft. It is not in the inventory yet.' : result.message });
    setDialog(null);
  }

  async function edit(id: string, form: PropertyForm, reason: string, draft: boolean) {
    setBusy(true);
    setFormError(null);
    const result = await updatePropertyAction(id, form, reason);
    setBusy(false);
    if (!result.ok) { setFormError(result.error); return; }
    toast({ tone: 'ok', text: draft ? 'Saved as a draft.' : result.message });
    setDialog(null);
  }

  async function bulkStatus(status: string) {
    const ids = [...picked];
    setBusy(true);
    const result = await setPropertyStatusAction(ids, status);
    setBusy(false);
    toast(result.ok ? { tone: 'ok', text: result.message } : { tone: 'error', text: result.error });
    if (result.ok) setPicked(new Set());
  }

  /* ⚠️ NO ROUND TRIP. The row is already on the page and already narrowed by
     RLS, and the dialog builds its message from the same allow-list the server
     would have used — `shareLines` is handed a shape that cannot carry a note,
     a lead or a booking. Fetching it again would break Rule Zero law 3 for no
     gain: there is nothing the server knows that the row does not. */
  function share(id: string) {
    setDialog({ kind: 'share', id });
  }

  async function shareList() {
    const result = await sharePropertyListAction([...picked]);
    if (!result.ok) { toast({ tone: 'error', text: result.error }); return; }
    setDialog({ kind: 'share-list', text: result.text ?? '' });
  }

  /* ── exports ────────────────────────────────────────────────────────── */
  const EXPORT_HEAD = [
    'Property ID', 'Plot / unit', 'Block', 'Project', 'Type', 'Size', 'Area (sq ft)',
    'Dimensions', 'Facing', 'Road (ft)', 'Category', 'Base price (PKR)',
    'Premium (PKR)', 'Status', 'Development', 'Updated',
  ];
  const exportRow = (r: PropertyRow) => [
    r.code, r.plotNumber ?? '', r.block ?? '', r.projectName, r.kind ?? '',
    sizeLabel(r.sizeMarla), displayArea(r.areaSqft, r.sizeMarla, r.marlaStandard) ?? '',
    r.dimensions ?? '', r.facing ?? '', r.roadWidthFt ?? '', r.category ?? '',
    r.basePrice ?? 0, r.premiumCharges ?? 0, statusLook(r.status).label,
    r.developmentStatus ?? '', dayLabel(r.updatedAt),
  ];

  function exportCsv(list: readonly PropertyRow[]) {
    const esc = (v: unknown) => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const body = [EXPORT_HEAD.join(','), ...list.map((r) => exportRow(r).map(esc).join(','))].join('\r\n');
    downloadBlob(`properties-${list.length}.csv`, `﻿${body}`, 'text/csv;charset=utf-8');
    toast({ tone: 'ok', text: `${list.length} properties exported.` });
  }

  function exportXlsx(list: readonly PropertyRow[]) {
    const bytes = writeXlsx({
      name: 'Properties',
      header: EXPORT_HEAD,
      rows: list.map((r) => exportRow(r)),
      widths: [14, 12, 8, 26, 18, 14, 13, 14, 14, 10, 13, 18, 16, 12, 18, 14],
    });
    downloadBlob(
      `properties-${list.length}.xlsx`,
      bytes,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    toast({ tone: 'ok', text: `${list.length} properties exported.` });
  }

  /* The template now has a dialog of its own — format, what it contains, and
     whether to include an example row. The one-press CSV it replaced could not
     answer "what goes in column F". */
  function downloadTemplate() {
    setDialog({ kind: 'template' });
  }

  const editing = dialog?.kind === 'edit' ? properties.find((r) => r.id === dialog.id) ?? null : null;

  return (
    <div className="prop-ui clients-ui mx-auto max-w-[var(--content-max)] space-y-[1.05rem]">
      {/* ── header ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[1.66rem] font-bold leading-tight tracking-[-0.01em]" style={{ color: cv('ink') }}>
            Properties
          </h1>
          <p className="mt-[0.15rem] text-[0.92rem]" style={{ color: cv('soft') }}>
            Manage project inventory, availability, pricing and property documents.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <ImportMenu onImport={() => setDialog({ kind: 'import' })} onTemplate={downloadTemplate} />
          <button
            type="button"
            onClick={() => { setFormError(null); setDialog({ kind: 'add' }); }}
            className={`${SOLID} h-[2.65rem] min-w-[10.1rem] px-5 text-[0.97rem]`}
            style={solidStyle}
          >
            <Plus className="size-[1.1rem]" strokeWidth={2.4} aria-hidden="true" />
            Add property
          </button>
        </div>
      </div>

      {/* ── the five cards. NOT clickable, by instruction ───────────────── */}
      <div className="grid gap-[0.85rem] sm:grid-cols-2 xl:grid-cols-5">
        <Tile label="Total inventory" value={cards.total} icon={Building2} bg="tile" ink="tile-ink" />
        <Tile
          label="Available"
          value={cards.available}
          icon={Home}
          bg="green-soft"
          ink="green"
          caption={cards.availablePct === null ? 'Nothing recorded yet' : `${cards.availablePct}% of inventory`}
        />
        <Tile label="Reserved" value={cards.reserved} icon={Clock} bg="amber-soft" ink="amber" />
        <Tile label="Sold" value={cards.sold} icon={Tag} bg="red-soft" ink="red" />
        <Tile label="On hold / Blocked" value={cards.held} icon={CircleSlash} bg="grey-bg" ink="grey" />
      </div>

      {/* ── tabs, and the view switch ──────────────────────────────────── */}
      <div className="flex flex-wrap items-end justify-between gap-3 border-b" style={{ borderColor: cv('line') }}>
        <div className="flex flex-wrap items-center gap-[1.4rem]" role="tablist" aria-label="Availability">
          {TABS.map((t) => {
            const on = tab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => { setTab(t.key); setPage(1); }}
                className="relative -mb-px h-[2.5rem] text-[0.95rem] font-medium transition-colors"
                style={{ color: on ? cv('brand-ink') : cv('soft') }}
              >
                {t.label}
                {on && (
                  <span className="absolute inset-x-0 -bottom-px block h-[0.14rem] rounded-full" style={{ background: cv('brand') }} />
                )}
              </button>
            );
          })}
        </div>
        <div className="mb-[0.35rem] inline-flex rounded-[0.55rem] border p-[0.25rem]" style={{ borderColor: cv('line'), background: cv('surface') }} role="tablist" aria-label="View">
          {([['table', 'Table', LayoutList], ['map', 'Site map', MapIcon]] as const).map(([k, label, Icon]) => {
            const on = view === k;
            return (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setView(k)}
                className="inline-flex h-[2.3rem] min-w-[7.9rem] items-center justify-center gap-2 rounded-[0.42rem] text-[0.93rem] font-medium transition-colors"
                style={on ? { background: cv('brand'), color: cv('on-brand') } : { color: cv('soft') }}
              >
                <Icon className="size-[1.05rem]" aria-hidden="true" />
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── filters ────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end gap-[0.65rem]">
        <Labelled label="Project">
          <Select label="Project" value={filters.projectId ?? 'all'} onChange={(v) => set({ projectId: v })} className="h-[2.65rem] w-[11.6rem]">
            <option value="all">All projects</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </Select>
        </Labelled>
        <Labelled label="Block">
          <Select label="Block" value={filters.block ?? 'all'} onChange={(v) => set({ block: v })} className="h-[2.65rem] w-[7.4rem]">
            <option value="all">All</option>
            {facets.blocks.map((b) => <option key={b} value={b}>{b}</option>)}
          </Select>
        </Labelled>
        <Labelled label="Size">
          <Select label="Size" value={filters.size ?? 'all'} onChange={(v) => set({ size: v })} className="h-[2.65rem] w-[8.6rem]">
            <option value="all">All</option>
            {facets.sizes.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
        </Labelled>
        <Labelled label="Property type">
          <Select label="Property type" value={filters.kind ?? 'all'} onChange={(v) => set({ kind: v })} className="h-[2.65rem] w-[9.4rem]">
            <option value="all">All</option>
            {facets.kinds.map((k) => <option key={k} value={k}>{k}</option>)}
          </Select>
        </Labelled>
        <Labelled label="Status">
          <Select label="Status" value={filters.status ?? 'all'} onChange={(v) => set({ status: v })} className="h-[2.65rem] w-[8.8rem]">
            <option value="all">All</option>
            {SELECTABLE_STATUSES.map((s) => <option key={s} value={s}>{statusLook(s).label}</option>)}
          </Select>
        </Labelled>
        <Labelled label="Price range">
          <Select label="Price range" value={filters.priceBand ?? 'all'} onChange={(v) => set({ priceBand: v === 'all' ? '' : v })} className="h-[2.65rem] w-[8.8rem]">
            <option value="all">All</option>
            {PRICE_BANDS.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
          </Select>
        </Labelled>

        <div className="flex h-[2.65rem] min-w-[11rem] flex-1 items-center gap-[0.7rem] rounded-[0.45rem] border px-[0.95rem]"
             style={{ borderColor: cv('line'), background: cv('surface') }}>
          <Search className="size-[1.15rem] shrink-0" style={{ color: cv('mute') }} aria-hidden="true" />
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search plot number or ID…"
            aria-label="Search properties"
            className="h-full w-full bg-transparent text-[0.92rem] outline-none placeholder:text-[var(--cl-mute)]"
            style={{ color: cv('ink') }}
          />
        </div>

        <button type="button" onClick={() => setMore(!more)} aria-expanded={more}
                className={`${OUTLINE} h-[2.65rem] px-4 text-[0.92rem]`} style={outlineStyle}>
          <SlidersHorizontal className="size-[1.05rem]" aria-hidden="true" />
          More filters
        </button>

        <DownloadMenu
          onList={() => exportCsv(visible)}
          onListXlsx={() => exportXlsx(visible)}
          onTemplate={downloadTemplate}
          count={visible.length}
        />
      </div>

      {/* ⚠️ Opening this must not move the page. It is a normal block in the
          flow, not an overlay — an absolutely-positioned panel inside a
          `space-y-*` column is the shift the trap list warns about. */}
      {more && (
        <div className="flex flex-wrap items-end gap-[0.65rem] rounded-[0.6rem] border p-[0.8rem]"
             style={{ borderColor: cv('line'), background: cv('surface') }}>
          <Labelled label="Facing">
            <Select label="Facing" value={filters.facing ?? 'all'} onChange={(v) => set({ facing: v })} className="h-[2.4rem] w-[11rem]">
              <option value="all">Any facing</option>
              {facets.facings.map((f) => <option key={f} value={f}>{f}</option>)}
            </Select>
          </Labelled>
          <Labelled label="Category">
            <Select label="Category" value={filters.category ?? 'all'} onChange={(v) => set({ category: v })} className="h-[2.4rem] w-[11rem]">
              <option value="all">Any category</option>
              {facets.categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </Labelled>
          <button
            type="button"
            onClick={() => { setFilters({}); setSearch(''); setTab('all'); setPage(1); }}
            className={`${OUTLINE} h-[2.4rem] px-4 text-[0.9rem]`}
            style={outlineStyle}
          >
            Clear all filters
          </button>
        </div>
      )}

      {/* ── the inventory, or the scheme drawn ─────────────────────────── */}
      {view === 'map' ? (
        <PropertySiteMap
          rows={visible}
          all={properties}
          /* ⚠️ THE DOMINANT SCHEME, not the first row's. Sorted by block, the
             first row can belong to a project holding two plots while the map
             below it draws a hundred and forty-eight from another — and the
             heading would name the wrong scheme over somebody's inventory. */
          projectName={mapTitle}
          openId={open?.id ?? null}
          onOpen={(id) => setOpenId(id)}
          onShare={(id) => share(id)}
          activeFilters={[
            ['Project', filters.projectId && filters.projectId !== 'all'
              ? (projects.find((p) => p.id === filters.projectId)?.name ?? 'All') : 'All'],
            ['Block', filters.block && filters.block !== 'all' ? filters.block : 'All'],
            ['Size', filters.size && filters.size !== 'all' ? filters.size : 'All'],
            ['Property type', filters.kind && filters.kind !== 'all' ? filters.kind : 'All'],
            ['Status', filters.status && filters.status !== 'all' ? statusLook(filters.status).label : 'All'],
            ['Price range', filters.priceBand
              ? (PRICE_BANDS.find((b) => b.key === filters.priceBand)?.label ?? 'All') : 'All'],
            ['Search', search.trim() || '—'],
          ]}
        />
      ) : (
      <div className="grid min-w-0 gap-[1.05rem] xl:grid-cols-[minmax(0,1fr)_28.5rem]">
        <section className="flex min-w-0 flex-col overflow-hidden rounded-[0.6rem] border"
                 style={{ borderColor: cv('line'), background: cv('surface') }}>
          <header className="flex flex-wrap items-center justify-between gap-2 px-[1rem] py-[0.85rem]">
            <h2 className="text-[1.28rem] font-semibold" style={{ color: cv('ink') }}>Property inventory</h2>
            <span className="text-[0.86rem]" style={{ color: cv('soft') }}>
              {visible.length.toLocaleString('en-US')} record{visible.length === 1 ? '' : 's'}
            </span>
          </header>

          {/* the bulk bar */}
          <div className="flex flex-wrap items-center gap-2 border-y px-[1rem] py-[0.6rem]" style={{ borderColor: cv('grid'), background: cv('strip') }}>
            <label className="inline-flex items-center gap-[0.55rem] text-[0.88rem]" style={{ color: cv('ink') }}>
              <input
                type="checkbox"
                className={CHECK}
                style={checkStyle}
                checked={allOnPagePicked}
                onChange={() => setPicked((c) => {
                  const next = new Set(c);
                  if (allOnPagePicked) rows.forEach((r) => next.delete(r.id));
                  else rows.forEach((r) => next.add(r.id));
                  return next;
                })}
                aria-label="Select every property on this page"
              />
              {picked.size > 0 ? `${picked.size} selected` : 'Select all'}
            </label>
            <button type="button" disabled={picked.size === 0}
                    onClick={() => exportCsv(properties.filter((r) => picked.has(r.id)))}
                    className={`${OUTLINE} h-[2.15rem] px-[0.8rem] text-[0.86rem]`} style={outlineStyle}>
              <Download className="size-[0.95rem]" aria-hidden="true" />
              Export
            </button>
            <button type="button" disabled={picked.size === 0} onClick={() => void shareList()}
                    className={`${OUTLINE} h-[2.15rem] px-[0.8rem] text-[0.86rem]`} style={outlineStyle}>
              <Share2 className="size-[0.95rem]" aria-hidden="true" />
              Share list
            </button>
            <StatusMenu disabled={picked.size === 0 || busy} onPick={(s) => void bulkStatus(s)} />
          </div>

          <Table
            rows={rows}
            picked={picked}
            openId={open?.id ?? null}
            onToggle={toggle}
            onOpen={(id) => setOpenId(id)}
            onEdit={(id) => { setFormError(null); setDialog({ kind: 'edit', id }); }}
            onShare={(id) => share(id)}
          />

          <footer className="flex flex-wrap items-center justify-between gap-3 px-[1rem] py-[0.75rem]">
            <span className="inline-flex items-center gap-[0.4rem] text-[0.8rem]" style={{ color: cv('soft') }}>
              <Info className="size-[0.95rem] shrink-0" aria-hidden="true" />
              {/* ⚠️ The standard is READ OFF THE ROWS, never printed as 225. Two
                  schemes on one screen can differ, and the footer must say so. */}
              {standardNote(visible)}
            </span>
            <Pager page={current} pages={pages} total={visible.length} onPage={setPage} />
          </footer>
        </section>

        {open ? (
          <PropertyPanel
            row={open}
            onEdit={() => { setFormError(null); setDialog({ kind: 'edit', id: open.id }); }}
            onShare={() => share(open.id)}
          />
        ) : (
          <aside className="grid min-h-[20rem] place-items-center rounded-[0.6rem] border p-8 text-center"
                 style={{ borderColor: cv('line'), background: cv('surface') }}>
            <p className="text-[0.9rem]" style={{ color: cv('soft') }}>
              {properties.length === 0
                ? 'No properties yet. Add one, or import a sheet.'
                : 'Nothing matches those filters.'}
            </p>
          </aside>
        )}
      </div>
      )}

      {/* ── dialogs ────────────────────────────────────────────────────── */}
      <AddPropertyWizard
        open={dialog?.kind === 'add'}
        onClose={() => setDialog(null)}
        projects={projects}
        busy={busy}
        error={formError}
        onSubmit={(form, draft) => void add(form, draft)}
      />

      <EditPropertyDialog
        open={dialog?.kind === 'edit'}
        onClose={() => setDialog(null)}
        row={editing}
        projects={projects}
        busy={busy}
        error={formError}
        onSubmit={(form, reason, draft) => { if (editing) void edit(editing.id, form, reason, draft); }}
      />

      <ImportDialog
        open={dialog?.kind === 'import'}
        onClose={() => setDialog(null)}
        projects={projects}
        /* ⚠️ The codes already on each project, so a clash is NAMED in the
           wizard rather than discovered by the server after somebody has mapped
           thirty columns. The board already holds every row. */
        existingCodes={codesByProject}
        onDone={(message) => toast({ tone: 'ok', text: message })}
        onTemplate={() => setDialog({ kind: 'template' })}
      />

      <SharePropertyDialog
        open={dialog?.kind === 'share'}
        onClose={() => setDialog(null)}
        row={dialog?.kind === 'share' ? (properties.find((r) => r.id === dialog.id) ?? null) : null}
        viewerName={viewerName}
        onToast={(tone, text) => toast({ tone, text })}
      />

      {/* The bulk one stays a plain list — a dozen plots do not get a message
          preview and a recipient; they get copied into whatever the salesperson
          is already writing. */}
      <DownloadTemplateDialog
        open={dialog?.kind === 'template'}
        onClose={() => setDialog(null)}
        projects={projects}
        onToast={(tone, text) => toast({ tone, text })}
      />

      <ShareDialog
        open={dialog?.kind === 'share-list'}
        onClose={() => setDialog(null)}
        subject={dialog?.kind === 'share-list' ? `${picked.size} properties` : ''}
        text={dialog?.kind === 'share-list' ? dialog.text : ''}
      />

    </div>
  );
}

/** "Area calculated using project standard: 225 sq ft per Marla." */
function standardNote(rows: readonly PropertyRow[]): string {
  const standards = [...new Set(rows.map((r) => r.marlaStandard))];
  if (standards.length === 0) return 'Area is calculated from each project’s Marla standard.';
  if (standards.length === 1) return `Area calculated using project standard: ${standards[0]} sq ft per Marla.`;
  return `Area calculated per project — these rows span ${standards.sort((a, b) => a - b).join(', ')} sq ft per Marla.`;
}

/* ---------------------------------------------------------------------------
 * The pieces
 * ------------------------------------------------------------------------- */

function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="flex flex-col gap-[0.28rem]">
      <span className="text-[0.78rem]" style={{ color: cv('soft') }}>{label}</span>
      {children}
    </span>
  );
}

function Tile({
  label, value, icon: Icon, bg, ink, caption,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties; strokeWidth?: number; 'aria-hidden'?: boolean }>;
  bg: string;
  ink: string;
  caption?: string;
}) {
  return (
    <div className="flex h-[6.4rem] items-start gap-[0.95rem] rounded-[0.6rem] border px-[0.8rem] pt-[0.8rem]"
         style={{ borderColor: cv('line'), background: cv('surface') }}>
      <span className="grid size-[3.1rem] shrink-0 place-items-center rounded-[0.55rem]" style={{ background: cv(bg) }}>
        <Icon className="size-[1.6rem]" style={{ color: cv(ink) }} strokeWidth={1.9} aria-hidden />
      </span>
      <span className="min-w-0 pt-[0.15rem]">
        <span className="block truncate text-[0.82rem]" style={{ color: cv('soft') }}>{label}</span>
        <span className="block truncate text-[1.6rem] font-bold leading-[1.25] tabular-nums" style={{ color: cv(ink) }}>
          {value.toLocaleString('en-US')}
        </span>
        {caption ? (
          <span className="mt-[0.1rem] block truncate text-[0.7rem]" style={{ color: cv('soft') }}>{caption}</span>
        ) : null}
      </span>
    </div>
  );
}

function StatusPill({ status, small }: { status: string; small?: boolean }) {
  const look = statusLook(status);
  return (
    <span
      title={look.meaning}
      className={cn(
        'inline-flex max-w-full items-center whitespace-nowrap rounded-full font-medium leading-[1.15]',
        small ? 'gap-[0.3rem] px-[0.55rem] py-[0.24rem] text-[0.74rem]' : 'gap-[0.4rem] px-[0.7rem] py-[0.28rem] text-[0.8rem]',
      )}
      style={{ background: cv(`${look.tone}-bg`), color: cv(look.tone) }}
    >
      <span className="size-[0.45rem] shrink-0 rounded-full" style={{ background: cv(`${look.tone}-dot`) }} aria-hidden="true" />
      {look.label}
    </span>
  );
}

function ImportMenu({ onImport, onTemplate }: { onImport: () => void; onTemplate: () => void }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  useOutside(ref, () => setOpen(false), open);

  return (
    <div className="relative" ref={ref}>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}
              className={`${OUTLINE} h-[2.65rem] px-4 text-[0.95rem]`} style={outlineStyle}>
        <Upload className="size-[1.05rem]" aria-hidden="true" />
        Import properties
        <ChevronDown className="size-[1rem]" aria-hidden="true" />
      </button>
      {open && (
        <div className="absolute right-0 top-[calc(100%+0.3rem)] z-20 w-[14rem] overflow-hidden rounded-[0.5rem] border shadow-[var(--shadow-md)]"
             style={{ borderColor: cv('line'), background: cv('surface') }}>
          <MenuItem onClick={() => { setOpen(false); onImport(); }}>Upload a sheet…</MenuItem>
          <MenuItem onClick={() => { setOpen(false); onTemplate(); }}>CSV / Excel template</MenuItem>
        </div>
      )}
    </div>
  );
}

function DownloadMenu({
  onList, onListXlsx, onTemplate, count,
}: { onList: () => void; onListXlsx: () => void; onTemplate: () => void; count: number }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  useOutside(ref, () => setOpen(false), open);

  return (
    <div className="relative" ref={ref}>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}
              className={`${OUTLINE} h-[2.65rem] px-4 text-[0.92rem]`} style={outlineStyle}>
        <Download className="size-[1.05rem]" aria-hidden="true" />
        Download template
        <ChevronDown className="size-[1rem]" aria-hidden="true" />
      </button>
      {open && (
        <div className="absolute right-0 top-[calc(100%+0.3rem)] z-20 w-[17rem] overflow-hidden rounded-[0.5rem] border shadow-[var(--shadow-md)]"
             style={{ borderColor: cv('line'), background: cv('surface') }}>
          {/* ⚠️ The owner's own words for this button are "download this list of
              properties ... with the filters that are set", so the filtered list
              comes FIRST and the count is named — a download that quietly
              carried all 150 when the screen showed 12 is the bug this avoids. */}
          <MenuItem onClick={() => { setOpen(false); onList(); }}>These {count} properties (CSV)</MenuItem>
          <MenuItem onClick={() => { setOpen(false); onListXlsx(); }}>These {count} properties (Excel)</MenuItem>
          <MenuItem onClick={() => { setOpen(false); onTemplate(); }}>Blank import template</MenuItem>
        </div>
      )}
    </div>
  );
}

function StatusMenu({ disabled, onPick }: { disabled: boolean; onPick: (s: string) => void }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  useOutside(ref, () => setOpen(false), open);

  return (
    <div className="relative" ref={ref}>
      <button type="button" disabled={disabled} aria-expanded={open} onClick={() => setOpen(!open)}
              className={`${OUTLINE} h-[2.15rem] px-[0.8rem] text-[0.86rem]`} style={outlineStyle}>
        <Tag className="size-[0.95rem]" aria-hidden="true" />
        Update status
        <ChevronDown className="size-[0.95rem]" aria-hidden="true" />
      </button>
      {open && (
        <div className="absolute left-0 top-[calc(100%+0.3rem)] z-20 w-[12rem] overflow-hidden rounded-[0.5rem] border shadow-[var(--shadow-md)]"
             style={{ borderColor: cv('line'), background: cv('surface') }}>
          {SELECTABLE_STATUSES.map((s) => (
            <MenuItem key={s} onClick={() => { setOpen(false); onPick(s); }}>
              {statusLook(s).label}
            </MenuItem>
          ))}
        </div>
      )}
    </div>
  );
}

function MenuItem({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
            className="block w-full px-3 py-[0.52rem] text-left text-[0.88rem] transition-colors hover:bg-[var(--cl-head)]"
            style={{ color: cv('ink') }}>
      {children}
    </button>
  );
}

function useOutside(ref: React.RefObject<HTMLDivElement | null>, close: () => void, on: boolean) {
  React.useEffect(() => {
    if (!on) return;
    const down = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) close(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
  }, [on, ref, close]);
}

/* ── the table ───────────────────────────────────────────────────────── */

/* ⚠️ `minmax(0, …)` on every track. An `fr` column keeps `min-width: auto`, and
   one long project name widened its own column and cut the price beside it on
   the Clients page. */
const COLS = 'grid-cols-[2.1rem_minmax(0,1.9fr)_3.4rem_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,0.9fr)_7.4rem]';

function Table({
  rows, picked, openId, onToggle, onOpen, onEdit, onShare,
}: {
  rows: readonly PropertyRow[];
  picked: ReadonlySet<string>;
  openId: string | null;
  onToggle: (id: string) => void;
  onOpen: (id: string) => void;
  onEdit: (id: string) => void;
  onShare: (id: string) => void;
}) {
  return (
    <div className="min-w-0 overflow-x-auto">
      <div className="min-w-[56rem]">
        <div className={cn('sticky top-0 z-10 grid h-[2.5rem] items-center border-y px-[1rem] text-[0.72rem] font-medium uppercase tracking-[0.03em]', COLS)}
             style={{ borderColor: cv('grid'), background: cv('head'), color: cv('soft') }}>
          <span />
          <span>Property / project</span>
          <span>Block</span>
          <span>Size / area</span>
          <span>Dimensions</span>
          <span>Price</span>
          <span>Status</span>
          <span>Updated</span>
          <span className="text-right">Actions</span>
        </div>

        {rows.length === 0 ? (
          <p className="px-[1rem] py-10 text-center text-[0.9rem]" style={{ color: cv('soft') }}>
            Nothing matches those filters.
          </p>
        ) : (
          rows.map((r) => {
            const on = openId === r.id;
            const area = displayArea(r.areaSqft, r.sizeMarla, r.marlaStandard);
            return (
              /* ⚠️ A HOVER STATE IS A PROMISE. The whole row opens; the controls
                 inside it are guarded by the closest() check rather than by
                 shrinking the target. */
              <div
                key={r.id}
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest('a, button, input, select, label')) return;
                  onOpen(r.id);
                }}
                className={cn('grid cursor-pointer items-center border-b px-[1rem] py-[0.62rem] text-[0.86rem] transition-colors', COLS)}
                style={{
                  borderColor: cv('grid'),
                  background: on ? cv('pick') : undefined,
                  boxShadow: on ? `inset 0.18rem 0 0 ${cv('brand')}` : undefined,
                }}
              >
                <input
                  type="checkbox"
                  className={CHECK}
                  style={checkStyle}
                  checked={picked.has(r.id)}
                  onChange={() => onToggle(r.id)}
                  aria-label={`Select ${r.code}`}
                />
                <span className="min-w-0 pr-2">
                  <span className="block truncate font-semibold" style={{ color: cv('brand-ink') }}>{r.code}</span>
                  <span className="block truncate text-[0.76rem]" style={{ color: cv('soft') }}>
                    {r.plotNumber ? `Plot ${r.plotNumber}` : '—'} · {r.projectName}
                  </span>
                </span>
                <span style={{ color: cv('ink') }}>{r.block ?? '—'}</span>
                <span className="min-w-0 pr-2">
                  <span className="block truncate" style={{ color: cv('ink') }}>{sizeLabel(r.sizeMarla)}</span>
                  <span className="block truncate text-[0.76rem]" style={{ color: cv('soft') }}>{areaLabel(area)}</span>
                </span>
                <span className="truncate pr-2" style={{ color: cv('ink') }}>{r.dimensions ?? '—'}</span>
                <span className="truncate pr-2 tabular-nums" style={{ color: cv('ink') }}>{money(r.basePrice)}</span>
                <span className="pr-2"><StatusPill status={r.status} small /></span>
                <span className="truncate pr-2 text-[0.8rem]" style={{ color: cv('soft') }}>{dayLabel(r.updatedAt)}</span>
                <span className="flex items-center justify-end gap-[0.3rem]">
                  {/* ⚠️ A LINK, not a button that opens a copy. The record is a
                      route now (the owner's seventh reference draws a breadcrumb,
                      which is a URL) — so it can be opened in a new tab, pasted
                      to a colleague, and bookmarked. */}
                  <Link
                    href={`/properties/${encodeURIComponent(r.code)}`}
                    aria-label={`Open the full record for ${r.code}`}
                    title="Open the full record"
                    className={cn(SQUARE, 'size-[2.05rem]')}
                    style={{ borderColor: cv('line'), color: cv('ink') }}
                  >
                    <Eye className="size-[0.95rem]" style={{ color: cv('brand-ink') }} aria-hidden="true" />
                  </Link>
                  <Square label={`Edit ${r.code}`} size="sm" onClick={() => onEdit(r.id)}>
                    <Pencil className="size-[0.95rem]" style={{ color: cv('brand-ink') }} aria-hidden="true" />
                  </Square>
                  <Square label={`Share ${r.code}`} size="sm" onClick={() => onShare(r.id)}>
                    <Share2 className="size-[0.95rem]" style={{ color: cv('brand-ink') }} aria-hidden="true" />
                  </Square>
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function Pager({ page, pages, total, onPage }: { page: number; pages: number; total: number; onPage: (p: number) => void }) {
  const step = 'grid size-[2.05rem] place-items-center rounded-[0.42rem] border text-[0.85rem] transition-colors hover:bg-[var(--cl-head)] disabled:cursor-not-allowed disabled:opacity-40';
  const from = total === 0 ? 0 : (page - 1) * PER_PAGE + 1;
  const to = Math.min(page * PER_PAGE, total);
  const window = [...Array(pages).keys()].map((i) => i + 1).filter((p) => Math.abs(p - page) < 3).slice(0, 5);

  return (
    <div className="flex items-center gap-[0.35rem]">
      <span className="mr-2 text-[0.82rem]" style={{ color: cv('soft') }}>{from} – {to} of {total}</span>
      <button type="button" className={step} style={{ borderColor: cv('line'), color: cv('ink') }} disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
        <ChevronLeft className="size-[1rem]" aria-hidden="true" />
      </button>
      {window.map((p) => (
        <button key={p} type="button" onClick={() => onPage(p)} aria-current={p === page ? 'page' : undefined}
                className={step}
                style={p === page
                  ? { borderColor: cv('brand'), background: cv('brand'), color: cv('on-brand') }
                  : { borderColor: cv('line'), color: cv('ink') }}>
          {p}
        </button>
      ))}
      <button type="button" className={step} style={{ borderColor: cv('line'), color: cv('ink') }} disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">
        <ChevronRight className="size-[1rem]" aria-hidden="true" />
      </button>
    </div>
  );
}

/* ── the detail panel ────────────────────────────────────────────────── */

function PropertyPanel({
  row, onEdit, onShare,
}: { row: PropertyRow; onEdit: () => void; onShare: () => void }) {
  const area = displayArea(row.areaSqft, row.sizeMarla, row.marlaStandard);
  const chips = characterChips(row);

  return (
    <aside className="flex min-w-0 flex-col gap-[0.7rem] rounded-[0.6rem] border p-[0.9rem]"
           style={{ borderColor: cv('line'), background: cv('surface') }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <h2 className="text-[1.15rem] font-semibold" style={{ color: cv('ink') }}>Property details</h2>
          <StatusPill status={row.status} />
        </span>
        <span className="flex gap-2">
          <button type="button" onClick={onEdit} className={`${OUTLINE} h-[2.15rem] px-[0.75rem] text-[0.85rem]`} style={outlineStyle}>
            <Pencil className="size-[0.95rem]" aria-hidden="true" /> Edit
          </button>
          <button type="button" onClick={onShare} className={`${OUTLINE} h-[2.15rem] px-[0.75rem] text-[0.85rem]`} style={outlineStyle}>
            <Share2 className="size-[0.95rem]" aria-hidden="true" /> Share
          </button>
        </span>
      </div>

      <div>
        <p className="text-[0.82rem]" style={{ color: cv('soft') }}>{row.code}</p>
        <p className="text-[1.2rem] font-bold leading-tight" style={{ color: cv('ink') }}>
          {row.plotNumber ? `Plot ${row.plotNumber}` : row.code}
          {row.block ? ` · Block ${row.block}` : ''}
        </p>
        <p className="text-[0.85rem]" style={{ color: cv('soft') }}>
          {row.projectName}{row.projectCity ? ` · ${row.projectCity}` : ''}
        </p>
      </div>

      <Box title="Core information">
        <div className="grid gap-x-4 gap-y-[0.3rem] sm:grid-cols-2">
          <Row k="Property type" v={row.kind ?? '—'} />
          <Row k="Dimensions" v={row.dimensions ?? '—'} />
          <Row k="Size" v={sizeLabel(row.sizeMarla)} />
          <Row k="Facing" v={row.facing ?? '—'} />
          <Row k="Marla standard" v={`${row.marlaStandard} sq ft`} />
          <Row k="Road size" v={row.roadWidthFt ? `${row.roadWidthFt} ft road` : '—'} />
          <Row k="Total area" v={areaLabel(area)} />
          <Row k="Development" v={row.developmentStatus ?? '—'} />
        </div>
      </Box>

      <div className="flex flex-wrap gap-[0.4rem]">
        {chips.map((c) => (
          <span key={c} className="inline-flex items-center gap-[0.35rem] rounded-[0.42rem] border px-[0.55rem] py-[0.3rem] text-[0.78rem]"
                style={{ borderColor: cv('line'), color: cv('soft') }}>
            {c}
          </span>
        ))}
      </div>

      <Box title="Pricing">
        <div className="grid gap-x-4 gap-y-[0.3rem] sm:grid-cols-2">
          <Row k="Base price" v={money(row.basePrice)} strong />
          <Row k="Last updated" v={dayLabel(row.priceUpdatedAt ?? row.updatedAt)} />
          <Row k="Premium" v={money(row.premiumCharges ?? 0)} />
          <Row k="Total" v={money((row.basePrice ?? 0) + (row.premiumCharges ?? 0))} strong />
        </div>
      </Box>

      <div className="grid gap-[0.7rem] sm:grid-cols-2">
        <Box title="Availability">
          <div className="space-y-[0.3rem]">
            <StatusPill status={row.status} small />
            <Row k="Active booking" v={row.activeBooking ?? 'No active booking'} />
            <Row k="Linked leads" v={String(row.linkedLeads)} />
            <Row k="Quotations" v={String(row.linkedQuotations)} />
          </div>
        </Box>
        <Box title="Documents">
          {/* ⚠️ THE THREE SLOTS ARE ALWAYS LISTED, and one with no file says so.
              The owner's own instruction about legal papers is to use a
              placeholder — *"Legal document not uploaded"* — rather than draw
              something that looks like a document. The same principle here: an
              absent site plan must read as absent, not as a missing row. */}
          <ul className="space-y-[0.3rem]">
            {(['property_sheet', 'site_plan', 'payment_plan'] as const).map((kind) => {
              const doc = row.documents.find((d) => d.kind === kind);
              const label = kind === 'property_sheet' ? 'Property sheet' : kind === 'site_plan' ? 'Site plan' : 'Payment plan';
              return (
                <li key={kind} className="flex items-center justify-between gap-2 text-[0.82rem]">
                  <span className="inline-flex min-w-0 flex-1 items-center gap-[0.35rem]" style={{ color: doc ? cv('ink') : cv('mute') }}>
                    <FileText className="size-[0.9rem] shrink-0" style={{ color: doc ? cv('red-strong') : cv('mute') }} aria-hidden="true" />
                    <span className="truncate">{label}</span>
                  </span>
                  <span className="ml-2 shrink-0 whitespace-nowrap text-[0.7rem]" style={{ color: doc ? cv('brand-ink') : cv('mute') }}>
                    {doc ? 'View' : 'Not uploaded'}
                  </span>
                </li>
              );
            })}
          </ul>
        </Box>
      </div>

      <Box title="Linked items">
        {row.links.length === 0 ? (
          <p className="text-[0.82rem]" style={{ color: cv('mute') }}>
            Nothing is linked to this plot yet.
          </p>
        ) : (
          <ul className="space-y-[0.32rem]">
            {row.links.slice(0, 6).map((l) => (
              <li key={`${l.kind}-${l.id}`} className="flex items-center justify-between gap-2 text-[0.82rem]">
                <span className="inline-flex min-w-0 items-center gap-[0.4rem]">
                  <Link2 className="size-[0.85rem] shrink-0" style={{ color: cv('mute') }} aria-hidden="true" />
                  <span className="truncate font-medium" style={{ color: cv('brand-ink') }}>{l.label}</span>
                  {l.detail ? (
                    <span className="shrink-0 rounded-full px-[0.45rem] py-[0.1rem] text-[0.7rem]"
                          style={{ background: cv('pill'), color: cv('soft') }}>{l.detail}</span>
                  ) : null}
                </span>
                <span className="shrink-0 text-[0.76rem] capitalize" style={{ color: cv('soft') }}>{l.kind}</span>
              </li>
            ))}
          </ul>
        )}
      </Box>

      <div className="mt-auto grid gap-2 sm:grid-cols-2">
        <Link href={`/properties/${encodeURIComponent(row.code)}`}
              className={`${OUTLINE} h-[2.6rem] text-[0.92rem]`} style={outlineStyle}>
          <FileText className="size-[1rem]" aria-hidden="true" /> View full record
        </Link>
        <button type="button" onClick={onShare} className={`${SOLID} h-[2.6rem] text-[0.92rem]`} style={solidStyle}>
          <Share2 className="size-[1rem]" aria-hidden="true" /> Share property
        </button>
      </div>
    </aside>
  );
}

function Box({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[0.5rem] border p-[0.7rem]" style={{ borderColor: cv('line') }}>
      <h3 className="mb-[0.45rem] text-[0.82rem] font-semibold" style={{ color: cv('ink') }}>{title}</h3>
      {children}
    </section>
  );
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <p className="flex min-w-0 items-baseline justify-between gap-3 text-[0.82rem]">
      <span className="shrink-0" style={{ color: cv('soft') }}>{k}</span>
      <span className={cn('min-w-0 truncate text-right', strong && 'font-semibold')} style={{ color: cv('ink') }}>{v}</span>
    </p>
  );
}

