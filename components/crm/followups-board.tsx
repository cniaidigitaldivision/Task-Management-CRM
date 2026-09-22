'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  ArrowRight,
  Building2,
  CalendarClock,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Clock3,
  FileText,
  Info,
  Layers,
  Loader2,
  Mail,
  MessageSquare,
  Pause,
  Pencil,
  Phone,
  Play,
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
import {
  cancelFollowUpAction,
  completeFollowUpAction,
  pauseSequenceAction,
  rescheduleSequenceAction,
  stopSequenceAction,
} from '@/app/actions/crm-followups';
import { leadBundlesAction } from '@/app/actions/crm-lead-bundles';
import { DateRangeButton, ink, RowMenu, tint } from '@/components/crm/appointments-board-parts';
import { EditLeadDetails } from '@/components/crm/edit-lead-details';
import { ConditionsButton, FollowUpConditionsDialog } from '@/components/crm/follow-up-conditions-dialog';
import { FollowUpWizard } from '@/components/crm/follow-up-wizard';
import { LeadDetailsModal } from '@/components/crm/lead-details-modal';
import { RelatedItemsDialog, seedRelated, type TabKey as RelatedTab } from '@/components/crm/related-items';
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
  VIEW_OPTIONS,
  viewOf,
  type BoardFilters,
  type DisplayStatus,
  type TabKey,
} from '@/lib/domain/crm-followup-board';
import { seedConditions } from '@/lib/domain/crm-followup-conditions';
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

/**
 * A still status tile — white, unclickable, colour only in the icon.
 *
 * ⚠️ NOT `StatCard`. That one is the Appointments page's, where the owner
 * asked for colourful cards that filter when clicked. Here they asked for the
 * opposite, and one component serving both would have to be told which owner
 * request it was obeying.
 */
