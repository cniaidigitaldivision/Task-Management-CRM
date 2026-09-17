'use client';

import * as React from 'react';
import type { Route } from 'next';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { CalendarClock, ExternalLink, Mail, X } from 'lucide-react';

import { WA_GREEN, WhatsAppMark } from '@/components/crm/whatsapp-mark';
import type {
  CrmLeadEvent,
  CrmLeadNote,
  CrmLeadRecord,
  CrmLeadRelated,
  CrmMessage,
} from '@/lib/db/queries/crm-leads';
import { activityLabel, stageLabel, stageToken } from '@/lib/domain/crm-stages';
import {
  appointmentKindLabel,
  appointmentStatusLabel,
  appointmentStatusToken,
} from '@/lib/domain/crm-appointments';
import { displayPhone } from '@/lib/domain/phone';
import { LeadOverviewTab } from '@/components/crm/lead-overview-tab';
import { relativeAge } from '@/lib/view/relative-age';
import { cn } from '@/lib/utils';
import { useSoftNavigate } from './use-panel';

/* ============================================================================
 * THE LEAD DRAWER — the record, over the list
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-14: *"I don't want to go somewhere else to view any details…
 * He will stay or she will stay on their lead page and view a specific row."*
 *
 * ── ⚠️ THE LIST IS STILL THERE, AND THAT IS THE WHOLE POINT ────────────────
 * This renders OVER `/my-leads` with the table behind it. The tab, the filters,
 * the page and the scroll position are all untouched, because none of them lives
 * in this component — they are URL parameters, and opening the drawer only adds
 * two more (`lead` and `tab`).
 *
 * ⚠️ AND CLOSING REBUILDS THE URL RATHER THAN CALLING `back()`. `back()` looks
 * tidier and is wrong for the case that matters: somebody who arrived on a
 * shared drawer link has no list behind them in history, so `back()` would take
 * them off the page entirely. Dropping the two parameters always lands on the
 * list, with every filter they had.
 *
 * ── ⚠️ AND IT IS A DIALOG, NOT A `<div>` THAT LOOKS LIKE ONE ───────────────
 * Escape closes it, focus moves into it on open and back to the row on close,
 * and the page behind is inert to a screen reader. A panel that traps neither
 * focus nor Escape is one a keyboard user cannot leave.
 * ========================================================================= */

type Tab = 'overview' | 'conversations' | 'followups' | 'related' | 'activity';

export const TABS: ReadonlyArray<{ key: Tab; label: string }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'conversations', label: 'Conversations' },
  { key: 'followups', label: 'Follow-ups' },
  { key: 'related', label: 'Related items' },
  { key: 'activity', label: 'Activity' },
];

