'use client';

import * as React from 'react';
import type { Route } from 'next';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createPortal } from 'react-dom';
import {
  ArrowRight,
  Bell,
  Building2,
  CalendarCheck2,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  Clock3,
  FileText,
  Loader2,
  MapPin,
  MessageCircleQuestion,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  User,
  X,
} from 'lucide-react';

import { leadBundlesAction } from '@/app/actions/crm-lead-bundles';
import {
  askClientToConfirmAction,
  confirmAppointmentAction,
  saveAppointmentNotesAction,
} from '@/app/actions/crm-appointments-board';
import { RescheduleAppointmentDialog, ScheduleAppointmentDialog } from '@/components/crm/appointment-schedule-dialog';
import {
  CalendarMonth,
  DateRangeButton,
  KIND_ICON,
  OutcomeStrip,
  RowMenu,
  SavedViewPicker,
  StatCard,
  StatusPill,
  type OutcomeStep,
} from '@/components/crm/appointments-board-parts';
import { CancelAppointmentDialog } from '@/components/crm/cancel-appointment-dialog';
import { EditLeadDetails } from '@/components/crm/edit-lead-details';
import { FollowUpWizard } from '@/components/crm/follow-up-wizard';
import { LeadDetailsModal } from '@/components/crm/lead-details-modal';
import { RecordAppointmentDialog } from '@/components/crm/record-appointment';
import { RecordOutcome } from '@/components/crm/record-outcome';
import { RelatedItemsDialog, seedRelated, type TabKey } from '@/components/crm/related-items';
import { WA_GREEN, WhatsAppMark } from '@/components/crm/whatsapp-mark';
import { PageHeader } from '@/components/ui/page-header';
import { useToast } from '@/components/ui/toast';
import type { BoardAppointment } from '@/lib/db/queries/crm-appointments-board';
import type { CrmLeadBundle } from '@/lib/db/queries/crm-leads';
import { appointmentKindLabel } from '@/lib/domain/crm-appointments';
import {
  applyFilters,
  apptRef,
  cardCounts,
  dateLines,
  displayStatus,
  karachiDay,
  listTitle,
  NO_FILTERS,
  reminderLine,
  sameFilters,
  shortDate,
  sortForList,
  STATUS_OPTIONS,
  timeRange,
  weekOf,
  type BoardFilters,
} from '@/lib/domain/crm-appointment-board';
import { cn } from '@/lib/utils';

/* ============================================================================
 * APPOINTMENTS — the owner's design, 2026-09-21
 * ----------------------------------------------------------------------------
 * *"cards for Today, Upcoming, Waiting for Confirmation, and Completed This
 * Week… appointments are showing in a table. When a row is clicked … the
 * appointment details for that specific appointment will be displayed on the
 * right side. When Related Items, Lead, or Property is clicked, a popup will
 * show… Notes can be added over here. Schedule, Cancel Appointment, Record
 * Outcome… List and calendar view… search… filters… date range… Project…
 * Saved Views."*
 *
 * ── ⚠️ RULE ZERO ───────────────────────────────────────────────────────────
 * Every card, filter, view, the calendar and the details panel are client
 * state over ONE query's rows. Nothing anybody clicks here asks the server
 * except a write — and a write moves the row in its own frame, then the page
 * catches up underneath (router.refresh in a transition).
 *
 * ⚠️ THE LEAD'S RECORD IS PREFETCHED for the rows on screen (the desk's own
 * leadBundlesAction), so "View lead", "View property" and "View quotation"
 * open from memory.
 *
 * ⚠️ "NEEDS RECORDING" IS NOT ONE OF THE FOUR CARDS in the design, and it is
 * the appointment most likely to be forgotten — so it leads the list, has its
 * own status and filter, and a chip on the list's header when any are owed.
 * ========================================================================= */

type Dialog =
  | { kind: 'schedule'; lead?: { id: string; name: string; projectName: string | null } }
  | { kind: 'details'; id: string }
  | { kind: 'reschedule'; id: string }
  | { kind: 'cancel'; id: string }
  | { kind: 'record'; id: string; edit?: boolean }
  | { kind: 'lead'; leadId: string }
  | { kind: 'edit'; leadId: string }
  | { kind: 'related'; leadId: string; tab: TabKey }
  | { kind: 'stage'; leadId: string }
  | { kind: 'followup'; leadId: string }
  | null;

const TYPE_OPTIONS = [
  { value: 'all', label: 'All types' },
  { value: 'site_visit', label: 'Site visits' },
  { value: 'office_visit', label: 'Office visits' },
  { value: 'meeting', label: 'Meetings / demos' },
  { value: 'call', label: 'Calls' },
] as const;

const CONTROL =
  'h-10 rounded-xl border border-border-default bg-bg-surface text-body-sm text-text-primary transition-colors hover:border-border-strong focus:border-accent-primary focus:outline-none';

