'use client';

import * as React from 'react';
import Link from 'next/link';
import { BarChart3, Filter, Maximize2, Minus, Plus, Share2, FileText } from 'lucide-react';

import { cv, OUTLINE, outlineStyle, SOLID, solidStyle } from '@/components/crm/clients-ui';
import type { PropertyRow } from '@/lib/db/queries/crm-properties';
import { areaLabel, displayArea, money, sizeLabel, statusLook } from '@/lib/domain/crm-property';
import { cn } from '@/lib/utils';

/* ============================================================================
 * THE SITE MAP — the owner's reference, 2026-09-27
 * ----------------------------------------------------------------------------
 * ── ⚠️ IT IS DRAWN FROM THE INVENTORY, NOT FROM A SITE PLAN ───────────────
 * Nobody has given this application a surveyed plan, and the owner's own
 * reference says so in the corner: *"Schematic inventory map · not a legal site
 * plan."* That sentence is the whole design brief for this component.
 *
 * So the blocks and their plots are laid out from the ROWS — grouped by block,
 * ordered by plot number, coloured by availability. It answers "how much of
 * Block A is left, and where are the gaps" at a glance, which is the question a
 * salesperson opens a map for. It does NOT claim where any plot physically is.
 *
 * ⚠️ AND THAT CAUTION STAYS ON SCREEN. A schematic that looks like a survey is
 * one somebody will show a buyer while pointing at a corner plot. The label is
 * not decoration; it is the difference between a stock chart and a promise.
 *
 * ── ⚠️ THE SAME SELECTION AS THE TABLE ────────────────────────────────────
 * Clicking a plot opens the same detail panel the table opens, because it is
 * the same page state. Two views of one list must not have two ideas of which
 * row is open.
 * ========================================================================= */

const TONE_FILL: Record<string, string> = {
  green: 'green-bg', amber: 'amber-bg', red: 'red-bg', grey: 'grey-bg', blue: 'blue-bg',
};
const TONE_INK: Record<string, string> = {
  green: 'green', amber: 'amber', red: 'red', grey: 'grey', blue: 'blue',
};

