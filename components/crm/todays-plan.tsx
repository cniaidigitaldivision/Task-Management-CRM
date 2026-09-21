'use client';

import * as React from 'react';
import { Building2, CalendarClock, Car, MapPin, Phone, Users } from 'lucide-react';

import { CancelAppointmentDialog } from '@/components/crm/cancel-appointment-dialog';
import { RecordAppointmentDialog } from '@/components/crm/record-appointment';
import type { CrmDiaryEntry } from '@/lib/db/queries/crm-leads';
import {
  appointmentKindLabel,
  appointmentStatusLabel,
  appointmentStatusToken,
} from '@/lib/domain/crm-appointments';
import { cn } from '@/lib/utils';

/* ============================================================================
 * TODAY'S PLAN — the appointments a salesperson actually has to turn up to
 * ----------------------------------------------------------------------------
 * Phase E's missing half. Booking has worked since the outcome form learned to
 * write one; until now there was nowhere to SEE them, so visits accumulated
 * where nobody could look at them.
 *
 * ── ⚠️ AN APPOINTMENT IS NOT A NEXT ACTION, AND THIS IS WHY IT HAS ITS OWN
 *    PLACE ON THE PAGE ────────────────────────────────────────────────────
 * `next_action_at` is a note to self — *ring them Tuesday* — and it already has
 * a column in the table. This is a promise made to somebody else: they are
 * coming to the site at four, and if nobody is there the lead is lost for a
 * reason that has nothing to do with the plot. Mixing the two into one list
 * would bury the four or five appointments that actually constrain a day among
 * forty reminders that do not.
 *
 * ── ⚠️ IT SHOWS ONLY WHAT IS STILL AHEAD, PLUS TODAY'S PAST ONES ───────────
 * A visit at 9am is still today's business at 10am — somebody has to record what
 * happened at it. `crmMyDiary` reads from the start of the day in Karachi rather
 * than from `now()` for exactly that reason: a rail that dropped each entry the
 * moment it began would empty itself over the course of the morning, which is
 * when it is most looked at.
 * ========================================================================= */

const KIND_ICON: Record<string, typeof CalendarClock> = {
  site_visit: Car,
  office_visit: Building2,
  meeting: Users,
  call: Phone,
};

