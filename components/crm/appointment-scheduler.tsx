'use client';

import * as React from 'react';
import { Bell, CalendarDays, ChevronDown, Clock3, Globe, Info, MapPin, Ruler, Wallet } from 'lucide-react';

import { DayChips, Field, hour12, MonthGrid, PickerTab, sameMinute, TimeInput, dayOfWeek } from '@/components/crm/calendar-bits';
import { karachiAt, karachiParts, TZ } from '@/components/crm/when';
import { WA_GREEN, WhatsAppMark } from '@/components/crm/whatsapp-mark';
import { displayPhone } from '@/lib/domain/phone';
import { cn } from '@/lib/utils';

/* ============================================================================
 * SCHEDULING AN APPOINTMENT — the owner's date-and-time design, for a diary
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-18, with the reference: *"properly I can get time, date, and
 * everything very interactively… design the appointment tab so that when I click
 * to schedule an appointment, it shows me this way."*
 *
 * The reference is the follow-up scheduler, and its three top tabs are about
 * SENDING a message: now, at a moment, after an event. An appointment has no
 * "now" — somebody has to be somewhere — so the same row carries the thing that
 * actually varies here, which is WHAT KIND of appointment it is. That is the
 * owner's standing rule about their designs: *"implement it logically according
 * to our data structure, our life cycles, and our flow."*
 *
 *   the reference            →  here
 *   Send now                 →  Site visit
 *   Choose date & time       →  Payment plan meeting
 *   After an event           →  WhatsApp call
 *   Send during business hours → the office's own hours, as a guard
 *   Event-based scheduling   →  a WhatsApp reminder for the client
 *
 * ⚠️ THE OFFICE HOURS ARE A GUARD, NOT DECORATION. With it on, a slot outside
 * 10 AM – 6 PM or on a closed day is snapped to the next one that works, and the
 * strip says so. A visit booked for 9 PM on a Sunday is a client standing at a
 * gate nobody is behind.
 *
 * ⚠️ AND THE REMINDER IS A REAL FOLLOW-UP. It writes `appointment_reminder`,
 * which is the purpose the Appointments tab already reads back as "WhatsApp
 * reminder · Scheduled" (`visitReminderAt`). A toggle that only looked right
 * would promise the client a message nobody sends.
 * ========================================================================= */

export type AppointmentKindKey = 'site_visit' | 'meeting' | 'call';

export interface AppointmentDraft {
  readonly kind: AppointmentKindKey;
  /** Karachi wall-clock instant. */
  readonly at: number;
  readonly minutes: number;
  readonly location: string;
  readonly note: string;
  /** Hours before the visit to remind the client, or null for no reminder. */
  readonly remindHoursBefore: number | null;
}

/** 10 AM – 6 PM, Monday to Saturday: the office's own week. */
export const OFFICE = { from: 10, to: 18, days: [1, 2, 3, 4, 5, 6] } as const;

const KINDS: ReadonlyArray<{
  key: AppointmentKindKey;
  label: string;
  icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' }>;
  minutes: number;
  hint: string;
  placeholder: string;
}> = [
  {
    key: 'site_visit',
    label: 'Site visit',
    icon: MapPin,
    minutes: 90,
    hint: 'Somebody meets the client at the plot — the location is where they are being met.',
    placeholder: 'Where to meet — site office, gate, plot number',
  },
  {
    key: 'meeting',
    label: 'Payment plan meeting',
    icon: Wallet,
    minutes: 45,
    hint: 'The instalments conversation: the office, or wherever the client is.',
    placeholder: 'Where — our office, their office, online',
  },
  {
    key: 'call',
    label: 'WhatsApp call',
    icon: WhatsAppMark,
    minutes: 20,
    hint: 'Placed from the business number, so the client sees the business calling.',
    placeholder: 'Nothing to fill in — the call goes to their WhatsApp',
  },
];

const REMINDERS: ReadonlyArray<{ label: string; hours: number | null }> = [
  { label: 'No reminder', hours: null },
  { label: '1 day before', hours: 24 },
  { label: '3 hours before', hours: 3 },
  { label: '1 hour before', hours: 1 },
];

