'use client';

import * as React from 'react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Coins,
  Eye,
  FileSpreadsheet,
  Filter,
  LayoutGrid,
  Mail,
  MessageSquare,
  Phone,
  Plus,
  Search,
  Table2,
  Upload,
  UserPlus,
  Users,
} from 'lucide-react';

import { bulkClientAction, clientActivityAction, updateClientAction } from '@/app/actions/crm-client-board';
import { leadBundlesAction } from '@/app/actions/crm-lead-bundles';
import { ink, RowMenu, tint } from '@/components/crm/appointments-board-parts';
import { ClientForm, downloadText, ImportDialog } from '@/components/crm/client-dialogs';
import { Avatar, ClientPanel, StatusChip } from '@/components/crm/client-panel';
import { EditLeadDetails } from '@/components/crm/edit-lead-details';
import { LeadDetailsModal } from '@/components/crm/lead-details-modal';
import { RelatedItemsDialog, seedRelated, type TabKey as RelatedTab } from '@/components/crm/related-items';
import { WA_GREEN, WhatsAppMark } from '@/components/crm/whatsapp-mark';
import { PageHeader } from '@/components/ui/page-header';
import { useToast } from '@/components/ui/toast';
import type { ClientMoment, ClientRow } from '@/lib/db/queries/crm-client-board';
import type { CrmLeadBundle } from '@/lib/db/queries/crm-leads';
import {
  applyFilters,
  cards as cardsOf,
  CHANNEL_LABEL,
  inTab,
  karachiDay,
  money,
  moreFilterCount,
  nextLine,
  NO_FILTERS,
  phoneLabel,
  sortClients,
  SOURCE_OPTIONS,
  STATUS_LOOK,
  STORED_STATUS_OPTIONS,
  TABS,
  toCsv,
  valueOf,
  type DisplayStatus,
  type Filters,
  type StoredStatus,
  type TabKey,
} from '@/lib/domain/crm-client-board';
import { cn } from '@/lib/utils';

/* ============================================================================
 * CLIENTS — the owner's design, 2026-09-22
 * ----------------------------------------------------------------------------
 * *"Please create this page accordingly and make sure everything is properly
 * working … each and every thing is properly wired up and logically
 * implemented. Make sure they are isolated and will not break any other
 * working thing."*
 *
 * ── ⚠️ RULE ZERO ───────────────────────────────────────────────────────────
 * One query. Cards, tabs, filters, table, cards view, paging, selection and
 * the preview are client state over it; only a write reaches the server, and
 * each write moves its row in its own frame before the page catches up.
 *
 * ── ⚠️ ISOLATED ────────────────────────────────────────────────────────────
 * Its own reader and writers (249), its own rules file, its own components.
 * What it reuses — the lead modal, Related items, the lead bundles — it calls
 * exactly as the Appointments and Follow-ups pages already do.
 * ========================================================================= */

const CONTROL =
  'h-9 rounded-xl border border-border-default bg-bg-surface text-body-sm text-text-primary transition-colors hover:border-border-strong focus:border-accent-primary focus:outline-none';

type Dialog =
  | { kind: 'add' }
  | { kind: 'edit'; id: string }
  | { kind: 'import' }
  | { kind: 'lead'; leadId: string }
  | { kind: 'related'; leadId: string; tab: RelatedTab }
  | { kind: 'edit-lead'; leadId: string }
  | null;

