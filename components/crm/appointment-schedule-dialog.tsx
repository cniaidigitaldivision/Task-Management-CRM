'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { Building2, CalendarPlus, Car, Loader2, Phone, Search, Users, X } from 'lucide-react';

import { bookableLeadsAction } from '@/app/actions/crm-appointments-board';
import { bookAppointmentAction, rescheduleAppointmentAction } from '@/app/actions/crm-leads';
import { useToast } from '@/components/ui/toast';
import type { BookableLead } from '@/lib/db/queries/crm-appointments-board';
import { cn } from '@/lib/utils';

/* ============================================================================
 * SCHEDULE AND RESCHEDULE — the Appointments page's two booking dialogs
 * ----------------------------------------------------------------------------
 * ⚠️ THE SAME WRITES EVERY OTHER SCREEN USES. bookAppointmentAction and
 * rescheduleAppointmentAction carry the rules (no past times, a sane length,
 * the clash said out loud); this only asks for the answers.
 *
 * ⚠️ NO REMINDER PICKER. Booking queues the client's confirmation and the
 * reminder before it by itself (220/235), at the project's own lead time.
 * Offering a second reminder here would send the client two.
 *
 * ⚠️ KARACHI WALL CLOCK. "2026-09-23" + "15:00" is 3 PM in Karachi, whatever
 * zone the laptop is in.
 * ========================================================================= */

const KARACHI_MS = 5 * 3_600_000;

/** "2026-09-23" + "15:00" (Karachi) → ISO instant; null when incomplete. */
export function karachiInstant(date: string, time: string): string | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{2}):(\d{2})$/.exec(time);
  if (!d || !t) return null;
  return new Date(Date.UTC(+d[1], +d[2] - 1, +d[3], +t[1], +t[2]) - KARACHI_MS).toISOString();
}

/** The Karachi date and time fields for an instant. */
export function karachiFields(iso: string): { date: string; time: string } {
  const local = new Date(Date.parse(iso) + KARACHI_MS).toISOString();
  return { date: local.slice(0, 10), time: local.slice(11, 16) };
}

const KINDS = [
  { key: 'site_visit', label: 'Site visit', icon: Car, minutes: 90 },
  { key: 'office_visit', label: 'Office visit', icon: Building2, minutes: 60 },
  { key: 'meeting', label: 'Meeting / demo', icon: Users, minutes: 45 },
  { key: 'call', label: 'WhatsApp call', icon: Phone, minutes: 20 },
] as const;

const DURATIONS = [15, 20, 30, 45, 60, 90, 120, 180];

const field =
  'w-full rounded-lg border border-border-default bg-bg-base px-2.5 py-2 text-body-sm text-text-primary placeholder:text-text-tertiary focus:border-accent-primary focus:outline-none';