export function PropertySiteMap({
  rows,
  all,
  projectName,
  openId,
  onOpen,
  onShare,
  activeFilters,
}: {
  /** The rows the filters left — what the map draws. */
  rows: readonly PropertyRow[];
  /** Every row, for the project totals in the rail. */
  all: readonly PropertyRow[];
  projectName: string;
  openId: string | null;
  onOpen: (id: string) => void;
  onShare: (id: string) => void;
  activeFilters: readonly (readonly [string, string])[];
}) {
  const [numbers, setNumbers] = React.useState(true);
  const [zoom, setZoom] = React.useState(1);

  /* Blocks in order, each with its plots. A plot with no block is its own
     group called "Unblocked" rather than being dropped — a scheme part-way
     through data entry has plenty of those, and hiding them would make the map
     disagree with the count above it. */
  const blocks = React.useMemo(() => {
    const byBlock = new Map<string, PropertyRow[]>();
    for (const r of rows) {
      const key = (r.block ?? '').trim() || 'Unblocked';
      const list = byBlock.get(key);
      if (list) list.push(r); else byBlock.set(key, [r]);
    }
    return [...byBlock.entries()]
      .sort(([a], [b]) => (a === 'Unblocked' ? 1 : b === 'Unblocked' ? -1 : a.localeCompare(b)))
      .map(([name, plots]) => ({
        name,
        plots: [...plots].sort((a, b) =>
          (a.plotNumber ?? a.code).localeCompare(b.plotNumber ?? b.code, undefined, { numeric: true })),
      }));
  }, [rows]);

  const open = rows.find((r) => r.id === openId) ?? null;
  const firstBlock = blocks[0]?.name ?? null;

  const tally = (list: readonly PropertyRow[]) => ({
    available: list.filter((r) => r.status === 'available').length,
    reserved: list.filter((r) => r.status === 'reserved').length,
    sold: list.filter((r) => r.status === 'sold').length,
    held: list.filter((r) => r.status === 'on_hold' || r.status === 'blocked').length,
  });
  const inBlock = tally(blocks[0]?.plots ?? []);
  const totals = tally(all);
  const pct = (n: number) => (all.length === 0 ? '—' : `${Math.round((n / all.length) * 1000) / 10}%`);

  return (
    <div className="grid min-w-0 gap-[1.05rem] xl:grid-cols-[minmax(0,1fr)_19rem]">
      <section className="min-w-0 overflow-hidden rounded-[0.6rem] border" style={{ borderColor: cv('line'), background: cv('surface') }}>
        <header className="flex flex-wrap items-center justify-between gap-2 px-[1rem] py-[0.8rem]">
          <span>
            <h2 className="text-[1.2rem] font-semibold leading-tight" style={{ color: cv('ink') }}>{projectName}</h2>
            <p className="text-[0.82rem]" style={{ color: cv('soft') }}>Site map view</p>
          </span>
          <span className="flex flex-wrap items-center gap-2">
            <label className="inline-flex cursor-pointer items-center gap-[0.45rem] text-[0.85rem]" style={{ color: cv('ink') }}>
              <input type="checkbox" checked={numbers} onChange={() => setNumbers(!numbers)}
                     className="size-[1.05rem] cursor-pointer rounded-[0.25rem]" style={{ accentColor: 'var(--cl-brand)' }} />
              Show plot numbers
            </label>
            <button type="button" onClick={() => setZoom(1)} className={`${OUTLINE} h-[2.2rem] px-[0.7rem] text-[0.85rem]`} style={outlineStyle}>
              <Maximize2 className="size-[0.9rem]" aria-hidden="true" /> Fit map
            </button>
            <span className="inline-flex overflow-hidden rounded-[0.45rem] border" style={{ borderColor: cv('line') }}>
              <button type="button" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(0.6, Math.round((z - 0.15) * 100) / 100))}
                      className="grid size-[2.2rem] place-items-center transition-colors hover:bg-[var(--cl-head)]" style={{ color: cv('ink') }}>
                <Minus className="size-[0.95rem]" aria-hidden="true" />
              </button>
              <button type="button" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(1.8, Math.round((z + 0.15) * 100) / 100))}
                      className="grid size-[2.2rem] place-items-center border-l transition-colors hover:bg-[var(--cl-head)]"
                      style={{ color: cv('ink'), borderColor: cv('line') }}>
                <Plus className="size-[0.95rem]" aria-hidden="true" />
              </button>
            </span>
          </span>
        </header>

        {/* ⚠️ The scheme. `overflow-auto` on its own container, so a zoomed map
            scrolls inside its card rather than widening the page (the trap the
            handover's table rule names). */}
        <div className="relative overflow-auto border-y p-[1rem]" style={{ borderColor: cv('grid'), background: '#eaf3ea' }}>
          <span className="pointer-events-none absolute right-[1rem] top-[1rem] z-10 grid size-[2.2rem] place-items-center rounded-full text-[0.8rem] font-semibold"
                style={{ background: cv('surface'), color: cv('soft'), boxShadow: 'var(--shadow-sm)' }} aria-hidden="true">
            N
          </span>

          <div className="origin-top-left space-y-[0.9rem]" style={{ zoom }}>
            {blocks.length === 0 ? (
              <p className="py-12 text-center text-[0.9rem]" style={{ color: cv('soft') }}>
                Nothing matches those filters, so there is nothing to draw.
              </p>
            ) : (
              blocks.map((b, i) => (
                <React.Fragment key={b.name}>
                  <BlockPlan
                    name={b.name}
                    plots={b.plots}
                    numbers={numbers}
                    openId={openId}
                    onOpen={onOpen}
                  />
                  {i === 0 && blocks.length > 1 && (
                    <div className="flex items-center gap-2 rounded-[0.3rem] px-3 py-[0.35rem] text-[0.78rem] font-medium tracking-[0.04em]"
                         style={{ background: '#d6d9dd', color: '#5b6472' }} aria-hidden="true">
                      <span className="h-px flex-1" style={{ background: '#ffffff88' }} />
                      MAIN BOULEVARD
                      <span className="h-px flex-1" style={{ background: '#ffffff88' }} />
                    </div>
                  )}
                </React.Fragment>
              ))
            )}
          </div>

          {/* the selected plot's card, as the reference draws it */}
          {open && (
            <div className="pointer-events-auto absolute left-[1rem] top-[3.4rem] z-20 w-[16.5rem] rounded-[0.6rem] border p-[0.7rem]"
                 style={{ borderColor: cv('line'), background: cv('surface'), boxShadow: 'var(--shadow-md)' }}>
              <p className="flex items-center justify-between gap-2">
                <span className="text-[1rem] font-bold" style={{ color: cv('ink') }}>{open.plotNumber ?? open.code}</span>
                <span className="inline-flex items-center gap-[0.35rem] rounded-full px-[0.55rem] py-[0.2rem] text-[0.74rem] font-medium"
                      style={{ background: cv(`${statusLook(open.status).tone}-bg`), color: cv(statusLook(open.status).tone) }}>
                  <span className="size-[0.4rem] rounded-full" style={{ background: cv(`${statusLook(open.status).tone}-dot`) }} aria-hidden="true" />
                  {statusLook(open.status).label}
                </span>
              </p>
              <p className="mt-[0.3rem] text-[0.8rem]" style={{ color: cv('soft') }}>
                {sizeLabel(open.sizeMarla)} <span aria-hidden="true">|</span>{' '}
                {areaLabel(displayArea(open.areaSqft, open.sizeMarla, open.marlaStandard))}
                {open.dimensions ? <> <span aria-hidden="true">|</span> {open.dimensions}</> : null}
              </p>
              {open.facing ? <p className="text-[0.8rem]" style={{ color: cv('soft') }}>{open.facing}</p> : null}
              <p className="mt-[0.2rem] text-[0.95rem] font-bold" style={{ color: cv('ink') }}>{money(open.basePrice)}</p>
              <span className="mt-[0.55rem] flex gap-2">
                <Link href={`/properties/${encodeURIComponent(open.code)}`}
                      className={`${SOLID} h-[2.1rem] flex-1 px-[0.6rem] text-[0.82rem]`} style={solidStyle}>
                  <FileText className="size-[0.9rem]" aria-hidden="true" /> View record
                </Link>
                <button type="button" onClick={() => onShare(open.id)}
                        className={`${OUTLINE} h-[2.1rem] flex-1 px-[0.6rem] text-[0.82rem]`} style={outlineStyle}>
                  <Share2 className="size-[0.9rem]" aria-hidden="true" /> Share
                </button>
              </span>
            </div>
          )}
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 px-[1rem] py-[0.7rem]">
          <span className="flex flex-wrap items-center gap-[1rem] text-[0.82rem]" style={{ color: cv('soft') }}>
            <Key tone="green" label={`Available (${totals.available})`} />
            <Key tone="amber" label={`Reserved (${totals.reserved})`} />
            <Key tone="red" label={`Sold (${totals.sold})`} />
            <Key tone="grey" label={`On hold / Blocked (${totals.held})`} />
          </span>
          {/* ⚠️ The owner's own caution, kept verbatim. */}
          <span className="text-[0.78rem]" style={{ color: cv('mute') }}>
            Schematic inventory map · not a legal site plan
          </span>
        </footer>
      </section>

      <aside className="space-y-[0.9rem]">
        <section className="rounded-[0.6rem] border p-[0.8rem]" style={{ borderColor: cv('line'), background: cv('surface') }}>
          <h3 className="mb-[0.6rem] inline-flex items-center gap-[0.45rem] text-[1rem] font-semibold" style={{ color: cv('ink') }}>
            <BarChart3 className="size-[1.05rem]" style={{ color: cv('brand-ink') }} aria-hidden="true" />
            Map insights
          </h3>
          <p className="mb-[0.4rem] text-[0.86rem] font-medium" style={{ color: cv('ink') }}>{projectName}</p>
          {firstBlock ? (
            <ul className="mb-[0.8rem] space-y-[0.28rem]">
              <Insight tone="green" label={`Available in Block ${firstBlock}`} value={inBlock.available} />
              <Insight tone="amber" label={`Reserved in Block ${firstBlock}`} value={inBlock.reserved} />
              <Insight tone="red" label={`Sold in Block ${firstBlock}`} value={inBlock.sold} />
              <Insight tone="grey" label={`On hold / Blocked in Block ${firstBlock}`} value={inBlock.held} />
            </ul>
          ) : null}

          <p className="mb-[0.4rem] text-[0.86rem] font-medium" style={{ color: cv('ink') }}>Project totals (all blocks)</p>
          <ul className="space-y-[0.28rem]">
            <Insight tone="green" label="Available" value={totals.available} extra={pct(totals.available)} />
            <Insight tone="amber" label="Reserved" value={totals.reserved} extra={pct(totals.reserved)} />
            <Insight tone="red" label="Sold" value={totals.sold} extra={pct(totals.sold)} />
            <Insight tone="grey" label="On hold / Blocked" value={totals.held} extra={pct(totals.held)} />
          </ul>
        </section>

        <section className="rounded-[0.6rem] border p-[0.8rem]" style={{ borderColor: cv('line'), background: cv('surface') }}>
          <h3 className="mb-[0.5rem] inline-flex items-center gap-[0.45rem] text-[1rem] font-semibold" style={{ color: cv('ink') }}>
            <Filter className="size-[1rem]" style={{ color: cv('brand-ink') }} aria-hidden="true" />
            Active filters
          </h3>
          <ul className="space-y-[0.22rem]">
            {activeFilters.map(([k, v]) => (
              <li key={k} className="flex items-baseline justify-between gap-3 text-[0.82rem]">
                <span style={{ color: cv('soft') }}>{k}</span>
                <span className="min-w-0 truncate text-right" style={{ color: cv('ink') }}>{v}</span>
              </li>
            ))}
          </ul>
        </section>
      </aside>
    </div>
  );
}