export function LeadDrawer({
  lead,
  notes,
  activity,
  messages,
  related,
  tab,
  viewerName,
  nowMs,
  onTab,
  onClose,
  onRaiseQuotation,
  onChooseUnit,
}: {
  lead: CrmLeadRecord;
  notes: readonly CrmLeadNote[];
  activity: readonly CrmLeadEvent[];
  messages: readonly CrmMessage[];
  related: CrmLeadRelated;
  tab: Tab;
  viewerName: string;
  nowMs: number;
  /** Switching tabs is the desk's decision to record, so the shell agrees. */
  onTab: (tab: string) => void;
  /** Hides the panel at once; the URL catches up in the parent. */
  onClose: () => void;
  /** Opens the quotation form over this drawer. */
  onRaiseQuotation: () => void;
  /** Opens the catalogue, to say which unit they are asking about. */
  onChooseUnit: () => void;
}) {
  const search = useSearchParams();
  const panel = React.useRef<HTMLDivElement>(null);
  const soft = useSoftNavigate();

  /* ⚠️ THE PARENT OWNS WHETHER THIS IS ON SCREEN — it is a client component with
     the row already in hand, so the panel goes at the click rather than after a
     server render. Closing also rebuilds the list's URL rather than calling
     `back()`: a reader who arrived on a shared drawer link has no list behind
     them, and `back()` would take them off the page entirely. */
  const close = onClose;

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  /* ── ⚠️ THE TAB IS THE DESK'S, NOT THIS COMPONENT'S ─────────────────────
     This used to seed its own `useState(tab)`. Two components each holding a
     copy of "which tab is open" — this one and the loading shell that precedes
     it — and the copies could disagree at the moment one replaced the other.
     The owner saw the result and described it exactly: *"when the drawer opens
     it directly opens the conversation tab… once the notes are loading it
     auto-switches."*

     ⚠️ SEEDED STATE DOES NOT RE-SEED. `useState(tab)` reads the prop once, on
     mount, and ignores every later value — so a drawer that mounted while the
     desk said "conversations" stayed there even after the desk moved on, and a
     reopened drawer could come back on whatever tab it was left on.

     One owner, one value. The desk holds it, the shell and this render the same
     thing, and the swap between them is invisible. */
  const activeTab = tab;

  const go = (t: Tab) => {
    onTab(t);
    const next = new URLSearchParams(search.toString());
    next.set('tab', t);
    soft(`/my-leads?${next.toString()}`);
  };

  /* Focus starts inside. Escape is handled by `usePanel`, on the instant path. */
  React.useEffect(() => {
    panel.current?.focus();
  }, []);

  const phone = displayPhone(lead.phoneE164, lead.phone);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* ⚠️ A BUTTON, not a div with onClick — a scrim somebody can only dismiss
          with a mouse is a trap for everybody else. */}
      <button
        type="button"
        aria-label="Close"
        onClick={close}
        className="absolute inset-0 bg-black/30 backdrop-blur-[1px]"
      />

      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={`${lead.fullName ?? 'Lead'} — details`}
        tabIndex={-1}
        /* ⚠️ WIDER THAN IT WAS — the reference lays Lead details beside Next action,
             and two columns inside 36rem gives each about 250px, which wraps every
             label. They stack below `lg:` regardless. */
          className="relative flex h-full w-full max-w-[46rem] flex-col border-l border-border-default bg-bg-surface shadow-2xl outline-none"
      >
        {/* ── Header ───────────────────────────────────────────────────── */}
        <div className="border-b border-border-subtle px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate text-h3 font-semibold text-text-primary">
                {lead.fullName ?? 'Name not given'}
              </h2>
              <p className="mt-0.5 truncate text-caption text-text-secondary">
                {lead.projectName}
                {lead.city && ` · ${lead.city}`}
              </p>
            </div>
            <button
              type="button"
              onClick={close}
              aria-label="Close"
              className="grid size-8 shrink-0 place-items-center rounded-lg text-text-secondary transition-colors hover:bg-bg-subtle hover:text-text-primary"
            >
              <X className="size-4" />
            </button>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span
              className="rounded-md px-2 py-0.5 text-caption font-medium"
              style={{
                backgroundColor: `color-mix(in oklab, var(--${stageToken(lead.stage)}) 14%, transparent)`,
                color: `var(--${stageToken(lead.stage)})`,
              }}
            >
              {stageLabel(lead.stage)}
            </span>
            {/* ⚠️ "You", not a dropdown. The owner's rule is explicit: a
                salesperson may not choose an owner, so there is nothing to
                choose from — showing a disabled select would suggest otherwise. */}
            <span className="text-caption text-text-secondary">
              Assigned to <strong className="font-medium text-text-primary">you · {viewerName}</strong>
            </span>
            <Link
              href={`/leads/${lead.id}` as Route}
              className="ml-auto inline-flex items-center gap-1 text-caption font-medium text-text-brand underline-offset-2 hover:underline"
            >
              Full record
              <ExternalLink className="size-3.5" aria-hidden="true" />
            </Link>
          </div>
        </div>

        {/* ── Tabs ─────────────────────────────────────────────────────── */}
        <div className="flex gap-1 overflow-x-auto border-b border-border-subtle px-3 py-2">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => go(t.key)}
              aria-pressed={activeTab === t.key}
              className={cn(
                'shrink-0 rounded-lg px-3 py-1.5 text-caption font-medium transition-colors',
                activeTab === t.key
                  ? 'bg-accent-primary text-white'
                  : 'text-text-secondary hover:bg-bg-subtle hover:text-text-primary',
              )}
            >
              {t.label}
              {t.key === 'conversations' && messages.length > 0 && ` (${messages.length})`}
              {t.key === 'related' && related.quotations.length > 0 && ` (${related.quotations.length})`}
            </button>
          ))}
        </div>

        {/* ── Body ─────────────────────────────────────────────────────── */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {activeTab === 'overview' && (
            <LeadOverviewTab
              lead={lead}
              notes={notes}
              activity={activity}
              related={related}
              phone={phone}
              viewerName={viewerName}
              onTab={go}
            />
          )}
          {activeTab === 'conversations' && <Conversation messages={messages} nowMs={nowMs} />}
          {activeTab === 'followups' && <FollowUps related={related} nowMs={nowMs} />}
          {activeTab === 'related' && (
            <Related
              related={related}
              lead={lead}
              onRaiseQuotation={onRaiseQuotation}
              onChooseUnit={onChooseUnit}
            />
          )}
          {activeTab === 'activity' && <Activity activity={activity} nowMs={nowMs} />}
        </div>

        {/* ── The three things a salesperson does from here ──────────────
            ⚠️ FIXED TO THE FOOT, OUTSIDE THE SCROLLING BODY. The reference puts
            them there and it is right: on a long Overview the actions would
            otherwise be below the fold on the one screen somebody opens in order
            to act.

            ⚠️ AND EACH ONE IS ABSENT RATHER THAN DISABLED WHEN IT CANNOT WORK. A
            greyed "Send email" on a lead with no address is a button somebody
            presses twice before reading it — 640 of 641 real leads have no email,
            so this is the common case, not the edge. */}
        <div className="flex shrink-0 flex-wrap gap-2 border-t border-border-subtle px-5 py-3">
          {lead.email && (
            <a
              href={`mailto:${lead.email}`}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-border-default px-3 py-2.5 text-body-sm font-medium text-text-primary transition-colors hover:bg-bg-subtle"
            >
              <Mail className="size-4" aria-hidden="true" />
              Send email
            </a>
          )}
          {lead.phoneE164 && (
            <button
              type="button"
              onClick={() => go('conversations')}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-border-default px-3 py-2.5 text-body-sm font-medium text-text-primary transition-colors hover:bg-bg-subtle"
            >
              <span style={{ color: WA_GREEN }}><WhatsAppMark className="size-4" /></span>
              WhatsApp
            </button>
          )}
          <button
            type="button"
            onClick={() => go('followups')}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-accent-primary px-3 py-2.5 text-body-sm font-semibold text-white transition-opacity hover:opacity-90"
          >
            <CalendarClock className="size-4" aria-hidden="true" />
            Add follow-up
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---- Overview ------------------------------------------------------------
   ⚠️ MOVED OUT to `lead-overview-tab.tsx` on 2026-09-17, when the owner's
   reference turned it from a list of facts into a lifecycle strip, two columns
   and three cards. It was the largest thing in this file and it is the one tab
   that will keep changing. */

/* ---- Conversation --------------------------------------------------------- */

function Conversation({
  messages,
  nowMs,
}: {
  messages: readonly CrmMessage[];
  nowMs: number;
}) {
  if (messages.length === 0) {
    return (
      <Empty>
        Nothing has been sent or received yet. ⚠️ Email is not connected, so this
        shows WhatsApp only.
      </Empty>
    );
  }

  return (
    <div className="space-y-2">
      {/* ⚠️ ONE CHANNEL, AND IT SAYS SO. The owner's spec asks for WhatsApp AND
          email in one timeline; there is no email integration, so a heading
          promising both would be the page claiming something it cannot do. */}
      <p className="flex items-center gap-1.5 pb-1 text-caption text-text-tertiary">
        <span aria-hidden="true" style={{ color: WA_GREEN }}>
          <WhatsAppMark className="size-4" />
        </span>
        WhatsApp only — email is not connected yet.
      </p>
      {messages.map((m) => {
        const mine = m.direction === 'outbound';
        return (
          <div key={m.id} className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
            <div
              className={cn(
                'max-w-[85%] rounded-2xl px-3 py-2',
                mine ? 'rounded-br-sm' : 'rounded-bl-sm border border-border-subtle bg-bg-subtle',
              )}
              style={mine ? { backgroundColor: `color-mix(in oklab, ${WA_GREEN} 18%, transparent)` } : undefined}
            >
              {m.body && (
                <p className="whitespace-pre-wrap break-words text-body-sm text-text-primary">
                  {m.body}
                </p>
              )}
              <p className="mt-0.5 text-caption text-text-tertiary">
                {/* ⚠️ THE CUSTOMER SEES THE BUSINESS, THE TEAM SEES THE PERSON.
                    Outbound is sent as CNI AI & Digital; who actually typed it is
                    an internal fact, and it is the one "how did he deal with this
                    client" is answered from. */}
                {mine ? (m.sentByName ?? 'CNI AI & Digital') : 'Them'} ·{' '}
                {relativeAge(m.occurredAt, nowMs)}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---- Follow-ups ----------------------------------------------------------- */

function FollowUps({ related, nowMs }: { related: CrmLeadRelated; nowMs: number }) {
  return (
    <div className="space-y-5">
      {related.sequence ? (
        <section
          className="rounded-xl border px-4 py-3"
          style={
            related.sequence.state === 'paused'
              ? {
                  borderColor: 'color-mix(in oklab, var(--gold-700) 40%, transparent)',
                  backgroundColor: 'color-mix(in oklab, var(--gold-700) 8%, transparent)',
                }
              : undefined
          }
        >
          <p className="text-body-sm font-medium text-text-primary">
            {related.sequence.name} · step {related.sequence.step} of {related.sequence.total}
          </p>
          <p className="mt-0.5 text-caption text-text-secondary">
            {related.sequence.state === 'paused'
              ? `Paused — ${related.sequence.pauseReason ?? 'no reason recorded'}. No further messages will send while paused.`
              : `State: ${related.sequence.state}. ⚠️ Nothing sends yet — the scheduler is not built.`}
          </p>
        </section>
      ) : (
        <Empty>No sequence is running on this lead.</Empty>
      )}

      {/* ── ⚠️ APPOINTMENTS WERE IN THE DATA AND ON NO SCREEN ────────────────
          `crmLeadRelated` has read them since 152 and nothing rendered them, so
          a visit booked from the outcome form vanished the moment it was made.
          They lead this tab rather than trailing it: a follow-up is a reminder
          to yourself, an appointment is somebody else's afternoon. */}
      <section>
        <h3 className="mb-2 text-micro font-semibold uppercase tracking-wide text-text-tertiary">
          Appointments ({related.appointments.length})
        </h3>
        {related.appointments.length === 0 ? (
          <Empty>Nothing booked. Record a &ldquo;site visit requested&rdquo; outcome to book one.</Empty>
        ) : (
          <ul className="space-y-2">
            {related.appointments.map((a) => {
              const when = new Date(a.scheduledAt);
              const past = when.getTime() < nowMs;
              return (
                <li key={a.id} className="rounded-lg border border-border-subtle px-3 py-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="truncate text-body-sm text-text-primary">
                      {appointmentKindLabel(a.kind)}
                      {a.ownerName && (
                        <span className="text-text-secondary"> · {a.ownerName}</span>
                      )}
                    </p>
                    <span
                      className={cn(
                        'shrink-0 text-caption tabular-nums',
                        past && a.status === 'scheduled'
                          ? 'font-semibold text-feedback-error'
                          : 'text-text-secondary',
                      )}
                    >
                      {when.toLocaleString('en-GB', {
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                        timeZone: 'Asia/Karachi',
                      })}
                    </span>
                  </div>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-caption text-text-tertiary">
                    <span style={{ color: `var(--${appointmentStatusToken(a.status)})` }}>
                      {appointmentStatusLabel(a.status)}
                    </span>
                    {a.location && <span className="truncate">{a.location}</span>}
                    <span>{a.durationMinutes} min</span>
                  </p>
                  {/* ⚠️ THE OUTCOME, WHEN THERE IS ONE. What happened at a visit
                      is what moves the lead — it is the point of recording it,
                      and hiding it here would make the panel a diary rather than
                      a record. */}
                  {a.outcome && (
                    <p className="mt-1 whitespace-pre-wrap text-caption text-text-secondary">
                      {a.outcome}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <h3 className="mb-2 text-micro font-semibold uppercase tracking-wide text-text-tertiary">
          Follow-ups ({related.followUps.length})
        </h3>
        {related.followUps.length === 0 ? (
          <Empty>Nothing planned or recorded yet.</Empty>
        ) : (
          <ul className="space-y-2">
            {related.followUps.map((f) => {
              const late = f.status !== 'done' && Date.parse(f.dueAt) < nowMs;
              return (
                <li key={f.id} className="rounded-lg border border-border-subtle px-3 py-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="truncate text-body-sm text-text-primary">{f.title}</p>
                    <span
                      className={cn(
                        'shrink-0 text-caption tabular-nums',
                        late ? 'font-semibold text-feedback-error' : 'text-text-secondary',
                      )}
                    >
                      {late ? 'Overdue · ' : ''}
                      {new Date(f.dueAt).toLocaleDateString('en-GB', {
                        day: 'numeric',
                        month: 'short',
                        timeZone: 'Asia/Karachi',
                      })}
                    </span>
                  </div>
                  <p className="mt-0.5 text-caption text-text-tertiary">
                    {f.channel} · {f.status}
                    {f.outcomeNote && ` · ${f.outcomeNote}`}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

/* ---- Related items -------------------------------------------------------- */

function Related({
  related,
  lead,
  onRaiseQuotation,
  onChooseUnit,
}: {
  related: CrmLeadRelated;
  lead: CrmLeadRecord;
  onRaiseQuotation: () => void;
  onChooseUnit: () => void;
}) {
  return (
    <div className="space-y-5">
      {/* ⚠️ THE UNIT LEADS THIS TAB, because it is what everything below it is
          about — a quotation prices a unit, and a site visit goes to one. A lead
          with no unit attached is the commonest reason a quotation has to be
          typed from memory. */}
      <section>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-micro font-semibold uppercase tracking-wide text-text-tertiary">
            Unit
          </h3>
          <button
            type="button"
            onClick={onChooseUnit}
            className="rounded-lg border border-border-subtle px-2.5 py-1 text-caption font-medium text-text-primary transition-colors hover:border-border-default"
          >
            {lead.propertyLabel ? 'Change' : 'Choose one'}
          </button>
        </div>
        {lead.propertyLabel ? (
          <p className="rounded-lg border border-border-subtle px-3 py-2 text-body-sm text-text-primary">
            {lead.propertyLabel}
          </p>
        ) : (
          <Empty>No unit attached. Choose one and a quotation will price itself.</Empty>
        )}
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-micro font-semibold uppercase tracking-wide text-text-tertiary">
            Quotations ({related.quotations.length})
          </h3>
          {/* ⚠️ THE ACTION SITS WITH THE THING IT ACTS ON. A "raise a quotation"
              button in the drawer header would be one more control competing
              with close and the tabs; here it is found by somebody who has just
              looked at what has already been quoted, which is when they want
              it. */}
          <button
            type="button"
            onClick={onRaiseQuotation}
            className="rounded-lg border border-border-subtle px-2.5 py-1 text-caption font-medium text-text-primary transition-colors hover:border-border-default"
          >
            Raise one
          </button>
        </div>
        {related.quotations.length === 0 ? (
          <Empty>No quotation has been raised for this lead.</Empty>
        ) : (
          <ul className="space-y-2">
            {related.quotations.map((q) => {
              const pending = q.status === 'pending_approval';
              return (
                <li key={q.id} className="rounded-lg border border-border-subtle px-3 py-2.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-body-sm font-medium text-text-primary">
                      {q.number}
                      {/* ⚠️ THE VERSION IS ALWAYS SHOWN. "QT-1042" alone is
                          ambiguous the moment a v2 exists, and the whole reason
                          versions are rows is so the pair can be told apart. */}
                      <span className="ml-1 text-caption font-normal text-text-tertiary">
                        v{q.version}
                      </span>
                    </p>
                    <span className="tabular-nums text-body-sm text-text-primary">
                      PKR {q.netAmount.toLocaleString('en-PK')}
                    </span>
                  </div>

                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-caption">
                    <span
                      className="rounded px-1.5 py-px font-medium"
                      style={
                        pending
                          ? {
                              backgroundColor: 'color-mix(in oklab, var(--gold-700) 14%, transparent)',
                              color: 'var(--gold-700)',
                            }
                          : {
                              backgroundColor:
                                'color-mix(in oklab, var(--feedback-success) 14%, transparent)',
                              color: 'var(--feedback-success)',
                            }
                      }
                    >
                      {pending ? 'Pending approval' : q.status}
                    </span>
                    {q.propertyLabel && <span className="text-text-secondary">{q.propertyLabel}</span>}
                    {q.validUntil && (
                      <span className="text-text-tertiary">
                        valid till{' '}
                        {new Date(q.validUntil).toLocaleDateString('en-GB', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                          timeZone: 'Asia/Karachi',
                        })}
                      </span>
                    )}
                  </div>

                  {q.requestedDiscount > 0 && q.approvedDiscount === 0 && (
                    <p className="mt-1 text-caption text-gold-700">
                      Discount of PKR {q.requestedDiscount.toLocaleString('en-PK')} requested,
                      not yet approved.
                    </p>
                  )}

                  {/* ⚠️ THE SEND BUTTON IS ABSENT WHILE PENDING, not disabled.
                      The owner's rule is that a pending quotation cannot leave
                      the building, and the server refuses it regardless — but a
                      greyed button invites the click that gets refused. */}
                  <p className="mt-1.5 text-caption text-text-tertiary">
                    {pending
                      ? 'Cannot be sent until a manager approves it.'
                      : `Prepared by ${q.preparedByName ?? 'someone'}${q.approvedByName ? `, approved by ${q.approvedByName}` : ''}.`}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <h3 className="mb-2 text-micro font-semibold uppercase tracking-wide text-text-tertiary">
          Appointments ({related.appointments.length})
        </h3>
        {related.appointments.length === 0 ? (
          <Empty>Nothing booked.</Empty>
        ) : (
          <ul className="space-y-2">
            {related.appointments.map((a) => (
              <li key={a.id} className="rounded-lg border border-border-subtle px-3 py-2">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-body-sm text-text-primary">
                    {a.kind.replace('_', ' ')} · {a.status}
                  </p>
                  <span className="shrink-0 text-caption tabular-nums text-text-secondary">
                    {new Date(a.scheduledAt).toLocaleString('en-GB', {
                      day: 'numeric',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                      timeZone: 'Asia/Karachi',
                    })}
                  </span>
                </div>
                {a.outcome && <p className="mt-0.5 text-caption text-text-secondary">{a.outcome}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ⚠️ BOOKINGS, INVOICES AND FILES ARE NOT HERE. The owner's spec lists
          them as subtabs; none of the three has a table yet, and an empty tab
          headed "Invoices" reads as "this lead has no invoices" rather than as
          "invoices do not exist". */}
    </div>
  );
}

/* ---- Activity ------------------------------------------------------------- */

function Activity({ activity, nowMs }: { activity: readonly CrmLeadEvent[]; nowMs: number }) {
  if (activity.length === 0) return <Empty>Nothing has happened yet.</Empty>;
  return (
    <ol className="space-y-3">
      {activity.map((e) => (
        <li key={e.id} className="flex gap-3">
          <span
            aria-hidden="true"
            className="mt-1.5 size-2 shrink-0 rounded-full bg-border-strong"
          />
          <div className="min-w-0">
            <p className="text-body-sm text-text-primary">{activityLabel(e.kind)}</p>
            <p className="mt-0.5 text-caption text-text-tertiary">
              {/* ⚠️ A NULL ACTOR MEANS THE IMPORTER, not a missing person. 615
                  rows carry one, and rendering "Unknown" would suggest data was
                  lost when the truth is that no human did it. */}
              {e.actorName ?? 'The importer'} · {relativeAge(e.occurredAt, nowMs)}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

/* ---- Small parts ---------------------------------------------------------- */


function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-caption leading-relaxed text-text-secondary">{children}</p>;
}
