'use client';

import * as React from 'react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  CalendarDays,
  ChartNoAxesColumnIncreasing,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Database,
  Download,
  Eye,
  FileSpreadsheet,
  FileText,
  Filter,
  Home,
  KeyRound,
  Mail,
  MessageSquareText,
  NotebookTabs,
  Phone,
  Plus,
  Receipt,
  Search,
  Table2,
  TriangleAlert,
  Upload,
  UserPlus,
  Users,
} from 'lucide-react';

import { bulkClientAction, clientActivityAction, exportClientsPdfAction, updateClientAction } from '@/app/actions/crm-client-board';
import { leadBundlesAction } from '@/app/actions/crm-lead-bundles';
import { ClientForm, downloadBlob, ImportDialog } from '@/components/crm/client-dialogs';
import { ClientPanel } from '@/components/crm/client-panel';
import {
  Avatar,
  cv,
  IconTile,
  Kebab,
  MENU,
  MENU_ITEM,
  OUTLINE,
  outlineStyle,
  Select,
  SOLID,
  solidStyle,
  Square,
  StatusChip,
  usePopover,
  type MenuItem,
} from '@/components/crm/clients-ui';
import { EditLeadDetails } from '@/components/crm/edit-lead-details';
import { LeadDetailsModal } from '@/components/crm/lead-details-modal';
import { RelatedItemsDialog, seedRelated, type TabKey as RelatedTab } from '@/components/crm/related-items';
import { WhatsAppMark } from '@/components/crm/whatsapp-mark';
import { useToast } from '@/components/ui/toast';
import type { ClientMoment, ClientRow } from '@/lib/db/queries/crm-client-board';
import type { CrmLeadBundle } from '@/lib/db/queries/crm-leads';
import {
  applyFilters,
  cards as cardsOf,
  CHANNEL_LABEL,
  exportTable,
  IMPORT_TEMPLATE_HEADER,
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
import { writeXlsx } from '@/lib/view/xlsx-write';
import { cn } from '@/lib/utils';

/* ============================================================================
 * CLIENTS — the owner's design, 2026-09-22
 * ----------------------------------------------------------------------------
 * *"Please create this page accordingly and make sure everything is properly
 * working … Make sure they are isolated and will not break any other working
 * thing."* And, of the first build: *"If I'm saying that I need the exact same
 * UI, it means you have to put each color, each icon, each styling, and
 * everything the same."*
 *
 * ── ⚠️ RULE ZERO ───────────────────────────────────────────────────────────
 * One query. Cards, tabs, filters, table, cards view, paging, selection and
 * the preview are client state over it; only a write reaches the server, and
 * each write moves its row in its own frame before the page catches up.
 *
 * ── ⚠️ THE DIRECTORY IS AS TALL AS THE PREVIEW ────────────────────────────
 * Owner: *"they have a fixed height … equal to the right side of the card."*
 * The directory is taken out of the row's height (absolute, inset 0, at xl)
 * so the preview alone decides it, and the rows scroll inside under a header
 * that stays put. Every row is one fixed height, as in the design.
 *
 * ── ⚠️ ISOLATED ────────────────────────────────────────────────────────────
 * Its own reader and writers (249), its own rules file, its own parts
 * (clients-ui.tsx) and palette (`.clients-ui` in tokens.css). What it reuses —
 * the lead modal, Related items, the lead bundles — it calls exactly as the
 * Appointments and Follow-ups pages already do.
 * ========================================================================= */

type Dialog =
  | { kind: 'add' }
  | { kind: 'edit'; id: string }
  | { kind: 'import' }
  | { kind: 'lead'; leadId: string }
  | { kind: 'related'; leadId: string; tab: RelatedTab }
  | { kind: 'edit-lead'; leadId: string }
  | null;

type Format = 'xlsx' | 'csv' | 'pdf';

const CHECK = 'size-[1.15rem] shrink-0 cursor-pointer rounded-[0.25rem]';
const checkStyle = { accentColor: 'var(--cl-brand)' } as const;

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
  /* ⚠️ A COLUMN THAT SAYS THE SAME NAME ON EVERY ROW IS NOT A COLUMN.
     Owner, 2026-09-22: *"it's Sarah's dashboard … obviously these are all clients
     of Sarah so here this column can be excluded. Definitely in the salespersons'
     or executive sales role … maybe this column will be valuable because there
     will be a lot of salespeople."*

     So it is not a role check — it is what is actually on the screen. A
     salesperson sees only their own clients, so the column goes and its width is
     given to the email; a manager or admin sees several owners and keeps it.
     Sarah being given a second person's client brings the column back by
     itself. */
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

  const soloOwner = ownerOptions.length <= 1 && ownerOptions.every(([id]) => id === viewerId);

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
  const tick = (id: string, on: boolean) =>
    setTicked((t) => {
      const next = new Set(t);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

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

  /* ── Export: Excel and CSV are built here; the PDF on the server ──────
     ⚠️ THE PDF CARRIES THE COMPANY LETTERHEAD, which only the server can read
     (system_settings), so it is the one format that makes a round trip — and
     the screen says so in the frame it was asked for. */
  const scopeWords = React.useMemo(() => {
    const parts: string[] = [TABS.find((t) => t.key === tab)?.label ?? 'All clients'];
    if (filters.project !== 'all') parts.push(filters.project);
    if (filters.owner !== 'all') parts.push(`Owner: ${ownerOptions.find(([id]) => id === filters.owner)?.[1] ?? 'one person'}`);
    if (filters.status !== 'all') parts.push(STATUS_LOOK[filters.status].label);
    if (filters.q.trim()) parts.push(`"${filters.q.trim()}"`);
    const more = moreFilterCount(filters);
    if (more) parts.push(`${more} more filter${more === 1 ? '' : 's'}`);
    return parts.join(' · ');
  }, [tab, filters, ownerOptions]);

  const [pdfBusy, setPdfBusy] = React.useState(false);
  const exportRows = async (list: readonly ClientRow[], format: Format, scope: string) => {
    if (!list.length) {
      toast({ tone: 'error', text: 'Nothing to export — the filters show no clients.' });
      return;
    }
    const stem = `clients-${karachiDay(nowMs)}`;
    const n = `${list.length} client${list.length === 1 ? '' : 's'}`;
    if (format === 'csv') {
      downloadBlob(`${stem}.csv`, toCsv(list, nowMs), 'text/csv;charset=utf-8');
      toast({ tone: 'ok', text: `Exported ${n} as CSV.` });
      return;
    }
    if (format === 'xlsx') {
      const t = exportTable(list, nowMs);
      downloadBlob(`${stem}.xlsx`, writeXlsx({ name: 'Clients', ...t }), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      toast({ tone: 'ok', text: `Exported ${n} as an Excel workbook.` });
      return;
    }
    setPdfBusy(true);
    toast({ tone: 'ok', text: `Preparing the PDF of ${n}…` });
    const r = await exportClientsPdfAction(
      list.map((c) => c.id),
      scope,
    );
    setPdfBusy(false);
    if (!r.ok) {
      toast({ tone: 'error', text: r.error });
      return;
    }
    const bin = atob(r.base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    downloadBlob(`${stem}.pdf`, bytes, 'application/pdf');
    toast({ tone: 'ok', text: `Exported ${r.count} client${r.count === 1 ? '' : 's'} as a PDF.` });
  };

  const template = () =>
    downloadBlob(
      'clients-template.xlsx',
      writeXlsx({ name: 'Clients', header: [...IMPORT_TEMPLATE_HEADER], rows: [], widths: [22, 18, 26, 22, 14, 14, 12, 18, 30] }),
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );

  const conversation = (c: ClientRow) => {
    if (c.primaryLeadId) router.push(`/conversations?lead=${c.primaryLeadId}` as Route);
  };

  const rowMenu = (c: ClientRow): MenuItem[] => [
    ...(c.primaryLeadId ? [{ label: 'View full record', onSelect: () => openLead(c.primaryLeadId!) }] : []),
    ...(c.primaryLeadId ? [{ label: 'Open related items', onSelect: () => openRelated(c.primaryLeadId!, 'quotations') }] : []),
    ...(c.primaryLeadId ? [{ label: 'Open the conversation', onSelect: () => conversation(c) }] : []),
    { label: 'Edit client', onSelect: () => setDialog({ kind: 'edit', id: c.id }) },
    { label: c.archivedAt ? 'Restore from archive' : 'Archive client', onSelect: () => void setArchived(c, !c.archivedAt), danger: !c.archivedAt },
  ];

  return (
    <div className="clients-ui mx-auto max-w-[var(--content-max)] space-y-[0.75rem]">
      {/* ── Title and the two actions ──────────────────────────────────── */}
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[1.66rem] font-bold leading-tight tracking-[-0.01em]" style={{ color: cv('ink') }}>
            Clients
          </h1>
          <p className="text-[0.95rem]" style={{ color: cv('soft') }}>
            Manage client relationships, projects, communication and sales records.
          </p>
        </div>
        <div className="flex items-center gap-[0.75rem]">
          <ImportMenu onImport={() => setDialog({ kind: 'import' })} onTemplate={template} />
          <button
            type="button"
            onClick={() => setDialog({ kind: 'add' })}
            disabled={projects.length === 0}
            title={projects.length === 0 ? 'No project is open to you for adding clients.' : undefined}
            className={`${SOLID} h-[2.65rem] min-w-[10.1rem] px-5 text-[0.97rem]`}
            style={solidStyle}
          >
            <Plus className="size-[1.3rem]" aria-hidden="true" /> Add client
          </button>
        </div>
      </header>

      {/* ── Five cards — still, white, colour in the icon only ─────────────
          The same treatment the owner asked for on Follow-ups: these report,
          they do not filter. The tabs below are what filters. */}
      <div className="grid grid-cols-2 gap-[0.7rem] lg:grid-cols-5">
        <Tile label="Total clients" value={String(card.total.value)} icon={Users} bg="teal-soft" ink="teal-strong" delta={card.total.delta} caption={card.total.caption} />
        <Tile
          label="Active"
          value={String(card.active.value)}
          icon={ChartNoAxesColumnIncreasing}
          bg="teal-soft"
          ink="brand"
          delta={card.active.delta}
          caption={card.active.caption}
          heavy
        />
        <Tile label="New this month" value={String(card.fresh.value)} icon={UserPlus} bg="blue-soft" ink="blue-strong" delta={card.fresh.delta} caption={card.fresh.caption} />
        <Tile
          label="Needs attention"
          value={String(card.attention.value)}
          icon={TriangleAlert}
          bg="red-soft"
          ink="red-strong"
          delta={card.attention.delta}
          caption={card.attention.caption}
          alarm
        />
        <Tile label="Outstanding" value={money(card.outstanding.value)} icon={Database} bg="amber-soft" ink="amber-strong" delta={card.outstanding.delta} caption={card.outstanding.caption} />
      </div>

      {/* ── Tabs, and table / cards ────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-end border-b" style={{ borderColor: cv('line') }} role="tablist" aria-label="Which clients">
          {TABS.map((t) => {
            const on = tab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setTab(t.key)}
                className={cn('-mb-px inline-flex h-[3rem] items-center gap-[0.55rem] px-[1.35rem] transition-colors', on ? 'text-[0.97rem] font-semibold' : 'text-[0.87rem] font-normal')}
                /* The bar is an inline token — a class lost to the global border
                   colour on /follow-ups (measured), and 3.5px lands on 3 device
                   pixels under the app's 0.9 zoom, as the design's bar is. */
                style={{
                  color: on ? cv('ink') : cv('soft'),
                  borderBottomStyle: 'solid',
                  borderBottomWidth: '3.5px',
                  borderBottomColor: on ? 'var(--cl-brand)' : 'transparent',
                }}
              >
                {t.label}
                {t.key !== 'all' && t.key !== 'archived' && (
                  <span className="grid h-[1.6rem] min-w-[1.6rem] place-items-center rounded-full px-[0.5rem] text-[0.8rem]" style={{ background: cv('pill'), color: cv('soft') }}>
                    {tabCount[t.key]}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div className="inline-flex rounded-[0.55rem] border p-[0.25rem]" style={{ borderColor: cv('line'), background: cv('surface') }} role="tablist" aria-label="View">
          {(
            [
              ['table', 'Table', Table2],
              ['cards', 'Cards', NotebookTabs],
            ] as const
          ).map(([v, label, Icon]) => {
            const on = view === v;
            return (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setView(v)}
                className="inline-flex h-[2.3rem] min-w-[7.9rem] items-center justify-center gap-2 rounded-[0.42rem] text-[0.93rem] font-medium transition-colors"
                style={on ? { background: cv('brand'), color: cv('on-brand') } : { color: cv('ink') }}
              >
                <Icon className="size-[1.2rem]" aria-hidden="true" /> {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Filters — flat boxes, small corners, one row ──────────────── */}
      <div className="flex flex-wrap items-center gap-[0.75rem]">
        <label
          className="flex h-[2.65rem] min-w-[16rem] flex-1 items-center gap-[0.7rem] rounded-[0.45rem] border px-[0.95rem]"
          style={{ borderColor: cv('line'), background: cv('surface') }}
        >
          <Search className="size-[1.3rem] shrink-0" style={{ color: cv('soft') }} aria-hidden="true" />
          <input
            value={filters.q}
            onChange={(e) => set({ q: e.target.value })}
            placeholder="Search client, company, phone or email..."
            aria-label="Search client, company, phone or email"
            className="min-w-0 flex-1 bg-transparent text-[0.85rem] placeholder:text-[var(--cl-soft)] focus:outline-none"
            style={{ color: cv('ink') }}
          />
        </label>
        <Select label="Project" value={filters.project} onChange={(v) => set({ project: v })} className="h-[2.65rem] w-[12.2rem]">
          <option value="all">All projects</option>
          {projectOptions.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </Select>
        {!soloOwner && (
          <Select label="Account owner" value={filters.owner} onChange={(v) => set({ owner: v })} className="h-[2.65rem] w-[12.2rem]">
            <option value="all">All owners</option>
            {ownerOptions.map(([id, name]) => (
              <option key={id} value={id}>
                {id === viewerId ? `${name} (you)` : name}
              </option>
            ))}
          </Select>
        )}
        <Select label="Relationship status" value={filters.status} onChange={(v) => set({ status: v as DisplayStatus | 'all' })} className="h-[2.65rem] w-[12.2rem]">
          <option value="all">All statuses</option>
          {(['active', 'onboarding', 'prospect', 'attention', 'dormant', 'archived'] as DisplayStatus[]).map((s) => (
            <option key={s} value={s}>
              {STATUS_LOOK[s].label}
            </option>
          ))}
        </Select>
        <MoreFilters filters={filters} cities={cityOptions} onChange={set} />
        <ExportMenu busy={pdfBusy} onExport={(f) => void exportRows(shown, f, scopeWords)} />
      </div>

      {/* ── The directory and the preview — one height ─────────────────── */}
      <div className="grid gap-[0.7rem] xl:grid-cols-[minmax(0,1.47fr)_minmax(0,1fr)]">
        <div className="relative min-w-0 xl:min-h-[38rem]">
          <section
            className="flex min-w-0 flex-col overflow-hidden rounded-[0.6rem] border xl:absolute xl:inset-0"
            style={{ borderColor: cv('line'), background: cv('surface') }}
          >
            <div className="flex flex-wrap items-baseline gap-[0.9rem] px-[1rem] pt-[0.85rem]">
              <h2 className="text-[1.28rem] font-semibold" style={{ color: cv('ink') }}>
                Client directory
              </h2>
              <span className="text-[0.87rem]" style={{ color: cv('soft') }}>
                {shown.length} record{shown.length === 1 ? '' : 's'}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-[1rem] px-[1rem] pb-[0.75rem] pt-[0.6rem]">
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
                className={CHECK}
                style={checkStyle}
              />
              <BulkMenu
                count={ticked.size}
                owners={ownerOptions}
                busy={pdfBusy}
                onStatus={(s) => void bulk({ status: s })}
                onOwner={(id, name) => void bulk({ ownerId: id, name })}
                onArchive={(a) => void bulk({ archive: a })}
                onExport={(f) => void exportRows(tickedRows, f, `${tickedRows.length} ticked client${tickedRows.length === 1 ? '' : 's'}`)}
                onClear={() => setTicked(new Set())}
              />
            </div>

            <div className="min-h-0 flex-1 overflow-auto">
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
                  showOwner={!soloOwner}
                  selectedId={selected?.id ?? null}
                  ticked={ticked}
                  onSelect={setSelectedId}
                  onTick={tick}
                  onConversation={conversation}
                  menuFor={rowMenu}
                />
              ) : (
                <CardsView
                  rows={pageRows}
                  nowMs={nowMs}
                  showOwner={!soloOwner}
                  selectedId={selected?.id ?? null}
                  ticked={ticked}
                  onSelect={setSelectedId}
                  onTick={tick}
                  onConversation={conversation}
                  menuFor={rowMenu}
                  onRelated={(c, t) => c.primaryLeadId && openRelated(c.primaryLeadId, t)}
                />
              )}
            </div>

            {shown.length > 0 && (
              <Pager page={onPage} pages={pages} perPage={perPage} total={shown.length} onPage={setPage} onPerPage={setPerPage} />
            )}
          </section>
        </div>

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
            showOwner={!soloOwner}
            onArchive={() => void setArchived(selected, !selected.archivedAt)}
            onStatus={(s) => void setStatus(selected, s)}
            onViewProject={() => selected.primaryProjectId && router.push(`/my-leads?project=${selected.primaryProjectId}` as Route)}
          />
        ) : (
          <aside className="grid min-h-[20rem] place-items-center rounded-[0.6rem] border p-8 text-center" style={{ borderColor: cv('line'), background: cv('surface') }}>
            <p className="text-[0.97rem]" style={{ color: cv('soft') }}>
              Pick a client to see their summary.
            </p>
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
  icon,
  bg,
  ink,
  delta,
  caption,
  alarm = false,
  heavy = false,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties; strokeWidth?: number }>;
  bg: string;
  ink: string;
  delta: number | null;
  caption: string;
  alarm?: boolean;
  /** The bar chart reads as the design's solid bars only with a heavier stroke. */
  heavy?: boolean;
}) {
  const up = (delta ?? 0) >= 0;
  const Icon = icon;
  return (
    <div className="flex h-[7.1rem] items-start gap-[0.95rem] rounded-[0.6rem] border px-[0.8rem] pt-[0.8rem]" style={{ borderColor: cv('line'), background: cv('surface') }}>
      <span className="grid size-[3.6rem] shrink-0 place-items-center rounded-[0.55rem]" style={{ background: cv(bg) }}>
        <Icon className="size-[1.8rem]" style={{ color: cv(ink) }} strokeWidth={heavy ? 3 : 1.9} aria-hidden="true" />
      </span>
      <span className="min-w-0 pt-[0.2rem]">
        <span className="block truncate text-[0.82rem]" style={{ color: cv('soft') }}>
          {label}
        </span>
        <span
          className="block truncate text-[1.66rem] font-bold leading-[1.3] tabular-nums"
          style={{ color: alarm && value !== '0' ? cv('red-strong') : cv('brand-ink') }}
        >
          {value}
        </span>
        <span className="mt-[0.2rem] flex items-center gap-[0.3rem] text-[0.67rem]" style={{ color: cv('soft') }}>
          {delta !== null && (
            <span className="inline-flex items-center gap-[0.3rem] font-medium" style={{ color: up ? cv('green-dot') : cv('red-strong') }}>
              {up ? <ArrowUp className="size-[0.95rem]" strokeWidth={3} aria-hidden="true" /> : <ArrowDown className="size-[0.95rem]" strokeWidth={3} aria-hidden="true" />}
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

/* ⚠️ THE COLUMNS ARE A BUDGET, AND THE CONTENT SETS IT — not the reference.
   The design's own rules (x = 262 · 412 · 534 · 616 · 696 · 772 · 840 · 920 ·
   1030 → 150 · 122 · 82 · 80 · 76 · 68 · 80 px) were drawn around invented data:
   "faisal@chitralroyal…" is cut off in the PNG itself. Owner, 2026-09-22:
   *"a full quotation value, a full phone number, and a full email should be kept
   visible … each value should be displayed properly."*

   So each column was measured against the LONGEST real string it must hold
   (`fitprobe`: an email needed 169px in a 98px cell) and the 656px between the
   ticks and the actions was re-shared. Widths are the design's rhythm, moved:
   contact takes what the project and owner columns can spare. */
const COLS = 'minmax(0,150fr) minmax(0,156fr) minmax(0,72fr) minmax(0,70fr) minmax(0,72fr) minmax(0,64fr) minmax(0,66fr) 7.15rem';
/* Without the owner, its 70px go where the longest strings are. */
const COLS_SOLO = 'minmax(0,152fr) minmax(0,196fr) minmax(0,86fr) minmax(0,74fr) minmax(0,66fr) minmax(0,76fr) 7.15rem';
const CELL = 'flex h-full min-w-0 items-center overflow-hidden px-[0.4rem]';

const nextInk = (tone: string) =>
  tone === 'red' ? cv('red-strong') : tone === 'green' ? cv('green-dot') : tone === 'amber' ? cv('amber') : cv('soft');

function Directory({
  rows,
  nowMs,
  showOwner,
  selectedId,
  ticked,
  onSelect,
  onTick,
  onConversation,
  menuFor,
}: {
  rows: readonly ClientRow[];
  nowMs: number;
  showOwner: boolean;
  selectedId: string | null;
  ticked: ReadonlySet<string>;
  onSelect: (id: string) => void;
  onTick: (id: string, on: boolean) => void;
  onConversation: (c: ClientRow) => void;
  menuFor: (c: ClientRow) => MenuItem[];
}) {
  const cols = showOwner ? COLS : COLS_SOLO;
  const line = { borderColor: cv('grid') };
  return (
    <div className="min-w-[50rem]">
      <div
        className="sticky top-0 z-10 grid h-[2.36rem] items-center border-y text-[0.6rem]"
        style={{ gridTemplateColumns: cols, background: cv('head'), color: cv('soft'), borderColor: cv('grid') }}
      >
        <span className="truncate px-[0.9rem]">Client / company</span>
        <span className="truncate px-[0.5rem]">Contact</span>
        <span className="truncate px-[0.5rem]">Linked project</span>
        {showOwner && <span className="truncate px-[0.5rem]">Owner</span>}
        <span className="truncate px-[0.5rem]">Relationship</span>
        <span className="truncate px-[0.5rem]">Value</span>
        <span className="truncate px-[0.5rem]">Next action</span>
        <span className="px-[0.5rem] text-center">Actions</span>
      </div>
      {rows.map((c) => {
        const on = c.id === selectedId;
        const next = nextLine(c, nowMs);
        const value = valueOf(c);
        const cell = { borderRight: `1px solid ${cv('grid')}` };
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
            className="grid h-[5.76rem] cursor-pointer border-b transition-colors hover:bg-[var(--cl-head)]"
            style={{
              gridTemplateColumns: cols,
              ...line,
              ...(on ? { background: cv('pick'), boxShadow: `inset 0 0 0 1px ${cv('pick-line')}` } : null),
            }}
          >
            <span className={cn(CELL, 'gap-[0.35rem] pl-[0.35rem]')} style={cell}>
              <input type="checkbox" aria-label={`Tick ${c.name}`} checked={ticked.has(c.id)} onChange={(e) => onTick(c.id, e.target.checked)} className={CHECK} style={checkStyle} />
              <Avatar id={c.id} name={c.name} size="row" />
              <span className="min-w-0">
                <span className="block truncate text-[0.6rem] font-semibold" style={{ color: cv('ink') }}>
                  {c.name}
                </span>
                <span className="line-clamp-3 text-[0.53rem] leading-[1.35]" style={{ color: cv('soft') }}>
                  {[c.company ?? c.primaryProjectName, c.city].filter(Boolean).join(', ') || '—'}
                </span>
              </span>
            </span>
            <span className={cn(CELL, 'flex-col items-start justify-center gap-[0.45rem]')} style={cell}>
              <span className="flex w-full min-w-0 items-center gap-[0.35rem] text-[0.58rem]" style={{ color: cv('ink') }}>
                {c.preferredChannel === 'whatsapp' && c.phoneE164 ? (
                  <span style={{ color: cv('wa') }}>
                    <WhatsAppMark className="size-[1.05rem] shrink-0" />
                  </span>
                ) : (
                  <Phone className="size-[1.05rem] shrink-0" style={{ color: c.phoneE164 ? cv('phone') : cv('mute') }} aria-hidden="true" />
                )}
                <span className="truncate">{phoneLabel(c.phoneE164)}</span>
              </span>
              <span className="flex w-full min-w-0 items-center gap-[0.35rem] text-[0.52rem]" style={{ color: cv('soft') }}>
                <Mail className="size-[0.95rem] shrink-0" aria-hidden="true" />
                <span className="truncate" title={c.email ?? undefined}>
                  {c.email ?? '—'}
                </span>
              </span>
            </span>
            <span className={CELL} style={cell}>
              {/* three lines: a project can be called "Demo — Product Enquiries
                  [demo]" and the row is tall enough to say so. */}
              <span className="line-clamp-4 text-[0.56rem] leading-[1.3]" style={{ color: cv('ink') }} title={c.projectNames.join(', ')}>
                {c.primaryProjectName ?? '—'}
                {c.projectNames.length > 1 && <span style={{ color: cv('soft') }}> +{c.projectNames.length - 1}</span>}
              </span>
            </span>
            {showOwner && (
              <span className={cn(CELL, 'gap-[0.5rem]')} style={cell}>
                {c.ownerId && c.ownerName ? (
                  <>
                    <Avatar id={c.ownerId} name={c.ownerName} size="xs" owner />
                    <span className="line-clamp-2 break-words text-[0.58rem] leading-[1.35]" style={{ color: cv('ink') }}>
                      {c.ownerName}
                    </span>
                  </>
                ) : (
                  <span className="text-[0.7rem]" style={{ color: cv('mute') }}>
                    Nobody
                  </span>
                )}
              </span>
            )}
            <span className={CELL} style={cell}>
              <StatusChip c={c} nowMs={nowMs} wrap small />
            </span>
            <span className={cn(CELL, 'flex-col items-start justify-center')} style={cell}>
              <span className="block whitespace-nowrap text-[0.66rem] font-bold" style={{ color: cv('ink') }}>
                {value.kind === 'none' ? '—' : money(value.amount)}
              </span>
              {value.kind === 'quoted' && (
                <span className="text-[0.56rem]" style={{ color: cv('soft') }}>
                  quoted
                </span>
              )}
            </span>
            <span className={cn(CELL, 'flex-col items-start justify-center')} style={cell}>
              <span className="line-clamp-2 text-[0.58rem] leading-[1.4]" style={{ color: nextInk(next.tone) }}>
                {next.text}
                {next.when ? ' ·' : ''}
              </span>
              {next.when && (
                <span className="block text-[0.58rem] leading-[1.4]" style={{ color: nextInk(next.tone) }}>
                  {next.when}
                </span>
              )}
            </span>
            <span className={cn(CELL, 'justify-center gap-[0.25rem] px-[0.25rem]')}>
              <Square label={`Preview ${c.name}`} onClick={() => onSelect(c.id)} size="sm">
                <Eye className="size-[1.15rem]" aria-hidden="true" />
              </Square>
              <Square label={c.primaryLeadId ? `Open the conversation with ${c.name}` : 'No conversation yet'} onClick={c.primaryLeadId ? () => onConversation(c) : undefined} size="sm">
                <MessageSquareText className="size-[1.15rem]" style={{ color: cv('brand-ink') }} aria-hidden="true" />
              </Square>
              <Kebab items={menuFor(c)} label={`More for ${c.name}`} size="sm" />
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ── The cards view — the owner's second design ──────────────────────────── */

const RELATED: ReadonlyArray<{ key: keyof Pick<ClientRow, 'quotations' | 'properties' | 'invoices' | 'appointments' | 'bookings'>; label: string; tab: RelatedTab; icon: typeof FileText }> = [
  { key: 'quotations', label: 'Quotes', tab: 'quotations', icon: FileText },
  { key: 'properties', label: 'Properties', tab: 'properties', icon: Home },
  { key: 'invoices', label: 'Invoices', tab: 'invoices', icon: Receipt },
  { key: 'appointments', label: 'Appointments', tab: 'appointments', icon: CalendarDays },
  { key: 'bookings', label: 'Bookings', tab: 'bookings', icon: KeyRound },
];

function CardsView({
  rows,
  nowMs,
  showOwner,
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
  showOwner: boolean;
  selectedId: string | null;
  ticked: ReadonlySet<string>;
  onSelect: (id: string) => void;
  onTick: (id: string, on: boolean) => void;
  onConversation: (c: ClientRow) => void;
  menuFor: (c: ClientRow) => MenuItem[];
  onRelated: (c: ClientRow, tab: RelatedTab) => void;
}) {
  return (
    <div className="grid gap-[0.75rem] px-[1rem] pb-[1rem] pt-[0.1rem] sm:grid-cols-2">
      {rows.map((c, i) => {
        /* ⚠️ An odd last card takes the whole row and lays itself out in two
           halves — the design's own Mohsin Ahmed card — rather than leaving
           half the row empty. */
        const wide = rows.length % 2 === 1 && i === rows.length - 1;
        return (
          <ClientCard
            key={c.id}
            c={c}
            nowMs={nowMs}
            showOwner={showOwner}
            wide={wide}
            on={c.id === selectedId}
            ticked={ticked.has(c.id)}
            onSelect={() => onSelect(c.id)}
            onTick={(v) => onTick(c.id, v)}
            onConversation={() => onConversation(c)}
            menu={menuFor(c)}
            onRelated={(t) => onRelated(c, t)}
          />
        );
      })}
    </div>
  );
}

function ClientCard({
  c,
  nowMs,
  showOwner,
  wide,
  on,
  ticked,
  onSelect,
  onTick,
  onConversation,
  menu,
  onRelated,
}: {
  c: ClientRow;
  nowMs: number;
  showOwner: boolean;
  wide: boolean;
  on: boolean;
  ticked: boolean;
  onSelect: () => void;
  onTick: (on: boolean) => void;
  onConversation: () => void;
  menu: MenuItem[];
  onRelated: (tab: RelatedTab) => void;
}) {
  const next = nextLine(c, nowMs);
  const value = valueOf(c);
  const counts = RELATED.filter((r) => c[r.key] > 0).slice(0, wide ? 3 : 2);
  const divider = { borderColor: cv('grid') };
  /* ⚠️ `@container` so the wide card's halves follow ITS width, not the
     window's — at 1584px it is ~850px wide, at 1280px it is not. */
  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={on}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('a, button, input, [role="menu"]')) return;
        onSelect();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.target === e.currentTarget) onSelect();
      }}
      className={cn('@container min-w-0 cursor-pointer rounded-[0.6rem] border transition-colors', wide && 'sm:col-span-2')}
      style={
        on
          ? { background: cv('card-pick'), borderColor: cv('card-pick-line'), boxShadow: `0 0 0 1px ${cv('card-pick-line')}` }
          : { borderColor: cv('line'), background: cv('surface') }
      }
    >
      {/* Who, and how to reach them */}
      <div className="grid grid-cols-1 @min-[44rem]:grid-cols-2">
        <div className="flex items-start gap-[0.7rem] px-[0.85rem] pt-[0.8rem] @min-[44rem]:pb-[0.7rem]">
          <input type="checkbox" aria-label={`Tick ${c.name}`} checked={ticked} onChange={(e) => onTick(e.target.checked)} className={cn(CHECK, 'mt-[0.2rem]')} style={checkStyle} />
          <Avatar id={c.id} name={c.name} size="card" />
          <span className="min-w-0 flex-1 pt-[0.1rem]">
            <span className="flex items-start gap-[0.5rem]">
              <span className="min-w-0 flex-1 truncate text-[0.88rem] font-semibold" style={{ color: cv('ink') }}>
                {c.name}
              </span>
              <StatusChip c={c} nowMs={nowMs} small />
              <Kebab items={menu} label={`More for ${c.name}`} size="sm" />
            </span>
            <span className="block truncate text-[0.78rem]" style={{ color: cv('soft') }}>
              {[c.company ?? c.primaryProjectName, c.city].filter(Boolean).join(', ') || '—'}
            </span>
          </span>
        </div>
        <div
          className="flex items-center gap-[0.5rem] pb-[0.65rem] pl-[5.1rem] pr-[0.85rem] pt-[0.35rem] @min-[44rem]:border-l @min-[44rem]:py-[0.7rem] @min-[44rem]:pl-[0.85rem]"
          style={divider}
        >
          <Phone className="size-[1.1rem] shrink-0" style={{ color: c.phoneE164 ? cv('phone') : cv('mute') }} aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-[0.87rem]" style={{ color: cv('soft') }}>
            {phoneLabel(c.phoneE164)}
          </span>
          <Square label={c.primaryLeadId ? `WhatsApp ${c.name}` : 'No conversation yet'} onClick={c.primaryLeadId ? onConversation : undefined} size="sm">
            <span style={{ color: cv('wa') }}>
              <WhatsAppMark className="size-[1.2rem]" />
            </span>
          </Square>
          <Square label={c.phoneE164 ? `Call ${c.name}` : 'No phone number on file'} href={c.phoneE164 ? `tel:${c.phoneE164}` : null} size="sm">
            <Phone className="size-[1.1rem]" style={{ color: cv('brand-ink') }} aria-hidden="true" />
          </Square>
          <Square label={c.email ? `Email ${c.email}` : 'No email on file'} href={c.email ? `mailto:${c.email}` : null} size="sm">
            <Mail className="size-[1.1rem]" style={{ color: cv('brand-ink') }} aria-hidden="true" />
          </Square>
        </div>
      </div>

      {/* Owner | Value — and Value alone when every client here is the viewer's */}
      <div className={cn('grid border-t text-[0.84rem]', showOwner && 'grid-cols-2')} style={divider}>
        {showOwner && (
          <span className="flex min-w-0 items-center gap-[0.6rem] px-[0.85rem] py-[0.5rem]">
            <span className="w-[3.4rem] shrink-0" style={{ color: cv('soft') }}>
              Owner
            </span>
            {c.ownerId && c.ownerName ? (
              <>
                <Avatar id={c.ownerId} name={c.ownerName} size="xs" owner />
                <span className="truncate" style={{ color: cv('ink') }}>
                  {c.ownerName}
                </span>
              </>
            ) : (
              <span style={{ color: cv('mute') }}>Nobody</span>
            )}
          </span>
        )}
        <span className={cn('flex min-w-0 items-center justify-between gap-2 px-[0.85rem] py-[0.5rem]', showOwner && 'border-l')} style={divider}>
          <span style={{ color: cv('soft') }}>Value</span>
          <span className="whitespace-nowrap text-[0.9rem] font-bold" style={{ color: cv('ink') }}>
            {value.kind === 'none' ? '—' : `${money(value.amount)}${value.kind === 'quoted' ? ' quoted' : ''}`}
          </span>
        </span>
      </div>

      {/* Next action | related records */}
      <div className="grid grid-cols-1 border-t @min-[44rem]:grid-cols-2" style={divider}>
        <p
          className="flex min-w-0 items-center gap-[0.6rem] border-b px-[0.85rem] py-[0.5rem] text-[0.84rem] @min-[44rem]:border-b-0 @min-[44rem]:border-r"
          style={{ ...divider, color: nextInk(next.tone) }}
        >
          <CalendarDays className="size-[1.2rem] shrink-0" style={{ color: cv('brand-ink') }} aria-hidden="true" />
          <span className="truncate">
            {next.text}
            {next.when ? ` · ${next.when}` : ''}
          </span>
        </p>
        <div className="flex min-w-0 items-stretch">
          {counts.length === 0 ? (
            <span className="flex flex-1 items-center px-[0.85rem] py-[0.5rem] text-[0.87rem]" style={{ color: cv('mute') }}>
              No related records yet
            </span>
          ) : (
            counts.map((r, i) => (
              <button
                key={r.key}
                type="button"
                onClick={() => onRelated(r.tab)}
                className="flex min-w-0 flex-1 items-center gap-[0.55rem] px-[0.7rem] py-[0.45rem] text-left transition-colors hover:bg-[var(--cl-head)]"
                style={i > 0 ? { borderLeft: `1px solid ${cv('grid')}` } : undefined}
              >
                <IconTile icon={r.icon} bg={cv('tile')} ink={cv('tile-ink')} size="sm" />
                <span className="min-w-0">
                  <span className="block truncate text-[0.7rem] leading-tight" style={{ color: cv('soft') }}>
                    {r.label}
                  </span>
                  <span className="block text-[0.8rem] font-semibold leading-tight" style={{ color: cv('ink') }}>
                    {c[r.key]}
                  </span>
                </span>
              </button>
            ))
          )}
          <button
            type="button"
            onClick={onSelect}
            className="inline-flex shrink-0 items-center gap-1.5 px-[0.85rem] text-[0.86rem] font-medium underline underline-offset-2"
            style={{ color: cv('brand-ink') }}
          >
            View <ArrowRight className="size-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Menus ───────────────────────────────────────────────────────────────── */

const HEAD_BTN = `${OUTLINE} h-[2.65rem] px-5 text-[0.97rem]`;

/* ⚠️ IMPORT ONLY. Owner, 2026-09-22: *"Don't show the export option over there
   in the import client."* Export has its own button, beside the filters. */
function ImportMenu({ onImport, onTemplate }: { onImport: () => void; onTemplate: () => void }) {
  const { open, setOpen, ref } = usePopover();
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className={cn(HEAD_BTN, 'min-w-[10.1rem]')} style={outlineStyle}>
        Import clients <ChevronDown className="size-[1.2rem]" aria-hidden="true" />
      </button>
      {open && (
        <div className={cn(MENU, 'right-0 top-full w-72')} style={{ borderColor: cv('line') }}>
          <button type="button" className={MENU_ITEM} style={{ color: cv('ink') }} onClick={() => { setOpen(false); onImport(); }}>
            <Upload className="size-[1.1rem] shrink-0" style={{ color: cv('brand-ink') }} aria-hidden="true" /> Import a CSV or Excel file
          </button>
          <button type="button" className={MENU_ITEM} style={{ color: cv('ink') }} onClick={() => { setOpen(false); onTemplate(); }}>
            <Download className="size-[1.1rem] shrink-0" style={{ color: cv('brand-ink') }} aria-hidden="true" /> Download a blank template
          </button>
        </div>
      )}
    </div>
  );
}

const FORMATS: ReadonlyArray<{ f: Format; label: string; hint: string; icon: typeof FileText; ink: string }> = [
  { f: 'xlsx', label: 'Excel workbook', hint: '.xlsx — opens in Excel with a bold, frozen header', icon: FileSpreadsheet, ink: 'green-strong' },
  { f: 'csv', label: 'CSV file', hint: '.csv — for any spreadsheet or another system', icon: FileText, ink: 'blue-strong' },
  { f: 'pdf', label: 'PDF report', hint: '.pdf — on the company letterhead, ready to print', icon: FileText, ink: 'red-strong' },
];

function FormatItems({ onPick, busy, prefix }: { onPick: (f: Format) => void; busy: boolean; prefix?: string }) {
  return (
    <>
      {FORMATS.map((x) => (
        <button key={x.f} type="button" disabled={x.f === 'pdf' && busy} className={cn(MENU_ITEM, 'items-start')} style={{ color: cv('ink') }} onClick={() => onPick(x.f)}>
          <x.icon className="mt-[0.1rem] size-[1.15rem] shrink-0" style={{ color: cv(x.ink) }} aria-hidden="true" />
          <span className="min-w-0">
            <span className="block">
              {prefix}
              {x.label}
              {x.f === 'pdf' && busy ? ' — preparing…' : ''}
            </span>
            <span className="block text-[0.8rem]" style={{ color: cv('soft') }}>
              {x.hint}
            </span>
          </span>
        </button>
      ))}
    </>
  );
}

function ExportMenu({ onExport, busy }: { onExport: (f: Format) => void; busy: boolean }) {
  const { open, setOpen, ref } = usePopover();
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className={`${OUTLINE} h-[2.65rem] w-[8.9rem] text-[0.9rem]`} style={outlineStyle}>
        <Upload className="size-[1.2rem]" aria-hidden="true" /> Export
      </button>
      {open && (
        <div className={cn(MENU, 'right-0 top-full w-80')} style={{ borderColor: cv('line') }}>
          <p className="px-3.5 pb-1 pt-1.5 text-[0.8rem] font-medium" style={{ color: cv('soft') }}>
            Export what the filters show
          </p>
          <FormatItems
            busy={busy}
            onPick={(f) => {
              setOpen(false);
              onExport(f);
            }}
          />
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
  const field = 'h-[2.5rem] w-full';
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className={`${OUTLINE} h-[2.65rem] w-[11.1rem] text-[0.9rem]`} style={outlineStyle}>
        <Filter className="size-[1.2rem]" aria-hidden="true" /> More filters{n ? ` · ${n}` : ''}
      </button>
      {open && (
        <div className={cn(MENU, 'right-0 top-full w-80 space-y-3 p-3.5')} style={{ borderColor: cv('line') }}>
          <label className="block">
            <span className="mb-1 block text-[0.83rem] font-medium" style={{ color: cv('soft') }}>
              Source
            </span>
            <Select label="Source" value={filters.source} onChange={(v) => onChange({ source: v })} className={field}>
              <option value="all">Any source</option>
              {SOURCE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[0.83rem] font-medium" style={{ color: cv('soft') }}>
              Preferred channel
            </span>
            <Select label="Preferred channel" value={filters.channel} onChange={(v) => onChange({ channel: v })} className={field}>
              <option value="all">Any channel</option>
              {Object.entries(CHANNEL_LABEL).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[0.83rem] font-medium" style={{ color: cv('soft') }}>
              City
            </span>
            <Select label="City" value={filters.city} onChange={(v) => onChange({ city: v })} className={field}>
              <option value="all">Any city</option>
              {cities.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[0.83rem] font-medium" style={{ color: cv('soft') }}>
              Not contacted for
            </span>
            <Select label="Not contacted for" value={filters.quietDays} onChange={(v) => onChange({ quietDays: Number(v) })} className={field}>
              <option value={0}>Any time</option>
              <option value={7}>7 days or more</option>
              <option value={30}>30 days or more</option>
              <option value={45}>45 days or more</option>
              <option value={90}>90 days or more</option>
            </Select>
          </label>
          <label className="flex items-center gap-2 text-[0.93rem]" style={{ color: cv('ink') }}>
            <input type="checkbox" checked={filters.unpaidOnly} onChange={(e) => onChange({ unpaidOnly: e.target.checked })} className={CHECK} style={checkStyle} />
            Only clients with an unpaid invoice
          </label>
          <div className="flex justify-between border-t pt-2.5" style={{ borderColor: cv('grid') }}>
            <button
              type="button"
              onClick={() => onChange({ source: 'all', channel: 'all', city: 'all', unpaidOnly: false, quietDays: 0 })}
              className="text-[0.87rem] font-medium"
              style={{ color: cv('soft') }}
            >
              Clear these
            </button>
            <button type="button" onClick={() => setOpen(false)} className="text-[0.87rem] font-medium underline underline-offset-2" style={{ color: cv('brand-ink') }}>
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
  busy,
  onStatus,
  onOwner,
  onArchive,
  onExport,
  onClear,
}: {
  count: number;
  owners: ReadonlyArray<[string, string]>;
  busy: boolean;
  onStatus: (s: StoredStatus) => void;
  onOwner: (id: string, name: string) => void;
  onArchive: (archive: boolean) => void;
  onExport: (f: Format) => void;
  onClear: () => void;
}) {
  const { open, setOpen, ref } = usePopover();
  const run = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  const heading = 'border-t px-3.5 pb-1 pt-2 text-[0.8rem] font-medium';
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={count === 0}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="inline-flex h-[2.15rem] items-center gap-2 rounded-[0.42rem] border px-[0.8rem] text-[0.84rem] transition-colors disabled:cursor-not-allowed"
        style={{ borderColor: cv('line'), background: cv('head'), color: count ? cv('ink') : cv('mute') }}
      >
        Bulk actions{count ? ` · ${count}` : ''} <ChevronDown className="size-[1rem]" aria-hidden="true" />
      </button>
      {open && (
        <div className={cn(MENU, 'left-0 top-full max-h-[26rem] w-72 overflow-y-auto')} style={{ borderColor: cv('line') }}>
          <p className="px-3.5 pb-1 pt-1.5 text-[0.8rem] font-medium" style={{ color: cv('soft') }}>
            Set status
          </p>
          {STORED_STATUS_OPTIONS.map((o) => (
            <button key={o.value} type="button" className={MENU_ITEM} style={{ color: cv('ink') }} onClick={run(() => onStatus(o.value))}>
              {o.label}
            </button>
          ))}
          {owners.length > 0 && (
            <>
              <p className={heading} style={{ borderColor: cv('grid'), color: cv('soft') }}>
                Give to (managers only)
              </p>
              {owners.map(([id, name]) => (
                <button key={id} type="button" className={MENU_ITEM} style={{ color: cv('ink') }} onClick={run(() => onOwner(id, name))}>
                  {name}
                </button>
              ))}
            </>
          )}
          <p className={heading} style={{ borderColor: cv('grid'), color: cv('soft') }}>
            Export the ticked
          </p>
          <FormatItems busy={busy} onPick={(f) => run(() => onExport(f))()} />
          <div className="border-t" style={{ borderColor: cv('grid') }}>
            <button type="button" className={MENU_ITEM} onClick={run(() => onArchive(true))} style={{ color: cv('red') }}>
              Archive ticked
            </button>
            <button type="button" className={MENU_ITEM} style={{ color: cv('ink') }} onClick={run(() => onArchive(false))}>
              Restore ticked
            </button>
            <button type="button" className={MENU_ITEM} style={{ color: cv('ink') }} onClick={run(onClear)}>
              Clear the ticks
            </button>
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
  const step = 'grid size-[2.2rem] place-items-center rounded-[0.42rem] border text-[0.87rem] transition-colors hover:bg-[var(--cl-head)] disabled:cursor-not-allowed';
  return (
    <div className="grid shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-3 border-t px-[1rem] py-[0.75rem]" style={{ borderColor: cv('grid') }}>
      <p className="min-w-0 text-[0.9rem]" style={{ color: cv('soft') }}>
        {page * perPage + 1}–{Math.min(total, page * perPage + perPage)} of {total}
      </p>
      <div className="flex items-center gap-[0.45rem]">
        <button
          type="button"
          aria-label="Previous page"
          disabled={page === 0}
          onClick={() => onPage(page - 1)}
          className={step}
          style={{ borderColor: cv('line'), color: page === 0 ? cv('mute') : cv('ink'), background: page === 0 ? cv('head') : cv('surface') }}
        >
          <ChevronLeft className="size-[1.1rem]" aria-hidden="true" />
        </button>
        {nums.map((n, i) => (
          <React.Fragment key={n}>
            {i > 0 && n - nums[i - 1] > 1 && <span style={{ color: cv('mute') }}>…</span>}
            <button
              type="button"
              aria-current={n === page ? 'page' : undefined}
              onClick={() => onPage(n)}
              className={step}
              style={n === page ? { background: cv('brand'), borderColor: cv('brand'), color: cv('on-brand') } : { borderColor: cv('line'), color: cv('ink'), background: cv('surface') }}
            >
              {n + 1}
            </button>
          </React.Fragment>
        ))}
        <button
          type="button"
          aria-label="Next page"
          disabled={page >= pages - 1}
          onClick={() => onPage(page + 1)}
          className={step}
          style={{ borderColor: cv('line'), color: page >= pages - 1 ? cv('mute') : cv('ink'), background: page >= pages - 1 ? cv('head') : cv('surface') }}
        >
          <ChevronRight className="size-[1.1rem]" aria-hidden="true" />
        </button>
      </div>
      <label className="flex items-center justify-end gap-[0.7rem] text-[0.9rem]" style={{ color: cv('soft') }}>
        Show
        <Select label="Clients per page" value={perPage} onChange={(v) => onPerPage(Number(v))} className="h-[2.4rem] w-[5.6rem]">
          {[10, 25, 50, 100].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </Select>
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
      <Users className="size-8" style={{ color: cv('mute') }} aria-hidden="true" />
      <p className="mt-2 text-[0.97rem] font-medium" style={{ color: cv('ink') }}>
        {line}
      </p>
      <p className="mt-0.5 max-w-sm text-[0.87rem]" style={{ color: cv('soft') }}>
        A client is somebody we have a relationship with — a lead who bought, or somebody you add here by hand.
      </p>
      <div className="mt-3 flex gap-2">
        {filtered && (
          <button type="button" onClick={onClear} className={`${OUTLINE} h-[2.4rem] px-4 text-[0.93rem]`} style={outlineStyle}>
            Clear the filters
          </button>
        )}
        <button type="button" onClick={onAdd} className={`${SOLID} h-[2.4rem] px-4 text-[0.93rem]`} style={solidStyle}>
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
      <p className="pointer-events-auto rounded-xl bg-bg-surface px-4 py-2.5 text-body-sm text-text-secondary shadow-xl">Opening the related items…</p>
    </div>
  );
}
