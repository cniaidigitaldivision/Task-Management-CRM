'use client';

import * as React from 'react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  ArrowRight,
  Building2,
  CalendarClock,
  CalendarDays,
  Check,
  CheckCircle2,
  Clock3,
  FileText,
  Info,
  Layers,
  Loader2,
  Mail,
  MessageSquare,
  Pencil,
  Phone,
  Plus,
  Search,
  Send,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';

import { bookableLeadsAction } from '@/app/actions/crm-appointments-board';
import {
  rescheduleFollowUpAction,
  saveFollowUpBodyAction,
  sendFollowUpNowAction,
} from '@/app/actions/crm-followup-board';
import { cancelFollowUpAction, completeFollowUpAction, stopSequenceAction } from '@/app/actions/crm-followups';
import { leadBundlesAction } from '@/app/actions/crm-lead-bundles';
import { ink, RowMenu, StatCard, tint } from '@/components/crm/appointments-board-parts';
import { FollowUpWizard } from '@/components/crm/follow-up-wizard';
import { WA_GREEN, WhatsAppMark } from '@/components/crm/whatsapp-mark';
import { PageHeader } from '@/components/ui/page-header';
import { useToast } from '@/components/ui/toast';
import type { BoardFollowUp, BoardSequence } from '@/lib/db/queries/crm-followup-board';
import type { CrmLeadBundle } from '@/lib/db/queries/crm-leads';
import {
  applyFilters,
  cardCounts,
  CHANNEL_OPTIONS,
  displayStatus,
  DUE_OPTIONS,
  dueLine,
  inTab,
  isOpen,
  NO_FILTERS,
  priority,
  rowAction,
  sequenceLine,
  sortForQueue,
  STATUS_LOOK,
  TABS,
  type BoardFilters,
  type DisplayStatus,
  type TabKey,
} from '@/lib/domain/crm-followup-board';
import { fillTokens, purposeLabel } from '@/lib/domain/crm-followup-plans';
import { cn } from '@/lib/utils';

/* ============================================================================
 * FOLLOW-UPS — the owner's design, 2026-09-22
 * ----------------------------------------------------------------------------
 * *"Prioritise the next action and keep every open lead moving."* Four cards,
 * four tabs, a queue, and a details panel carrying the message that will go
 * out, what would stop it, and the sequence it belongs to.
 *
 * ── ⚠️ RULE ZERO ───────────────────────────────────────────────────────────
 * Cards, tabs, filters, the queue and the panel are all client state over ONE
 * query. Only a write reaches the server, and each one moves the row in its own
 * frame before the page catches up underneath.
 *
 * ── ⚠️ EVERY CONTROL DOES SOMETHING ────────────────────────────────────────
 * Owner: *"I want each and every thing to be working properly, sensibly, and
 * logically, with each and every thing wired up."* So the row's button is
 * whatever that row actually needs (`rowAction`), and a button that cannot act
 * is not drawn rather than drawn dead.
 * ========================================================================= */

const CONTROL =
  'h-9 rounded-xl border border-border-default bg-bg-surface text-body-sm text-text-primary transition-colors hover:border-border-strong focus:border-accent-primary focus:outline-none';

type IconOf = React.ComponentType<{ className?: string; style?: React.CSSProperties }>;

const CHANNEL_ICON: Record<string, IconOf> = {
  email: Mail,
  call: Phone,
  task: CheckCircle2,
};

function ChannelMark({ channel }: { channel: string }) {
  if (channel === 'whatsapp') {
    return (
      <span className="grid size-8 place-items-center rounded-full" style={{ background: tint('green', 14) }}>
        <span style={{ color: WA_GREEN }}>
          <WhatsAppMark className="size-4" />
        </span>
      </span>
    );
  }
  const Icon = CHANNEL_ICON[channel] ?? MessageSquare;
  return (
    <span className="grid size-8 place-items-center rounded-full" style={{ background: tint('blue', 12) }}>
      <Icon className="size-4" style={{ color: ink('blue') }} />
    </span>
  );
}

/** The states that are owed now — the only ones that carry red. */
const LATE = new Set<DisplayStatus>(['overdue', 'due_now', 'reply_needed']);

function StatusPill({ status }: { status: DisplayStatus }) {
  const look = STATUS_LOOK[status];
  const Icon = status === 'scheduled' ? CalendarDays : status === 'sent' ? CheckCircle2 : status === 'waiting_approval' ? Clock3 : AlertCircle;
  return (
    <span
      className="inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-caption font-semibold leading-tight"
      style={{ background: tint(look.tone, 14), color: ink(look.tone) }}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0">{look.label}</span>
    </span>
  );
}

type Dialog =
  | { kind: 'new' }
  | { kind: 'wizard'; leadId: string }
  | { kind: 'reschedule'; id: string }
  | { kind: 'done'; id: string }
  | null;

