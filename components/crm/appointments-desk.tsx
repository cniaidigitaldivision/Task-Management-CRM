'use client';

import * as React from 'react';
import Link from 'next/link';
import { CalendarClock, Car, ClipboardCheck, MapPin, Phone, Users } from 'lucide-react';

import { closeAppointmentAction } from '@/app/actions/crm-leads';
import { CancelAppointmentDialog } from '@/components/crm/cancel-appointment-dialog';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/ui/page-header';
import { useToast } from '@/components/ui/toast';
import type { CrmDiaryRow } from '@/lib/db/queries/crm-leads';
import { DIVISION_NAME } from '@/lib/domain/constants';
import {
  appointmentKindLabel,
  appointmentStatusLabel,
  appointmentStatusToken,
  bucketAppointments,
  openingTab,
} from '@/lib/domain/crm-appointments';
import { cn } from '@/lib/utils';

/* ============================================================================
 * APPOINTMENTS — the salesperson's whole diary
 * ----------------------------------------------------------------------------
 * Phase H's rail screen for Phase E. Owner, 2026-09-16: *"It is done but I want
 * to implement and also build its screen today so I can run it at least."*
 *
 * ── ⚠️ THIS IS NOT "TODAY'S PLAN" AGAIN, AND THE DIFFERENCE IS THE POINT ───
 * `TodaysPlan` is a RAIL: the next seven days, cancelled ones hidden, the whole
 * panel absent when the diary is empty, because it sits above a list somebody
 * opens between two calls and dead space there teaches the eye to skip it.
 *
 * This is a RECORD. It reaches backwards, it keeps the cancellations, and it
 * exists to answer two questions the rail deliberately cannot:
 *
 *   · *which visit have I still not written up?* — the *Needs recording* tab,
 *     and the reason this screen leads with it rather than with Upcoming. An
 *     appointment nobody recorded is the commonest way a lead goes quiet, and
 *     until now there was no screen anywhere that could list them.
 *   · *what did I arrange last week?* — which the rail's forward window hides.
 *
 * ── ⚠️ THE TABS ARE CLIENT STATE. Rule Zero, law 3 ─────────────────────────
 * All three are subsets of rows already on the page. Asking Singapore again to
 * hide some of what it just sent is a round trip to perform a `filter()`.
 *
 * ── ⚠️ AND NOTHING HERE BOOKS ONE ──────────────────────────────────────────
 * Booking belongs to the lead — it needs a lead, its project, its owner and its
 * unit, and `crmBookAppointment` reads all four from the lead row precisely so a
 * caller cannot name a different one. A "new appointment" button here would need
 * a lead picker, and would be a second write path into a table that already has
 * a correct one. Book from Record Outcome; this screen is where it then lives.
 * ========================================================================= */

const KIND_ICON: Record<string, typeof CalendarClock> = {
  site_visit: Car,
  meeting: Users,
  call: Phone,
};

type Tab = 'owed' | 'upcoming' | 'done';