/** The next moment the office is open, at or after this one. */
export function snapToOffice(at: number, hours: { from: number; to: number; days: readonly number[] }): number {
  let { y, m, d, h, mi } = karachiParts(at);
  for (let guard = 0; guard < 14; guard++) {
    const open = hours.days.includes(dayOfWeek(y, m, d));
    /* ⚠️ CLOSING TIME IS NOT AN OPEN SLOT, and this has to agree with
       `outsideOffice` exactly. An appointment starting at 6 PM runs past the hour
       the office shuts; one rule calling that fine while the other warns about it
       is a screen arguing with itself. */
    if (open && h >= hours.from && h < hours.to) {
      return karachiAt(y, m, d, h, mi);
    }
    if (open && h < hours.from) return karachiAt(y, m, d, hours.from, 0);
    /* Past closing, or a closed day: try the next morning. */
    ({ y, m, d } = karachiParts(karachiAt(y, m, d + 1, 12)));
    h = hours.from;
    mi = 0;
  }
  return at;
}

export function outsideOffice(at: number, hours: { from: number; to: number; days: readonly number[] }): string | null {
  const { y, m, d, h } = karachiParts(at);
  if (!hours.days.includes(dayOfWeek(y, m, d))) {
    const day = new Date(at).toLocaleDateString('en-GB', { weekday: 'long', timeZone: TZ });
    return `${day} is not a working day.`;
  }
  if (h < hours.from) return `Before the office opens at ${hour12(hours.from)}.`;
  if (h >= hours.to) return `After the office closes at ${hour12(hours.to)}.`;
  return null;
}

/** "Tuesday, 15 September · 10:00 AM PKT" — the reference's own summary line. */
export function appointmentSummary(at: number): string {
  const date = new Date(at);
  /* ⚠️ THE COMMA IS BUILT, NOT ASKED FOR. `en-GB` renders weekday-day-month as
     "Tuesday 15 September"; the owner's reference reads "Tuesday, 15 September". */
  const weekday = date.toLocaleDateString('en-GB', { weekday: 'long', timeZone: TZ });
  const day = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: TZ });
  const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ });
  return `${weekday}, ${day} · ${time} PKT`;
}