function StatTile({
  label,
  count,
  tone,
  icon: Icon,
  alarm = false,
}: {
  label: string;
  count: number;
  tone: 'blue' | 'red' | 'amber' | 'green';
  icon: IconOf;
  alarm?: boolean;
}) {
  return (
    <div className="flex items-center gap-4 rounded-2xl border border-border-subtle bg-bg-surface px-5 py-4 shadow-sm">
      <span className="grid size-11 shrink-0 place-items-center rounded-xl" style={{ background: tint(tone, 14) }}>
        <Icon className="size-5" style={{ color: ink(tone) }} />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-body-sm font-semibold text-text-primary">{label}</span>
        <span
          className="block text-[1.75rem] font-bold leading-tight tabular-nums text-text-primary"
          /* Only the count that means somebody is late carries colour. */
          style={alarm && count > 0 ? { color: ink(tone) } : undefined}
        >
          {count}
        </span>
      </span>
    </div>
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
  | { kind: 'conditions'; id: string }
  | { kind: 'seq-resume'; id: string }
  | { kind: 'lead'; leadId: string }
  | { kind: 'related'; leadId: string; tab: RelatedTab }
  | { kind: 'edit'; leadId: string }
  | null;

export function FollowUpsBoard({
  followUps,
  sequences,
  nowMs,
  viewerName,
  windowFrom,
  startTab = 'scheduled',
}: {
  followUps: readonly BoardFollowUp[];
  sequences: readonly BoardSequence[];
  nowMs: number;
  viewerName: string;
  windowFrom: string;
  startTab?: TabKey;
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

  /* ⚠️ OPENS ON SCHEDULED. Owner, 2026-09-22: *"by default when the page
     loads, the schedule tab should open or should be selected."* The prop is
     the seam a `?tab=` deep link would use, and it is what lets a render test
     reach a tab it cannot click. */
  const [tab, setTab] = React.useState<TabKey>(startTab);
  /* ⚠️ TEN A PAGE, PAGED ON THE CLIENT. Owner, 2026-09-22: *"in the completed
     follow-ups, it should display 10 follow-ups and add pagination. Make sure
     that pagination page switching will not take too much time … It should be
     instant."* So the page turn is a slice of rows already in memory — no
     round trip, no query, nothing to wait for (Rule Zero). The QUERY's own
     ceiling is 400 rows over 30 days, which is what keeps this honest as the
     business grows. */
  const [page, setPage] = React.useState(0);
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

  /* Any change to what is being looked at starts at the first page again —
     adjusted during the render, never in an effect. */
  const [pageKey, setPageKey] = React.useState('');
  const key = `${tab}|${filters.q}|${filters.due}|${filters.purpose}|${filters.channel}|${filters.project}|${filters.from}|${filters.to}`;
  if (pageKey !== key) {
    setPageKey(key);
    setPage(0);
  }
  const pages = Math.max(1, Math.ceil(shown.length / PER_PAGE));
  const onPage = Math.min(page, pages - 1);
  const pageRows = shown.slice(onPage * PER_PAGE, onPage * PER_PAGE + PER_PAGE);

  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const selected = shown.find((r) => r.id === selectedId) ?? pageRows[0] ?? null;
  /* The Sequences tab selects a sequence, not a follow-up — its own state, so
     moving between tabs loses neither choice. */
  const [selectedSeqId, setSelectedSeqId] = React.useState<string | null>(null);
  const seq = sequences.find((q) => q.id === selectedSeqId) ?? sequences[0] ?? null;

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

  const pauseSeq = async (q: BoardSequence) => {
    setBusy(q.id);
    const r = await pauseSequenceAction(q.id);
    setBusy(null);
    toast(
      r.ok
        ? { tone: 'ok', text: 'Paused. Nothing goes out until you resume it.' }
        : { tone: 'error', text: r.error ?? 'That did not save.' },
    );
    if (r.ok) refresh();
  };

  const stopSeqById = async (id: string) => {
    setBusy(id);
    const r = await stopSequenceAction(id);
    setBusy(null);
    toast(
      r.ok
        ? { tone: 'ok', text: 'Sequence stopped. Nothing further will go out.' }
        : { tone: 'error', text: r.error ?? 'That did not save.' },
    );
    if (r.ok) refresh();
  };

  /**
   * The lead, in place.
   *
   * Owner, 2026-09-22: *"if I am on a follow-up page I want to see that
   * relevant row data or a row detail. It should pop up here so I can see that
   * detail and then I will close it if I don't want to go to that page."*
   * — and separately: *"unless it is an open conversation then you will bring
   * me to the conversation page. That's fine but for the detail of a lead it
   * should not bring me to the lead page."*
   *
   * ⚠️ THE PANEL OPENS IN THIS FRAME and the bundle arrives underneath
   * (Rule Zero, law 1) — the same `LeadDetailsModal` the Appointments page
   * uses, so the two screens behave identically.
   */
  const openLead = (leadId: string) => {
    setDialog({ kind: 'lead', leadId });
    if (!bundles[leadId]) {
      void leadBundlesAction([leadId]).then((r) => setBundles((prev) => ({ ...prev, ...r.bundles })));
    }
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
        /* ⚠️ STAYS ON THIS PAGE. Owner, 2026-09-22: *"when I want to see
           anything, like lead information or 'Open the lead' … it should not
           bring me to that page. It should display the basic information over
           here."* The lead panel carries the quotation and its status. */
        openLead(f.leadId);
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

      {/* ⚠️ THESE ARE NOT TABS AND THEY DO NOT CLICK. Owner, 2026-09-22:
          *"These are just cards to show the status. These are not tabs. I don't
          want them colorful because they are not clickable. They are just
          tinted and still. I want them in the same exact color, a white color,
          and these colored icons are fine."* So: one white surface for all
          four, colour only in the icon, and no button, no hover, no pressed
          state — nothing that promises something will happen.
          The Appointments cards ARE clickable and stay colourful, which is why
          this is a tile of its own rather than a change to `StatCard`. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Due today" count={counts.dueToday} tone="blue" icon={CalendarDays} />
        <StatTile label="Overdue" count={counts.overdue} tone="red" icon={AlertCircle} alarm />
        <StatTile label="Reply needed" count={counts.replyNeeded} tone="amber" icon={MessageSquare} />
        <StatTile label="Active sequences" count={counts.activeSequences} tone="green" icon={Layers} />
      </div>

      {/* ── Tabs ───────────────────────────────────────────────────────── */}
      {/* ⚠️ HIGHLIGHTED AND UNDERLINED, exactly as the owner drew it on
          2026-09-22: *"These are tabs and I want the UI … they are highlighted
          and they are underlined. I want this type of design."*

          It was an underline before, and they could not see it (*"which tab is
          selected … is not visible"*) — so this keeps their design and makes
          it findable: a 3px accent bar, the label in the accent colour and
          semibold, and a hairline under the whole strip for the bar to sit on.
          The count that carried the visibility in between is gone; the queue's
          own heading already says how many rows are in view. */}
      <div className="flex flex-wrap items-center gap-6 border-b border-border-subtle" role="tablist" aria-label="Which follow-ups">
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
                '-mb-px pb-2.5 pt-1 text-body-sm transition-colors',
                on ? 'font-semibold text-accent-primary' : 'font-medium text-text-secondary hover:text-text-primary',
              )}
              /* ⚠️ THE BAR IS SET HERE, NOT IN A CLASS. Measured on the running
                 page, 2026-09-22: the selected tab's border came out
                 `2.22px solid rgb(211, 225, 226)` — border-subtle, the global
                 default — while its text was correctly teal. The colour class
                 was not winning, so the owner saw *"their underline is not
                 visible"*. A token read straight from the variable cannot lose. */
              style={{
                borderBottomStyle: 'solid',
                /* 3px measured as 2px painted at the app's 0.9 body zoom, which is
                   what "not visible" looked like. 4px survives the rounding. */
                borderBottomWidth: '4px',
                borderBottomColor: on ? 'var(--accent-primary)' : 'transparent',
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {/* ── Filters, all on one row ─────────────────────────── */}
      {/* ⚠️ ONE CONTROL PER QUESTION. Owner, 2026-09-22: *"due status and
          view/saved view mostly show the same thing. For due status mark them
          with the saved view status and add the custom range filter here"* —
          and *"make sure that all filters will be displayed in one row."*
          So: search, one View (which carries the due statuses), purpose,
          channel, project, and a date range. `flex-nowrap` with a scroll is
          deliberate: they asked for one row, and wrapping at a narrow width
          would break that promise rather than keep it.

          ⚠️ AND IT DOES NOT SCROLL. `overflow-x-auto` here CLIPPED the date
          range's popover and gave the strip a scrollbar the moment it opened
          (owner, 2026-09-22: *"when I click on the date range it adds a
          scrollbar"*) — an absolutely positioned panel cannot escape a
          scrolling ancestor. It wraps instead: one row at every width these
          controls fit, and a second row rather than a clipped calendar when
          they genuinely do not. */}
      <div className="flex flex-wrap items-end gap-2">
        <label className={cn(CONTROL, 'flex min-w-[12rem] flex-1 items-center gap-2 px-3')}>
          <Search className="size-4 shrink-0 text-text-tertiary" aria-hidden="true" />
          <input
            value={filters.q}
            onChange={(e) => set({ q: e.target.value })}
            placeholder="Search lead, project or related item…"
            aria-label="Search lead, project or related item"
            className="min-w-0 flex-1 bg-transparent placeholder:text-text-tertiary focus:outline-none"
          />
        </label>
        {/* ⚠️ SECOND, NOT LAST. Owner, 2026-09-22: *"still when I click on the
            date range filter, it is cutting from the right side or hiding. One
            more possibility is to move this date filter to the second
            position."* Measured at the end of the row: the 259px panel opened
            at x=1347 in a 1512px viewport, so 94px of it was off the screen and
            the shell's horizontal clip meant no scrollbar ever said so. Second
            place gives it the whole row to open into. */}
        <Field label="Date range">
          <DateRangeButton
            from={filters.from}
            to={filters.to}
            nowMs={nowMs}
            onChange={(from, to) => set({ from, to })}
          />
        </Field>
        <Field label="View">
          <select
            aria-label="View"
            value={viewOf(filters)}
            onChange={(e) => {
              const v = VIEW_OPTIONS.find((o) => o.value === e.target.value);
              if (!v) return;
              /* A view keeps the search and the range a person has typed. */
              setFilters((f) => ({ ...NO_FILTERS, q: f.q, from: f.from, to: f.to, ...v.filters }));
              if (v.tab) setTab(v.tab);
            }}
            className={cn(CONTROL, 'w-[11rem] shrink-0 px-2.5')}
          >
            {VIEW_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Purpose">
          <select
            aria-label="Purpose"
            value={filters.purpose}
            onChange={(e) => set({ purpose: e.target.value })}
            className={cn(CONTROL, 'w-[9.5rem] shrink-0 px-2.5')}
          >
            <option value="all">All</option>
            {purposes.map((x) => <option key={x} value={x}>{purposeLabel(x)}</option>)}
          </select>
        </Field>
        <Field label="Channel">
          <select
            aria-label="Channel"
            value={filters.channel}
            onChange={(e) => set({ channel: e.target.value })}
            className={cn(CONTROL, 'w-[8rem] shrink-0 px-2.5')}
          >
            {CHANNEL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </Field>
        <Field label="Project">
          <select
            aria-label="Project"
            value={filters.project}
            onChange={(e) => set({ project: e.target.value })}
            className={cn(CONTROL, 'w-[9.5rem] shrink-0 px-2.5')}
          >
            <option value="all">All</option>
            {projects.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </Field>
      </div>

      {/* ⚠️ EVERY TAB HAS THE SAME SHAPE. Owner, 2026-09-22: *"how pathetic is
          the way you are showing that the sequences are two leads? Please show
          them in a proper same rhythm. The others, like my queue, scheduled and
          completed, should be displayed in the same rhythm on both the right
          side and the left side, where the details will be displayed."*
          The Sequences tab was a strip of little cards with nothing on the
          right — it is a table and a details panel now, like the rest. */}
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,29rem)]">
        <section className="min-w-0 rounded-2xl border border-border-subtle bg-bg-surface py-4 shadow-sm">
          <div className="flex flex-wrap items-center gap-2 px-5 pb-3">
            <h2 className="text-h3 font-semibold text-text-primary">
              {tab === 'queue' ? 'My follow-up queue' : tab === 'scheduled' ? 'Scheduled' : tab === 'sequences' ? 'Running sequences' : 'Completed'}
            </h2>
            <span className="flex-1" />
            <span className="text-caption text-text-secondary">
              {tab === 'sequences'
                ? `${sequences.length} sequence${sequences.length === 1 ? '' : 's'}`
                : `${shown.length} follow-up${shown.length === 1 ? '' : 's'}`}
            </span>
          </div>

          {tab === 'sequences' ? (
            sequences.length === 0 ? (
              <Empty tab={tab} anyAtAll={rows.length > 0} hasSequences={false} onNew={() => setDialog({ kind: 'new' })} />
            ) : (
              <SequenceTable
                sequences={sequences}
                rows={rows}
                nowMs={nowMs}
                selectedId={seq?.id ?? null}
                onSelect={setSelectedSeqId}
                menuFor={(q) => [
                  { label: 'Open the conversation', onSelect: () => router.push(`/conversations?lead=${q.leadId}` as Route) },
                  { label: 'View lead details', onSelect: () => openLead(q.leadId) },
                  ...(q.state === 'paused'
                    ? [{ label: 'Resume it…', onSelect: () => setDialog({ kind: 'seq-resume', id: q.id }) }]
                    : [{ label: 'Pause it', onSelect: () => void pauseSeq(q) }]),
                  { label: 'Move the next step…', onSelect: () => setDialog({ kind: 'seq-resume', id: q.id }) },
                  { label: 'Stop the sequence', onSelect: () => void stopSeqById(q.id), danger: true },
                ]}
              />
            )
          ) : shown.length === 0 ? (
            <Empty
              tab={tab}
              anyAtAll={rows.length > 0}
              hasSequences={sequences.length > 0}
              onNew={() => setDialog({ kind: 'new' })}
            />
          ) : (
            <QueueTable
              rows={pageRows}
              nowMs={nowMs}
              selectedId={selected?.id ?? null}
              busy={busy}
              onSelect={setSelectedId}
              onAct={act}
              actionLabel={(f) => ACTION_LABEL[rowAction(f, nowMs)]}
              onSend={(f) => void send(f)}
              menuFor={(f) => [
                { label: 'Open the conversation', onSelect: () => router.push(`/conversations?lead=${f.leadId}` as Route) },
                { label: 'View lead details', onSelect: () => openLead(f.leadId) },
                { label: 'Add another follow-up', onSelect: () => openLeadWizard(f.leadId) },
                ...(isOpen(f)
                  ? [{ label: 'Advanced settings…', onSelect: () => setDialog({ kind: 'conditions', id: f.id }) }]
                  : []),
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

          {tab !== 'sequences' && shown.length > PER_PAGE && (
            <Pager
              page={onPage}
              pages={pages}
              from={onPage * PER_PAGE + 1}
              to={Math.min(shown.length, onPage * PER_PAGE + PER_PAGE)}
              total={shown.length}
              onPage={setPage}
            />
          )}
        </section>

        {tab === 'sequences' ? (
          seq ? (
            <SequenceDetails
              q={seq}
              rows={rows.filter((r) => r.sequenceRunId === seq.id)}
              nowMs={nowMs}
              busy={busy === seq.id}
              onPause={() => void pauseSeq(seq)}
              onResume={() => setDialog({ kind: 'seq-resume', id: seq.id })}
              onStop={() => void stopSeqById(seq.id)}
              onConversation={() => router.push(`/conversations?lead=${seq.leadId}` as Route)}
              onLead={() => openLead(seq.leadId)}
            />
          ) : (
            <aside className="grid place-items-center rounded-2xl border border-border-subtle bg-bg-surface p-6 text-center shadow-sm">
              <p className="text-body-sm text-text-secondary">Pick a sequence to see its steps.</p>
            </aside>
          )
        ) : selected ? (
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
            onConditions={() => setDialog({ kind: 'conditions', id: selected.id })}
            onSaved={(body) => patch(selected.id, { body })}
          />
        ) : (
          <aside className="grid place-items-center rounded-2xl border border-border-subtle bg-bg-surface p-6 text-center shadow-sm">
            <p className="text-body-sm text-text-secondary">
              Pick a follow-up to see what will be sent, and to reach its advanced settings.
            </p>
          </aside>
        )}
      </div>

      <p className="text-caption text-text-secondary">
        Showing everything still open, and what was completed since {windowFrom}.
      </p>

      {dialog?.kind === 'lead' && (
        <LeadDetailsModal
          leadId={dialog.leadId}
          bundle={bundles[dialog.leadId] ?? null}
          fallbackName={rows.find((r) => r.leadId === dialog.leadId)?.leadName ?? 'Lead'}
          viewerName={viewerName}
          nowMs={nowMs}
          onClose={() => setDialog(null)}
          onEdit={() => setDialog({ kind: 'edit', leadId: dialog.leadId })}
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
          onClose={() => setDialog({ kind: 'lead', leadId: dialog.leadId })}
          onChooseUnit={() => setDialog({ kind: 'lead', leadId: dialog.leadId })}
          onRecordOutcome={() => setDialog({ kind: 'lead', leadId: dialog.leadId })}
          onAttach={() => {
            /* A file is sent from the lead's own WhatsApp tab, where the
               composer is — this page has none. Said, and taken there. */
            setDialog(null);
            toast({ tone: 'ok', text: 'Opening the conversation — attach and send it from there.' });
            router.push(`/conversations?lead=${dialog.leadId}` as Route);
          }}
        />
      )}
      {dialog?.kind === 'edit' && bundles[dialog.leadId] && (
        <EditLeadDetails
          lead={bundles[dialog.leadId].record.lead}
          onClose={() => setDialog({ kind: 'lead', leadId: dialog.leadId })}
        />
      )}
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
      {dialog?.kind === 'seq-resume' && sequences.some((q) => q.id === dialog.id) && (
        <SequenceWhenDialog
          q={sequences.find((q) => q.id === dialog.id)!}
          nowMs={nowMs}
          onClose={() => setDialog(null)}
          onMoved={() => {
            setDialog(null);
            refresh();
          }}
        />
      )}
      {dialog?.kind === 'conditions' && byId(dialog.id) && (
        <FollowUpConditionsDialog
          followUpId={dialog.id}
          leadId={byId(dialog.id)!.leadId}
          leadName={byId(dialog.id)!.leadName}
          projectName={byId(dialog.id)!.projectName}
          ownerName={byId(dialog.id)!.ownerName ?? viewerName}
          propertyLabel={byId(dialog.id)!.propertyLabel}
          dueAt={byId(dialog.id)!.dueAt}
          seed={seedConditions(byId(dialog.id)!, nowMs)}
          onClose={() => setDialog(null)}
          onSaved={refresh}
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

/** Ten a page, and the turn is a slice of what is already here. */
const PER_PAGE = 10;

function Pager({
  page,
  pages,
  from,
  to,
  total,
  onPage,
}: {
  page: number;
  pages: number;
  from: number;
  to: number;
  total: number;
  onPage: (n: number) => void;
}) {
  /* At most seven numbers, always including the first and the last. */
  const nums: number[] = [];
  const push = (n: number) => {
    if (n >= 0 && n < pages && !nums.includes(n)) nums.push(n);
  };
  push(0);
  for (let d = -1; d <= 1; d += 1) push(page + d);
  push(pages - 1);
  nums.sort((a, b) => a - b);

  const step = 'grid size-8 place-items-center rounded-lg border border-border-default text-body-sm font-medium text-text-primary transition-colors hover:bg-bg-subtle disabled:opacity-40';

  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-border-subtle px-5 pt-3">
      <p className="min-w-0 flex-1 text-caption text-text-secondary">
        {from}–{to} of {total}
      </p>
      <button type="button" aria-label="Previous page" disabled={page === 0} onClick={() => onPage(page - 1)} className={step}>
        <ChevronLeft className="size-4" aria-hidden="true" />
      </button>
      {nums.map((n, i) => (
        <React.Fragment key={n}>
          {i > 0 && n - nums[i - 1] > 1 && <span className="px-0.5 text-caption text-text-tertiary">…</span>}
          <button
            type="button"
            aria-current={n === page ? 'page' : undefined}
            onClick={() => onPage(n)}
            className={cn(
              'grid size-8 place-items-center rounded-lg text-body-sm font-semibold transition-colors',
              n === page
                ? 'bg-accent-primary text-white'
                : 'border border-border-default text-text-primary hover:bg-bg-subtle',
            )}
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
      >
        <ChevronRight className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}

/* ── The Sequences tab, in the same shape as every other tab ─────────────── */

const SEQ_COLS =
  'minmax(0,1.45fr) minmax(0,1.3fr) minmax(0,0.7fr) minmax(0,0.95fr) minmax(0,1.05fr) minmax(0,0.75fr)';

/** What a sequence is doing, in the same vocabulary the rows use. */
function seqLook(q: BoardSequence): { label: string; tone: 'green' | 'amber' | 'blue' } {
  if (q.state === 'paused') return { label: q.pauseReason ? `Paused · ${q.pauseReason}` : 'Paused', tone: 'amber' };
  if (q.state === 'scheduled') return { label: 'Not started', tone: 'blue' };
  return { label: 'Running', tone: 'green' };
}

function SequenceTable({
  sequences,
  rows,
  nowMs,
  selectedId,
  onSelect,
  menuFor,
}: {
  sequences: readonly BoardSequence[];
  rows: readonly BoardFollowUp[];
  nowMs: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  menuFor: (q: BoardSequence) => ReadonlyArray<{ label: string; onSelect: () => void; danger?: boolean }>;
}) {
  return (
    <div>
      <div
        className="grid items-center gap-3 border-y border-border-subtle bg-bg-subtle/40 px-5 py-2.5 text-caption font-semibold text-text-secondary"
        style={{ gridTemplateColumns: SEQ_COLS }}
      >
        <span>Lead / project</span>
        <span>Sequence</span>
        <span>Step</span>
        <span>Next step</span>
        <span>Status</span>
        <span className="text-right">Actions</span>
      </div>
      <div>
        {sequences.map((q) => {
          const on = q.id === selectedId;
          const look = seqLook(q);
          const next = q.nextStepAt ? dueLine(q.nextStepAt, nowMs, 'scheduled') : null;
          const mine = rows.filter((r) => r.sequenceRunId === q.id);
          const sent = mine.filter((r) => r.status === 'done').length;
          return (
            <div
              key={q.id}
              role="button"
              tabIndex={0}
              aria-pressed={on}
              onClick={(e) => {
                const hit = (e.target as HTMLElement).closest('a, button, [role="menu"]');
                if (hit && hit !== e.currentTarget) return;
                onSelect(q.id);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && e.target === e.currentTarget) onSelect(q.id);
              }}
              className={cn(
                'grid cursor-pointer items-center gap-3 border-b border-l-[3px] border-b-border-subtle px-5 py-3 transition-colors',
                on ? 'border-l-accent-primary' : 'border-l-transparent hover:bg-bg-subtle/60',
              )}
              style={{ gridTemplateColumns: SEQ_COLS, background: on ? tint('blue', 6) : undefined }}
            >
              <span className="min-w-0">
                <span className="block truncate text-body-sm font-semibold text-text-primary">
                  {q.leadName ?? 'Unnamed lead'}
                </span>
                <span className="block truncate text-caption text-text-secondary">{q.projectName ?? '—'}</span>
              </span>
              <span className="min-w-0">
                <span className="block truncate text-body-sm text-text-primary">{q.name}</span>
                <span className="block truncate text-caption text-text-secondary">{purposeLabel(q.purpose)}</span>
              </span>
              <span className="min-w-0">
                <span className="block text-body-sm font-semibold text-text-primary">
                  {q.step} of {q.total}
                </span>
                <span className="block truncate text-caption text-text-secondary">
                  {sent} sent
                </span>
              </span>
              <span className="min-w-0">
                {next ? (
                  <>
                    <span className="block truncate text-body-sm text-text-primary">{next.day}</span>
                    {next.time && <span className="block truncate text-caption text-text-secondary">{next.time}</span>}
                  </>
                ) : (
                  <span className="text-body-sm text-text-tertiary">—</span>
                )}
              </span>
              <span className="min-w-0">
                <span
                  className="inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-caption font-semibold leading-tight"
                  style={{ background: tint(look.tone, 14), color: ink(look.tone) }}
                >
                  <Layers className="size-3.5 shrink-0" aria-hidden="true" />
                  <span className="truncate">{look.label}</span>
                </span>
              </span>
              <span className="flex items-center justify-end">
                <RowMenu items={menuFor(q)} label={`More for ${q.leadName ?? 'this sequence'}`} />
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The right-hand column for a sequence — the same frame as `DetailsPanel`:
 * who it is for, where it has got to, every step with what actually happened to
 * it, and what a person can do about it.
 */
function SequenceDetails({
  q,
  rows,
  nowMs,
  busy,
  onPause,
  onResume,
  onStop,
  onConversation,
  onLead,
}: {
  q: BoardSequence;
  rows: readonly BoardFollowUp[];
  nowMs: number;
  busy: boolean;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onConversation: () => void;
  onLead: () => void;
}) {
  const look = seqLook(q);
  /* The plan is on any of its rows; a run with nothing queued yet has none. */
  const plan = rows.find((r) => r.steps.length > 0)?.steps ?? [];
  const byStep = new Map(rows.map((r) => [r.stepNo ?? 0, r]));
  const next = q.nextStepAt ? dueLine(q.nextStepAt, nowMs, 'scheduled') : null;

  return (
    <aside className="flex min-w-0 flex-col rounded-2xl border border-border-subtle bg-bg-surface px-5 py-4 shadow-sm">
      <div className="flex flex-wrap items-start gap-2">
        <h2 className="text-h3 font-semibold text-text-primary">Sequence details</h2>
        <span className="flex-1" />
        <span
          className="inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-caption font-semibold"
          style={{ background: tint(look.tone, 14), color: ink(look.tone) }}
        >
          <Layers className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{look.label}</span>
        </span>
      </div>

      <h3 className="mt-3 text-[1.35rem] font-bold leading-tight text-text-primary">{q.leadName ?? 'Unnamed lead'}</h3>
      <p className="truncate text-body-sm text-text-secondary">{q.projectName ?? '—'}</p>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-2 border-t border-border-subtle pt-3">
        <div className="min-w-0">
          <p className="text-body font-semibold text-text-primary">{q.name}</p>
          <p className="truncate text-caption text-text-secondary">{purposeLabel(q.purpose)}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-body-sm font-semibold text-text-primary">
            Step {q.step} of {q.total}
          </p>
          <p className="text-caption text-text-secondary">
            {next ? `Next ${next.day}${next.time ? ` · ${next.time}` : ''}` : 'Nothing scheduled'}
          </p>
        </div>
      </div>

      {/* ── Every step, and what became of it ────────────────────── */}
      <div className="mt-3.5 border-t border-border-subtle pt-3">
        <h4 className="text-body-sm font-semibold text-text-primary">The plan</h4>
        {plan.length === 0 ? (
          <p className="mt-2 text-caption text-text-secondary">
            No step has been queued yet, so its plan is not on this screen. Opening the lead shows the whole sequence.
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {plan.map((st) => {
              const row = byStep.get(st.stepNo);
              const state = !row
                ? { text: st.stepNo <= q.step ? 'Sent' : 'Not queued yet', tone: 'grey' as const }
                : row.status === 'done'
                  ? { text: 'Sent', tone: 'green' as const }
                  : row.status === 'failed'
                    ? { text: 'Failed', tone: 'red' as const }
                    : row.status === 'cancelled' || row.status === 'skipped'
                      ? { text: 'Stopped', tone: 'grey' as const }
                      : { text: displayStatus(row, nowMs) === 'scheduled' ? 'Queued' : 'Due now', tone: 'blue' as const };
              return (
                <li key={st.stepNo} className="flex items-start gap-2">
                  <span className="w-10 shrink-0 pt-1.5 text-caption font-semibold text-text-secondary">Day {st.day}</span>
                  <ChannelMark channel={st.channel} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-caption font-medium text-text-primary">{st.title}</span>
                    <span className="block truncate text-caption text-text-secondary">
                      {channelLabel(st.channel)}
                      {row?.dueAt ? ` · ${dueLine(row.dueAt, nowMs, displayStatus(row, nowMs)).day}` : ''}
                    </span>
                  </span>
                  <span
                    className="shrink-0 rounded-full px-1.5 py-0.5 text-caption font-semibold"
                    style={{ background: tint(state.tone, 14), color: ink(state.tone) }}
                  >
                    {state.text}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <dl className="mt-3.5 space-y-2 border-t border-border-subtle pt-3 text-body-sm">
        <Fact
          icon={CalendarDays}
          label="Started"
          value={new Date(q.startedAt).toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            timeZone: 'Asia/Karachi',
          })}
        />
        <Fact icon={Layers} label="Steps sent" value={`${rows.filter((r) => r.status === 'done').length} of ${q.total}`} />
        <Fact
          icon={MessageSquare}
          label="Stops on"
          value={
            [
              rows[0]?.stopOnReply === false ? null : 'a reply',
              rows[0]?.stopOnVisit === false ? null : 'a booking',
              rows[0]?.stopOnQuotationDead === false ? null : 'a dead quotation',
            ]
              .filter(Boolean)
              .join(', ') || 'nothing — it runs to the end'
          }
        />
      </dl>

      <div className="mt-auto flex flex-wrap gap-2 pt-4 [&>button]:min-w-fit [&>button]:flex-1 [&>button]:whitespace-nowrap">
        <button
          type="button"
          onClick={onConversation}
          className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-border-default px-3 py-2.5 text-[0.8rem] font-semibold text-text-primary transition-colors hover:bg-bg-subtle"
        >
          <MessageSquare className="size-4" aria-hidden="true" /> Conversation
        </button>
        <button
          type="button"
          onClick={onLead}
          className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-border-default px-3 py-2.5 text-[0.8rem] font-semibold text-text-primary transition-colors hover:bg-bg-subtle"
        >
          <ArrowRight className="size-4" aria-hidden="true" /> Open the lead
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onStop}
          className="inline-flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2.5 text-[0.8rem] font-semibold transition-colors hover:bg-bg-subtle disabled:opacity-50"
          style={{ borderColor: 'color-mix(in oklab, var(--feedback-error) 55%, var(--border-default))', color: ink('red') }}
        >
          <Trash2 className="size-4" aria-hidden="true" /> Stop
        </button>
        {q.state === 'paused' ? (
          <button
            type="button"
            disabled={busy}
            onClick={onResume}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-accent-primary px-3 py-2.5 text-[0.8rem] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Play className="size-4" aria-hidden="true" />}
            Resume
          </button>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={onPause}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-accent-primary px-3 py-2.5 text-[0.8rem] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Pause className="size-4" aria-hidden="true" />}
            Pause
          </button>
        )}
      </div>
    </aside>
  );
}

/**
 * When the next step should go — which is what Resume means here.
 *
 * ⚠️ THE SAME FUNCTION DECIDES BOTH. `rescheduleSequence` asks the engine's own
 * stop-conditions before committing, so resuming something the engine would
 * immediately stop is refused with the reason rather than accepted and dropped.
 */
function SequenceWhenDialog({
  q,
  nowMs,
  onClose,
  onMoved,
}: {
  q: BoardSequence;
  nowMs: number;
  onClose: () => void;
  onMoved: () => void;
}) {
  const toast = useToast();
  const was = fields(q.nextStepAt ?? new Date(nowMs + 86_400_000).toISOString());
  const [date, setDate] = React.useState(was.date);
  const [time, setTime] = React.useState(was.time === '00:00' ? '10:00' : was.time);
  const [busy, setBusy] = React.useState(false);
  const at = instant(date, time);

  const move = async () => {
    if (!at) return;
    setBusy(true);
    const r = await rescheduleSequenceAction(q.id, at);
    setBusy(false);
    if (!r.ok) {
      toast({ tone: 'error', text: r.error ?? 'That could not be moved.' });
      return;
    }
    toast({ tone: 'ok', text: q.state === 'paused' ? 'Resumed.' : 'The next step was moved.' });
    onMoved();
  };

  return (
    <Shell
      title={q.state === 'paused' ? 'Resume this sequence' : 'Move the next step'}
      subtitle={`${q.leadName ?? 'this lead'} · ${q.name}`}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-border-default px-3.5 py-2 text-body-sm font-medium text-text-primary hover:bg-bg-subtle"
          >
            Leave it
          </button>
          <button
            type="button"
            disabled={busy || !at}
            onClick={() => void move()}
            className="inline-flex items-center gap-2 rounded-xl bg-accent-primary px-3.5 py-2 text-body-sm font-semibold text-white hover:opacity-90 disabled:opacity-40"
          >
            {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            {q.state === 'paused' ? 'Resume it' : 'Move it'}
          </button>
        </>
      }
    >
      <div className="grid gap-2.5 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-caption font-semibold text-text-secondary">Date</span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full rounded-lg border border-border-default bg-bg-base px-2.5 py-2 text-body-sm text-text-primary"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-caption font-semibold text-text-secondary">Time (Karachi)</span>
          <input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className="w-full rounded-lg border border-border-default bg-bg-base px-2.5 py-2 text-body-sm text-text-primary"
          />
        </label>
      </div>
      <p className="mt-2.5 text-caption text-text-secondary">
        Step {q.step + 1} of {q.total} goes at this time; the steps after it keep their own spacing.
        {q.state === 'paused' && q.pauseReason ? ` It was paused because ${q.pauseReason.toLowerCase()}.` : ''}
      </p>
    </Shell>
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
  onConditions,
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
  onConditions: () => void;
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
          <div className="flex items-start gap-2">
            <h4 className="flex-1 text-body-sm font-semibold text-text-primary">Conditions</h4>
            {/* ⚠️ 247 · THE ADVANCED SETTINGS THE OWNER ASKED FOR. The card
                names the checks in force; the dialog is where they change, and
                where each one is read back live from the sender's own rule. */}
            {open && <ConditionsButton onClick={onConditions} count={f.conditionsChanged || undefined} />}
          </div>
          <ul className="mt-2 space-y-1.5">
            <Condition on={f.condNoReply} text="Only if they have not replied" />
            <Condition on={f.condQuoteValid} text="Only while the quotation is live" />
            <Condition on={f.condNotBooked} text="Only if nothing is booked yet" />
            <Condition on={f.consent} text={f.consent ? 'Consent active' : 'No WhatsApp consent'} />
          </ul>
          {f.conditionsChanged > 0 && (
            <p className="mt-2 text-caption text-text-secondary">
              {f.conditionsChanged} changed from the default for {purposeLabel(f.purpose).toLowerCase()}.
            </p>
          )}
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

  /* ⚠️ PORTALLED TO THE BODY. Measured on the running page, 2026-09-22:
     `fixed inset-0` came out 1231×605 inside a 1512×1000 viewport, because an
     ancestor carries `transform: matrix(1,0,0,1,0,0)` (the page's reveal
     animation) and a transform makes that element the containing block for
     everything `fixed` inside it. The owner saw exactly that: *"the background
     overlay is not on the whole screen and it should not be in the center of
     the screen. The modal should be in the center of the screen."*
     Same trap as the "View lead" panel on 2026-09-21. */
  const body = (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" aria-label="Close" onClick={onClose} className="fixed inset-0 bg-black/45" />
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

  return typeof document === 'undefined' ? body : createPortal(body, document.body);
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
  const veil = (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-black/45 p-4" onMouseDown={onClose}>
      <p className="flex items-center gap-2 rounded-xl bg-bg-surface px-4 py-3 text-body-sm text-text-secondary shadow-xl">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Opening the follow-up planner…
      </p>
    </div>
  );
  return typeof document === 'undefined' ? veil : createPortal(veil, document.body);
}
