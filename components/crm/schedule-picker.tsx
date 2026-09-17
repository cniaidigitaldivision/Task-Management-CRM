'use client';

import * as React from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, Globe, Send, Workflow } from 'lucide-react';

import { formatWhen, karachiAt, karachiParts, TZ } from '@/components/crm/when';
import { cn } from '@/lib/utils';

/* ============================================================================
 * WHEN SHOULD THIS HAPPEN — a calendar, business hours, or an event
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-17, with a design: *"you can see how beautifully you can choose
 * the time and date for the follow-up."* Three ways, because they are three
 * different thoughts: now, a moment, or "a day after the quotation went".
 *
 * ⚠️ KARACHI, ALWAYS, AND IT SAYS SO. The zone is shown rather than assumed —
 * a laptop set to UTC would otherwise book a 10 AM call at 3 PM, and the person
 * who set it would have no way of seeing that from the screen.
 *
 * ⚠️ AND THE BUSINESS HOURS ARE THE ENGINE'S, NOT DECORATION. What is chosen
 * here is stored on the plan and `app.crm_next_send_slot` (187) pushes a step
 * that falls outside them to the next moment they allow.
 * ========================================================================= */

export type ScheduleMode = 'now' | 'at' | 'event';

export interface ScheduleValue {
  readonly mode: ScheduleMode;
  /** Chosen moment, as a Karachi wall-clock instant. Null for "now". */
  readonly at: number | null;
  /** Business hours. Null when the project's quiet hours are enough. */
  readonly hours: { from: number; to: number; days: readonly number[] } | null;
  /** Event anchor: how many days after which event. */
  readonly event: { key: EventKey; days: number } | null;
}

export type EventKey = 'quotation_sent' | 'last_message' | 'visit_booked' | 'lead_created';