export function AppointmentsBoard({
  appointments,
  nowMs,
  viewerId,
  viewerName,
  windowFrom,
}: {
  appointments: readonly BoardAppointment[];
  nowMs: number;
  viewerId: string;
  viewerName: string;
  /** "24 March 2026" — the earliest day this page reaches back to. */
  windowFrom: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [, startTransition] = React.useTransition();

  /* ── Rows, with what this screen has just done laid over them ─────────── */
  const [overrides, setOverrides] = React.useState<ReadonlyMap<string, Partial<BoardAppointment>>>(new Map());
  const [seen, setSeen] = React.useState(appointments);
  if (seen !== appointments) {
    /* The server's answer has caught up — it is the truth now (adjusted during
       render, not in an effect: react-hooks/set-state-in-effect). */
    setSeen(appointments);
    setOverrides(new Map());
  }
  const rows = React.useMemo(
    () => appointments.map((a) => (overrides.has(a.id) ? { ...a, ...overrides.get(a.id) } : a)),
    [appointments, overrides],
  );
  const patch = (id: string, p: Partial<BoardAppointment>) =>
    setOverrides((prev) => new Map(prev).set(id, { ...prev.get(id), ...p }));
  const refresh = () => startTransition(() => router.refresh());

  /* ── Filters and the view ─────────────────────────────────────────────── */
  const [filters, setFilters] = React.useState<BoardFilters>(NO_FILTERS);
  const [view, setView] = React.useState<'list' | 'calendar'>('list');
  const today = karachiDay(nowMs);
  const week = weekOf(today);
  const [month, setMonth] = React.useState(today.slice(0, 7));
  const set = (p: Partial<BoardFilters>) => setFilters((f) => ({ ...f, ...p }));

  const counts = React.useMemo(() => cardCounts(rows, nowMs), [rows, nowMs]);
  const shown = React.useMemo(() => sortForList(applyFilters(rows, filters, nowMs), nowMs), [rows, filters, nowMs]);
  const projects = React.useMemo(
    () => [...new Set(rows.map((a) => a.projectName).filter((p): p is string => Boolean(p)))].sort(),
    [rows],
  );

  const CARD_FILTERS = {
    today: { ...NO_FILTERS, from: today, to: today },
    upcoming: { ...NO_FILTERS, status: 'upcoming' as const },
    awaiting: { ...NO_FILTERS, status: 'awaiting' as const },
    completed: { ...NO_FILTERS, status: 'completed' as const, from: week.from, to: week.to },
  };
  const card = (f: BoardFilters) => setFilters((cur) => (sameFilters(cur, f) ? NO_FILTERS : f));

  /* ── Selection: the clicked row, or the first on screen ──────────────── */
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const selected = shown.find((a) => a.id === selectedId) ?? rows.find((a) => a.id === selectedId && view === 'calendar') ?? shown[0] ?? null;

  /* ── The lead's record, fetched before anybody asks ───────────────────── */
  const [bundles, setBundles] = React.useState<Record<string, CrmLeadBundle>>({});
  const leadIds = React.useMemo(() => [...new Set(appointments.map((a) => a.leadId))].slice(0, 40).join(','), [appointments]);
  React.useEffect(() => {
    if (!leadIds) return;
    let alive = true;
    void leadBundlesAction(leadIds.split(',')).then((r) => {
      if (alive) setBundles((prev) => ({ ...prev, ...r.bundles }));
    });
    return () => {
      alive = false;
    };
  }, [leadIds]);
  const ensureBundle = (leadId: string) => {
    if (bundles[leadId]) return;
    void leadBundlesAction([leadId]).then((r) => setBundles((prev) => ({ ...prev, ...r.bundles })));
  };

  const [dialog, setDialog] = React.useState<Dialog>(null);
  const openLead = (leadId: string) => {
    ensureBundle(leadId);
    setDialog({ kind: 'lead', leadId });
  };
  const openRelated = (leadId: string, tab: TabKey) => {
    ensureBundle(leadId);
    setDialog({ kind: 'related', leadId, tab });
  };
  const byId = (id: string) => rows.find((a) => a.id === id) ?? null;

  /* ⚠️ 243 · CONFIRMING, AND SAYING WHICH ONE IS IN FLIGHT. Two buttons, one
     row; a spinner on the one pressed rather than a dimmed panel. */
  const [confirming, setConfirming] = React.useState<null | { id: string; how: 'mark' | 'ask' }>(null);

  const markConfirmed = async (a: BoardAppointment) => {
    setConfirming({ id: a.id, how: 'mark' });
    /* The pill moves in this frame; the server follows (Rule Zero). */
    patch(a.id, { status: 'confirmed' });
    const r = await confirmAppointmentAction(a.id, a.leadId);
    setConfirming(null);
    if (!r.ok) {
      patch(a.id, { status: a.status });
      toast({ tone: 'error', text: r.error ?? 'That could not be confirmed.' });
      return;
    }
    toast({ tone: 'ok', text: 'Confirmed. The client was not messaged.' });
    refresh();
  };

  const askToConfirm = async (a: BoardAppointment) => {
    setConfirming({ id: a.id, how: 'ask' });
    const r = await askClientToConfirmAction(a.id, a.leadId);
    setConfirming(null);
    if (!r.ok) {
      toast({ tone: 'error', text: r.error ?? 'That message could not be sent.' });
      return;
    }
    patch(a.id, { confirmationSent: true });
    toast({
      tone: 'ok',
      text: r.sent
        ? 'Sent — the client can tap Confirm or Change the time.'
        : 'Queued — it goes out on the next run of the sender.',
    });
    refresh();
  };

  /* ── Notes, edited in place ───────────────────────────────────────────── */
  const [editing, setEditing] = React.useState<{ id: string; text: string } | null>(null);
  const [savingNote, setSavingNote] = React.useState(false);
  const saveNote = async (a: BoardAppointment) => {
    if (!editing || editing.id !== a.id) return;
    const before = a.notes;
    const text = editing.text.trim();
    patch(a.id, { notes: text || null });
    setSavingNote(true);
    const r = await saveAppointmentNotesAction(a.id, a.leadId, text);
    setSavingNote(false);
    if (!r.ok) {
      patch(a.id, { notes: before });
      toast({ tone: 'error', text: r.error ?? 'The note did not save.' });
      return;
    }
    setEditing(null);
    refresh();
  };

  /* ⚠️ NO DEAD BUTTONS. Owner, 2026-09-21: *"Reschedule, Cancel Appointment,
     and Record Outcome. These buttons are not working"* — on a Completed
     appointment all three were disabled. Each state now offers what can
     actually be done to it. */
  const actionsFor = (a: BoardAppointment) => {
    const s = displayStatus(a, nowMs);
    const live = s !== 'completed' && s !== 'cancelled' && s !== 'no_show';
    const lead = { id: a.leadId, name: a.leadName ?? 'this lead', projectName: a.projectName };
    return {
      live,
      done: s === 'completed',
      reschedule: () => setDialog({ kind: 'reschedule', id: a.id }),
      cancel: () => setDialog({ kind: 'cancel', id: a.id }),
      record: () => setDialog({ kind: 'record', id: a.id }),
      editOutcome: () => setDialog({ kind: 'record', id: a.id, edit: true }),
      bookAnother: () => setDialog({ kind: 'schedule', lead }),
      /* The SAME wizard the lead drawer opens (owner, 2026-09-21: *"The same
         modal will appear here and the things will be the same"*). */
      followUp: () => {
        ensureBundle(a.leadId);
        setDialog({ kind: 'followup', leadId: a.leadId });
      },
      /* Not yet confirmed and still to come — both ways are worth offering. */
      needsConfirming: live && s !== 'confirmed',
      confirming: confirming?.id === a.id ? confirming.how : null,
      markConfirmed: () => void markConfirmed(a),
      askToConfirm: () => void askToConfirm(a),
    };
  };

  const menuFor = (a: BoardAppointment) => {
    const act = actionsFor(a);
    return [
      {
        label: 'View details',
        onSelect: () => {
          setSelectedId(a.id);
          setDialog({ kind: 'details', id: a.id });
        },
      },
      { label: 'View lead', onSelect: () => openLead(a.leadId) },
      { label: 'Add follow-up', onSelect: act.followUp },
      ...(act.needsConfirming
        ? [
            { label: 'Mark confirmed', onSelect: act.markConfirmed },
            { label: 'Ask client to confirm', onSelect: act.askToConfirm },
          ]
        : []),
      ...(act.live
        ? [
            { label: 'Reschedule', onSelect: act.reschedule },
            { label: 'Record outcome', onSelect: act.record },
            { label: 'Cancel appointment', onSelect: act.cancel, danger: true },
          ]
        : [
            ...(act.done ? [{ label: 'Edit outcome', onSelect: act.editOutcome }] : []),
            { label: act.done ? 'Book another' : 'Book again', onSelect: act.bookAnother },
          ]),
    ];
  };

  const panelProps = (a: BoardAppointment) => {
    const act = actionsFor(a);
    return {
      a,
      nowMs,
      viewerId,
      editing: editing && editing.id === a.id ? editing.text : null,
      savingNote,
      onEdit: (text: string) => setEditing({ id: a.id, text }),
      onCancelEdit: () => setEditing(null),
      onSaveNote: () => void saveNote(a),
      onLead: () => openLead(a.leadId),
      onProperty: () => openRelated(a.leadId, 'properties'),
      onQuotation: () => openRelated(a.leadId, 'quotations'),
      onReschedule: act.reschedule,
      onCancel: act.cancel,
      onRecord: act.record,
      onEditOutcome: act.editOutcome,
      onBookAnother: act.bookAnother,
      onFollowUp: act.followUp,
      needsConfirming: act.needsConfirming,
      confirming: act.confirming,
      onMarkConfirmed: act.markConfirmed,
      onAskToConfirm: act.askToConfirm,
    };
  };

  return (
    <div className="mx-auto max-w-[var(--content-max)] space-y-4">
      <PageHeader
        title="Appointments"
        description="Manage calls, meetings and site visits for your assigned leads."
        actions={
          <button
            type="button"
            onClick={() => setDialog({ kind: 'schedule' })}
            className="inline-flex items-center gap-2 rounded-xl bg-accent-primary px-4 py-2.5 text-body-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
          >
            <Plus className="size-4" aria-hidden="true" /> Schedule appointment
          </button>
        }
      />

      {/* ── The four cards — each one is a filter ─────────────────────── */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Today" count={counts.today} tone="blue" icon={CalendarDays} active={sameFilters(filters, CARD_FILTERS.today)} onClick={() => card(CARD_FILTERS.today)} />
        <StatCard label="Upcoming" count={counts.upcoming} tone="green" icon={CalendarCheck2} active={sameFilters(filters, CARD_FILTERS.upcoming)} onClick={() => card(CARD_FILTERS.upcoming)} />
        <StatCard label="Awaiting confirmation" count={counts.awaiting} tone="amber" icon={Clock3} active={sameFilters(filters, CARD_FILTERS.awaiting)} onClick={() => card(CARD_FILTERS.awaiting)} />
        <StatCard label="Completed this week" count={counts.completedThisWeek} tone="gold" icon={CheckCircle2} active={sameFilters(filters, CARD_FILTERS.completed)} onClick={() => card(CARD_FILTERS.completed)} />
      </div>

      {/* ── The toolbar ────────────────────────────────────────────────── */}
      {/* ⚠️ ONE ROW, as drawn (owner, 2026-09-21: *"the above filters should all
          be adjusted in one row"*). Every control has a fixed width and the
          search takes what is left; below xl it wraps rather than squeezing. */}
      <div className="flex flex-wrap items-center gap-2 xl:flex-nowrap">
        <div className="inline-flex shrink-0 rounded-xl border border-border-default bg-bg-surface p-1" role="tablist" aria-label="View">
          {(['list', 'calendar'] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={cn(
                'h-8 rounded-lg px-5 text-body-sm font-semibold capitalize transition-colors',
                view === v ? 'bg-accent-primary text-white' : 'text-text-secondary hover:text-text-primary',
              )}
            >
              {v}
            </button>
          ))}
        </div>
        <label className={cn(CONTROL, 'flex min-w-[12rem] flex-1 items-center gap-2 px-3')}>
          <Search className="size-4 shrink-0 text-text-tertiary" aria-hidden="true" />
          <input
            value={filters.q}
            onChange={(e) => set({ q: e.target.value })}
            placeholder="Search lead or appointment…"
            aria-label="Search lead or appointment"
            className="min-w-0 flex-1 bg-transparent placeholder:text-text-tertiary focus:outline-none"
          />
        </label>
        <select aria-label="Type" value={filters.kind} onChange={(e) => set({ kind: e.target.value as BoardFilters['kind'] })} className={cn(CONTROL, 'w-[9rem] shrink-0 px-3')}>
          {TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <select aria-label="Status" value={filters.status} onChange={(e) => set({ status: e.target.value as BoardFilters['status'] })} className={cn(CONTROL, 'w-[10.5rem] shrink-0 px-3')}>
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <div className="w-[10.75rem] shrink-0">
          <DateRangeButton from={filters.from} to={filters.to} nowMs={nowMs} onChange={(from, to) => set({ from, to })} />
        </div>
        <select aria-label="Project" value={filters.project} onChange={(e) => set({ project: e.target.value })} className={cn(CONTROL, 'w-[9.5rem] shrink-0 px-3')}>
          <option value="all">Project</option>
          {projects.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
        <div className="w-[9.5rem] shrink-0">
          <SavedViewPicker filters={filters} nowMs={nowMs} onApply={setFilters} />
        </div>
      </div>

      {/* ── The list (or the calendar) and the details ─────────────────── */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,31rem)]">
        <section className="min-w-0 rounded-2xl border border-border-subtle bg-bg-surface py-4 shadow-sm">
          <div className="flex flex-wrap items-center gap-2 px-5 pb-3">
            <h2 className="text-h3 font-semibold text-text-primary">
              {view === 'calendar' ? 'Calendar' : listTitle(filters.status)}
            </h2>
            <span className="text-caption text-text-secondary">{shown.length}</span>
            <span className="flex-1" />
            {counts.needsRecording > 0 && filters.status !== 'needs_recording' && (
              <button
                type="button"
                onClick={() => setFilters({ ...NO_FILTERS, status: 'needs_recording' })}
                className="rounded-full px-2.5 py-1 text-caption font-semibold"
                style={{ background: 'color-mix(in oklab, var(--feedback-warning) 16%, var(--bg-surface))', color: 'color-mix(in oklab, var(--feedback-warning) 72%, var(--text-primary))' }}
              >
                {counts.needsRecording} need{counts.needsRecording === 1 ? 's' : ''} recording
              </button>
            )}
            {!sameFilters(filters, NO_FILTERS) && (
              <button type="button" onClick={() => setFilters(NO_FILTERS)} className="text-caption font-medium text-text-brand hover:underline">
                Clear filters
              </button>
            )}
          </div>

          {view === 'calendar' ? (
            <CalendarMonth
              items={applyFilters(rows, filters, nowMs).map((a) => ({
                id: a.id,
                day: karachiDay(Date.parse(a.scheduledAt)),
                time: dateLines(a.scheduledAt, nowMs).time,
                who: a.leadName ?? 'Unnamed lead',
                status: displayStatus(a, nowMs),
              }))}
              month={month}
              today={today}
              selectedId={selected?.id ?? null}
              onMonth={setMonth}
              onPick={setSelectedId}
              onDay={(d) => {
                setFilters({ ...NO_FILTERS, from: d, to: d });
                setView('list');
              }}
            />
          ) : shown.length === 0 ? (
            <div className="grid place-items-center px-5 py-16 text-center">
              <CalendarClock className="size-8 text-text-tertiary" aria-hidden="true" />
              <p className="mt-2 text-body-sm font-medium text-text-primary">
                {rows.length === 0 ? 'No appointments yet' : 'Nothing matches these filters'}
              </p>
              <p className="mt-0.5 max-w-sm text-caption text-text-secondary">
                {rows.length === 0
                  ? 'Book a site visit, a meeting or a call for one of your leads — or let the AI agent book a demo.'
                  : 'Change or clear the filters to see more.'}
              </p>
              <button
                type="button"
                onClick={() => (rows.length === 0 ? setDialog({ kind: 'schedule' }) : setFilters(NO_FILTERS))}
                className="mt-3 rounded-xl border border-border-default px-3.5 py-2 text-body-sm font-medium text-text-primary hover:bg-bg-subtle"
              >
                {rows.length === 0 ? 'Schedule appointment' : 'Clear filters'}
              </button>
            </div>
          ) : (
            <AppointmentTable
              rows={shown}
              nowMs={nowMs}
              selectedId={selected?.id ?? null}
              onSelect={setSelectedId}
              menuFor={menuFor}
            />
          )}
        </section>

        {selected ? (
          <DetailsPanel {...panelProps(selected)} />
        ) : (
          <aside className="grid place-items-center rounded-2xl border border-border-subtle bg-bg-surface p-6 text-center shadow-sm">
            <p className="text-body-sm text-text-secondary">Pick an appointment to see its details.</p>
          </aside>
        )}
      </div>

      {/* ── The last recorded outcome ──────────────────────────────────── */}
      {selected && <LastOutcome a={selected} nowMs={nowMs} onRecord={actionsFor(selected).record} />}

      <p className="text-caption text-text-secondary">
        Showing your appointments from {windowFrom} onwards. Search, filters, views and the calendar work on these.
      </p>

      {/* ── Dialogs (portalled or fixed — never part of the column above) ─ */}
      {dialog?.kind === 'schedule' && (
        <ScheduleAppointmentDialog nowMs={nowMs} initialLead={dialog.lead ?? null} onClose={() => setDialog(null)} onBooked={refresh} />
      )}
      {dialog?.kind === 'details' && byId(dialog.id) && (
        <AppointmentModal onClose={() => setDialog(null)}>
          <DetailsPanel {...panelProps(byId(dialog.id)!)} onClose={() => setDialog(null)} />
          <LastOutcome a={byId(dialog.id)!} nowMs={nowMs} onRecord={actionsFor(byId(dialog.id)!).record} />
        </AppointmentModal>
      )}
      {dialog?.kind === 'reschedule' && byId(dialog.id) && (() => {
        const a = byId(dialog.id)!;
        return (
          <RescheduleAppointmentDialog
            appointment={{ id: a.id, leadId: a.leadId, leadName: a.leadName, scheduledAt: a.scheduledAt, durationMinutes: a.durationMinutes, location: a.location, ref: apptRef(a.refNo) }}
            nowMs={nowMs}
            onClose={() => setDialog(null)}
            onMoved={refresh}
          />
        );
      })()}
      {dialog?.kind === 'cancel' && byId(dialog.id) && (
        <CancelAppointmentDialog
          appointment={byId(dialog.id)!}
          onClose={() => setDialog(null)}
          onCancelled={(id) => {
            patch(id, { status: 'cancelled' });
            refresh();
          }}
        />
      )}
      {dialog?.kind === 'record' && byId(dialog.id) && (
        <RecordAppointmentDialog
          appointment={byId(dialog.id)!}
          editing={dialog.edit === true}
          initialNote={dialog.edit ? (byId(dialog.id)!.outcome ?? '') : ''}
          initialInterested={dialog.edit ? byId(dialog.id)!.clientInterested : null}
          onClose={() => setDialog(null)}
          onRecorded={(id, interested, note) => {
            patch(id, { status: 'completed', outcome: note, clientInterested: interested, outcomeAt: new Date().toISOString() });
            refresh();
          }}
        />
      )}
      {dialog?.kind === 'lead' && (
        <LeadDetailsModal
          leadId={dialog.leadId}
          bundle={bundles[dialog.leadId] ?? null}
          fallbackName={rows.find((a) => a.leadId === dialog.leadId)?.leadName ?? 'Lead'}
          viewerName={viewerName}
          nowMs={nowMs}
          onClose={() => setDialog(null)}
          onEdit={() => setDialog({ kind: 'edit', leadId: dialog.leadId })}
          onRelated={() => setDialog({ kind: 'related', leadId: dialog.leadId, tab: 'quotations' })}
          onElsewhere={(href) => router.push(href as Route)}
        />
      )}
      {dialog?.kind === 'edit' && bundles[dialog.leadId] && (
        <ToBody>
          <EditLeadDetails lead={bundles[dialog.leadId].record.lead} onClose={() => setDialog({ kind: 'lead', leadId: dialog.leadId })} />
        </ToBody>
      )}
      {dialog?.kind === 'related' &&
        (bundles[dialog.leadId] ? (
          <RelatedItemsDialog
            lead={bundles[dialog.leadId].record.lead}
            sender={bundles[dialog.leadId].related.sender}
            seed={seedRelated(bundles[dialog.leadId].record.lead, bundles[dialog.leadId].related)}
            initialTab={dialog.tab}
            onClose={() => setDialog(null)}
            onChooseUnit={() => setDialog(null)}
            onRecordOutcome={() => setDialog({ kind: 'stage', leadId: dialog.leadId })}
            onAttach={() => {
              /* A file is sent from the lead's own WhatsApp tab, where the
                 composer is — this page has none. Said, and taken there. */
              setDialog(null);
              toast({ tone: 'ok', text: 'Opening the lead — attach and send it from its WhatsApp tab.' });
              router.push(`/my-leads?lead=${dialog.leadId}` as Route);
            }}
          />
        ) : (
          <Opening onClose={() => setDialog(null)} />
        ))}
      {dialog?.kind === 'followup' &&
        (bundles[dialog.leadId] ? (
          <FollowUpWizard
            lead={bundles[dialog.leadId].record.lead}
            related={bundles[dialog.leadId].related}
            viewerName={viewerName}
            nowMs={nowMs}
            onClose={() => setDialog(null)}
            onCreated={() => {
              const leadId = dialog.leadId;
              setDialog(null);
              /* The lead's next action and its record both change — re-read
                 them underneath a screen that is already closed. The old copy
                 stays until the new one lands, so nothing blanks. */
              void leadBundlesAction([leadId]).then((r) => setBundles((prev) => ({ ...prev, ...r.bundles })));
              refresh();
            }}
          />
        ) : (
          <Opening onClose={() => setDialog(null)} label="Opening the follow-up planner…" />
        ))}
      {dialog?.kind === 'stage' && bundles[dialog.leadId] && (
        <ToBody>
          <RecordOutcome
            leadId={dialog.leadId}
            leadName={bundles[dialog.leadId].record.lead.fullName ?? 'this lead'}
            currentStage={bundles[dialog.leadId].record.lead.stage}
            onClose={() => {
              setDialog(null);
              refresh();
            }}
          />
        </ToBody>
      )}
    </div>
  );
}

/* ── The table ───────────────────────────────────────────────────────────── */

/* ⚠️ A GRID, NOT <table>: `truncate` inside an auto table holds the column open
   (truncate-in-auto-tables). Every column can shrink; the name keeps the room. */
const COLS = 'minmax(0,1.8fr) minmax(0,0.8fr) minmax(0,0.85fr) minmax(0,0.95fr) minmax(0,1.4fr) 5.25rem';

function AppointmentTable({
  rows,
  nowMs,
  selectedId,
  onSelect,
  menuFor,
}: {
  rows: readonly BoardAppointment[];
  nowMs: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  menuFor: (a: BoardAppointment) => ReadonlyArray<{ label: string; onSelect: () => void; disabled?: boolean; danger?: boolean }>;
}) {
  return (
    <div>
      <div
        className="grid items-center gap-3 border-y border-border-subtle bg-bg-subtle/40 px-5 py-2.5 text-caption font-semibold text-text-secondary"
        style={{ gridTemplateColumns: COLS }}
      >
        <span>Appointment / lead</span>
        <span>Date &amp; time</span>
        <span>Type</span>
        <span>Related item</span>
        <span>Status</span>
        <span className="text-right">Actions</span>
      </div>
      <div>
        {rows.map((a) => {
          const on = a.id === selectedId;
          const when = dateLines(a.scheduledAt, nowMs);
          const Icon = KIND_ICON[a.kind] ?? CalendarClock;
          const related = [a.propertyCode, a.quotationNumber].filter(Boolean).join(' · ');
          return (
            <div
              key={a.id}
              role="button"
              tabIndex={0}
              aria-pressed={on}
              onClick={(e) => {
                /* A hover promises the whole row — but the WhatsApp link and the
                   menu inside it are their own controls (CLAUDE.md). */
                const hit = (e.target as HTMLElement).closest('a, button, [role="menu"]');
                if (hit && hit !== e.currentTarget) return;
                onSelect(a.id);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && e.target === e.currentTarget) onSelect(a.id);
              }}
              className={cn(
                'grid cursor-pointer items-center gap-3 border-b border-l-[3px] border-b-border-subtle px-5 py-3.5 transition-colors',
                on ? 'border-l-[var(--channel-email)]' : 'border-l-transparent hover:bg-bg-subtle/60',
              )}
              style={{ gridTemplateColumns: COLS, background: on ? 'color-mix(in oklab, var(--channel-email) 7%, var(--bg-surface))' : undefined }}
            >
              <span className="min-w-0">
                <span className="block truncate text-body-sm font-semibold text-text-primary">{apptRef(a.refNo)}</span>
                <span className="block truncate text-caption text-text-secondary">
                  {[a.leadName ?? 'Unnamed lead', a.projectName].filter(Boolean).join(' · ')}
                </span>
              </span>
              <span className="min-w-0">
                <span className="block truncate text-body-sm text-text-primary">{when.day}</span>
                <span className="block truncate text-caption text-text-secondary">{when.time}</span>
              </span>
              <span className="flex min-w-0 items-center gap-2 text-body-sm text-text-primary">
                <Icon className="size-4 shrink-0" style={{ color: 'var(--channel-email)' }} aria-hidden="true" />
                <span className="truncate">{appointmentKindLabel(a.kind)}</span>
              </span>
              <span className={cn('truncate text-body-sm', related ? 'text-text-primary' : 'text-text-tertiary')}>
                {related || 'No related item'}
              </span>
              <span className="min-w-0">
                <StatusPill status={displayStatus(a, nowMs)} />
              </span>
              <span className="flex items-center justify-end gap-1.5">
                <Link
                  href={`/conversations?lead=${a.leadId}` as Route}
                  aria-label={`Open the WhatsApp conversation with ${a.leadName ?? 'this lead'}`}
                  title="Open the WhatsApp conversation"
                  className="grid size-9 place-items-center rounded-lg border border-border-subtle bg-bg-surface transition-colors hover:border-border-default"
                  style={{ color: WA_GREEN }}
                >
                  <WhatsAppMark className="size-[1.15rem]" />
                </Link>
                <RowMenu items={menuFor(a)} label={`More for ${apptRef(a.refNo)}`} />
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── The details panel ───────────────────────────────────────────────────── */

function DetailsPanel({
  a,
  nowMs,
  viewerId,
  editing,
  savingNote,
  onEdit,
  onCancelEdit,
  onSaveNote,
  onLead,
  onProperty,
  onQuotation,
  onReschedule,
  onCancel,
  onRecord,
  onEditOutcome,
  onBookAnother,
  onFollowUp,
  needsConfirming,
  confirming,
  onMarkConfirmed,
  onAskToConfirm,
  onClose,
}: {
  a: BoardAppointment | null;
  nowMs: number;
  viewerId: string;
  editing: string | null;
  savingNote: boolean;
  onEdit: (text: string) => void;
  onCancelEdit: () => void;
  onSaveNote: () => void;
  onLead: () => void;
  onProperty: () => void;
  onQuotation: () => void;
  onReschedule: () => void;
  onCancel: () => void;
  onRecord: () => void;
  onEditOutcome: () => void;
  onBookAnother: () => void;
  onFollowUp: () => void;
  /** 243 · still to come and not confirmed by the client. */
  needsConfirming: boolean;
  confirming: 'mark' | 'ask' | null;
  onMarkConfirmed: () => void;
  onAskToConfirm: () => void;
  /** Only in the "View details" modal. */
  onClose?: () => void;
}) {
  if (!a) {
    return (
      <aside className="grid place-items-center rounded-2xl border border-border-subtle bg-bg-surface p-6 text-center shadow-sm">
        <p className="text-body-sm text-text-secondary">Pick an appointment to see its details.</p>
      </aside>
    );
  }
  const s = displayStatus(a, nowMs);
  const live = s !== 'completed' && s !== 'cancelled' && s !== 'no_show';
  const location = a.location || a.propertyLabel || (a.kind === 'call' ? 'WhatsApp call — no location' : 'Not set');
  const consultant = a.ownerId === viewerId ? `You · ${a.ownerName ?? 'you'}` : (a.ownerName ?? 'Unassigned');

  return (
    <aside className="flex min-w-0 flex-col rounded-2xl border border-border-subtle bg-bg-surface px-5 py-4 shadow-sm">
      <div className="flex items-start gap-2">
        <h2 className="flex-1 text-h3 font-semibold text-text-primary">Appointment details</h2>
        <StatusPill status={s} />
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid size-8 shrink-0 place-items-center rounded-lg text-text-secondary hover:bg-bg-subtle hover:text-text-primary"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        )}
      </div>
      <p className="mt-3 text-[1.45rem] font-bold leading-tight text-text-primary">{apptRef(a.refNo)}</p>
      <p className="truncate text-body-sm text-text-secondary">
        {[a.leadName ?? 'Unnamed lead', a.projectName].filter(Boolean).join(' · ')}
      </p>

      <dl className="mt-4 space-y-2.5 text-body-sm">
        <Fact icon={CalendarDays} label="Date & time" value={timeRange(a.scheduledAt, a.durationMinutes)} />
        <Fact icon={MapPin} label="Location" value={location} />
        <Fact icon={User} label="Consultant" value={consultant} />
        <Fact icon={Bell} label="Reminder" value={reminderLine(a.scheduledAt, a.reminderStatus, a.reminderAt)} />
      </dl>

      {/* ── 243 · Confirming, where a salesperson looks for it ───────────── */}
      {needsConfirming && (
        <div
          className="mt-4 rounded-xl border px-3.5 py-3"
          style={{
            background: 'color-mix(in oklab, var(--feedback-warning) 8%, var(--bg-surface))',
            borderColor: 'color-mix(in oklab, var(--feedback-warning) 30%, var(--border-default))',
          }}
        >
          <p className="text-body-sm font-semibold text-text-primary">
            {a.confirmationSent ? 'The client has not confirmed yet' : 'The client has not been asked yet'}
          </p>
          <p className="mt-0.5 text-caption text-text-secondary">
            {a.confirmationSent
              ? 'They were sent the time and have not tapped Confirm.'
              : 'Send them the time so they can tap Confirm, or mark it yourself if they have already told you.'}
          </p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={confirming !== null}
              onClick={onMarkConfirmed}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent-primary px-3 py-1.5 text-[0.8rem] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {confirming === 'mark' ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="size-3.5" aria-hidden="true" />}
              Mark confirmed
            </button>
            <button
              type="button"
              disabled={confirming !== null}
              onClick={onAskToConfirm}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border-default bg-bg-surface px-3 py-1.5 text-[0.8rem] font-semibold text-text-primary transition-colors hover:bg-bg-subtle disabled:opacity-50"
            >
              {confirming === 'ask' ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <MessageCircleQuestion className="size-3.5" aria-hidden="true" />
              )}
              {a.confirmationSent ? 'Ask again on WhatsApp' : 'Ask on WhatsApp'}
            </button>
          </div>
        </div>
      )}

      <div className="mt-4 border-t border-border-subtle pt-3.5">
        <h3 className="text-body-sm font-semibold text-text-primary">Related items</h3>
        <ul className="mt-2 space-y-2">
          <RelatedLink icon={User} label="View lead" onClick={onLead} />
          {a.propertyCode ? (
            <RelatedLink icon={Building2} label={`View property ${a.propertyCode}`} onClick={onProperty} />
          ) : (
            <RelatedLink icon={Building2} label="Properties" hint="No property linked" onClick={onProperty} />
          )}
          {a.quotationNumber ? (
            <RelatedLink icon={FileText} label={`View quotation ${a.quotationNumber}`} onClick={onQuotation} />
          ) : (
            <RelatedLink icon={FileText} label="Quotations" hint="None sent yet" onClick={onQuotation} />
          )}
        </ul>
      </div>

      <div className="mt-4 border-t border-border-subtle pt-3.5">
        <div className="flex items-center gap-2">
          <FileText className="size-4 text-text-secondary" aria-hidden="true" />
          <h3 className="flex-1 text-body-sm font-semibold text-text-primary">Notes</h3>
          {editing === null && (
            <button
              type="button"
              onClick={() => onEdit(a.notes ?? '')}
              className="inline-flex items-center gap-1 text-caption font-medium text-text-brand hover:underline"
            >
              {a.notes ? <Pencil className="size-3.5" aria-hidden="true" /> : <Plus className="size-3.5" aria-hidden="true" />}
              {a.notes ? 'Edit' : 'Add note'}
            </button>
          )}
        </div>
        {editing !== null ? (
          <NoteEditor initial={editing} saving={savingNote} onChange={onEdit} onCancel={onCancelEdit} onSave={onSaveNote} />
        ) : (
          <p className={cn('mt-1.5 whitespace-pre-line pl-6 text-body-sm', a.notes ? 'text-text-primary' : 'text-text-tertiary')}>
            {a.notes || 'No notes yet.'}
          </p>
        )}
      </div>

      {/* ── Follow-up — the lead's next step, and the wizard to plan one ── */}
      <div className="mt-4 border-t border-border-subtle pt-3.5">
        <div className="flex items-center gap-2">
          <CalendarClock className="size-4 text-text-secondary" aria-hidden="true" />
          <h3 className="flex-1 text-body-sm font-semibold text-text-primary">Follow-up</h3>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-2 pl-6">
          <p className={cn('min-w-0 flex-1 text-body-sm', a.leadNextAction ? 'text-text-primary' : 'text-text-tertiary')}>
            {a.leadNextAction
              ? `${a.leadNextAction}${a.leadNextActionAt ? ` · ${shortDate(Date.parse(a.leadNextActionAt))}, ${dateLines(a.leadNextActionAt, nowMs).time}` : ''}`
              : 'Nothing planned for this lead yet.'}
          </p>
          <button
            type="button"
            onClick={onFollowUp}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[0.8rem] font-semibold transition-colors hover:bg-bg-subtle"
            style={{ borderColor: 'color-mix(in oklab, var(--accent-primary) 45%, var(--border-default))', color: 'var(--text-brand)' }}
          >
            <Plus className="size-3.5" aria-hidden="true" /> Schedule follow-up
          </button>
        </div>
      </div>

      {/* ⚠️ ONE LINE, AS DRAWN, and never a dead button: what is offered is what
          can be done to an appointment in this state. */}
      <div className="mt-auto flex flex-wrap gap-2 pt-4 [&>button]:min-w-fit [&>button]:flex-1 [&>button]:whitespace-nowrap">
        {live ? (
          <>
            <button type="button" onClick={onReschedule} className={SECONDARY}>
              <CalendarDays className="size-4" aria-hidden="true" /> Reschedule
            </button>
            <button type="button" onClick={onCancel} className={DANGER} style={DANGER_STYLE}>
              <Trash2 className="size-4" aria-hidden="true" /> Cancel appointment
            </button>
            <button type="button" onClick={onRecord} className={PRIMARY}>
              <CheckCircle2 className="size-4" aria-hidden="true" /> Record outcome
            </button>
          </>
        ) : s === 'completed' ? (
          <>
            <button type="button" onClick={onEditOutcome} className={SECONDARY}>
              <Pencil className="size-4" aria-hidden="true" /> Edit outcome
            </button>
            <button type="button" onClick={onBookAnother} className={PRIMARY}>
              <Plus className="size-4" aria-hidden="true" /> Book another {kindWord(a.kind)}
            </button>
          </>
        ) : (
          <button type="button" onClick={onBookAnother} className={PRIMARY}>
            <RotateCcw className="size-4" aria-hidden="true" /> Book again
          </button>
        )}
      </div>
    </aside>
  );
}

const SECONDARY =
  'inline-flex items-center justify-center gap-1.5 rounded-xl border border-border-default px-3 py-2.5 text-[0.8rem] font-semibold text-text-primary transition-colors hover:bg-bg-subtle';
const DANGER = 'inline-flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2.5 text-[0.8rem] font-semibold transition-colors hover:bg-bg-subtle';
const DANGER_STYLE = {
  borderColor: 'color-mix(in oklab, var(--feedback-error) 55%, var(--border-default))',
  color: 'color-mix(in oklab, var(--feedback-error) 80%, var(--text-primary))',
};
const PRIMARY =
  'inline-flex items-center justify-center gap-1.5 rounded-xl bg-accent-primary px-3 py-2.5 text-[0.8rem] font-semibold text-white transition-opacity hover:opacity-90';
const kindWord = (kind: string) => appointmentKindLabel(kind).toLowerCase();

/** Portalled to <body>: the page column's transform would otherwise hold a
 *  `fixed` overlay inside it (the "View lead" bug, 2026-09-21). */
function ToBody({ children }: { children: React.ReactNode }) {
  return createPortal(children, document.body);
}

/** "View details" from the row menu — the same panel, over the page. */
function AppointmentModal({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
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
  return createPortal(
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-black/45 p-4 backdrop-blur-[2px]" onMouseDown={onClose} role="dialog" aria-modal="true" aria-label="Appointment details">
      <div className="mx-auto my-6 w-full max-w-2xl space-y-3" onMouseDown={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>,
    document.body,
  );
}

function Fact({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string }) {
  return (
    <div className="grid grid-cols-[1.1rem_7rem_minmax(0,1fr)] items-start gap-2">
      <Icon className="mt-0.5 size-4 text-text-secondary" aria-hidden="true" />
      <dt className="text-text-secondary">{label}</dt>
      <dd className="min-w-0 text-text-primary">{value}</dd>
    </div>
  );
}

function RelatedLink({
  icon: Icon,
  label,
  hint,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  hint?: string;
  onClick: () => void;
}) {
  return (
    <li className="flex items-center gap-2.5">
      <Icon className="size-4 shrink-0 text-text-secondary" aria-hidden="true" />
      <button
        type="button"
        onClick={onClick}
        className="inline-flex min-w-0 items-center gap-2 text-body-sm font-medium text-text-brand underline-offset-2 hover:underline"
      >
        <span className="truncate underline">{label}</span>
        <ArrowRight className="size-4 shrink-0" aria-hidden="true" />
      </button>
      {hint && <span className="truncate text-caption text-text-tertiary">{hint}</span>}
    </li>
  );
}

function NoteEditor({
  initial,
  saving,
  onChange,
  onCancel,
  onSave,
}: {
  initial: string;
  saving: boolean;
  onChange: (text: string) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <div className="mt-2 pl-6">
      <textarea
        autoFocus
        rows={3}
        value={initial}
        maxLength={2000}
        onChange={(e) => onChange(e.target.value)}
        placeholder="What should anybody opening this appointment know?"
        className="w-full resize-y rounded-lg border border-border-default bg-bg-base px-2.5 py-2 text-body-sm text-text-primary placeholder:text-text-tertiary focus:border-accent-primary focus:outline-none"
      />
      <div className="mt-1.5 flex justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={saving} className="rounded-lg px-2.5 py-1 text-caption font-medium text-text-secondary hover:bg-bg-subtle">
          Cancel
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent-primary px-2.5 py-1 text-caption font-semibold text-white disabled:opacity-50"
        >
          {saving && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
          Save note
        </button>
      </div>
    </div>
  );
}

/* ── The last recorded outcome ───────────────────────────────────────────── */

function LastOutcome({ a, nowMs, onRecord }: { a: BoardAppointment; nowMs: number; onRecord: () => void }) {
  const s = displayStatus(a, nowMs);
  const what = appointmentKindLabel(a.kind).toLowerCase();
  const at = (iso: string | null) => (iso ? `${shortDate(Date.parse(iso))}, ${dateLines(iso, nowMs).time}` : null);

  const next: OutcomeStep = a.feedbackAt
    ? {
        title: 'Next action',
        detail: a.feedbackStatus === 'done' ? 'Feedback message sent to the client.' : a.feedbackStatus === 'cancelled' ? 'Feedback not sent — the client wrote first.' : 'Feedback message to the client.',
        when: at(a.feedbackAt),
        tone: 'blue',
        icon: 'calendar',
      }
    : a.leadNextAction
      ? { title: 'Next action', detail: a.leadNextAction, when: at(a.leadNextActionAt), tone: 'blue', icon: 'calendar' }
      : { title: 'Next action', detail: 'Nothing planned for this lead yet.', tone: 'grey', icon: 'calendar' };

  let body: React.ReactNode;
  if (s === 'completed') {
    const interest: OutcomeStep =
      a.clientInterested === true
        ? { title: 'Interested', detail: 'The client showed interest.', tone: 'blue', icon: 'people' }
        : a.clientInterested === false
          ? { title: 'Not interested', detail: 'No feedback message was sent.', tone: 'grey', icon: 'cross' }
          : { title: 'Interest not recorded', detail: 'Recorded before this was asked.', tone: 'grey', icon: 'clock' };
    body = (
      <OutcomeStrip
        steps={[
          {
            title: 'Attended',
            detail: a.outcome ? `${a.outcome.slice(0, 90)}${a.outcome.length > 90 ? '…' : ''}` : `The client attended the ${what}.`,
            tone: 'green',
            icon: 'check',
          },
          interest,
          next,
        ]}
      />
    );
  } else if (s === 'cancelled' || s === 'no_show') {
    body = (
      <OutcomeStrip
        steps={[{ title: 'Cancelled', detail: a.outcome || 'No reason was given.', tone: 'red', icon: 'cross' }, next]}
      />
    );
  } else {
    body = (
      <div className="flex flex-wrap items-center gap-3 rounded-xl bg-bg-subtle/60 px-4 py-3.5">
        <Clock3 className="size-5 text-text-tertiary" aria-hidden="true" />
        <p className="min-w-0 flex-1 text-body-sm text-text-secondary">
          {s === 'needs_recording'
            ? `Nothing is recorded for this ${what} yet — it has happened, so record what came of it.`
            : `Nothing to record yet — this ${what} is still ahead.`}
        </p>
        {s === 'needs_recording' && (
          <button type="button" onClick={onRecord} className="rounded-xl bg-accent-primary px-3.5 py-2 text-body-sm font-semibold text-white hover:opacity-90">
            Record outcome
          </button>
        )}
      </div>
    );
  }

  return (
    <section className="rounded-2xl border border-border-subtle bg-bg-surface px-5 py-4 shadow-sm">
      <h2 className="mb-3 text-h3 font-semibold text-text-primary">Last recorded outcome ({apptRef(a.refNo)})</h2>
      {body}
    </section>
  );
}

function Opening({ onClose, label = 'Opening related items…' }: { onClose: () => void; label?: string }) {
  return createPortal(
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/40 p-4" onMouseDown={onClose}>
      <p className="flex items-center gap-2 rounded-xl bg-bg-surface px-4 py-3 text-body-sm text-text-secondary shadow-xl">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" /> {label}
      </p>
    </div>,
    document.body,
  );
}