function BlockPlan({
  name, plots, numbers, openId, onOpen,
}: {
  name: string;
  plots: readonly PropertyRow[];
  numbers: boolean;
  openId: string | null;
  onOpen: (id: string) => void;
}) {
  return (
    <div className="rounded-[0.5rem] p-[0.7rem]" style={{ background: '#dfeade' }}>
      <p className="mx-auto mb-[0.6rem] w-fit rounded-[0.3rem] px-[0.9rem] py-[0.2rem] text-[0.82rem] font-semibold"
         style={{ background: '#cfd9e6', color: '#3c4a60' }}>
        {name === 'Unblocked' ? 'No block recorded' : `Block ${name}`}
      </p>
      <div className="flex flex-wrap gap-[0.3rem]">
        {plots.map((p) => {
          const look = statusLook(p.status);
          const on = openId === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onOpen(p.id)}
              title={`${p.plotNumber ?? p.code} · ${look.label} · ${sizeLabel(p.sizeMarla)} · ${money(p.basePrice)}`}
              aria-label={`${p.plotNumber ?? p.code}, ${look.label}, ${sizeLabel(p.sizeMarla)}, ${money(p.basePrice)}`}
              aria-pressed={on}
              className={cn(
                'grid h-[3.1rem] w-[4.3rem] place-items-center rounded-[0.28rem] border text-[0.72rem] font-medium transition-transform',
                'hover:-translate-y-[0.1rem] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]',
              )}
              style={{
                background: cv(TONE_FILL[look.tone] ?? 'grey-bg'),
                color: cv(TONE_INK[look.tone] ?? 'grey'),
                borderColor: on ? cv('brand') : 'transparent',
                borderWidth: on ? '0.14rem' : '1px',
              }}
            >
              {numbers ? (p.plotNumber ?? p.code) : ''}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Key({ tone, label }: { tone: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-[0.35rem]">
      <span className="size-[0.6rem] rounded-full" style={{ background: cv(`${tone}-dot`) }} aria-hidden="true" />
      {label}
    </span>
  );
}

function Insight({ tone, label, value, extra }: { tone: string; label: string; value: number; extra?: string }) {
  return (
    <li className="flex items-baseline justify-between gap-2 text-[0.84rem]">
      <span className="inline-flex min-w-0 items-center gap-[0.4rem]" style={{ color: cv('soft') }}>
        <span className="size-[0.55rem] shrink-0 rounded-full" style={{ background: cv(`${tone}-dot`) }} aria-hidden="true" />
        <span className="truncate">{label}</span>
      </span>
      <span className="shrink-0 tabular-nums" style={{ color: cv('ink') }}>
        {value}
        {extra ? <span className="ml-2" style={{ color: cv('mute') }}>{extra}</span> : null}
      </span>
    </li>
  );
}