function Shell({
  title,
  subtitle,
  onClose,
  busy,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  busy: boolean;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [busy, onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <button type="button" aria-label="Close" onClick={() => !busy && onClose()} className="absolute inset-0 bg-black/40" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative flex max-h-[92vh] w-full max-w-lg flex-col rounded-2xl border border-border-subtle bg-bg-surface shadow-xl"
      >
        <div className="flex items-start gap-3 border-b border-border-subtle px-5 py-4">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-accent-primary/10">
            <CalendarPlus className="size-4 text-accent-primary" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-body font-semibold text-text-primary">{title}</h2>
            {subtitle && <p className="mt-0.5 truncate text-caption text-text-secondary">{subtitle}</p>}
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={() => !busy && onClose()}
            className="grid size-7 shrink-0 place-items-center rounded-lg text-text-secondary hover:bg-bg-subtle"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-3.5 overflow-y-auto px-5 py-4">{children}</div>
        <div className="flex justify-end gap-2 border-t border-border-subtle px-5 py-3.5">{footer}</div>
      </div>
    </div>,
    document.body,
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <span className="mb-1 block text-caption font-semibold text-text-secondary">{children}</span>;
}

function WhenFields({
  date,
  time,
  minutes,
  today,
  onDate,
  onTime,
  onMinutes,
}: {
  date: string;
  time: string;
  minutes: number;
  today: string;
  onDate: (v: string) => void;
  onTime: (v: string) => void;
  onMinutes: (v: number) => void;
}) {
  return (
    <div className="grid gap-2.5 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)]">
      <label className="block">
        <Label>Date</Label>
        <input type="date" value={date} min={today} onChange={(e) => onDate(e.target.value)} className={field} />
      </label>
      <label className="block">
        <Label>Time (Karachi)</Label>
        <input type="time" value={time} step={60} onChange={(e) => onTime(e.target.value)} className={field} />
      </label>
      <label className="block">
        <Label>Length</Label>
        <select value={minutes} onChange={(e) => onMinutes(Number(e.target.value))} className={field}>
          {DURATIONS.map((m) => (
            <option key={m} value={m}>
              {m < 60 ? `${m} minutes` : `${m / 60} hour${m === 60 ? '' : 's'}`}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

/* ── Schedule a new appointment ──────────────────────────────────────────── */

export function ScheduleAppointmentDialog({
  nowMs,
  onClose,
  onBooked,
  initialLead = null,
}: {
  nowMs: number;
  onClose: () => void;
  onBooked: () => void;
  /** "Book another" from an appointment: the lead is already chosen. */
  initialLead?: { id: string; name: string; projectName: string | null } | null;
}) {
  const toast = useToast();
  const [leads, setLeads] = React.useState<BookableLead[] | null>(null);
  const [q, setQ] = React.useState('');
  const [leadId, setLeadId] = React.useState<string | null>(initialLead?.id ?? null);
  const [kind, setKind] = React.useState<(typeof KINDS)[number]['key']>('site_visit');
  const [minutes, setMinutes] = React.useState(90);
  const tomorrow = karachiFields(new Date(nowMs + 86_400_000).toISOString()).date;
  const today = karachiFields(new Date(nowMs).toISOString()).date;
  const [date, setDate] = React.useState(tomorrow);
  const [time, setTime] = React.useState('11:00');
  const [location, setLocation] = React.useState('');
  const [note, setNote] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  /* The list arrives underneath a dialog that is already open (Rule Zero). */
  React.useEffect(() => {
    let alive = true;
    void bookableLeadsAction()
      .then((rows) => alive && setLeads(rows))
      .catch(() => alive && setLeads([]));
    return () => {
      alive = false;
    };
  }, []);

  const words = q.trim().toLowerCase();
  const shown = (leads ?? []).filter(
    (l) => !words || `${l.name} ${l.projectName ?? ''} ${l.phone ?? ''}`.toLowerCase().includes(words),
  );
  /* The preset lead shows at once, before the list has arrived. */
  const chosen =
    leads?.find((l) => l.id === leadId) ??
    (initialLead && initialLead.id === leadId
      ? { id: initialLead.id, name: initialLead.name, projectName: initialLead.projectName, phone: null, stage: '' }
      : null);
  const at = karachiInstant(date, time);

  const book = async () => {
    if (!chosen || !at) return;
    setBusy(true);
    const result = await bookAppointmentAction({
      leadId: chosen.id,
      kind,
      scheduledAt: at,
      durationMinutes: minutes,
      location,
      note,
      remindHoursBefore: null,
    });
    setBusy(false);
    if (!result.ok) {
      toast({ tone: 'error', text: result.error ?? 'That could not be booked.' });
      return;
    }
    toast({
      tone: 'ok',
      text: result.clash ?? `Booked for ${chosen.name}. The confirmation goes to the client now, and a reminder before it.`,
    });
    onBooked();
    onClose();
  };

  return (
    <Shell
      title="Schedule appointment"
      subtitle="For one of your leads. The client is sent the confirmation and a reminder."
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="rounded-xl border border-border-default px-3.5 py-2 text-body-sm font-medium text-text-primary hover:bg-bg-subtle disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || !chosen || !at}
            onClick={() => void book()}
            className="inline-flex items-center gap-2 rounded-xl bg-accent-primary px-3.5 py-2 text-body-sm font-semibold text-white hover:opacity-90 disabled:opacity-40"
          >
            {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            {busy ? 'Booking…' : 'Book it'}
          </button>
        </>
      }
    >
      <div>
        <Label>Lead</Label>
        {chosen ? (
          <div className="flex items-center gap-2 rounded-lg border border-border-default bg-bg-base px-2.5 py-2">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-body-sm font-semibold text-text-primary">{chosen.name}</span>
              <span className="block truncate text-caption text-text-secondary">{chosen.projectName ?? '—'}</span>
            </span>
            <button type="button" onClick={() => setLeadId(null)} className="text-caption font-medium text-text-brand hover:underline">
              Change
            </button>
          </div>
        ) : (
          <div className="rounded-lg border border-border-default bg-bg-base">
            <span className="flex items-center gap-2 border-b border-border-subtle px-2.5 py-2">
              <Search className="size-4 shrink-0 text-text-tertiary" aria-hidden="true" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search your leads by name, project or phone…"
                className="min-w-0 flex-1 bg-transparent text-body-sm text-text-primary placeholder:text-text-tertiary focus:outline-none"
              />
            </span>
            <ul className="max-h-48 overflow-y-auto py-1">
              {leads === null ? (
                <li className="flex items-center gap-2 px-3 py-2 text-caption text-text-secondary">
                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> Reading your leads…
                </li>
              ) : shown.length === 0 ? (
                <li className="px-3 py-2 text-caption text-text-secondary">
                  {leads.length === 0 ? 'You have no open leads to book for.' : 'No lead matches that.'}
                </li>
              ) : (
                shown.slice(0, 80).map((l) => (
                  <li key={l.id}>
                    <button
                      type="button"
                      onClick={() => setLeadId(l.id)}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-bg-subtle"
                    >
                      <span className="min-w-0 flex-1 truncate text-body-sm text-text-primary">{l.name}</span>
                      <span className="max-w-[45%] shrink-0 truncate text-caption text-text-secondary">{l.projectName}</span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
        )}
      </div>

      <div>
        <Label>What is it?</Label>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {KINDS.map((k) => (
            <button
              key={k.key}
              type="button"
              onClick={() => {
                setKind(k.key);
                setMinutes(k.minutes);
              }}
              aria-pressed={kind === k.key}
              className={cn(
                'flex flex-col items-center gap-1 rounded-xl border px-2 py-2.5 text-caption font-medium transition-colors',
                kind === k.key
                  ? 'border-[var(--pick-border)] bg-[var(--pick-bg)] text-text-primary'
                  : 'border-border-default text-text-secondary hover:text-text-primary',
              )}
            >
              <k.icon className="size-4" aria-hidden="true" />
              {k.label}
            </button>
          ))}
        </div>
      </div>

      <WhenFields date={date} time={time} minutes={minutes} today={today} onDate={setDate} onTime={setTime} onMinutes={setMinutes} />

      <label className="block">
        <Label>Location</Label>
        <input
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder={kind === 'call' ? 'Nothing needed — the call goes to their WhatsApp' : 'Site office, plot number, or our office'}
          className={field}
        />
      </label>
      <label className="block">
        <Label>Note (for you, not the client)</Label>
        <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} className={cn(field, 'resize-y')} />
      </label>
    </Shell>
  );
}

/* ── Reschedule ──────────────────────────────────────────────────────────── */

export function RescheduleAppointmentDialog({
  appointment,
  nowMs,
  onClose,
  onMoved,
}: {
  appointment: {
    id: string;
    leadId: string;
    leadName: string | null;
    scheduledAt: string;
    durationMinutes: number;
    location: string | null;
    ref: string;
  };
  nowMs: number;
  onClose: () => void;
  onMoved: () => void;
}) {
  const toast = useToast();
  const was = karachiFields(appointment.scheduledAt);
  const today = karachiFields(new Date(nowMs).toISOString()).date;
  /* ⚠️ A PAST TIME OPENS ON TOMORROW. The commonest reason to move an
     appointment is that its time has gone; opening on that time would open on
     an answer the action refuses. */
  const past = Date.parse(appointment.scheduledAt) <= nowMs;
  const [date, setDate] = React.useState(past ? karachiFields(new Date(nowMs + 86_400_000).toISOString()).date : was.date);
  const [time, setTime] = React.useState(was.time);
  const [minutes, setMinutes] = React.useState(appointment.durationMinutes);
  const [location, setLocation] = React.useState(appointment.location ?? '');
  const [busy, setBusy] = React.useState(false);
  const at = karachiInstant(date, time);

  const move = async () => {
    if (!at) return;
    setBusy(true);
    const result = await rescheduleAppointmentAction({
      appointmentId: appointment.id,
      leadId: appointment.leadId,
      at,
      minutes,
      location,
    });
    setBusy(false);
    if (!result.ok) {
      toast({ tone: 'error', text: result.error ?? 'That could not be moved.' });
      return;
    }
    toast({ tone: 'ok', text: 'Moved. The client is sent the new time, and the reminder moves with it.' });
    onMoved();
    onClose();
  };

  return (
    <Shell
      title={`Reschedule ${appointment.ref}`}
      subtitle={appointment.leadName ?? undefined}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="rounded-xl border border-border-default px-3.5 py-2 text-body-sm font-medium text-text-primary hover:bg-bg-subtle disabled:opacity-50"
          >
            Keep it
          </button>
          <button
            type="button"
            disabled={busy || !at}
            onClick={() => void move()}
            className="inline-flex items-center gap-2 rounded-xl bg-accent-primary px-3.5 py-2 text-body-sm font-semibold text-white hover:opacity-90 disabled:opacity-40"
          >
            {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            {busy ? 'Moving…' : 'Move it'}
          </button>
        </>
      }
    >
      <WhenFields date={date} time={time} minutes={minutes} today={today} onDate={setDate} onTime={setTime} onMinutes={setMinutes} />
      <label className="block">
        <Label>Location</Label>
        <input value={location} onChange={(e) => setLocation(e.target.value)} className={field} />
      </label>
      <p className="text-caption text-text-secondary">
        One appointment moves — it does not become two. The old time is kept in its notes.
      </p>
    </Shell>
  );
}