export function ClientsBoard({
  clients,
  projects,
  nowMs,
  viewerId,
  viewerName,
}: {
  clients: readonly ClientRow[];
  projects: ReadonlyArray<{ id: string; name: string }>;
  nowMs: number;
  viewerId: string;
  viewerName: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [, startTransition] = React.useTransition();
  const refresh = () => startTransition(() => router.refresh());

  /* ── What this screen has just changed, over the server's rows ────────── */
  const [patches, setPatches] = React.useState<ReadonlyMap<string, Partial<ClientRow>>>(new Map());
  const [seen, setSeen] = React.useState(clients);
  if (seen !== clients) {
    setSeen(clients);
    setPatches(new Map());
  }
  /* Clients added on this screen, until the server's own rows include them. */
  const [added, setAdded] = React.useState<readonly ClientRow[]>([]);
  const rows = React.useMemo(
    () =>
      [...added.filter((a) => !clients.some((c) => c.id === a.id)), ...clients].map((c) =>
        patches.has(c.id) ? ({ ...c, ...patches.get(c.id) } as ClientRow) : c,
      ),
    [added, clients, patches],
  );
  const patch = (ids: readonly string[], p: Partial<ClientRow>) =>
    setPatches((prev) => {
      const next = new Map(prev);
      for (const id of ids) next.set(id, { ...next.get(id), ...p });
      return next;
    });
  const unpatch = (ids: readonly string[]) =>
    setPatches((prev) => {
      const next = new Map(prev);
      for (const id of ids) next.delete(id);
      return next;
    });

  const [tab, setTab] = React.useState<TabKey>('all');
  const [filters, setFilters] = React.useState<Filters>(NO_FILTERS);
  const set = (p: Partial<Filters>) => setFilters((f) => ({ ...f, ...p }));
  const [view, setView] = React.useState<'table' | 'cards'>('table');

  const card = React.useMemo(() => cardsOf(rows, nowMs), [rows, nowMs]);
  const tabCount = React.useMemo(() => {
    const out: Record<TabKey, number> = { all: 0, active: 0, prospect: 0, attention: 0, dormant: 0, archived: 0 };
    for (const c of rows) for (const t of TABS) if (inTab(c, t.key, nowMs)) out[t.key] += 1;
    return out;
  }, [rows, nowMs]);

  const shown = React.useMemo(
    () => sortClients(applyFilters(rows.filter((c) => inTab(c, tab, nowMs)), filters, nowMs), nowMs),
    [rows, tab, filters, nowMs],
  );

  const projectOptions = React.useMemo(() => [...new Set(rows.flatMap((c) => c.projectNames))].sort(), [rows]);
  const ownerOptions = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const c of rows) if (c.ownerId) m.set(c.ownerId, c.ownerName ?? 'Former member');
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);
  /* The project a new client most likely belongs to: the one filtered on, else
     the one most of these clients are on. */
  const defaultProjectId = React.useMemo(() => {
    const byName = filters.project !== 'all' ? projects.find((p) => p.name === filters.project)?.id : null;
    if (byName) return byName;
    const tally = new Map<string, number>();
    for (const c of rows) if (c.primaryProjectId) tally.set(c.primaryProjectId, (tally.get(c.primaryProjectId) ?? 0) + 1);
    return [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  }, [filters.project, projects, rows]);

  const cityOptions = React.useMemo(
    () => [...new Set(rows.map((c) => c.city).filter((x): x is string => Boolean(x)))].sort(),
    [rows],
  );

  /* ── Paging — a slice of rows already here, so a page turn is free ───── */
  const [perPage, setPerPage] = React.useState(25);
  const [page, setPage] = React.useState(0);
  const key = `${tab}|${JSON.stringify(filters)}|${perPage}`;
  const [pageKey, setPageKey] = React.useState(key);
  if (pageKey !== key) {
    setPageKey(key);
    setPage(0);
  }
  const pages = Math.max(1, Math.ceil(shown.length / perPage));
  const onPage = Math.min(page, pages - 1);
  const pageRows = shown.slice(onPage * perPage, onPage * perPage + perPage);

  /* ── Selection and ticks ─────────────────────────────────────────────── */
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const selected = shown.find((c) => c.id === selectedId) ?? pageRows[0] ?? null;
  const [ticked, setTicked] = React.useState<ReadonlySet<string>>(new Set());
  const tickedRows = rows.filter((c) => ticked.has(c.id));
  const allOnPage = pageRows.length > 0 && pageRows.every((c) => ticked.has(c.id));

  /* ── The selected client's activity, read once and kept ──────────────── */
  const [activity, setActivity] = React.useState<Record<string, ClientMoment[]>>({});
  const asked = React.useRef<Set<string>>(new Set());
  React.useEffect(() => {
    if (!selected || asked.current.has(selected.id)) return;
    asked.current.add(selected.id);
    const id = selected.id;
    void clientActivityAction(id).then((r) => setActivity((a) => ({ ...a, [id]: r.moments })));
  }, [selected]);

  /* ── The lead's own modal and Related items, as the other pages open them ── */
  const [dialog, setDialog] = React.useState<Dialog>(null);
  const [bundles, setBundles] = React.useState<Record<string, CrmLeadBundle>>({});
  const needBundle = (leadId: string) => {
    if (!bundles[leadId]) {
      void leadBundlesAction([leadId]).then((r) => setBundles((prev) => ({ ...prev, ...r.bundles })));
    }
  };
  const openLead = (leadId: string) => {
    setDialog({ kind: 'lead', leadId });
    needBundle(leadId);
  };
  const openRelated = (leadId: string, t: RelatedTab) => {
    setDialog({ kind: 'related', leadId, tab: t });
    needBundle(leadId);
  };

  /* ── Writes ──────────────────────────────────────────────────────────── */
  const setStatus = async (c: ClientRow, status: StoredStatus) => {
    patch([c.id], { status });
    const r = await updateClientAction(c.id, { status });
    if (!r.ok) {
      unpatch([c.id]);
      toast({ tone: 'error', text: r.error });
      return;
    }
    toast({ tone: 'ok', text: `${c.name} is now ${STATUS_LOOK[status].label.toLowerCase()}.` });
    refresh();
  };

  const setArchived = async (c: ClientRow, archive: boolean) => {
    patch([c.id], { archivedAt: archive ? new Date().toISOString() : null });
    const r = await updateClientAction(c.id, { archive });
    if (!r.ok) {
      unpatch([c.id]);
      toast({ tone: 'error', text: r.error });
      return;
    }
    toast({ tone: 'ok', text: archive ? `${c.name} archived — find them under Archived.` : `${c.name} restored.` });
    refresh();
  };

  const bulk = async (op: { status: StoredStatus } | { ownerId: string; name: string } | { archive: boolean }) => {
    const ids = [...ticked];
    if (!ids.length) return;
    if ('status' in op) patch(ids, { status: op.status });
    else if ('archive' in op) patch(ids, { archivedAt: op.archive ? new Date().toISOString() : null });
    else patch(ids, { ownerId: op.ownerId, ownerName: op.name });
    const r = await bulkClientAction(ids, 'name' in op ? { ownerId: op.ownerId } : op);
    /* ⚠️ THE ONES REFUSED GO BACK, BY NAME — a bulk change that reported
       "done" for rows it could not touch would be lying. */
    if (r.refused.length) {
      unpatch(r.refused.map((x) => x.id));
      const first = rows.find((c) => c.id === r.refused[0].id)?.name ?? 'One client';
      toast({ tone: 'error', text: `${r.done} changed. ${r.refused.length} refused — ${first}: ${r.refused[0].error}` });
    } else {
      toast({ tone: 'ok', text: `${r.done} client${r.done === 1 ? '' : 's'} updated.` });
    }
    setTicked(new Set());
    refresh();
  };

  const exportRows = (list: readonly ClientRow[]) => {
    if (!list.length) {
      toast({ tone: 'error', text: 'Nothing to export — the filters show no clients.' });
      return;
    }
    downloadText(`clients-${karachiDay(nowMs)}.csv`, toCsv(list, nowMs));
    toast({ tone: 'ok', text: `Exported ${list.length} client${list.length === 1 ? '' : 's'}.` });
  };

  const conversation = (c: ClientRow) => {
    if (c.primaryLeadId) router.push(`/conversations?lead=${c.primaryLeadId}` as Route);
  };

  const rowMenu = (c: ClientRow) => [
    ...(c.primaryLeadId ? [{ label: 'View full record', onSelect: () => openLead(c.primaryLeadId!) }] : []),
    ...(c.primaryLeadId ? [{ label: 'Open related items', onSelect: () => openRelated(c.primaryLeadId!, 'quotations') }] : []),
    ...(c.primaryLeadId ? [{ label: 'Open the conversation', onSelect: () => conversation(c) }] : []),
    { label: 'Edit client', onSelect: () => setDialog({ kind: 'edit', id: c.id }) },
    { label: c.archivedAt ? 'Restore from archive' : 'Archive client', onSelect: () => void setArchived(c, !c.archivedAt), danger: !c.archivedAt },
  ];

  return (
    <div className="mx-auto max-w-[var(--content-max)] space-y-4">
      <PageHeader
        title="Clients"
        description="Manage client relationships, projects, communication and sales records."
        actions={
          <>
            <ImportMenu
              onImport={() => setDialog({ kind: 'import' })}
              onExport={() => exportRows(shown)}
              onTemplate={() =>
                downloadText(
                  'clients-template.csv',
                  '﻿Name,Phone,Email,Company,City,Source,Status,Preferred channel,Notes\r\n',
                )
              }
            />
            <button
              type="button"
              onClick={() => setDialog({ kind: 'add' })}
              disabled={projects.length === 0}
              title={projects.length === 0 ? 'No project is open to you for adding clients.' : undefined}
              className="inline-flex items-center gap-2 rounded-xl bg-accent-primary px-4 py-2.5 text-body-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              <Plus className="size-4" aria-hidden="true" /> Add client
            </button>
          </>
        }
      />

      {/* ── Five cards — still, white, colour in the icon only ─────────────
          The same treatment the owner asked for on Follow-ups: these report,
          they do not filter. The tabs below are what filters. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Tile label="Total clients" value={String(card.total.value)} tone="blue" icon={Users} delta={card.total.delta} caption={card.total.caption} />
        <Tile label="Active" value={String(card.active.value)} tone="green" icon={BarChart3} delta={card.active.delta} caption={card.active.caption} />
        <Tile label="New this month" value={String(card.fresh.value)} tone="blue" icon={UserPlus} delta={card.fresh.delta} caption={card.fresh.caption} />
        <Tile
          label="Needs attention"
          value={String(card.attention.value)}
          tone="red"
          icon={AlertTriangle}
          delta={card.attention.delta}
          caption={card.attention.caption}
          alarm
        />
        <Tile label="Outstanding" value={money(card.outstanding.value)} tone="amber" icon={Coins} delta={card.outstanding.delta} caption={card.outstanding.caption} />
      </div>

      {/* ── Tabs, and table / cards ────────────────────────────────────── */}
      <div className="flex flex-wrap items-end gap-3 border-b border-border-subtle">
        <div className="flex flex-1 flex-wrap items-center gap-6" role="tablist" aria-label="Which clients">
          {TABS.map((t) => {
            const on = tab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setTab(t.key)}
                className={cn(
                  '-mb-px inline-flex items-center gap-2 pb-2.5 pt-1 text-body-sm transition-colors',
                  on ? 'font-semibold text-accent-primary' : 'font-medium text-text-secondary hover:text-text-primary',
                )}
                /* The bar is an inline token — the class lost to the global
                   border colour on /follow-ups (measured), and 4px survives the
                   app's 0.9 zoom. */
                style={{ borderBottomStyle: 'solid', borderBottomWidth: '4px', borderBottomColor: on ? 'var(--accent-primary)' : 'transparent' }}
              >
                {t.label}
                {t.key !== 'all' && t.key !== 'archived' && (
                  <span
                    className="grid min-w-5 place-items-center rounded-full px-1.5 text-caption font-semibold leading-5"
                    style={on ? { background: tint('blue', 16), color: ink('blue') } : { background: 'var(--bg-subtle)', color: 'var(--text-secondary)' }}
                  >
                    {tabCount[t.key]}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div className="mb-2 inline-flex rounded-xl border border-border-default bg-bg-surface p-1" role="tablist" aria-label="View">
          {(
            [
              ['table', 'Table', Table2],
              ['cards', 'Cards', LayoutGrid],
            ] as const
          ).map(([v, label, Icon]) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={cn(
                'inline-flex items-center gap-2 rounded-lg px-4 py-1.5 text-body-sm font-semibold transition-colors',
                view === v ? 'bg-accent-primary text-white' : 'text-text-secondary hover:text-text-primary',
              )}
            >
              <Icon className="size-4" aria-hidden="true" /> {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Filters ────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <label className={cn(CONTROL, 'flex min-w-[14rem] flex-1 items-center gap-2 px-3')}>
          <Search className="size-4 shrink-0 text-text-tertiary" aria-hidden="true" />
          <input
            value={filters.q}
            onChange={(e) => set({ q: e.target.value })}
            placeholder="Search client, company, phone or email…"
            aria-label="Search client, company, phone or email"
            className="min-w-0 flex-1 bg-transparent placeholder:text-text-tertiary focus:outline-none"
          />
        </label>
        <select aria-label="Project" value={filters.project} onChange={(e) => set({ project: e.target.value })} className={cn(CONTROL, 'w-[11rem] px-2.5')}>
          <option value="all">All projects</option>
          {projectOptions.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
        <select aria-label="Account owner" value={filters.owner} onChange={(e) => set({ owner: e.target.value })} className={cn(CONTROL, 'w-[10rem] px-2.5')}>
          <option value="all">All owners</option>
          {ownerOptions.map(([id, name]) => (
            <option key={id} value={id}>{id === viewerId ? `${name} (you)` : name}</option>
          ))}
        </select>
        <select
          aria-label="Relationship status"
          value={filters.status}
          onChange={(e) => set({ status: e.target.value as DisplayStatus | 'all' })}
          className={cn(CONTROL, 'w-[10rem] px-2.5')}
        >
          <option value="all">All statuses</option>
          {(['active', 'onboarding', 'prospect', 'attention', 'dormant', 'archived'] as DisplayStatus[]).map((s) => (
            <option key={s} value={s}>{STATUS_LOOK[s].label}</option>
          ))}
        </select>
        <MoreFilters filters={filters} cities={cityOptions} onChange={set} />
        <button
          type="button"
          onClick={() => exportRows(shown)}
          className="inline-flex h-9 items-center gap-2 rounded-xl border border-border-default px-3.5 text-body-sm font-semibold text-text-primary transition-colors hover:bg-bg-subtle"
        >
          <Upload className="size-4" aria-hidden="true" /> Export
        </button>
      </div>

      {/* ── The directory and the preview ──────────────────────────────── */}
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,27rem)]">
        <section className="min-w-0 rounded-2xl border border-border-subtle bg-bg-surface py-4 shadow-sm">
          <div className="flex flex-wrap items-center gap-3 px-5 pb-3">
            <h2 className="text-h3 font-semibold text-text-primary">Client directory</h2>
            <span className="text-caption text-text-secondary">
              {shown.length} record{shown.length === 1 ? '' : 's'}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-3 px-5 pb-3">
            <input
              type="checkbox"
              aria-label="Tick every client on this page"
              checked={allOnPage}
              onChange={(e) =>
                setTicked((t) => {
                  const next = new Set(t);
                  for (const c of pageRows) {
                    if (e.target.checked) next.add(c.id);
                    else next.delete(c.id);
                  }
                  return next;
                })
              }
              className="size-4"
            />
            <BulkMenu
              count={ticked.size}
              owners={ownerOptions}
              onStatus={(s) => void bulk({ status: s })}
              onOwner={(id, name) => void bulk({ ownerId: id, name })}
              onArchive={(a) => void bulk({ archive: a })}
              onExport={() => exportRows(tickedRows)}
              onClear={() => setTicked(new Set())}
            />
          </div>

          {shown.length === 0 ? (
            <Empty
              anyAtAll={rows.length > 0}
              tab={tab}
              filtered={JSON.stringify(filters) !== JSON.stringify(NO_FILTERS)}
              onClear={() => setFilters(NO_FILTERS)}
              onAdd={() => setDialog({ kind: 'add' })}
            />
          ) : view === 'table' ? (
            <Directory
              rows={pageRows}
              nowMs={nowMs}
              selectedId={selected?.id ?? null}
              ticked={ticked}
              onSelect={setSelectedId}
              onTick={(id, on) =>
                setTicked((t) => {
                  const next = new Set(t);
                  if (on) next.add(id);
                  else next.delete(id);
                  return next;
                })
              }
              onConversation={conversation}
              menuFor={rowMenu}
            />
          ) : (
            <CardsView
              rows={pageRows}
              nowMs={nowMs}
              selectedId={selected?.id ?? null}
              ticked={ticked}
              onSelect={setSelectedId}
              onTick={(id, on) =>
                setTicked((t) => {
                  const next = new Set(t);
                  if (on) next.add(id);
                  else next.delete(id);
                  return next;
                })
              }
              onConversation={conversation}
              menuFor={rowMenu}
              onRelated={(c, t) => c.primaryLeadId && openRelated(c.primaryLeadId, t)}
            />
          )}

          {shown.length > 0 && (
            <Pager
              page={onPage}
              pages={pages}
              perPage={perPage}
              total={shown.length}
              onPage={setPage}
              onPerPage={setPerPage}
            />
          )}
        </section>

        {selected ? (
          <ClientPanel
            key={selected.id}
            c={selected}
            nowMs={nowMs}
            activity={activity[selected.id]}
            onEdit={() => setDialog({ kind: 'edit', id: selected.id })}
            onConversation={() => conversation(selected)}
            onRelated={(t) => selected.primaryLeadId && openRelated(selected.primaryLeadId, t)}
            onFullRecord={() => selected.primaryLeadId && openLead(selected.primaryLeadId)}
            onArchive={() => void setArchived(selected, !selected.archivedAt)}
            onStatus={(s) => void setStatus(selected, s)}
            onViewProject={() =>
              selected.primaryProjectId && router.push(`/my-leads?project=${selected.primaryProjectId}` as Route)
            }
          />
        ) : (
          <aside className="grid place-items-center rounded-2xl border border-border-subtle bg-bg-surface p-8 text-center shadow-sm">
            <p className="text-body-sm text-text-secondary">Pick a client to see their summary.</p>
          </aside>
        )}
      </div>

      {/* ── Dialogs ────────────────────────────────────────────────────── */}
      {dialog?.kind === 'add' && (
        <ClientForm
          mode="add"
          projects={projects}
          defaultProjectId={defaultProjectId}
          viewerId={viewerId}
          viewerName={viewerName}
          onClose={() => setDialog(null)}
          onSaved={({ clientId, draft }) => {
            setDialog(null);
            /* ⚠️ IN THIS FRAME: the row, selected, on a tab and filter that
               show it — a new client hidden by the filter that was on would read
               as "it did not save". */
            if (draft) setAdded((a) => [draft, ...a.filter((x) => x.id !== draft.id)]);
            setFilters(NO_FILTERS);
            setTab('all');
            setSelectedId(clientId);
            refresh();
          }}
        />
      )}
      {dialog?.kind === 'edit' && rows.some((c) => c.id === dialog.id) && (
        <ClientForm
          mode="edit"
          client={rows.find((c) => c.id === dialog.id)!}
          projects={projects}
          viewerId={viewerId}
          viewerName={viewerName}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            refresh();
          }}
        />
      )}
      {dialog?.kind === 'import' && (
        <ImportDialog
          projects={projects}
          defaultProjectId={defaultProjectId}
          viewerId={viewerId}
          viewerName={viewerName}
          onClose={() => setDialog(null)}
          onDone={() => refresh()}
        />
      )}
      {dialog?.kind === 'lead' && (
        <LeadDetailsModal
          leadId={dialog.leadId}
          bundle={bundles[dialog.leadId] ?? null}
          fallbackName={rows.find((c) => c.leadIds.includes(dialog.leadId))?.name ?? 'Client'}
          viewerName={viewerName}
          nowMs={nowMs}
          onClose={() => setDialog(null)}
          onEdit={() => setDialog({ kind: 'edit-lead', leadId: dialog.leadId })}
          onRelated={() => setDialog({ kind: 'related', leadId: dialog.leadId, tab: 'quotations' })}
          onElsewhere={(href) => router.push(href as Route)}
        />
      )}
      {dialog?.kind === 'related' && bundles[dialog.leadId] && (
        <RelatedItemsDialog
          lead={bundles[dialog.leadId].record.lead}
          sender={bundles[dialog.leadId].related.sender}
          seed={seedRelated(bundles[dialog.leadId].record.lead, bundles[dialog.leadId].related)}
          initialTab={dialog.tab}
          onClose={() => setDialog(null)}
          onChooseUnit={() => setDialog(null)}
          onRecordOutcome={() => setDialog({ kind: 'lead', leadId: dialog.leadId })}
          onAttach={() => {
            setDialog(null);
            toast({ tone: 'ok', text: 'Opening the conversation — attach and send it from there.' });
            router.push(`/conversations?lead=${dialog.leadId}` as Route);
          }}
        />
      )}
      {dialog?.kind === 'related' && !bundles[dialog.leadId] && <Opening onClose={() => setDialog(null)} />}
      {dialog?.kind === 'edit-lead' && bundles[dialog.leadId] && (
        <EditLeadDetails lead={bundles[dialog.leadId].record.lead} onClose={() => setDialog({ kind: 'lead', leadId: dialog.leadId })} />
      )}
    </div>
  );
}

/* ── The five tiles ──────────────────────────────────────────────────────── */

function Tile({
  label,
  value,
  tone,
  icon: Icon,
  delta,
  caption,
  alarm = false,
}: {
  label: string;
  value: string;
  tone: 'blue' | 'green' | 'red' | 'amber';
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  delta: number | null;
  caption: string;
  alarm?: boolean;
}) {
  const up = (delta ?? 0) >= 0;
  return (
    <div className="flex items-start gap-3.5 rounded-2xl border border-border-subtle bg-bg-surface px-4 py-4 shadow-sm">
      <span className="grid size-11 shrink-0 place-items-center rounded-xl" style={{ background: tint(tone, 14) }}>
        <Icon className="size-5" style={{ color: ink(tone) }} />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-body-sm text-text-secondary">{label}</span>
        <span
          className="block truncate text-[1.6rem] font-bold leading-tight tabular-nums text-text-primary"
          style={alarm && value !== '0' ? { color: ink('red') } : undefined}
        >
          {value}
        </span>
        <span className="mt-0.5 flex items-center gap-1 text-caption text-text-secondary">
          {delta !== null && (
            <span className="inline-flex items-center gap-0.5 font-semibold" style={{ color: ink(up ? 'green' : 'red') }}>
              {up ? <ArrowUpRight className="size-3.5" aria-hidden="true" /> : <ArrowDownRight className="size-3.5" aria-hidden="true" />}
              {up ? '+' : ''}
              {delta}%
            </span>
          )}
          <span className="truncate">{caption}</span>
        </span>
      </span>
    </div>
  );
}

/* ── The table ───────────────────────────────────────────────────────────── */

/* ⚠️ MEASURED, NOT GUESSED: at 32rem for the preview the Actions column was
   cut off at 1512px. The panel is 27rem now and these columns fit beside it. */
const COLS = '1.25rem minmax(0,1.45fr) minmax(0,1.3fr) minmax(0,0.9fr) minmax(0,0.85fr) minmax(0,0.95fr) minmax(0,0.7fr) minmax(0,0.95fr) 6.25rem';

function Directory({
  rows,
  nowMs,
  selectedId,
  ticked,
  onSelect,
  onTick,
  onConversation,
  menuFor,
}: {
  rows: readonly ClientRow[];
  nowMs: number;
  selectedId: string | null;
  ticked: ReadonlySet<string>;
  onSelect: (id: string) => void;
  onTick: (id: string, on: boolean) => void;
  onConversation: (c: ClientRow) => void;
  menuFor: (c: ClientRow) => ReadonlyArray<{ label: string; onSelect: () => void; danger?: boolean }>;
}) {
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[50rem]">
        <div
          className="grid items-center gap-2.5 border-y border-border-subtle bg-bg-subtle/40 px-4 py-2.5 text-caption font-semibold text-text-secondary"
          style={{ gridTemplateColumns: COLS }}
        >
          <span />
          <span>Client / company</span>
          <span>Contact</span>
          <span>Linked project</span>
          <span>Owner</span>
          <span>Relationship</span>
          <span>Value</span>
          <span>Next action</span>
          <span className="text-right">Actions</span>
        </div>
        {rows.map((c) => {
          const on = c.id === selectedId;
          const next = nextLine(c, nowMs);
          const value = valueOf(c);
          return (
            <div
              key={c.id}
              role="button"
              tabIndex={0}
              aria-pressed={on}
              onClick={(e) => {
                if ((e.target as HTMLElement).closest('a, button, input, [role="menu"]')) return;
                onSelect(c.id);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && e.target === e.currentTarget) onSelect(c.id);
              }}
              className={cn(
                'grid cursor-pointer items-center gap-2.5 border-b border-l-[3px] border-b-border-subtle px-4 py-3 transition-colors',
                on ? 'border-l-accent-primary' : 'border-l-transparent hover:bg-bg-subtle/60',
              )}
              style={{ gridTemplateColumns: COLS, background: on ? tint('blue', 6) : undefined }}
            >
              <input
                type="checkbox"
                aria-label={`Tick ${c.name}`}
                checked={ticked.has(c.id)}
                onChange={(e) => onTick(c.id, e.target.checked)}
                className="size-4"
              />
              <span className="flex min-w-0 items-center gap-2.5">
                <Avatar id={c.id} name={c.name} />
                <span className="min-w-0">
                  <span className="block truncate text-body-sm font-semibold text-text-primary">{c.name}</span>
                  <span className="block truncate text-caption text-text-secondary">
                    {[c.company, c.city].filter(Boolean).join(', ') || '—'}
                  </span>
                </span>
              </span>
              <span className="min-w-0 space-y-0.5">
                <span className="flex min-w-0 items-center gap-1.5 text-caption text-text-primary">
                  {c.preferredChannel === 'whatsapp' ? (
                    <span style={{ color: WA_GREEN }}>
                      <WhatsAppMark className="size-3.5 shrink-0" />
                    </span>
                  ) : (
                    <Phone className="size-3.5 shrink-0 text-text-secondary" aria-hidden="true" />
                  )}
                  <span className="truncate">{phoneLabel(c.phoneE164)}</span>
                </span>
                <span className="flex min-w-0 items-center gap-1.5 text-caption text-text-secondary">
                  <Mail className="size-3.5 shrink-0" aria-hidden="true" />
                  <span className="truncate">{c.email ?? '—'}</span>
                </span>
              </span>
              <span className="min-w-0 truncate text-body-sm text-text-primary" title={c.projectNames.join(', ')}>
                {c.primaryProjectName ?? '—'}
                {c.projectNames.length > 1 && <span className="text-caption text-text-secondary"> +{c.projectNames.length - 1}</span>}
              </span>
              <span className="flex min-w-0 items-center gap-2">
                {c.ownerId && c.ownerName ? (
                  <>
                    <Avatar id={c.ownerId} name={c.ownerName} size="sm" />
                    <span className="truncate text-body-sm text-text-primary">{c.ownerName}</span>
                  </>
                ) : (
                  <span className="text-body-sm text-text-tertiary">Nobody</span>
                )}
              </span>
              <span className="min-w-0">
                <StatusChip c={c} nowMs={nowMs} />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-body-sm font-semibold text-text-primary">
                  {value.kind === 'none' ? '—' : money(value.amount)}
                </span>
                {value.kind === 'quoted' && <span className="block text-caption text-text-secondary">quoted</span>}
              </span>
              <span className="min-w-0">
                <span
                  className="block truncate text-caption font-medium"
                  style={{ color: next.tone === 'grey' ? 'var(--text-primary)' : ink(next.tone === 'amber' ? 'amber' : 'red') }}
                >
                  {next.text}
                  {next.when ? ' ·' : ''}
                </span>
                {next.when && <span className="block truncate text-caption text-text-secondary">{next.when}</span>}
              </span>
              <span className="flex items-center justify-end gap-1">
                <button
                  type="button"
                  aria-label={`Preview ${c.name}`}
                  onClick={() => onSelect(c.id)}
                  className="grid size-7 place-items-center rounded-lg border border-border-default text-text-secondary hover:bg-bg-subtle"
                >
                  <Eye className="size-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label={`Open the conversation with ${c.name}`}
                  disabled={!c.primaryLeadId}
                  onClick={() => onConversation(c)}
                  className="grid size-7 place-items-center rounded-lg border border-border-default text-text-secondary hover:bg-bg-subtle disabled:opacity-40"
                >
                  <MessageSquare className="size-4" aria-hidden="true" />
                </button>
                <RowMenu items={menuFor(c)} label={`More for ${c.name}`} />
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── The cards view — the owner's second design ──────────────────────────── */

function CardsView({
  rows,
  nowMs,
  selectedId,
  ticked,
  onSelect,
  onTick,
  onConversation,
  menuFor,
  onRelated,
}: {
  rows: readonly ClientRow[];
  nowMs: number;
  selectedId: string | null;
  ticked: ReadonlySet<string>;
  onSelect: (id: string) => void;
  onTick: (id: string, on: boolean) => void;
  onConversation: (c: ClientRow) => void;
  menuFor: (c: ClientRow) => ReadonlyArray<{ label: string; onSelect: () => void; danger?: boolean }>;
  onRelated: (c: ClientRow, tab: RelatedTab) => void;
}) {
  return (
    <div className="grid gap-3 px-5 sm:grid-cols-2">
      {rows.map((c) => {
        const on = c.id === selectedId;
        const next = nextLine(c, nowMs);
        const value = valueOf(c);
        /* The three counts that say most about this client, in the design's
           spirit: what they have been sent, what they hold, what they owe. */
        const counts = (
          [
            ['Quotes', c.quotations, 'quotations'],
            ['Properties', c.properties, 'properties'],
            ['Invoices', c.invoices, 'invoices'],
            ['Appointments', c.appointments, 'appointments'],
            ['Bookings', c.bookings, 'bookings'],
          ] as const
        )
          .filter(([, n]) => n > 0)
          .slice(0, 3);
        return (
          <div
            key={c.id}
            role="button"
            tabIndex={0}
            aria-pressed={on}
            onClick={(e) => {
              if ((e.target as HTMLElement).closest('a, button, input, [role="menu"]')) return;
              onSelect(c.id);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && e.target === e.currentTarget) onSelect(c.id);
            }}
            className={cn(
              'min-w-0 cursor-pointer rounded-2xl border-2 p-3.5 transition-colors',
              on ? 'border-accent-primary' : 'border-border-subtle hover:border-border-default',
            )}
            style={on ? { background: tint('blue', 6) } : undefined}
          >
            <div className="flex items-start gap-2.5">
              <input
                type="checkbox"
                aria-label={`Tick ${c.name}`}
                checked={ticked.has(c.id)}
                onChange={(e) => onTick(c.id, e.target.checked)}
                className="mt-1 size-4"
              />
              <Avatar id={c.id} name={c.name} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body-sm font-semibold text-text-primary">{c.name}</span>
                <span className="block truncate text-caption text-text-secondary">
                  {[c.company ?? c.primaryProjectName, c.city].filter(Boolean).join(', ') || '—'}
                </span>
              </span>
              <StatusChip c={c} nowMs={nowMs} />
              <RowMenu items={menuFor(c)} label={`More for ${c.name}`} />
            </div>

            <div className="mt-2.5 flex items-center gap-2">
              <Phone className="size-3.5 shrink-0 text-text-secondary" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate text-caption text-text-primary">{phoneLabel(c.phoneE164)}</span>
              {c.primaryLeadId && (
                <button
                  type="button"
                  aria-label={`WhatsApp ${c.name}`}
                  onClick={() => onConversation(c)}
                  className="grid size-8 place-items-center rounded-lg border border-border-default hover:bg-bg-subtle"
                >
                  <span style={{ color: WA_GREEN }}>
                    <WhatsAppMark className="size-4" />
                  </span>
                </button>
              )}
              {c.phoneE164 && (
                <a
                  href={`tel:${c.phoneE164}`}
                  aria-label={`Call ${c.name}`}
                  className="grid size-8 place-items-center rounded-lg border border-border-default text-text-secondary hover:bg-bg-subtle"
                >
                  <Phone className="size-4" aria-hidden="true" />
                </a>
              )}
              {c.email && (
                <a
                  href={`mailto:${c.email}`}
                  aria-label={`Email ${c.name}`}
                  className="grid size-8 place-items-center rounded-lg border border-border-default text-text-secondary hover:bg-bg-subtle"
                >
                  <Mail className="size-4" aria-hidden="true" />
                </a>
              )}
            </div>

            <div className="mt-2.5 grid grid-cols-2 gap-2 border-t border-border-subtle pt-2.5 text-caption">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="text-text-secondary">Owner</span>
                {c.ownerId && c.ownerName ? (
                  <>
                    <Avatar id={c.ownerId} name={c.ownerName} size="sm" />
                    <span className="truncate text-text-primary">{c.ownerName}</span>
                  </>
                ) : (
                  <span className="text-text-tertiary">Nobody</span>
                )}
              </span>
              <span className="flex min-w-0 items-center justify-end gap-1.5">
                <span className="text-text-secondary">Value</span>
                <span className="truncate font-semibold text-text-primary">
                  {value.kind === 'none' ? '—' : `${money(value.amount)}${value.kind === 'quoted' ? ' quoted' : ''}`}
                </span>
              </span>
            </div>

            <p
              className="mt-2 flex items-center gap-1.5 text-caption font-medium"
              style={{ color: next.tone === 'grey' ? 'var(--text-primary)' : ink(next.tone === 'amber' ? 'amber' : 'red') }}
            >
              <ChevronRight className="size-3.5 shrink-0 text-text-tertiary" aria-hidden="true" />
              {next.text}
              {next.when ? ` · ${next.when}` : ''}
            </p>

            <div className="mt-2.5 flex items-center gap-3 border-t border-border-subtle pt-2.5">
              {counts.length === 0 ? (
                <span className="flex-1 text-caption text-text-tertiary">No related records yet</span>
              ) : (
                counts.map(([label, n, t]) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => onRelated(c, t)}
                    className="min-w-0 text-left hover:underline"
                  >
                    <span className="block text-caption text-text-secondary">{label}</span>
                    <span className="block text-body-sm font-semibold text-text-primary">{n}</span>
                  </button>
                ))
              )}
              <span className="flex-1" />
              <button
                type="button"
                onClick={() => onSelect(c.id)}
                className="shrink-0 text-caption font-semibold text-text-brand hover:underline"
              >
                View →
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── Menus ───────────────────────────────────────────────────────────────── */

function usePopover() {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  return { open, setOpen, ref };
}

const MENU_ITEM = 'block w-full px-3 py-2 text-left text-body-sm text-text-primary hover:bg-bg-subtle';

function ImportMenu({ onImport, onExport, onTemplate }: { onImport: () => void; onExport: () => void; onTemplate: () => void }) {
  const { open, setOpen, ref } = usePopover();
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-2 rounded-xl border border-border-default bg-bg-surface px-4 py-2.5 text-body-sm font-semibold text-text-primary transition-colors hover:bg-bg-subtle"
      >
        Import clients <ChevronDown className="size-4" aria-hidden="true" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-1.5 w-60 overflow-hidden rounded-xl border border-border-subtle bg-bg-surface py-1 shadow-lg">
          <button type="button" className={MENU_ITEM} onClick={() => { setOpen(false); onImport(); }}>
            <FileSpreadsheet className="mr-2 inline size-4 text-text-secondary" aria-hidden="true" /> From CSV or Excel…
          </button>
          <button type="button" className={MENU_ITEM} onClick={() => { setOpen(false); onTemplate(); }}>
            Download a blank template
          </button>
          <button type="button" className={MENU_ITEM} onClick={() => { setOpen(false); onExport(); }}>
            Export what is shown
          </button>
        </div>
      )}
    </div>
  );
}

function MoreFilters({
  filters,
  cities,
  onChange,
}: {
  filters: Filters;
  cities: readonly string[];
  onChange: (p: Partial<Filters>) => void;
}) {
  const { open, setOpen, ref } = usePopover();
  const n = moreFilterCount(filters);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={cn(
          'inline-flex h-9 items-center gap-2 rounded-xl border px-3.5 text-body-sm font-semibold transition-colors hover:bg-bg-subtle',
          n ? 'border-accent-primary text-accent-primary' : 'border-border-default text-text-primary',
        )}
      >
        <Filter className="size-4" aria-hidden="true" /> More filters{n ? ` · ${n}` : ''}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-1.5 w-72 space-y-3 rounded-xl border border-border-subtle bg-bg-surface p-3 shadow-lg">
          <label className="block">
            <span className="mb-1 block text-caption font-semibold text-text-secondary">Source</span>
            <select value={filters.source} onChange={(e) => onChange({ source: e.target.value })} className={cn(CONTROL, 'w-full px-2.5')}>
              <option value="all">Any source</option>
              {SOURCE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-caption font-semibold text-text-secondary">Preferred channel</span>
            <select value={filters.channel} onChange={(e) => onChange({ channel: e.target.value })} className={cn(CONTROL, 'w-full px-2.5')}>
              <option value="all">Any channel</option>
              {Object.entries(CHANNEL_LABEL).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-caption font-semibold text-text-secondary">City</span>
            <select value={filters.city} onChange={(e) => onChange({ city: e.target.value })} className={cn(CONTROL, 'w-full px-2.5')}>
              <option value="all">Any city</option>
              {cities.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-caption font-semibold text-text-secondary">Not contacted for</span>
            <select value={filters.quietDays} onChange={(e) => onChange({ quietDays: Number(e.target.value) })} className={cn(CONTROL, 'w-full px-2.5')}>
              <option value={0}>Any time</option>
              <option value={7}>7 days or more</option>
              <option value={30}>30 days or more</option>
              <option value={45}>45 days or more</option>
              <option value={90}>90 days or more</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-body-sm text-text-primary">
            <input type="checkbox" checked={filters.unpaidOnly} onChange={(e) => onChange({ unpaidOnly: e.target.checked })} />
            Only clients with an unpaid invoice
          </label>
          <div className="flex justify-between border-t border-border-subtle pt-2.5">
            <button
              type="button"
              onClick={() => onChange({ source: 'all', channel: 'all', city: 'all', unpaidOnly: false, quietDays: 0 })}
              className="text-caption font-semibold text-text-secondary hover:text-text-primary"
            >
              Clear these
            </button>
            <button type="button" onClick={() => setOpen(false)} className="text-caption font-semibold text-text-brand hover:underline">
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function BulkMenu({
  count,
  owners,
  onStatus,
  onOwner,
  onArchive,
  onExport,
  onClear,
}: {
  count: number;
  owners: ReadonlyArray<[string, string]>;
  onStatus: (s: StoredStatus) => void;
  onOwner: (id: string, name: string) => void;
  onArchive: (archive: boolean) => void;
  onExport: () => void;
  onClear: () => void;
}) {
  const { open, setOpen, ref } = usePopover();
  const run = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={count === 0}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border-default px-3 text-caption font-semibold text-text-primary transition-colors hover:bg-bg-subtle disabled:opacity-40"
      >
        Bulk actions{count ? ` · ${count}` : ''} <ChevronDown className="size-3.5" aria-hidden="true" />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-40 mt-1.5 w-64 overflow-hidden rounded-xl border border-border-subtle bg-bg-surface py-1 shadow-lg">
          <p className="px-3 pb-1 pt-1.5 text-caption font-semibold text-text-tertiary">Set status</p>
          {STORED_STATUS_OPTIONS.map((o) => (
            <button key={o.value} type="button" className={MENU_ITEM} onClick={run(() => onStatus(o.value))}>
              {o.label}
            </button>
          ))}
          {owners.length > 0 && (
            <>
              <p className="border-t border-border-subtle px-3 pb-1 pt-2 text-caption font-semibold text-text-tertiary">
                Give to (managers only)
              </p>
              {owners.map(([id, name]) => (
                <button key={id} type="button" className={MENU_ITEM} onClick={run(() => onOwner(id, name))}>
                  {name}
                </button>
              ))}
            </>
          )}
          <div className="border-t border-border-subtle">
            <button type="button" className={MENU_ITEM} onClick={run(onExport)}>Export ticked</button>
            <button type="button" className={MENU_ITEM} onClick={run(() => onArchive(true))} style={{ color: ink('red') }}>
              Archive ticked
            </button>
            <button type="button" className={MENU_ITEM} onClick={run(() => onArchive(false))}>Restore ticked</button>
            <button type="button" className={MENU_ITEM} onClick={run(onClear)}>Clear the ticks</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Paging, empty, opening ──────────────────────────────────────────────── */

function Pager({
  page,
  pages,
  perPage,
  total,
  onPage,
  onPerPage,
}: {
  page: number;
  pages: number;
  perPage: number;
  total: number;
  onPage: (n: number) => void;
  onPerPage: (n: number) => void;
}) {
  const nums: number[] = [];
  const push = (n: number) => {
    if (n >= 0 && n < pages && !nums.includes(n)) nums.push(n);
  };
  push(0);
  for (let d = -2; d <= 2; d += 1) push(page + d);
  push(pages - 1);
  nums.sort((a, b) => a - b);
  const step = 'grid size-8 place-items-center rounded-lg border border-border-default text-text-primary transition-colors hover:bg-bg-subtle disabled:opacity-40';
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-border-subtle px-5 pt-3">
      <p className="min-w-0 flex-1 text-caption text-text-secondary">
        {page * perPage + 1}–{Math.min(total, page * perPage + perPage)} of {total}
      </p>
      <button type="button" aria-label="Previous page" disabled={page === 0} onClick={() => onPage(page - 1)} className={step}>
        <ChevronLeft className="size-4" aria-hidden="true" />
      </button>
      {nums.map((n, i) => (
        <React.Fragment key={n}>
          {i > 0 && n - nums[i - 1] > 1 && <span className="text-caption text-text-tertiary">…</span>}
          <button
            type="button"
            aria-current={n === page ? 'page' : undefined}
            onClick={() => onPage(n)}
            className={cn(
              'grid size-8 place-items-center rounded-lg text-body-sm font-semibold transition-colors',
              n === page ? 'bg-accent-primary text-white' : 'border border-border-default text-text-primary hover:bg-bg-subtle',
            )}
          >
            {n + 1}
          </button>
        </React.Fragment>
      ))}
      <button type="button" aria-label="Next page" disabled={page >= pages - 1} onClick={() => onPage(page + 1)} className={step}>
        <ChevronRight className="size-4" aria-hidden="true" />
      </button>
      <label className="ml-2 flex items-center gap-2 text-caption text-text-secondary">
        Show
        <select value={perPage} onChange={(e) => onPerPage(Number(e.target.value))} className={cn(CONTROL, 'h-8 w-[4.5rem] px-2')}>
          {[10, 25, 50, 100].map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
        per page
      </label>
    </div>
  );
}

function Empty({
  anyAtAll,
  tab,
  filtered,
  onClear,
  onAdd,
}: {
  anyAtAll: boolean;
  tab: TabKey;
  filtered: boolean;
  onClear: () => void;
  onAdd: () => void;
}) {
  const line = !anyAtAll
    ? 'No clients yet.'
    : filtered
      ? 'No client matches these filters.'
      : tab === 'attention'
        ? 'Nobody needs attention — nothing is overdue and nobody is waiting on you.'
        : tab === 'archived'
          ? 'Nothing is archived.'
          : 'Nobody in this group right now.';
  return (
    <div className="grid place-items-center px-5 py-14 text-center">
      <Users className="size-8 text-text-tertiary" aria-hidden="true" />
      <p className="mt-2 text-body-sm font-medium text-text-primary">{line}</p>
      <p className="mt-0.5 max-w-sm text-caption text-text-secondary">
        A client is somebody we have a relationship with — a lead who bought, or somebody you add here by hand.
      </p>
      <div className="mt-3 flex gap-2">
        {filtered && (
          <button type="button" onClick={onClear} className="rounded-xl border border-border-default px-3.5 py-2 text-body-sm font-medium text-text-primary hover:bg-bg-subtle">
            Clear the filters
          </button>
        )}
        <button type="button" onClick={onAdd} className="rounded-xl bg-accent-primary px-3.5 py-2 text-body-sm font-semibold text-white hover:opacity-90">
          Add client
        </button>
      </div>
    </div>
  );
}

function Opening({ onClose }: { onClose: () => void }) {
  React.useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[70] flex justify-center">
      <p className="pointer-events-auto rounded-xl bg-bg-surface px-4 py-2.5 text-body-sm text-text-secondary shadow-xl">
        Opening the related items…
      </p>
    </div>
  );
}
