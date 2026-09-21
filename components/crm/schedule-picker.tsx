'use client';

import * as React from 'react';
import { CalendarDays, Clock3, Globe, Send, Workflow } from 'lucide-react';

/* ⚠️ THE CALENDAR IS SHARED WITH THE APPOINTMENTS TAB. One month grid, one idea
   of which days are past, one time input (to the minute) — see `calendar-bits.tsx`. */
import {
  DayChips,
  Field,
  hour12,
  MonthGrid,
  PickerTab as Tab,
  sameMinute,
  TimeInput,
} from '@/components/crm/calendar-bits';
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
}: {
  value: ScheduleValue;
  onChange: (next: ScheduleValue) => void;
  nowMs: number;
  anchors: readonly EventAnchor[];
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
      <div role="tablist" aria-label="When" className="flex flex-wrap items-center gap-2 border-b border-border-subtle sm:gap-4">
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
          <MonthGrid
            month={month}
            onMonth={setMonth}
            selected={{ y: p.y, m: p.m, d: p.d }}
            onPick={(y, m, d) => setDay(y, m, d)}
            nowMs={nowMs}
          />

          {/* ── Time, zone, quick picks ──────────────────────────────── */}
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <Field label="Time" icon={Clock3}>
                <TimeInput
                  h={p.h}
                  mi={p.mi}
                  onChange={(h, mi) => set({ mode: 'at', at: karachiAt(p.y, p.m, p.d, h, mi) })}
                />
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
            <div className="mt-2">
              <DayChips
                days={value.hours.days}
                ariaLabel="Days a step may go out"
                onToggle={(i) => {
                  const on = value.hours!.days.includes(i);
                  const days = on ? value.hours!.days.filter((d) => d !== i) : [...value.hours!.days, i].sort();
                  /* ⚠️ NEVER ZERO DAYS. A plan allowed to send on no day at all
                     would wait for ever and look like a bug. */
                  set({ hours: { ...value.hours!, days: days.length > 0 ? days : value.hours!.days } });
                }}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}


/* ── Pieces ──────────────────────────────────────────────────────────────── */




/* ── Dates ───────────────────────────────────────────────────────────────── */





/** Every half hour, which is as fine as anybody schedules a follow-up. */