export function AppointmentScheduler({
  draft,
  onChange,
  nowMs,
  clientPhone,
  clientName,
  /** What the visit would be about, when the lead has a unit on it. */
  unitLabel,
  busy,
  onCancel,
  onSubmit,
  existing,
}: {
  draft: AppointmentDraft;
  onChange: (next: AppointmentDraft) => void;
  nowMs: number;
  clientPhone: string | null;
  clientName: string;
  unitLabel: string | null;
  busy: boolean;
  onCancel: () => void;
  onSubmit: () => void;
  /** Appointments already in the diary for this lead, to warn about a double booking. */
  existing: ReadonlyArray<{ at: string; minutes: number; status: string }>;
}) {
  const p = karachiParts(draft.at);
  const [month, setMonth] = React.useState(() => ({ y: p.y, m: p.m }));
  const [guard, setGuard] = React.useState(true);
  const [remindOpen, setRemindOpen] = React.useState(false);

  const kind = KINDS.find((k) => k.key === draft.kind) ?? KINDS[0];
  const set = (patch: Partial<AppointmentDraft>) => {
    const next = { ...draft, ...patch };
    /* ⚠️ THE SNAP HAPPENS HERE, ONCE, on the value being committed — not in an
       effect that would fight the person as they type. */
    onChange(guard && patch.at !== undefined ? { ...next, at: snapToOffice(next.at, OFFICE) } : next);
  };

  const problem = outsideOffice(draft.at, OFFICE);
  const inPast = draft.at < nowMs;

  /* Something else already in that hour — said, never refused (the booking action
     has the same rule, and the person decides). */
  const clash = existing.find((a) => {
    if (!['scheduled', 'confirmed'].includes(a.status)) return false;
    const start = Date.parse(a.at);
    return Math.abs(start - draft.at) < Math.max(draft.minutes, a.minutes) * 60_000;
  });

  const quick: ReadonlyArray<{ label: string; at: () => number }> = [
    { label: 'Tomorrow', at: () => { const t = karachiParts(nowMs); return karachiAt(t.y, t.m, t.d + 1, 10); } },
    { label: 'In 3 days', at: () => { const t = karachiParts(nowMs); return karachiAt(t.y, t.m, t.d + 3, 10); } },
    { label: 'Next week', at: () => { const t = karachiParts(nowMs); return karachiAt(t.y, t.m, t.d + 7, 10); } },
  ];

  return (
    /* ⚠️ A FLEX CHILD, NOT AN OVERLAY. It fills the dialog's tab area, so the
       "Related items" header and the five tabs stay where they were and the
       dialog's fixed height does not move — the owner's first rule about this
       modal. An `absolute inset-0` here covered the header too. */
    <div className="flex min-h-0 flex-1 flex-col bg-bg-surface">
      {/* ── What kind of appointment ───────────────────────────────────── */}
      <div role="tablist" aria-label="Appointment kind" className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border-subtle px-6">
        {KINDS.map((k) => (
          <PickerTab
            key={k.key}
            active={draft.kind === k.key}
            icon={k.icon}
            onClick={() => set({ kind: k.key, minutes: k.minutes })}
          >
            {k.label}
          </PickerTab>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
          <MonthGrid
            month={month}
            onMonth={setMonth}
            selected={{ y: p.y, m: p.m, d: p.d }}
            onPick={(y, m, d) => set({ at: karachiAt(y, m, d, p.h, p.mi) })}
            nowMs={nowMs}
            closedDays={[0]}
          />

          <div className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-3">
              <Field label="Date" icon={CalendarDays}>
                <span className="block truncate text-body-sm text-text-primary">
                  {new Date(draft.at).toLocaleDateString('en-GB', {
                    day: 'numeric', month: 'short', year: 'numeric', timeZone: TZ,
                  })}
                </span>
              </Field>
              <Field label="Time" icon={Clock3}>
                <TimeInput
                  h={p.h}
                  mi={p.mi}
                  onChange={(h, mi) => set({ at: karachiAt(p.y, p.m, p.d, h, mi) })}
                />
              </Field>
              {/* ⚠️ NOT A CHOICE. Everybody here works in one zone, and a second
                  one on this screen is a second way to book the wrong hour. */}
              <Field label="Time zone" icon={Globe}>
                <span className="block truncate text-body-sm text-text-primary">{TZ} (UTC+05:00)</span>
              </Field>
            </div>

            <div className="grid gap-2 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
              <Field label="Length" icon={Ruler}>
                <select
                  value={draft.minutes}
                  onChange={(e) => set({ minutes: Number(e.target.value) })}
                  aria-label="Length"
                  className="w-full bg-transparent text-body-sm text-text-primary focus:outline-none"
                >
                  {[15, 20, 30, 45, 60, 90, 120].map((m) => (
                    <option key={m} value={m}>{m} minutes</option>
                  ))}
                </select>
              </Field>
              <Field label={draft.kind === 'call' ? 'Calling' : 'Where'} icon={draft.kind === 'call' ? WhatsAppMark : MapPin}>
                {draft.kind === 'call' ? (
                  <span className="block truncate text-body-sm text-text-primary">
                    {clientPhone ? displayPhone(clientPhone) : 'No WhatsApp number on this lead'}
                  </span>
                ) : (
                  <input
                    value={draft.location}
                    onChange={(e) => set({ location: e.target.value })}
                    placeholder={kind.placeholder}
                    aria-label="Where"
                    className="w-full bg-transparent text-body-sm text-text-primary placeholder:text-text-tertiary focus:outline-none"
                  />
                )}
              </Field>
            </div>

            <div>
              <p className="text-caption font-semibold text-text-primary">Quick picks</p>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {quick.map((q) => {
                  const at = guard ? snapToOffice(q.at(), OFFICE) : q.at();
                  const on = sameMinute(draft.at, at);
                  return (
                    <button
                      key={q.label}
                      type="button"
                      onClick={() => set({ at: q.at() })}
                      aria-pressed={on}
                      className={cn(
                        'rounded-full border px-4 py-1.5 text-caption font-medium transition-colors',
                        on
                          ? 'border-accent-primary bg-accent-primary text-white'
                          : 'border-border-default text-text-primary hover:bg-bg-subtle',
                      )}
                    >
                      {q.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* ── The office's own hours ──────────────────────────────── */}
            <div className="rounded-xl border border-border-subtle p-3.5">
              <div className="flex items-start gap-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-bg-subtle text-text-secondary">
                  <Clock3 className="size-4" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-body-sm font-semibold text-text-primary">Keep inside office hours</p>
                  <p className="text-caption text-text-secondary">
                    {hour12(OFFICE.from)} – {hour12(OFFICE.to)}
                    {guard ? ', and a slot outside them moves to the next one that works.' : ' — off, so any hour can be booked.'}
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={guard}
                  aria-label="Keep inside office hours"
                  onClick={() => {
                    const next = !guard;
                    setGuard(next);
                    if (next) onChange({ ...draft, at: snapToOffice(draft.at, OFFICE) });
                  }}
                  className={cn(
                    'relative h-6 w-11 shrink-0 rounded-full transition-colors',
                    guard ? 'bg-accent-primary' : 'bg-border-default',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'absolute top-0.5 size-5 rounded-full bg-white shadow transition-all',
                      guard ? 'left-[1.375rem]' : 'left-0.5',
                    )}
                  />
                </button>
              </div>
              <div className="mt-2.5">
                <DayChips days={OFFICE.days} ariaLabel="Days the office is open" />
              </div>
            </div>

            {/* ── Remind the client ──────────────────────────────────── */}
            <div className="rounded-xl bg-bg-subtle/60 p-3.5">
              <button
                type="button"
                onClick={() => setRemindOpen((v) => !v)}
                aria-expanded={remindOpen}
                className="flex w-full items-center gap-3 text-left"
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-bg-surface text-text-secondary">
                  <Bell className="size-4" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-body-sm font-semibold text-text-primary">Remind the client</span>
                  <span className="block truncate text-caption text-text-secondary">
                    {draft.remindHoursBefore === null
                      ? 'No reminder — nothing goes to the client about this.'
                      : `WhatsApp ${REMINDERS.find((r) => r.hours === draft.remindHoursBefore)?.label.toLowerCase()}, from the business number.`}
                  </span>
                </span>
                <ChevronDown
                  className={cn('size-4 shrink-0 text-text-secondary transition-transform', remindOpen && 'rotate-180')}
                  aria-hidden="true"
                />
              </button>
              {remindOpen && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {REMINDERS.map((r) => {
                    const on = draft.remindHoursBefore === r.hours;
                    return (
                      <button
                        key={r.label}
                        type="button"
                        onClick={() => set({ remindHoursBefore: r.hours })}
                        aria-pressed={on}
                        className={cn(
                          'rounded-full border px-3.5 py-1.5 text-caption font-medium transition-colors',
                          on
                            ? 'border-accent-primary bg-accent-primary text-white'
                            : 'border-border-default bg-bg-surface text-text-primary hover:bg-bg-subtle',
                        )}
                      >
                        {r.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <label className="block">
              <span className="text-caption text-text-secondary">Note (optional)</span>
              <input
                value={draft.note}
                onChange={(e) => set({ note: e.target.value })}
                placeholder={`What this ${kind.label.toLowerCase()} is about${unitLabel ? ` — e.g. ${unitLabel}` : ''}`}
                className="mt-1 w-full rounded-lg border border-border-default bg-bg-surface px-3 py-2 text-body-sm text-text-primary placeholder:text-text-tertiary focus:border-accent-primary focus:outline-none"
              />
            </label>

            <p className="flex items-start gap-2 text-caption leading-relaxed text-text-secondary">
              <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              {kind.hint}
            </p>
          </div>
        </div>
      </div>

      {/* ── The summary strip, as the reference draws it ────────────────── */}
      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border-subtle px-6 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className="grid size-9 shrink-0 place-items-center rounded-lg"
            style={{ background: 'color-mix(in oklab, var(--accent-primary) 12%, transparent)', color: 'var(--accent-primary)' }}
          >
            <CalendarDays className="size-4.5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-body font-semibold text-text-primary">{appointmentSummary(draft.at)}</p>
            <p className="truncate text-caption text-text-secondary">
              {TZ} (UTC+05:00) · {kind.label} · {draft.minutes} minutes
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex min-h-[2.75rem] items-center rounded-lg border border-border-default bg-bg-surface px-5 text-body-sm font-semibold text-text-primary transition-colors hover:bg-bg-subtle"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || inPast}
            onClick={onSubmit}
            className="inline-flex min-h-[2.75rem] items-center rounded-lg bg-accent-primary px-5 text-body-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy ? 'Booking…' : 'Schedule appointment'}
          </button>
        </div>
      </footer>

      {/* ⚠️ THE WARNINGS SIT ABOVE THE BUTTON THEY ARE ABOUT, and none of them
          blocks except a time that has already passed. */}
      {(inPast || problem || clash) && (
        <div className="shrink-0 space-y-1 border-t border-border-subtle px-6 py-2.5">
          {inPast && (
            <p className="text-caption font-medium" style={{ color: 'var(--feedback-error)' }}>
              That moment has already passed — pick a later one.
            </p>
          )}
          {!inPast && problem && (
            <p className="text-caption text-text-secondary">
              {problem} {guard ? 'Turn the guard off above to book it anyway.' : `${clientName} will be expecting somebody.`}
            </p>
          )}
          {clash && (
            <p className="flex items-center gap-1.5 text-caption" style={{ color: WA_GREEN }}>
              <Info className="size-3.5 shrink-0" aria-hidden="true" />
              Something else is already booked in that hour. Both can stand — move one if you need to.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