export interface EventAnchor {
  readonly key: EventKey;
  readonly label: string;
  /** When it happened. Null means it has not — the option says so. */
  readonly at: string | null;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'] as const;

/** 10 AM … 6 PM, the office's own day, and the default the design shows. */
export const DEFAULT_HOURS = { from: 10, to: 18, days: [1, 2, 3, 4, 5, 6] } as const;

export function ScheduleValueLabel(value: ScheduleValue, nowMs: number, anchors: readonly EventAnchor[]): string {
  if (value.mode === 'now') return 'As soon as the plan starts';
  if (value.mode === 'event' && value.event) {
    const anchor = anchors.find((a) => a.key === value.event?.key);
    const when = eventMoment(value.event, anchors);
    return when === null
      ? `${value.event.days} day${value.event.days === 1 ? '' : 's'} after ${anchor?.label.toLowerCase() ?? 'the event'} — which has not happened yet`
      : formatWhen(new Date(when).toISOString());
  }
  return formatWhen(new Date(value.at ?? nowMs).toISOString());
}

/** The instant an event-based choice resolves to, or null when it cannot yet. */
export function eventMoment(
  event: { key: EventKey; days: number } | null,
  anchors: readonly EventAnchor[],
): number | null {
  if (!event) return null;
  const anchor = anchors.find((a) => a.key === event.key);
  if (!anchor?.at) return null;
  return Date.parse(anchor.at) + event.days * 86_400_000;
}

export function SchedulePicker({
  value,
  onChange,
  nowMs,
  anchors,
  compact = false,
}: {
  value: ScheduleValue;
  onChange: (next: ScheduleValue) => void;
  nowMs: number;
  anchors: readonly EventAnchor[];
  /** Hides the calendar's own heading when it sits inside a step of a wizard. */
  compact?: boolean;
}) {
  const chosen = value.at ?? nowMs;
  const p = karachiParts(chosen);
  const [month, setMonth] = React.useState(() => ({ y: p.y, m: p.m }));

  const set = (patch: Partial<ScheduleValue>) => onChange({ ...value, ...patch });
  const setDay = (y: number, m: number, d: number) => {
    const t = karachiParts(chosen);
    set({ mode: 'at', at: karachiAt(y, m, d, t.h, t.mi) });
  };

  const quick: ReadonlyArray<{ label: string; at: () => number }> = [
    { label: 'Tomorrow', at: () => { const t = karachiParts(nowMs); return karachiAt(t.y, t.m, t.d + 1, 10); } },
    { label: 'In 3 days', at: () => { const t = karachiParts(nowMs); return karachiAt(t.y, t.m, t.d + 3, 10); } },
    { label: 'Next week', at: () => { const t = karachiParts(nowMs); return karachiAt(t.y, t.m, t.d + 7, 10); } },
  ];

  return (
    <div>
      {/* ── The three ways ─────────────────────────────────────────────── */}
      <div role="tablist" aria-label="When" className="flex flex-wrap items-center gap-1 border-b border-border-subtle">
        <Tab active={value.mode === 'now'} onClick={() => set({ mode: 'now', at: null })} icon={Send}>Send now</Tab>
        <Tab active={value.mode === 'at'} onClick={() => set({ mode: 'at', at: value.at ?? quick[0].at() })} icon={CalendarDays}>
          Choose date &amp; time
        </Tab>
        <Tab
          active={value.mode === 'event'}
          onClick={() => set({ mode: 'event', event: value.event ?? { key: anchors[0]?.key ?? 'quotation_sent', days: 1 } })}
          icon={Workflow}
        >
          After an event
        </Tab>
      </div>

      {value.mode === 'now' && (
        <p className="mt-3 rounded-xl bg-bg-subtle px-3.5 py-2.5 text-caption leading-relaxed text-text-secondary">
          The first step goes out as soon as the plan starts — inside business hours, if they are on below.
        </p>
      )}

      {value.mode === 'event' && (
        <div className="mt-3 space-y-2">
          {anchors.map((a) => {
            const on = value.event?.key === a.key;
            return (
              <label
                key={a.key}
                className={cn(
                  'flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-colors',
                  on ? 'border-[var(--pick-border)] bg-[var(--pick-bg)]' : 'border-border-subtle bg-bg-surface hover:bg-bg-subtle',
                  !a.at && 'opacity-70',
                )}
              >
                <input
                  type="radio"
                  name="anchor"
                  checked={on}
                  onChange={() => set({ mode: 'event', event: { key: a.key, days: value.event?.days ?? 1 } })}
                  className="size-4 accent-[var(--pick-mark)]"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-body-sm font-medium text-text-primary">{a.label}</span>
                  <span className="block text-caption text-text-secondary">
                    {a.at ? formatWhen(a.at) : 'Has not happened yet — the plan would wait for it.'}
                  </span>
                </span>
                {on && (
                  <span className="flex shrink-0 items-center gap-1.5">
                    <input
                      type="number"
                      min={0}
                      max={60}
                      value={value.event?.days ?? 1}
                      onChange={(e) => set({ event: { key: a.key, days: Math.max(0, Math.min(60, Number(e.target.value) || 0)) } })}
                      aria-label="Days after"
                      className="w-16 rounded-lg border border-border-default bg-bg-surface px-2 py-1 text-center text-body-sm tabular-nums text-text-primary focus:border-accent-primary focus:outline-none"
                    />
                    <span className="text-caption text-text-secondary">day(s) after</span>
                  </span>
                )}
              </label>
            );
          })}
        </div>
      )}

      {value.mode === 'at' && (
        <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          {/* ── Calendar ─────────────────────────────────────────────── */}
          <div className="rounded-xl border border-border-subtle p-3">
            {!compact && <p className="sr-only">Calendar</p>}
            <div className="flex items-center justify-between">
              <IconButton
                label="Previous month"
                onClick={() => setMonth((v) => (v.m === 1 ? { y: v.y - 1, m: 12 } : { ...v, m: v.m - 1 }))}
              >
                <ChevronLeft className="size-4" aria-hidden="true" />
              </IconButton>
              <p className="text-body-sm font-semibold text-text-primary">
                {MONTHS[month.m - 1]} {month.y}
              </p>
              <IconButton
                label="Next month"
                onClick={() => setMonth((v) => (v.m === 12 ? { y: v.y + 1, m: 1 } : { ...v, m: v.m + 1 }))}
              >
                <ChevronRight className="size-4" aria-hidden="true" />
              </IconButton>
            </div>
            <div className="mt-2 grid grid-cols-7 gap-1 text-center">
              {DAYS.map((d) => (
                <span key={d} className="py-1 text-caption text-text-secondary">{d}</span>
              ))}
              {calendarCells(month.y, month.m).map((cell, i) =>
                cell === null ? (
                  <span key={`x${i}`} />
                ) : (
                  <button
                    key={cell}
                    type="button"
                    onClick={() => setDay(month.y, month.m, cell)}
                    aria-pressed={p.y === month.y && p.m === month.m && p.d === cell}
                    disabled={isPast(month.y, month.m, cell, nowMs)}
                    className={cn(
                      'rounded-lg py-1.5 text-body-sm tabular-nums transition-colors disabled:cursor-not-allowed disabled:opacity-30',
                      p.y === month.y && p.m === month.m && p.d === cell
                        ? 'bg-accent-primary font-semibold text-white'
                        : 'text-text-primary hover:bg-bg-subtle',
                    )}
                  >
                    {cell}
                  </button>
                ),
              )}
            </div>
          </div>

          {/* ── Time, zone, quick picks ──────────────────────────────── */}
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <Field label="Time" icon={Clock3}>
                <select
                  value={`${String(p.h).padStart(2, '0')}:${String(p.mi).padStart(2, '0')}`}
                  onChange={(e) => {
                    const [h, mi] = e.target.value.split(':').map(Number);
                    set({ mode: 'at', at: karachiAt(p.y, p.m, p.d, h, mi) });
                  }}
                  className="w-full bg-transparent text-body-sm text-text-primary focus:outline-none"
                >
                  {times().map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Time zone" icon={Globe}>
                {/* ⚠️ NOT A CHOICE. Every salesperson here works in one zone and a
                    second one on this screen is a second way to book the wrong hour. */}
                <span className="block truncate text-body-sm text-text-primary">{TZ} (UTC+05:00)</span>
              </Field>
            </div>

            <div>
              <p className="text-caption font-semibold text-text-primary">Quick picks</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {quick.map((q) => {
                  const at = q.at();
                  const on = value.at !== null && sameMinute(value.at, at);
                  return (
                    <button
                      key={q.label}
                      type="button"
                      onClick={() => set({ mode: 'at', at })}
                      aria-pressed={on}
                      className={cn(
                        'rounded-full border px-3 py-1 text-caption font-medium transition-colors',
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
          </div>
        </div>
      )}

      {/* ── Business hours, on every mode ──────────────────────────────── */}
      <div className="mt-3 rounded-xl border border-border-subtle p-3">
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={value.hours !== null}
            onChange={(e) => set({ hours: e.target.checked ? { ...DEFAULT_HOURS, days: [...DEFAULT_HOURS.days] } : null })}
            className="mt-0.5 size-4 accent-[var(--pick-mark)]"
          />
          <span className="min-w-0 flex-1">
            <span className="block text-body-sm font-semibold text-text-primary">Send during business hours</span>
            <span className="block text-caption text-text-secondary">
              {value.hours
                ? `${hour12(value.hours.from)} – ${hour12(value.hours.to)}, on the days below. A step due outside them waits, it is never dropped.`
                : 'Off — the project’s quiet hours still apply, so nothing goes out at night.'}
            </span>
          </span>
        </label>

        {value.hours && (
          <>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <Field label="From" icon={Clock3}>
                <select
                  value={value.hours.from}
                  onChange={(e) => set({ hours: { ...value.hours!, from: Number(e.target.value) } })}
                  className="bg-transparent text-body-sm text-text-primary focus:outline-none"
                >
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={h} disabled={h >= value.hours!.to}>{hour12(h)}</option>
                  ))}
                </select>
              </Field>
              <Field label="To" icon={Clock3}>
                <select
                  value={value.hours.to}
                  onChange={(e) => set({ hours: { ...value.hours!, to: Number(e.target.value) } })}
                  className="bg-transparent text-body-sm text-text-primary focus:outline-none"
                >
                  {Array.from({ length: 24 }, (_, h) => h + 1).map((h) => (
                    <option key={h} value={h} disabled={h <= value.hours!.from}>{hour12(h)}</option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {DAYS.map((label, i) => {
                const on = value.hours!.days.includes(i);
                return (
                  <button
                    key={label}
                    type="button"
                    aria-pressed={on}
                    onClick={() => {
                      const days = on ? value.hours!.days.filter((d) => d !== i) : [...value.hours!.days, i].sort();
                      /* ⚠️ NEVER ZERO DAYS. A plan allowed to send on no day at
                         all would wait for ever and look like a bug. */
                      set({ hours: { ...value.hours!, days: days.length > 0 ? days : value.hours!.days } });
                    }}
                    className={cn(
                      'min-w-14 rounded-lg px-3 py-1.5 text-caption font-medium transition-colors',
                      on ? 'bg-accent-primary text-white' : 'bg-bg-subtle text-text-secondary hover:text-text-primary',
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ── Pieces ──────────────────────────────────────────────────────────────── */

function Tab({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' }>;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-body-sm font-medium transition-colors',
        active
          ? 'border-accent-primary text-accent-primary'
          : 'border-transparent text-text-secondary hover:text-text-primary',
      )}
    >
      <Icon className="size-4" aria-hidden="true" />
      {children}
    </button>
  );
}

function Field({
  label,
  icon: Icon,
  children,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' }>;
  children: React.ReactNode;
}) {
  return (
    <label className="block min-w-0">
      <span className="block text-caption text-text-secondary">{label}</span>
      <span className="mt-1 flex items-center gap-2 rounded-lg border border-border-default bg-bg-surface px-2.5 py-1.5">
        <Icon className="size-4 shrink-0 text-text-secondary" aria-hidden="true" />
        <span className="min-w-0 flex-1">{children}</span>
      </span>
    </label>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="grid size-7 place-items-center rounded-lg text-text-secondary transition-colors hover:bg-bg-subtle hover:text-text-primary"
    >
      {children}
    </button>
  );
}

/* ── Dates ───────────────────────────────────────────────────────────────── */

function calendarCells(y: number, m: number): ReadonlyArray<number | null> {
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return [...Array.from({ length: first }, () => null), ...Array.from({ length: days }, (_, i) => i + 1)];
}

function isPast(y: number, m: number, d: number, nowMs: number): boolean {
  const today = karachiParts(nowMs);
  return karachiAt(y, m, d, 23, 59) < karachiAt(today.y, today.m, today.d, 0, 0);
}

function sameMinute(a: number, b: number): boolean {
  return Math.abs(a - b) < 60_000;
}

function hour12(h: number): string {
  const hour = h % 24;
  const suffix = hour < 12 ? 'AM' : 'PM';
  const shown = hour % 12 === 0 ? 12 : hour % 12;
  return `${shown}:00 ${suffix}`;
}

/** Every half hour, which is as fine as anybody schedules a follow-up. */
function times(): ReadonlyArray<{ value: string; label: string }> {
  const out: Array<{ value: string; label: string }> = [];
  for (let h = 0; h < 24; h++) {
    for (const mi of [0, 30]) {
      const value = `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
      const suffix = h < 12 ? 'AM' : 'PM';
      const shown = h % 12 === 0 ? 12 : h % 12;
      out.push({ value, label: `${shown}:${String(mi).padStart(2, '0')} ${suffix}` });
    }
  }
  return out;
}