export function FollowUpsBoard({
  followUps,
  sequences,
  nowMs,
  viewerName,
  windowFrom,
}: {
  followUps: readonly BoardFollowUp[];
  sequences: readonly BoardSequence[];
  nowMs: number;
  viewerName: string;
  windowFrom: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [, startTransition] = React.useTransition();

  /* ── What this screen has just done, over the server's rows ───────────── */
  const [overrides, setOverrides] = React.useState<ReadonlyMap<string, Partial<BoardFollowUp>>>(new Map());
  const [seen, setSeen] = React.useState(followUps);
  if (seen !== followUps) {
    setSeen(followUps);
    setOverrides(new Map());
  }
  const rows = React.useMemo(
    () => followUps.map((f) => (overrides.has(f.id) ? { ...f, ...overrides.get(f.id) } : f)),
    [followUps, overrides],
  );
  const patch = (id: string, p: Partial<BoardFollowUp>) =>
    setOverrides((prev) => new Map(prev).set(id, { ...prev.get(id), ...p }));
  const refresh = () => startTransition(() => router.refresh());

  const [tab, setTab] = React.useState<TabKey>('queue');
  const [filters, setFilters] = React.useState<BoardFilters>(NO_FILTERS);
  const set = (p: Partial<BoardFilters>) => setFilters((f) => ({ ...f, ...p }));

  const counts = React.useMemo(
    () => cardCounts(rows, nowMs, sequences.filter((s) => s.state !== 'stopped').length),
    [rows, nowMs, sequences],
  );
  const shown = React.useMemo(
    () => sortForQueue(applyFilters(rows.filter((r) => inTab(r, tab, nowMs)), filters, nowMs), nowMs),
    [rows, tab, filters, nowMs],
  );
  const projects = React.useMemo(
    () => [...new Set(rows.map((r) => r.projectName).filter((p): p is string => Boolean(p)))].sort(),
    [rows],
  );
  const purposes = React.useMemo(
    () => [...new Set(rows.map((r) => r.purpose))].sort(),
    [rows],
  );

  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const selected = shown.find((r) => r.id === selectedId) ?? shown[0] ?? null;

  const [dialog, setDialog] = React.useState<Dialog>(null);
  const [bundles, setBundles] = React.useState<Record<string, CrmLeadBundle>>({});
  const byId = (id: string) => rows.find((r) => r.id === id) ?? null;

  /* ── The writes ───────────────────────────────────────────────────────── */
  const [busy, setBusy] = React.useState<string | null>(null);

  const send = async (f: BoardFollowUp) => {
    setBusy(f.id);
    const r = await sendFollowUpNowAction(f.id, f.leadId);
    setBusy(null);
    if (!r.ok) {
      toast({ tone: 'error', text: r.error ?? 'That could not be sent.' });
      return;
    }
    if (r.sent) {
      patch(f.id, { status: 'done', doneAt: new Date().toISOString() });
      toast({ tone: 'ok', text: `Sent to ${f.leadName ?? 'the client'}.` });
    } else {
      toast({
        tone: r.error ? 'error' : 'ok',
        text: r.error ?? 'Queued — it goes out on the sender’s next run.',
      });
    }
    refresh();
  };

  const markDone = async (f: BoardFollowUp, note: string) => {
    setBusy(f.id);
    const r = await completeFollowUpAction(f.id, note);
    setBusy(null);
    if (!r.ok) {
      toast({ tone: 'error', text: r.error ?? 'That did not save.' });
      return;
    }
    patch(f.id, { status: 'done', doneAt: new Date().toISOString(), outcomeNote: note || null });
    toast({ tone: 'ok', text: 'Marked done.' });
    setDialog(null);
    refresh();
  };

  const cancel = async (f: BoardFollowUp) => {
    setBusy(f.id);
    const r = await cancelFollowUpAction(f.id);
    setBusy(null);
    if (!r.ok) {
      toast({ tone: 'error', text: r.error ?? 'That did not save.' });
      return;
    }
    patch(f.id, { status: 'cancelled' });
    toast({ tone: 'ok', text: 'Cancelled — nothing will be sent.' });
    refresh();
  };

  const stopSeq = async (f: BoardFollowUp) => {
    if (!f.sequenceRunId) return;
    setBusy(f.id);
    const r = await stopSequenceAction(f.sequenceRunId);
    setBusy(null);
    if (!r.ok) {
      toast({ tone: 'error', text: r.error ?? 'That did not save.' });
      return;
    }
    toast({ tone: 'ok', text: 'Sequence stopped. Nothing further will go out.' });
    refresh();
  };

  const openLeadWizard = (leadId: string) => {
    if (!bundles[leadId]) {
      void leadBundlesAction([leadId]).then((r) => setBundles((prev) => ({ ...prev, ...r.bundles })));
    }
    setDialog({ kind: 'wizard', leadId });
  };

  const act = (f: BoardFollowUp) => {
    switch (rowAction(f, nowMs)) {
      case 'reply':
        router.push(`/conversations?lead=${f.leadId}` as Route);
        break;
      case 'approval':
        router.push(`/my-leads?lead=${f.leadId}` as Route);
        break;
      case 'review':
      case 'preview':
        setSelectedId(f.id);
        break;
      case 'done':
        setDialog({ kind: 'done', id: f.id });
        break;
      default:
        break;
    }
  };

  const ACTION_LABEL: Record<string, string> = {
    reply: 'Reply',
    approval: 'View approval',
    review: 'Review',
    preview: 'Preview',
    done: 'Mark done',
    none: '',
  };

  return (
    <div className="mx-auto max-w-[var(--content-max)] space-y-4">
      <PageHeader
        title="Follow-ups"
        description="Prioritise the next action and keep every open lead moving."
        actions={
          <button
            type="button"
            onClick={() => setDialog({ kind: 'new' })}
            className="inline-flex items-center gap-2 rounded-xl bg-accent-primary px-4 py-2.5 text-body-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
          >
            <Plus className="size-4" aria-hidden="true" /> New follow-up
          </button>
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Due today" count={counts.dueToday} tone="blue" icon={CalendarDays}
          active={filters.due === 'today'} onClick={() => set({ due: filters.due === 'today' ? 'all' : 'today' })} />
        <StatCard label="Overdue" count={counts.overdue} tone="red" icon={AlertCircle}
          active={filters.due === 'overdue'} onClick={() => set({ due: filters.due === 'overdue' ? 'all' : 'overdue' })} />
        <StatCard label="Reply needed" count={counts.replyNeeded} tone="amber" icon={MessageSquare}
          active={tab === 'queue' && filters.q === 'reply'} onClick={() => { setTab('queue'); setFilters(NO_FILTERS); }} />
        <StatCard label="Active sequences" count={counts.activeSequences} tone="green" icon={Layers}
          active={tab === 'sequences'} onClick={() => setTab(tab === 'sequences' ? 'queue' : 'sequences')} />
      </div>

      {/* ── Tabs ───────────────────────────────────────────────────────── */}
      {/* ⚠️ THE OPEN TAB IS FILLED, NOT UNDERLINED. Owner, 2026-09-22: *"which
          tab is selected or which tab is opened is not visible"* — the same
          complaint they made about the Appointments tabs. A 2px rule under a
          word is not enough to find at a glance, so the open one carries the
          accent as a solid pill, which is the treatment they accepted there.
          Each tab also says how many rows it holds, so the choice is informed
          before it is made rather than after. */}
      <div
        className="inline-flex max-w-full flex-wrap gap-1 rounded-xl border border-border-default bg-bg-surface p-1"
        role="tablist"
        aria-label="Which follow-ups"
      >
        {TABS.map((t) => {
          /* ⚠️ THE SEQUENCES TAB COUNTS SEQUENCES. Counting its rows instead
             put "2" on the Active sequences card and "0" on the tab that
             shows those same two — a running sequence often has no step
             queued at this instant, and the two numbers must agree. */
          const n = t.key === 'sequences' ? counts.activeSequences : rows.filter((r) => inTab(r, t.key, nowMs)).length;
          const on = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setTab(t.key)}
              className={cn(
                'inline-flex items-center gap-2 rounded-lg px-4 py-2 text-body-sm font-semibold transition-colors',
                on ? 'bg-accent-primary text-white shadow-sm' : 'text-text-secondary hover:bg-bg-subtle hover:text-text-primary',
              )}
            >
              {t.label}
              <span
                className={cn(
                  'grid min-w-5 place-items-center rounded-full px-1.5 text-caption font-semibold leading-5',
                  on ? 'bg-white/25 text-white' : 'bg-bg-subtle text-text-secondary',
                )}
              >
                {n}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── Filters ────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end gap-2.5">
        <label className={cn(CONTROL, 'flex min-w-[13rem] flex-1 items-center gap-2 px-3')}>
          <Search className="size-4 shrink-0 text-text-tertiary" aria-hidden="true" />
          <input
            value={filters.q}
            onChange={(e) => set({ q: e.target.value })}
            placeholder="Search lead, project or related item…"
            aria-label="Search lead, project or related item"
            className="min-w-0 flex-1 bg-transparent placeholder:text-text-tertiary focus:outline-none"
          />
        </label>
        <Field label="Due status">
          <select aria-label="Due status" value={filters.due} onChange={(e) => set({ due: e.target.value as BoardFilters['due'] })} className={cn(CONTROL, 'w-[8rem] px-2.5')}>
            {DUE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </Field>
        <Field label="Purpose">
          <select aria-label="Purpose" value={filters.purpose} onChange={(e) => set({ purpose: e.target.value })} className={cn(CONTROL, 'w-[10rem] px-2.5')}>
            <option value="all">All</option>
            {purposes.map((p) => <option key={p} value={p}>{purposeLabel(p)}</option>)}
          </select>
        </Field>
        <Field label="Channel">
          <select aria-label="Channel" value={filters.channel} onChange={(e) => set({ channel: e.target.value })} className={cn(CONTROL, 'w-[8.5rem] px-2.5')}>
            {CHANNEL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </Field>
        <Field label="Project">
          <select aria-label="Project" value={filters.project} onChange={(e) => set({ project: e.target.value })} className={cn(CONTROL, 'w-[10rem] px-2.5')}>
            <option value="all">All</option>
            {projects.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </Field>
        <Field label="Saved view">
          <select
            aria-label="Saved view"
            value={filters.due === 'overdue' ? 'overdue' : filters.q ? 'search' : 'open'}
            onChange={(e) => {
              const v = e.target.value;
              if (v === 'open') { setTab('queue'); setFilters(NO_FILTERS); }
              if (v === 'overdue') { setTab('queue'); setFilters({ ...NO_FILTERS, due: 'overdue' }); }
              if (v === 'week') { setTab('scheduled'); setFilters({ ...NO_FILTERS, due: 'week' }); }
              if (v === 'whatsapp') { setFilters({ ...NO_FILTERS, channel: 'whatsapp' }); }
            }}
            className={cn(CONTROL, 'w-[11rem] px-2.5')}
          >
            <option value="open">My open follow-ups</option>
            <option value="overdue">Overdue only</option>
            <option value="week">This week</option>
            <option value="whatsapp">WhatsApp only</option>
          </select>
        </Field>
      </div>

      {/* ── The queue and the details ──────────────────────────────────── */}
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,29rem)]">
        <section className="min-w-0 rounded-2xl border border-border-subtle bg-bg-surface py-4 shadow-sm">
          <div className="flex flex-wrap items-center gap-2 px-5 pb-3">
            <h2 className="text-h3 font-semibold text-text-primary">
              {tab === 'queue' ? 'My follow-up queue' : tab === 'scheduled' ? 'Scheduled' : tab === 'sequences' ? 'In a sequence' : 'Completed'}
            </h2>
            <span className="flex-1" />
            <span className="text-caption text-text-secondary">
              {tab === 'sequences'
                ? `${counts.activeSequences} sequence${counts.activeSequences === 1 ? '' : 's'}${shown.length ? ` · ${shown.length} queued` : ''}`
                : `${shown.length} follow-up${shown.length === 1 ? '' : 's'}`}
            </span>
          </div>

          {tab === 'sequences' && sequences.length > 0 && (
            <SequenceStrip sequences={sequences} onOpen={(leadId) => router.push(`/my-leads?lead=${leadId}` as Route)} />
          )}

          {shown.length === 0 ? (
            <Empty
              tab={tab}
              anyAtAll={rows.length > 0}
              hasSequences={sequences.length > 0}
              onNew={() => setDialog({ kind: 'new' })}
            />
          ) : (
            <QueueTable
              rows={shown}
              nowMs={nowMs}
              selectedId={selected?.id ?? null}
              busy={busy}
              onSelect={setSelectedId}
              onAct={act}
              actionLabel={(f) => ACTION_LABEL[rowAction(f, nowMs)]}
              onSend={(f) => void send(f)}
              menuFor={(f) => [
                { label: 'Open the conversation', onSelect: () => router.push(`/conversations?lead=${f.leadId}` as Route) },
                { label: 'Open the lead', onSelect: () => router.push(`/my-leads?lead=${f.leadId}` as Route) },
                { label: 'Add another follow-up', onSelect: () => openLeadWizard(f.leadId) },
                ...(isOpen(f)
                  ? [
                      { label: 'Reschedule', onSelect: () => setDialog({ kind: 'reschedule', id: f.id }) },
                      { label: 'Mark done', onSelect: () => setDialog({ kind: 'done', id: f.id }) },
                      { label: 'Cancel this follow-up', onSelect: () => void cancel(f), danger: true },
                      ...(f.sequenceRunId
                        ? [{ label: 'Stop the whole sequence', onSelect: () => void stopSeq(f), danger: true }]
                        : []),
                    ]
                  : []),
              ]}
            />
          )}
        </section>

        {selected ? (
          <DetailsPanel
            f={selected}
            nowMs={nowMs}
            viewerName={viewerName}
            busy={busy === selected.id}
            onSend={() => void send(selected)}
            onReschedule={() => setDialog({ kind: 'reschedule', id: selected.id })}
            onStopSequence={() => void stopSeq(selected)}
            onCancel={() => void cancel(selected)}
            onMarkDone={() => setDialog({ kind: 'done', id: selected.id })}
            onConversation={() => router.push(`/conversations?lead=${selected.leadId}` as Route)}
            onSaved={(body) => patch(selected.id, { body })}
          />
        ) : (
          <aside className="grid place-items-center rounded-2xl border border-border-subtle bg-bg-surface p-6 text-center shadow-sm">
            <p className="text-body-sm text-text-secondary">Pick a follow-up to see what will be sent.</p>
          </aside>
        )}
      </div>

      <p className="text-caption text-text-secondary">
        Showing everything still open, and what was completed since {windowFrom}.
      </p>

      {dialog?.kind === 'new' && (
        <LeadPicker
          onClose={() => setDialog(null)}
          onPick={(leadId) => openLeadWizard(leadId)}
        />
      )}
      {dialog?.kind === 'wizard' &&
        (bundles[dialog.leadId] ? (
          <FollowUpWizard
            lead={bundles[dialog.leadId].record.lead}
            related={bundles[dialog.leadId].related}
            viewerName={viewerName}
            nowMs={nowMs}
            onClose={() => setDialog(null)}
            onCreated={() => {
              setDialog(null);
              toast({ tone: 'ok', text: 'Follow-up planned.' });
              refresh();
            }}
          />
        ) : (
          <Opening onClose={() => setDialog(null)} />
        ))}
      {dialog?.kind === 'reschedule' && byId(dialog.id) && (
        <RescheduleDialog
          followUp={byId(dialog.id)!}
          nowMs={nowMs}
          onClose={() => setDialog(null)}
          onMoved={(at) => {
            patch(dialog.id, { dueAt: at, status: Date.parse(at) <= Date.now() ? 'due' : 'planned' });
            setDialog(null);
            refresh();
          }}
        />
      )}
      {dialog?.kind === 'done' && byId(dialog.id) && (
        <DoneDialog
          followUp={byId(dialog.id)!}
          busy={busy === dialog.id}
          onClose={() => setDialog(null)}
          onDone={(note) => void markDone(byId(dialog.id)!, note)}
        />
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-caption text-text-secondary">{label}</span>
      {children}
    </label>
  );
}

/* ── The queue ───────────────────────────────────────────────────────────── */

/* ⚠️ THE PURPOSE COLUMN CARRIES THE LONGEST WORDS ON THE ROW — "Appointment
   reminder", "Missing information" — and truncating them leaves two purposes
   that read identically. It gets the room; Sequence says "Manual" most of the
   time and Related item is a short reference. */
const COLS =
  'minmax(0,1.35fr) minmax(0,1.45fr) minmax(0,0.75fr) 2.75rem minmax(0,0.85fr) minmax(0,0.8fr) minmax(0,1fr) minmax(0,0.95fr)';

function QueueTable({
  rows,
  nowMs,
  selectedId,
  busy,
  onSelect,
  onAct,
  actionLabel,
  onSend,
  menuFor,
}: {
  rows: readonly BoardFollowUp[];
  nowMs: number;
  selectedId: string | null;
  busy: string | null;
  onSelect: (id: string) => void;
  onAct: (f: BoardFollowUp) => void;
  actionLabel: (f: BoardFollowUp) => string;
  onSend: (f: BoardFollowUp) => void;
  menuFor: (f: BoardFollowUp) => ReadonlyArray<{ label: string; onSelect: () => void; danger?: boolean }>;
}) {
  return (
    <div>
      <div
        className="grid items-center gap-3 border-y border-border-subtle bg-bg-subtle/40 px-5 py-2.5 text-caption font-semibold text-text-secondary"
        style={{ gridTemplateColumns: COLS }}
      >
        <span>Lead / project</span>
        <span>Purpose</span>
        <span>Due</span>
        <span>Channel</span>
        <span>Related item</span>
        <span>Sequence</span>
        <span>Status</span>
        <span className="text-right">Actions</span>
      </div>
      <div>
        {rows.map((f) => {
          const s = displayStatus(f, nowMs);
          const on = f.id === selectedId;
          const due = dueLine(f.dueAt, nowMs, s);
          const related = f.quotationNumber ?? (f.appointmentRef ? `APPT-${f.appointmentRef}` : null);
          const action = rowAction(f, nowMs);
          const label = actionLabel(f);
          return (
            <div
              key={f.id}
              role="button"
              tabIndex={0}
              aria-pressed={on}
              onClick={(e) => {
                const hit = (e.target as HTMLElement).closest('a, button, [role="menu"]');
                if (hit && hit !== e.currentTarget) return;
                onSelect(f.id);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && e.target === e.currentTarget) onSelect(f.id);
              }}
              className={cn(
                'grid cursor-pointer items-center gap-3 border-b border-l-[3px] border-b-border-subtle px-5 py-3 transition-colors',
                on ? 'border-l-accent-primary' : 'border-l-transparent hover:bg-bg-subtle/60',
              )}
              style={{ gridTemplateColumns: COLS, background: on ? tint('blue', 6) : undefined }}
            >
              <span className="min-w-0">
                <span className="block truncate text-body-sm font-semibold text-text-primary">
                  {f.leadName ?? 'Unnamed lead'}
                </span>
                <span className="block truncate text-caption text-text-secondary">{f.projectName ?? '—'}</span>
              </span>
              <span className="min-w-0 truncate text-body-sm text-text-primary">{purposeLabel(f.purpose)}</span>
              <span className="min-w-0">
                <span
                  className={cn('block truncate text-body-sm font-semibold', LATE.has(s) ? '' : 'text-text-primary')}
                  style={LATE.has(s) ? { color: ink('red') } : undefined}
                >
                  {due.day}
                </span>
                {due.time && <span className="block truncate text-caption text-text-secondary">{due.time}</span>}
              </span>
              <span><ChannelMark channel={f.channel} /></span>
              <span
                className={cn('truncate text-body-sm', related ? 'font-medium text-text-brand' : 'text-text-tertiary')}
                title={related ?? 'No related item'}
              >
                {related ?? '—'}
              </span>
              <span className="truncate text-body-sm text-text-secondary">{sequenceLine(f)}</span>
              <span className="min-w-0"><StatusPill status={s} /></span>
              <span className="flex items-center justify-end gap-1.5">
                {label && (
                  <button
                    type="button"
                    onClick={() => onAct(f)}
                    className={cn(
                      'rounded-lg px-2.5 py-1.5 text-caption font-semibold transition-colors',
                      action === 'review'
                        ? 'bg-accent-primary text-white hover:opacity-90'
                        : 'border border-border-default text-text-primary hover:bg-bg-subtle',
                    )}
                  >
                    {label}
                  </button>
                )}
                {action === 'review' && (
                  <button
                    type="button"
                    disabled={busy === f.id}
                    onClick={() => onSend(f)}
                    className="rounded-lg border border-border-default px-2.5 py-1.5 text-caption font-semibold text-text-primary transition-colors hover:bg-bg-subtle disabled:opacity-50"
                  >
                    {busy === f.id ? 'Sending…' : 'Send'}
                  </button>
                )}
                <RowMenu items={menuFor(f)} label={`More for ${f.leadName ?? 'this follow-up'}`} />
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SequenceStrip({
  sequences,
  onOpen,
}: {
  sequences: readonly BoardSequence[];
  onOpen: (leadId: string) => void;
}) {
  return (
    <div className="mb-3 flex gap-2 overflow-x-auto px-5 pb-1">
      {sequences.map((s) => (
        <button
          key={s.id}
          type="button"
          onClick={() => onOpen(s.leadId)}
          className="min-w-[13rem] shrink-0 rounded-xl border border-border-subtle px-3 py-2 text-left transition-colors hover:bg-bg-subtle"
        >
          <span className="block truncate text-body-sm font-semibold text-text-primary">{s.leadName ?? 'Unnamed lead'}</span>
          <span className="block truncate text-caption text-text-secondary">{s.name}</span>
          <span className="mt-1 flex items-center gap-2">
            <span className="text-caption font-medium text-text-primary">Step {s.step} of {s.total}</span>
            <span
              className="rounded-full px-1.5 py-0.5 text-caption font-medium"
              style={
                s.state === 'paused'
                  ? { background: tint('amber', 14), color: ink('amber') }
                  : { background: tint('green', 14), color: ink('green') }
              }
            >
              {s.state === 'paused' ? (s.pauseReason ?? 'Paused') : 'Running'}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

function Empty({
  tab,
  anyAtAll,
  hasSequences,
  onNew,
}: {
  tab: TabKey;
  anyAtAll: boolean;
  hasSequences: boolean;
  onNew: () => void;
}) {
  const line =
    tab === 'queue'
      ? anyAtAll ? 'Nothing is owed right now. What is coming is under Scheduled.' : 'No follow-ups yet.'
      : tab === 'scheduled'
        ? 'Nothing is scheduled ahead.'
        : tab === 'sequences'
          /* ⚠️ The strip above this is not nothing. A running sequence with no
             step queued yet must not be described as no sequence at all. */
          ? hasSequences ? 'No step is queued right now — the sequences above are waiting on their next day.' : 'No sequence is running.'
          : 'Nothing completed in this window.';
  return (
    <div className="grid place-items-center px-5 py-16 text-center">
      <CalendarClock className="size-8 text-text-tertiary" aria-hidden="true" />
      <p className="mt-2 text-body-sm font-medium text-text-primary">{line}</p>
      <p className="mt-0.5 max-w-sm text-caption text-text-secondary">
        A follow-up keeps a lead moving — a check-in on a quotation, a nudge after silence, a reminder before a visit.
      </p>
      <button
        type="button"
        onClick={onNew}
        className="mt-3 rounded-xl border border-border-default px-3.5 py-2 text-body-sm font-medium text-text-primary hover:bg-bg-subtle"
      >
        New follow-up
      </button>
    </div>
  );
}

/* ── The details panel ───────────────────────────────────────────────────── */

function DetailsPanel({
  f,
  nowMs,
  viewerName,
  busy,
  onSend,
  onReschedule,
  onStopSequence,
  onCancel,
  onMarkDone,
  onConversation,
  onSaved,
}: {
  f: BoardFollowUp;
  nowMs: number;
  viewerName: string;
  busy: boolean;
  onSend: () => void;
  onReschedule: () => void;
  onStopSequence: () => void;
  onCancel: () => void;
  onMarkDone: () => void;
  onConversation: () => void;
  onSaved: (body: string) => void;
}) {
  const toast = useToast();
  const s = displayStatus(f, nowMs);
  const p = priority(f, nowMs);
  const due = dueLine(f.dueAt, nowMs, s);
  const open = isOpen(f);
  const sendable = open && f.mode === 'auto_send' && (f.channel === 'whatsapp' || f.channel === 'email');

  /* The tokens a person would have typed, filled the way the sender fills them. */
  const filled = React.useMemo(() => {
    const first = (f.leadName ?? '').split(/\s+/)[0] ?? '';
    return fillTokens(f.body ?? '', {
      lead_first_name: first,
      lead_name: f.leadName ?? '',
      my_first_name: (f.ownerName ?? viewerName).split(/\s+/)[0] ?? '',
      my_name: f.ownerName ?? viewerName,
      company: f.businessSender ?? '',
      project: f.projectName ?? '',
      quotation_number: f.quotationNumber ?? '',
      visit_when: f.appointmentAt ? new Date(f.appointmentAt).toLocaleString('en-GB', { timeZone: 'Asia/Karachi' }) : '',
    });
  }, [f, viewerName]);

  const [editing, setEditing] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  /* Picking a different row abandons a half-typed edit — adjusted DURING the
     render, not in an effect, so the panel never paints one row's draft over
     another's message for a frame. */
  const [editingFor, setEditingFor] = React.useState(f.id);
  if (editingFor !== f.id) {
    setEditingFor(f.id);
    setEditing(null);
  }

  const save = async () => {
    if (editing === null) return;
    setSaving(true);
    const r = await saveFollowUpBodyAction(f.id, f.leadId, editing);
    setSaving(false);
    if (!r.ok) {
      toast({ tone: 'error', text: r.error ?? 'That did not save.' });
      return;
    }
    onSaved(editing);
    setEditing(null);
    toast({ tone: 'ok', text: 'Message saved.' });
  };

  return (
    <aside className="flex min-w-0 flex-col rounded-2xl border border-border-subtle bg-bg-surface px-5 py-4 shadow-sm">
      <div className="flex flex-wrap items-start gap-2">
        <h2 className="text-h3 font-semibold text-text-primary">Follow-up details</h2>
        <span className="flex-1" />
        <span
          className="inline-flex max-w-full items-start gap-2 rounded-xl px-3 py-2"
          style={{ background: tint(p.tone, 10) }}
          title="Suggested from what this lead has done — never a hidden score"
        >
          <Sparkles className="mt-0.5 size-3.5 shrink-0" style={{ color: ink(p.tone) }} aria-hidden="true" />
          <span className="min-w-0">
            <span className="block text-caption font-semibold" style={{ color: ink(p.tone) }}>
              Priority suggested: {p.level}
            </span>
            <span className="block text-caption text-text-secondary">{p.why}</span>
          </span>
          <Info className="mt-0.5 size-3.5 shrink-0 text-text-tertiary" aria-hidden="true" />
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <h3 className="text-[1.35rem] font-bold leading-tight text-text-primary">{f.leadName ?? 'Unnamed lead'}</h3>
        <span className="flex-1" />
        <StatusPill status={s} />
      </div>
      <p className="truncate text-body-sm text-text-secondary">{f.projectName ?? '—'}</p>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-2 border-t border-border-subtle pt-3">
        <div className="min-w-0">
          <p className="text-body font-semibold text-text-primary">{purposeLabel(f.purpose)}</p>
          <p className="truncate text-caption text-text-secondary">Owner: {f.ownerName ?? viewerName}</p>
        </div>
        <div className="shrink-0 text-right">
          {/* ⚠️ RED MEANS OWED. A cancelled row kept its old date, and painting
              that red said a closed follow-up was late. */}
          <p
            className="flex items-center justify-end gap-1.5 text-body-sm font-semibold text-text-primary"
            style={LATE.has(s) ? { color: ink('red') } : undefined}
          >
            <CalendarDays className="size-4 text-text-tertiary" aria-hidden="true" />
            {due.day}{due.time ? ` · ${due.time}` : ''}
          </p>
          <p className="text-caption text-text-secondary">
            {new Date(f.dueAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Karachi' })}
          </p>
        </div>
      </div>

      {/* ── Recent conversation ─────────────────────────────────────────── */}
      <div className="mt-3.5 border-t border-border-subtle pt-3">
        <div className="flex items-center gap-2">
          <h4 className="flex-1 text-body-sm font-semibold text-text-primary">Recent conversation</h4>
          <button type="button" onClick={onConversation} className="inline-flex items-center gap-1 text-caption font-semibold text-text-brand hover:underline">
            View conversation <ArrowRight className="size-3.5" aria-hidden="true" />
          </button>
        </div>
        {f.lastMessageBody ? (
          <div className="mt-2 flex items-start gap-2">
            <span className="mt-0.5 shrink-0" style={{ color: WA_GREEN }}>
              <WhatsAppMark className="size-4" />
            </span>
            <div
              className="min-w-0 flex-1 rounded-xl px-3 py-2"
              style={{ background: f.lastMessageDirection === 'inbound' ? 'var(--bg-subtle)' : tint('green', 10) }}
            >
              <p className="whitespace-pre-line break-words text-caption text-text-primary">
                {f.lastMessageBody.slice(0, 220)}
              </p>
              <p className="mt-1 text-caption text-text-tertiary">
                {f.lastMessageAt ? relativeWhen(f.lastMessageAt, nowMs) : ''}
                {f.lastMessageDirection === 'outbound' ? ' · sent by us' : ' · from the client'}
              </p>
            </div>
          </div>
        ) : (
          <p className="mt-2 text-caption text-text-tertiary">Nothing has been said in this chat yet.</p>
        )}
        {f.awaitingTheirReply && (
          <p className="mt-1.5 inline-block rounded-md bg-bg-subtle px-2 py-0.5 text-caption text-text-secondary">No reply yet</p>
        )}
      </div>

      {/* ── The facts ───────────────────────────────────────────────────── */}
      <dl className="mt-3.5 space-y-2 border-t border-border-subtle pt-3 text-body-sm">
        <Fact icon={MessageSquare} label="Channel" value={channelLabel(f.channel)} />
        <Fact icon={Building2} label="Business sender" value={f.businessSender ?? '—'} />
        <Fact
          icon={FileText}
          label="Related item"
          value={
            f.quotationNumber
              ? `${f.quotationNumber}${f.quotationStatus ? ` · ${f.quotationStatus.replace(/_/g, ' ')}` : ''}${f.quotationValidUntil ? ` · valid until ${new Date(f.quotationValidUntil).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Karachi' })}` : ''}`
              : f.appointmentRef
                ? `APPT-${f.appointmentRef}`
                : 'None'
          }
        />
        <Fact
          icon={Send}
          label="Execution mode"
          value={
            f.mode === 'auto_send'
              ? f.windowOpen
                ? 'Sent automatically · as a normal message'
                : `Sent automatically · as the template ${f.templateName ?? 'for this purpose'}`
              : 'A reminder for you — nothing is sent'
          }
        />
      </dl>

      {/* ── What will be sent ───────────────────────────────────────────── */}
      {(f.channel === 'whatsapp' || f.channel === 'email') && (
        <div className="mt-3.5 rounded-xl border border-border-subtle">
          <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2">
            <h4 className="flex-1 text-body-sm font-semibold text-text-primary">Message preview</h4>
            {open && editing === null && (
              <button type="button" onClick={() => setEditing(f.body ?? '')} className="inline-flex items-center gap-1 text-caption font-semibold text-text-brand hover:underline">
                <Pencil className="size-3.5" aria-hidden="true" /> Edit
              </button>
            )}
          </div>
          {editing === null ? (
            <p className="whitespace-pre-line break-words px-3 py-2.5 text-caption leading-relaxed text-text-primary">
              {filled || 'This follow-up has no message written.'}
            </p>
          ) : (
            <div className="px-3 py-2.5">
              <textarea
                autoFocus
                rows={6}
                value={editing}
                maxLength={4000}
                onChange={(e) => setEditing(e.target.value)}
                className="w-full resize-y rounded-lg border border-border-default bg-bg-base px-2.5 py-2 text-caption text-text-primary focus:border-accent-primary focus:outline-none"
              />
              <p className="mt-1 text-caption text-text-tertiary">
                {'{{lead_first_name}}, {{company}} and {{project}} are filled in when it sends.'}
              </p>
              <div className="mt-2 flex justify-end gap-2">
                <button type="button" onClick={() => setEditing(null)} className="rounded-lg px-2.5 py-1 text-caption font-medium text-text-secondary hover:bg-bg-subtle">
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={saving || !editing.trim()}
                  onClick={() => void save()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-accent-primary px-2.5 py-1 text-caption font-semibold text-white disabled:opacity-50"
                >
                  {saving && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />} Save
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Conditions and the sequence ─────────────────────────────────── */}
      <div className="mt-3.5 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-border-subtle p-3">
          <h4 className="text-body-sm font-semibold text-text-primary">Conditions</h4>
          <ul className="mt-2 space-y-1.5">
            <Condition on={f.sequenceRunId ? f.stopOnReply : true} text="Stop if the client replies" />
            <Condition on={f.sequenceRunId ? f.stopOnVisit : true} text="Stop once a visit is booked" />
            <Condition on={f.sequenceRunId ? f.stopOnQuotationDead : true} text="Stop if the quotation dies" />
            <Condition on={f.consent} text={f.consent ? 'Consent active' : 'No WhatsApp consent'} />
          </ul>
        </div>
        <div className="rounded-xl border border-border-subtle p-3">
          <h4 className="text-body-sm font-semibold text-text-primary">
            {f.steps.length > 0 ? 'Sequence preview' : 'This follow-up'}
          </h4>
          {f.steps.length > 0 ? (
            <ul className="mt-2 space-y-2">
              {f.steps.map((st) => (
                <li key={st.stepNo} className="flex items-start gap-2">
                  <span className="w-10 shrink-0 text-caption font-semibold text-text-secondary">Day {st.day}</span>
                  <ChannelMark channel={st.channel} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-caption font-medium text-text-primary">{channelLabel(st.channel)}</span>
                    <span className="block truncate text-caption text-text-secondary">{st.title}</span>
                  </span>
                  {st.stepNo === f.stepNo && (
                    <span className="shrink-0 rounded-full px-1.5 py-0.5 text-caption font-semibold" style={{ background: tint('red', 14), color: ink('red') }}>
                      {s === 'scheduled' ? 'Next' : 'Due now'}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-caption text-text-secondary">
              A one-off follow-up, not part of a sequence.
            </p>
          )}
        </div>
      </div>

      {/* ── What a person can do about it ───────────────────────────────── */}
      <div className="mt-auto flex flex-wrap gap-2 pt-4 [&>button]:min-w-fit [&>button]:flex-1 [&>button]:whitespace-nowrap">
        {open ? (
          <>
            <button type="button" onClick={onReschedule} className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-border-default px-3 py-2.5 text-[0.8rem] font-semibold text-text-primary transition-colors hover:bg-bg-subtle">
              <CalendarDays className="size-4" aria-hidden="true" /> Reschedule
            </button>
            {f.sequenceRunId ? (
              <button
                type="button"
                onClick={onStopSequence}
                className="inline-flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2.5 text-[0.8rem] font-semibold transition-colors hover:bg-bg-subtle"
                style={{ borderColor: 'color-mix(in oklab, var(--feedback-error) 55%, var(--border-default))', color: ink('red') }}
              >
                <Trash2 className="size-4" aria-hidden="true" /> Stop sequence
              </button>
            ) : (
              <button
                type="button"
                onClick={onCancel}
                className="inline-flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2.5 text-[0.8rem] font-semibold transition-colors hover:bg-bg-subtle"
                style={{ borderColor: 'color-mix(in oklab, var(--feedback-error) 55%, var(--border-default))', color: ink('red') }}
              >
                <X className="size-4" aria-hidden="true" /> Cancel it
              </button>
            )}
            {sendable ? (
              <button
                type="button"
                disabled={busy}
                onClick={onSend}
                className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-accent-primary px-3 py-2.5 text-[0.8rem] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Send className="size-4" aria-hidden="true" />}
                {/* ⚠️ Sending something scheduled for Thursday is an early send, and
                    the button says so rather than pretending its moment has come. */}
                {busy ? 'Sending…' : s === 'scheduled' ? 'Send it now' : 'Review & send'}
              </button>
            ) : (
              <button
                type="button"
                onClick={onMarkDone}
                className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-accent-primary px-3 py-2.5 text-[0.8rem] font-semibold text-white transition-opacity hover:opacity-90"
              >
                <CheckCircle2 className="size-4" aria-hidden="true" /> Mark done
              </button>
            )}
          </>
        ) : (
          <p className="rounded-xl bg-bg-subtle/60 px-3 py-2.5 text-caption text-text-secondary">
            {f.status === 'done'
              ? `Completed${f.doneAt ? ` · ${relativeWhen(f.doneAt, nowMs)}` : ''}${f.outcomeNote ? ` · ${f.outcomeNote}` : ''}`
              : f.status === 'failed'
                ? `Could not be sent${f.outcomeNote ? ` · ${f.outcomeNote}` : ''}`
                : `Stopped${f.outcomeNote ? ` · ${f.outcomeNote}` : ''}`}
          </p>
        )}
      </div>
    </aside>
  );
}

function Fact({ icon: Icon, label, value }: { icon: IconOf; label: string; value: string }) {
  return (
    <div className="grid grid-cols-[1.1rem_8rem_minmax(0,1fr)] items-start gap-2">
      <Icon className="mt-0.5 size-4 text-text-secondary" aria-hidden="true" />
      <dt className="text-text-secondary">{label}</dt>
      <dd className="min-w-0 break-words text-text-primary">{value}</dd>
    </div>
  );
}

function Condition({ on, text }: { on: boolean; text: string }) {
  return (
    <li className="flex items-center gap-2 text-caption">
      <span className="grid size-4 shrink-0 place-items-center rounded-full" style={{ background: on ? tint('green', 20) : tint('grey', 18) }}>
        {on ? <Check className="size-3" style={{ color: ink('green') }} aria-hidden="true" /> : <X className="size-3 text-text-tertiary" aria-hidden="true" />}
      </span>
      <span className={on ? 'text-text-primary' : 'text-text-tertiary'}>{text}</span>
    </li>
  );
}

const channelLabel = (c: string) =>
  c === 'whatsapp' ? 'WhatsApp' : c === 'email' ? 'Email' : c === 'call' ? 'WhatsApp call' : 'Task';

function relativeWhen(iso: string, nowMs: number): string {
  const mins = Math.round((nowMs - Date.parse(iso)) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

/* ── Dialogs ─────────────────────────────────────────────────────────────── */

function Shell({
  title,
  subtitle,
  onClose,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/40" />
      <div className="relative flex max-h-[92vh] w-full max-w-md flex-col rounded-2xl border border-border-subtle bg-bg-surface shadow-xl">
        <div className="flex items-start gap-3 border-b border-border-subtle px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-body font-semibold text-text-primary">{title}</h2>
            {subtitle && <p className="mt-0.5 truncate text-caption text-text-secondary">{subtitle}</p>}
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="grid size-7 shrink-0 place-items-center rounded-lg text-text-secondary hover:bg-bg-subtle">
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        <div className="flex justify-end gap-2 border-t border-border-subtle px-5 py-3.5">{footer}</div>
      </div>
    </div>
  );
}

const KARACHI_MS = 5 * 3_600_000;
const fields = (iso: string) => {
  const local = new Date(Date.parse(iso) + KARACHI_MS).toISOString();
  return { date: local.slice(0, 10), time: local.slice(11, 16) };
};
const instant = (date: string, time: string) => {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{2}):(\d{2})$/.exec(time);
  if (!d || !t) return null;
  return new Date(Date.UTC(+d[1], +d[2] - 1, +d[3], +t[1], +t[2]) - KARACHI_MS).toISOString();
};

function RescheduleDialog({
  followUp,
  nowMs,
  onClose,
  onMoved,
}: {
  followUp: BoardFollowUp;
  nowMs: number;
  onClose: () => void;
  onMoved: (at: string) => void;
}) {
  const toast = useToast();
  const was = fields(followUp.dueAt);
  const [date, setDate] = React.useState(was.date);
  const [time, setTime] = React.useState(was.time);
  const [busy, setBusy] = React.useState(false);
  const at = instant(date, time);

  const move = async () => {
    if (!at) return;
    setBusy(true);
    const r = await rescheduleFollowUpAction(followUp.id, followUp.leadId, at);
    setBusy(false);
    if (!r.ok) {
      toast({ tone: 'error', text: r.error ?? 'That could not be moved.' });
      return;
    }
    toast({ tone: 'ok', text: 'Moved.' });
    onMoved(at);
  };

  const quick = (days: number) => {
    const f = fields(new Date(nowMs + days * 86_400_000).toISOString());
    setDate(f.date);
    setTime('10:00');
  };

  return (
    <Shell
      title="Reschedule this follow-up"
      subtitle={`${followUp.leadName ?? 'this lead'} · ${purposeLabel(followUp.purpose)}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="rounded-xl border border-border-default px-3.5 py-2 text-body-sm font-medium text-text-primary hover:bg-bg-subtle">
            Keep it
          </button>
          <button
            type="button"
            disabled={busy || !at}
            onClick={() => void move()}
            className="inline-flex items-center gap-2 rounded-xl bg-accent-primary px-3.5 py-2 text-body-sm font-semibold text-white hover:opacity-90 disabled:opacity-40"
          >
            {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />} Move it
          </button>
        </>
      }
    >
      <div className="grid gap-2.5 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-caption font-semibold text-text-secondary">Date</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full rounded-lg border border-border-default bg-bg-base px-2.5 py-2 text-body-sm text-text-primary" />
        </label>
        <label className="block">
          <span className="mb-1 block text-caption font-semibold text-text-secondary">Time (Karachi)</span>
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="w-full rounded-lg border border-border-default bg-bg-base px-2.5 py-2 text-body-sm text-text-primary" />
        </label>
      </div>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {[['Tomorrow', 1], ['In 3 days', 3], ['Next week', 7]].map(([label, days]) => (
          <button
            key={String(label)}
            type="button"
            onClick={() => quick(Number(days))}
            className="rounded-full border border-border-default px-2.5 py-1 text-caption font-medium text-text-secondary hover:text-text-primary"
          >
            {label}
          </button>
        ))}
      </div>
      <p className="mt-2.5 text-caption text-text-secondary">
        Moving it changes only this step. The rest of the sequence keeps its own days.
      </p>
    </Shell>
  );
}

function DoneDialog({
  followUp,
  busy,
  onClose,
  onDone,
}: {
  followUp: BoardFollowUp;
  busy: boolean;
  onClose: () => void;
  onDone: (note: string) => void;
}) {
  const [note, setNote] = React.useState('');
  return (
    <Shell
      title="Mark this follow-up done"
      subtitle={`${followUp.leadName ?? 'this lead'} · ${purposeLabel(followUp.purpose)}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="rounded-xl border border-border-default px-3.5 py-2 text-body-sm font-medium text-text-primary hover:bg-bg-subtle">
            Not now
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onDone(note.trim())}
            className="inline-flex items-center gap-2 rounded-xl bg-accent-primary px-3.5 py-2 text-body-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />} Mark done
          </button>
        </>
      }
    >
      <label className="block">
        <span className="mb-1 block text-caption font-semibold text-text-secondary">What happened? (optional)</span>
        <textarea
          autoFocus
          rows={3}
          value={note}
          maxLength={2000}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Rang them — they will decide after the weekend."
          className="w-full resize-y rounded-lg border border-border-default bg-bg-base px-2.5 py-2 text-body-sm text-text-primary placeholder:text-text-tertiary focus:border-accent-primary focus:outline-none"
        />
      </label>
      <p className="mt-1.5 text-caption text-text-secondary">It is kept on the lead, so the next person knows what came of it.</p>
    </Shell>
  );
}

function LeadPicker({ onClose, onPick }: { onClose: () => void; onPick: (leadId: string) => void }) {
  const [leads, setLeads] = React.useState<Array<{ id: string; name: string; projectName: string | null }> | null>(null);
  const [q, setQ] = React.useState('');

  React.useEffect(() => {
    let alive = true;
    void bookableLeadsAction()
      .then((rows) => alive && setLeads(rows.map((l) => ({ id: l.id, name: l.name, projectName: l.projectName }))))
      .catch(() => alive && setLeads([]));
    return () => {
      alive = false;
    };
  }, []);

  const words = q.trim().toLowerCase();
  const shown = (leads ?? []).filter((l) => !words || `${l.name} ${l.projectName ?? ''}`.toLowerCase().includes(words));

  return (
    <Shell
      title="New follow-up"
      subtitle="Which lead is it for?"
      onClose={onClose}
      footer={
        <button type="button" onClick={onClose} className="rounded-xl border border-border-default px-3.5 py-2 text-body-sm font-medium text-text-primary hover:bg-bg-subtle">
          Cancel
        </button>
      }
    >
      <label className="flex items-center gap-2 rounded-lg border border-border-default bg-bg-base px-2.5 py-2">
        <Search className="size-4 shrink-0 text-text-tertiary" aria-hidden="true" />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search your leads…"
          className="min-w-0 flex-1 bg-transparent text-body-sm text-text-primary placeholder:text-text-tertiary focus:outline-none"
        />
      </label>
      <ul className="mt-2 max-h-72 overflow-y-auto">
        {leads === null ? (
          <li className="flex items-center gap-2 px-1 py-2 text-caption text-text-secondary">
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> Reading your leads…
          </li>
        ) : shown.length === 0 ? (
          <li className="px-1 py-2 text-caption text-text-secondary">
            {leads.length === 0 ? 'You have no open leads.' : 'No lead matches that.'}
          </li>
        ) : (
          shown.slice(0, 80).map((l) => (
            <li key={l.id}>
              <button
                type="button"
                onClick={() => onPick(l.id)}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-bg-subtle"
              >
                <span className="min-w-0 flex-1 truncate text-body-sm text-text-primary">{l.name}</span>
                <span className="max-w-[45%] shrink-0 truncate text-caption text-text-secondary">{l.projectName}</span>
              </button>
            </li>
          ))
        )}
      </ul>
    </Shell>
  );
}

function Opening({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-black/40 p-4" onMouseDown={onClose}>
      <p className="flex items-center gap-2 rounded-xl bg-bg-surface px-4 py-3 text-body-sm text-text-secondary shadow-xl">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Opening the follow-up planner…
      </p>
    </div>
  );
}