export function TodaysPlan({
  diary,
  nowMs,
  onOpenLead,
}: {
  diary: readonly CrmDiaryEntry[];
  nowMs: number;
  onOpenLead: (leadId: string) => void;
}) {
  /* ⚠️ Closed entries are hidden here the moment they are recorded, rather than
     waiting for the page to come back — the row has served its purpose and
     leaving it sitting there invites a second click. */
  const [done, setDone] = React.useState<ReadonlySet<string>>(new Set());
  /* A confirmation popup with a reason — never a one-click close (2026-09-21). */
  const [cancelling, setCancelling] = React.useState<CrmDiaryEntry | null>(null);
  /* 237 · "done" asks what happened AND whether the client is interested. */
  const [recording, setRecording] = React.useState<CrmDiaryEntry | null>(null);

  const live = diary.filter((a) => !done.has(a.id));
  if (live.length === 0) return null;

  /* ⚠️ KARACHI, NOT THE BROWSER'S ZONE. Every other date in this product is
     rendered in the division's own zone, and "today" that disagreed with the
     rest of the page by five hours would be worse than no heading at all. */
  const dayKey = (iso: string) =>
    new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' });
  const todayKey = new Date(nowMs).toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' });
  const tomorrowKey = new Date(nowMs + 86_400_000).toLocaleDateString('en-CA', {
    timeZone: 'Asia/Karachi',
  });

  const days = new Map<string, CrmDiaryEntry[]>();
  for (const a of live) {
    const k = dayKey(a.scheduledAt);
    const bucket = days.get(k);
    if (bucket) bucket.push(a);
    else days.set(k, [a]);
  }

  const dayLabel = (k: string) =>
    k === todayKey
      ? 'Today'
      : k === tomorrowKey
        ? 'Tomorrow'
        : new Date(`${k}T12:00:00Z`).toLocaleDateString('en-GB', {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
          });


  return (
    <section className="rounded-2xl border border-border-subtle bg-bg-surface px-4 py-3.5">
      <header className="flex items-center gap-2">
        <CalendarClock className="size-4 text-accent-primary" aria-hidden="true" />
        <h2 className="text-body-sm font-semibold text-text-primary">Today&rsquo;s plan</h2>
        <span className="text-caption text-text-tertiary">
          {live.length} appointment{live.length === 1 ? '' : 's'} ahead
        </span>
      </header>

      <div className="mt-3 space-y-3">
        {[...days.entries()].map(([k, entries]) => (
          <div key={k}>
            <p className="mb-1.5 text-micro font-semibold uppercase tracking-wide text-text-tertiary">
              {dayLabel(k)}
            </p>
            <ul className="space-y-1.5">
              {entries.map((a) => {
                const Icon = KIND_ICON[a.kind] ?? CalendarClock;
                const past = Date.parse(a.scheduledAt) < nowMs;
                const time = new Date(a.scheduledAt).toLocaleTimeString('en-GB', {
                  hour: '2-digit',
                  minute: '2-digit',
                  timeZone: 'Asia/Karachi',
                });
                return (
                  <li
                    key={a.id}
                    className="flex flex-wrap items-start gap-x-3 gap-y-1.5 rounded-xl border border-border-subtle px-3 py-2"
                  >
                    <span className="flex shrink-0 items-center gap-1.5 text-body-sm font-semibold tabular-nums text-text-primary">
                      <Icon className="size-4 text-text-tertiary" aria-hidden="true" />
                      {time}
                    </span>

                    <span className="min-w-0 flex-1">
                      <button
                        type="button"
                        onClick={() => onOpenLead(a.leadId)}
                        className="block truncate text-left text-body-sm font-medium text-text-primary underline-offset-2 hover:text-text-brand hover:underline"
                      >
                        {a.leadName ?? 'Unnamed lead'}
                      </button>
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-caption text-text-secondary">
                        <span>{appointmentKindLabel(a.kind)}</span>
                        {(a.propertyLabel || a.location) && (
                          <span className="flex min-w-0 items-center gap-1">
                            <MapPin className="size-3 shrink-0 text-text-tertiary" aria-hidden="true" />
                            <span className="truncate">{a.propertyLabel ?? a.location}</span>
                          </span>
                        )}
                        {a.status !== 'scheduled' && (
                          <span style={{ color: `var(--${appointmentStatusToken(a.status)})` }}>
                            {appointmentStatusLabel(a.status)}
                          </span>
                        )}
                      </span>
                    </span>

                    {/* ⚠️ THE ACTIONS APPEAR ONLY ONCE IT HAS HAPPENED. Offering
                        "did not turn up" on a visit that is three days away is an
                        invitation to close something by accident, and there is
                        nothing to record about a meeting nobody has been to. */}
                    {past && (
                      <span className="flex shrink-0 flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          /* ⚠️ A POPUP, NOT window.prompt — it asks two things
                             now (what happened, and is the client interested),
                             and a prompt blocks the page and loses what was typed. */
                          onClick={() => setRecording(a)}
                          className={cn(
                            'rounded-lg border border-border-subtle px-2 py-1 text-caption font-medium text-text-primary transition-colors hover:border-border-default',
                          )}
                        >
                          It happened
                        </button>
                        {/* ⚠️ NO "NO-SHOW" (2026-09-21): one stray click closed a
                            visit. A client who did not come is a Cancel reason. */}
                        <button
                          type="button"
                          onClick={() => setCancelling(a)}
                          className={cn(
                            'rounded-lg px-2 py-1 text-caption font-medium text-text-secondary transition-colors hover:bg-bg-subtle',
                          )}
                        >
                          Cancel
                        </button>
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      {recording && (
        <RecordAppointmentDialog
          appointment={recording}
          onClose={() => setRecording(null)}
          onRecorded={(id) => setDone((prev) => new Set(prev).add(id))}
        />
      )}
      {cancelling && (
        <CancelAppointmentDialog
          appointment={cancelling}
          onClose={() => setCancelling(null)}
          onCancelled={(id) => setDone((prev) => new Set(prev).add(id))}
        />
      )}
    </section>
  );
}