export function AppointmentsDesk({
  appointments,
  backDays,
  limit,
  nowMs,
}: {
  appointments: readonly CrmDiaryRow[];
  backDays: number;
  limit: number;
  nowMs: number;
}) {
  const toast = useToast();
  const [busy, setBusy] = React.useState<string | null>(null);
  /* The visit whose "what happened?" box is open. */
  const [writing, setWriting] = React.useState<string | null>(null);
  /* ⚠️ CANCELLING IS A CONFIRMATION POPUP WITH A REASON, NOT AN INLINE CLICK.
     Owner, 2026-09-21, after a stray "No-show": *"There should be a cancel
     button with a popup with the confirmation."* See cancel-appointment-dialog. */
  const [cancelling, setCancelling] = React.useState<CrmDiaryRow | null>(null);
  const [draft, setDraft] = React.useState('');
  /* ⚠️ RECORDED ROWS MOVE, THEY DO NOT VANISH. A closed appointment is still a
     fact about the week — it changes tab rather than leaving the screen, so the
     count somebody just watched go down is still findable under Done. */
  const [closed, setClosed] = React.useState<ReadonlyMap<string, string>>(new Map());

  const rows = React.useMemo(
    () =>
      appointments.map((a) => {
        const override = closed.get(a.id);
        return override ? { ...a, status: override } : a;
      }),
    [appointments, closed],
  );

  /* ⚠️ THE RULE ITSELF LIVES IN `lib/domain/crm-appointments`, not here — it is
     the whole meaning of this screen, and a rule inside a `useMemo` can only be
     tested by rendering and then clicking the tab it hides the answer behind. */
  const buckets = React.useMemo(() => bucketAppointments(rows, nowMs), [rows, nowMs]);

  const [tab, setTab] = React.useState<Tab>(() => openingTab(buckets));

  const shown = buckets[tab];

  async function close(a: CrmDiaryRow, status: string, outcome: string) {
    setBusy(a.id);
    const result = await closeAppointmentAction(a.id, a.leadId, status, outcome);
    setBusy(null);
    if (!result.ok) {
      toast({ tone: 'error', text: result.error ?? 'That did not save.' });
      return;
    }
    setClosed((prev) => new Map(prev).set(a.id, status));
    setWriting(null);
    setDraft('');
    toast({
      tone: 'ok',
      text:
        status === 'completed'
          ? a.kind === 'site_visit'
            ? 'Recorded — the lead moves to Visited.'
            : 'Recorded.'
          : 'Cancelled.',
    });
  }

  return (
    <div className="mx-auto max-w-[var(--content-max)] space-y-4">
      <PageHeader
        eyebrow={DIVISION_NAME}
        title="Appointments"
        description="Every call, meeting and site visit in your diary — and the ones you still owe a write-up."
      />

      <nav className="flex flex-wrap gap-1.5" aria-label="Which appointments">
        <TabButton
          active={tab === 'owed'}
          count={buckets.owed.length}
          onClick={() => setTab('owed')}
          /* ⚠️ The only tab that is ever emphasised, and only when it has rows.
             A permanent red count on an empty list is how a badge stops meaning
             anything. */
          urgent={buckets.owed.length > 0}
        >
          Needs recording
        </TabButton>
        <TabButton
          active={tab === 'upcoming'}
          count={buckets.upcoming.length}
          onClick={() => setTab('upcoming')}
        >
          Upcoming
        </TabButton>
        <TabButton active={tab === 'done'} count={buckets.done.length} onClick={() => setTab('done')}>
          Done
        </TabButton>
      </nav>

      {shown.length === 0 ? (
        <Empty tab={tab} anyAtAll={rows.length > 0} />
      ) : (
        <ul className="space-y-1.5">
          {shown.map((a) => {
            const Icon = KIND_ICON[a.kind] ?? CalendarClock;
            const open = writing === a.id;
            const when = new Date(a.scheduledAt);
            return (
              <li
                key={a.id}
                /* ⚠️ `aria-busy` AS WELL AS THE DIM. Recording is the one thing on
                   this screen that genuinely has to reach the database, and
                   CLAUDE.md's rule for an unavoidable round trip is that the
                   waiting is SAID, not just shaded — a screen reader gets nothing
                   from 40% opacity. The row stays readable throughout; nothing is
                   blanked and no grey bar replaces it. */
                aria-busy={busy === a.id}
                className={cn(
                  'rounded-xl border border-border-subtle bg-bg-surface px-3.5 py-3 transition-opacity',
                  busy === a.id && 'opacity-40',
                )}
              >
                <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
                  <span className="flex w-[8.5rem] shrink-0 flex-col">
                    <span className="flex items-center gap-1.5 text-body-sm font-semibold tabular-nums text-text-primary">
                      <Icon className="size-4 text-text-tertiary" aria-hidden="true" />
                      {when.toLocaleTimeString('en-GB', {
                        hour: '2-digit',
                        minute: '2-digit',
                        timeZone: 'Asia/Karachi',
                      })}
                    </span>
                    {/* ⚠️ `text-secondary`, NOT `text-tertiary`. Measured through a
                        canvas at 1440px in both themes: tertiary is 3.94:1 on this
                        ground in LIGHT — below AA — while passing comfortably in
                        dark. That asymmetry is the trap; a token checked only in
                        dark reads as fine. Secondary is 6.42 / 8.07.

                        ⚠️ KARACHI ON EVERY DATE ON THIS PAGE. `current_date` is a
                        different day here for five hours each evening, and a
                        diary that disagreed with the rest of the product about
                        which day a visit was on would be worse than no date. */}
                    <span className="mt-0.5 text-caption text-text-secondary">
                      {when.toLocaleDateString('en-GB', {
                        weekday: 'short',
                        day: 'numeric',
                        month: 'short',
                        timeZone: 'Asia/Karachi',
                      })}
                    </span>
                  </span>

                  <span className="min-w-0 flex-1">
                    {/* ⚠️ A LINK, NOT A BUTTON — this screen has no drawer of its
                        own, and building a second one here would be a second copy
                        of the record to keep in step. `/my-leads?lead=<id>` opens
                        the real one, on the page that owns it. */}
                    <Link
                      href={{ pathname: '/my-leads', query: { lead: a.leadId } }}
                      className="block truncate text-body-sm font-medium text-text-primary underline-offset-2 hover:text-text-brand hover:underline"
                    >
                      {a.leadName ?? 'Unnamed lead'}
                    </Link>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-caption text-text-secondary">
                      <span>{appointmentKindLabel(a.kind)}</span>
                      <span aria-hidden="true" className="text-text-tertiary">·</span>
                      <span>{a.durationMinutes} min</span>
                      {a.projectName && (
                        <>
                          <span aria-hidden="true" className="text-text-tertiary">·</span>
                          <span className="truncate">{a.projectName}</span>
                        </>
                      )}
                      {(a.propertyLabel || a.location) && (
                        <span className="flex min-w-0 items-center gap-1">
                          <MapPin className="size-3 shrink-0 text-text-tertiary" aria-hidden="true" />
                          <span className="truncate">{a.propertyLabel ?? a.location}</span>
                        </span>
                      )}
                    </span>
                    {/* ⚠️ THE OUTCOME IS THE WHOLE POINT OF KEEPING A PAST ONE.
                        A Done row with the status alone tells you a visit
                        happened, which is what the lead's timeline already said. */}
                    {a.outcome && (
                      <p className="mt-1.5 border-l-2 border-border-default pl-2.5 text-caption leading-relaxed text-text-secondary">
                        {a.outcome}
                      </p>
                    )}
                  </span>

                  <span className="flex shrink-0 items-center gap-1.5">
                    {a.status !== 'scheduled' && (
                      <Badge token={appointmentStatusToken(a.status)} size="sm">
                        {appointmentStatusLabel(a.status)}
                      </Badge>
                    )}
                    {tab === 'owed' && !open && (
                      <>
                        <button
                          type="button"
                          disabled={busy === a.id}
                          onClick={() => {
                            setWriting(a.id);
                            setDraft('');
                          }}
                          className="rounded-lg border border-border-subtle px-2 py-1 text-caption font-medium text-text-primary transition-colors hover:border-border-default"
                        >
                          It happened
                        </button>
                        {/* ⚠️ NO "NO-SHOW" BUTTON (2026-09-21). One stray click on
                            it closed a visit with no confirmation. A client who did
                            not come is a CANCEL reason, chosen in the popup. */}
                        <button
                          type="button"
                          disabled={busy === a.id}
                          onClick={() => setCancelling(a)}
                          className="rounded-lg px-2 py-1 text-caption font-medium text-text-secondary transition-colors hover:bg-bg-subtle"
                        >
                          Cancel
                        </button>
                      </>
                    )}

                    {/* ⚠️ THE ONLY WAY TO CALL OFF A BOOKED VISIT ANYWHERE IN THE
                        PRODUCT. `crmCloseAppointment` has accepted `cancelled`
                        since 152 and no screen has ever sent it: Today's plan
                        shows its buttons only once an appointment is in the past,
                        so a client ringing to move tomorrow's visit left the
                        salesperson with a diary they could not correct.

                        ⚠️ AND IT ASKS WHY, WHERE THE PAST-TAB BUTTONS DO NOT. A
                        stray click here calls off a real client's visit, which is
                        the one thing on this screen that is not recoverable by
                        pressing something else — so it opens the box rather than
                        writing immediately. That is the same guard Today's plan
                        gets from only ever offering these on a visit that has
                        already happened. */}
                    {tab === 'upcoming' && !open && (
                      <button
                        type="button"
                        disabled={busy === a.id}
                        onClick={() => setCancelling(a)}
                        /* ⚠️ A CONTROL, SO IT IS HELD TO AA even though it is
                           deliberately quiet. Tertiary measured 3.94:1 in light. */
                        className="rounded-lg px-2 py-1 text-caption font-medium text-text-secondary transition-colors hover:bg-bg-subtle"
                      >
                        Cancel
                      </button>
                    )}
                  </span>
                </div>

                {/* ⚠️ AN INLINE BOX, NOT `window.prompt`. The prompt blocks the
                    whole page, cannot be styled, and loses what was typed if the
                    mouse slips. This opens in the click's own frame — Rule Zero —
                    because it is nothing but client state. */}
                {open && (
                  <div className="mt-2.5 border-t border-border-subtle pt-2.5">
                    <label
                      htmlFor={`outcome-${a.id}`}
                      className="text-caption font-medium text-text-secondary"
                    >
                      {`What happened at the ${appointmentKindLabel(a.kind).toLowerCase()} with ${a.leadName ?? 'this lead'}?`}
                    </label>
                    <textarea
                      id={`outcome-${a.id}`}
                      autoFocus
                      rows={2}
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      placeholder="They came with their brother, liked A-101, asked about the payment plan."
                      className="mt-1.5 w-full resize-y rounded-lg border border-border-default bg-bg-base px-2.5 py-2 text-body-sm text-text-primary placeholder:text-text-tertiary focus:border-accent-primary focus:outline-none"
                    />
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        /* ⚠️ REFUSED WHILE EMPTY, in the button's own state rather
                           than by a toast after the click. 152 has a CHECK that
                           says the same thing; "it happened" with nothing written
                           is the same as not recording it.

                           ⚠️ A CANCELLATION IS HELD TO THE SAME STANDARD even
                           though 152 does NOT demand an outcome for one. "Why did
                           this visit not happen" is the question a manager asks a
                           week later, and the reason is free to capture now and
                           impossible to recover then. */
                        disabled={!draft.trim() || busy === a.id}
                        onClick={() => void close(a, 'completed', draft.trim())}
                        className={cn(
                          'rounded-lg bg-accent-primary px-2.5 py-1.5 text-caption font-semibold text-white transition-opacity',
                          (!draft.trim() || busy === a.id) && 'opacity-40',
                        )}
                      >
                        Record it
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setWriting(null);
                          setDraft('');
                        }}
                        className="rounded-lg px-2 py-1.5 text-caption font-medium text-text-secondary transition-colors hover:bg-bg-subtle"
                      >
                        Not now
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {cancelling && (
        <CancelAppointmentDialog
          appointment={cancelling}
          onClose={() => setCancelling(null)}
          onCancelled={(id) => setClosed((prev) => new Map(prev).set(id, 'cancelled'))}
        />
      )}

      {/* ⚠️ THE WINDOW IS STATED RATHER THAN IMPLIED. This page is not everything
          that ever happened, and a diary that silently stopped at sixty days
          would have somebody concluding a visit was never recorded. */}
      {/* ⚠️ Secondary — this is a sentence somebody is meant to READ, not a
          decorative separator. The remaining `text-tertiary` on this screen is
          all `aria-hidden` icons and dots, where AA does not apply. */}
      <p className="text-caption text-text-secondary">
        Showing your diary from the last {backDays} days onwards
        {rows.length >= limit && `, capped at the most recent ${limit}`}. Appointments are booked
        from a lead — record an outcome of{' '}
        <span className="text-text-secondary">site visit requested</span> and it lands here.
      </p>
    </div>
  );
}

function TabButton({
  active,
  count,
  urgent = false,
  onClick,
  children,
}: {
  active: boolean;
  count: number;
  urgent?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'true' : undefined}
      className={cn(
        'flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-body-sm font-medium transition-colors',
        active
          ? 'border-accent-primary bg-accent-primary/10 text-text-primary'
          : 'border-border-subtle text-text-secondary hover:border-border-default hover:text-text-primary',
      )}
    >
      {children}
      <span
        className={cn(
          'rounded px-1.5 text-caption font-semibold tabular-nums',
          /* ⚠️ Secondary, not tertiary — a count nobody can read is not a count.
             Measured 3.41:1 on the tab's own ground in light. */
          urgent ? 'bg-feedback-error/15 text-feedback-error' : 'text-text-secondary',
        )}
      >
        {count}
      </span>
    </button>
  );
}

/* ⚠️ THREE DIFFERENT EMPTIES, because they mean three different things and one
   sentence covering all of them would be wrong twice. "Nothing to record" is
   good news; "nothing booked" is a prompt to go and book something; and an
   entirely empty diary needs to name the action that fills it, or it reads as
   broken rather than as new. */
function Empty({ tab, anyAtAll }: { tab: Tab; anyAtAll: boolean }) {
  const [Icon, text] =
    tab === 'owed'
      ? [ClipboardCheck, 'Nothing waiting to be written up. Every appointment that has happened is recorded.']
      : tab === 'upcoming'
        ? [
            CalendarClock,
            anyAtAll
              ? 'Nothing booked ahead. Book a site visit from a lead and it appears here.'
              : 'No appointments yet. Open a lead, press Record Outcome and choose “site visit requested” — the visit you book lands here.',
          ]
        : [CalendarClock, 'Nothing recorded in this window yet.'];

  return (
    <div className="rounded-xl border border-dashed border-border-default bg-bg-surface px-5 py-8 text-center">
      <Icon className="mx-auto size-6 text-text-tertiary" aria-hidden="true" />
      <p className="mx-auto mt-2 max-w-[42ch] text-body-sm leading-relaxed text-text-secondary">
        {text}
      </p>
    </div>
  );
}
