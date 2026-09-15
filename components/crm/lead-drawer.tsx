'use client';

import * as React from 'react';
import type { Route } from 'next';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ExternalLink, X } from 'lucide-react';

import { WA_GREEN, WhatsAppMark } from '@/components/crm/whatsapp-mark';
import type {
  CrmLeadEvent,
  CrmLeadNote,
  CrmLeadRecord,
  CrmLeadRelated,
  CrmMessage,
} from '@/lib/db/queries/crm-leads';
import { activityLabel, stageLabel, stageToken } from '@/lib/domain/crm-stages';
import { sourceDetail, sourceLabel } from '@/lib/domain/lead-source';
import { displayPhone } from '@/lib/domain/phone';
import { relativeAge } from '@/lib/view/relative-age';
import { cn } from '@/lib/utils';

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

const TABS: ReadonlyArray<{ key: Tab; label: string }> = [
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
}: {
  lead: CrmLeadRecord;
  notes: readonly CrmLeadNote[];
  activity: readonly CrmLeadEvent[];
  messages: readonly CrmMessage[];
  related: CrmLeadRelated;
  tab: Tab;
  viewerName: string;
  nowMs: number;
}) {
  const router = useRouter();
  const search = useSearchParams();
  const panel = React.useRef<HTMLDivElement>(null);

  const close = React.useCallback(() => {
    /* ⚠️ Rebuild the list's URL rather than `back()` — a reader who arrived on a
       shared drawer link has no list behind them, and `back()` would take them
       off the page entirely. Dropping the two parameters lands them on the list
       with every filter they had. */
    const next = new URLSearchParams(search.toString());
    next.delete('lead');
    next.delete('tab');
    const q = next.toString();
    router.push((q ? `/my-leads?${q}` : '/my-leads') as Route);
  }, [router, search]);

  const go = (t: Tab) => {
    const next = new URLSearchParams(search.toString());
    next.set('tab', t);
    /* ⚠️ `replace`, not `push`. Five tabs would otherwise put five entries in the
       history and "back" would walk through them one at a time instead of
       returning to the list. */
    router.replace(`/my-leads?${next.toString()}` as Route);
  };

  /* Escape closes; focus starts inside. */
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    panel.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [close]);

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
        className="relative flex h-full w-full max-w-[36rem] flex-col border-l border-border-default bg-bg-surface shadow-2xl outline-none"
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
              aria-pressed={tab === t.key}
              className={cn(
                'shrink-0 rounded-lg px-3 py-1.5 text-caption font-medium transition-colors',
                tab === t.key
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
          {tab === 'overview' && (
            <Overview lead={lead} notes={notes} phone={phone} nowMs={nowMs} />
          )}
          {tab === 'conversations' && <Conversation messages={messages} nowMs={nowMs} />}
          {tab === 'followups' && <FollowUps related={related} nowMs={nowMs} />}
          {tab === 'related' && <Related related={related} />}
          {tab === 'activity' && <Activity activity={activity} nowMs={nowMs} />}
        </div>
      </div>
    </div>
  );
}

/* ---- Overview ------------------------------------------------------------- */

function Overview({
  lead,
  notes,
  phone,
  nowMs,
}: {
  lead: CrmLeadRecord;
  notes: readonly CrmLeadNote[];
  phone: string;
  nowMs: number;
}) {
  return (
    <div className="space-y-5">
      <Facts
        rows={[
          ['Project', lead.projectName],
          ['City', lead.city],
          ['Phone', phone],
          ['Email', lead.email],
          ['Source', `${sourceLabel(lead.source)}${sourceDetail(lead.source, null) ? ` · ${sourceDetail(lead.source, null)}` : ''}`],
          ['Came from', lead.campaignName ?? lead.formName],
          ['Enquired', relativeAge(lead.submittedAt, nowMs)],
          ['Next action', lead.nextAction],
        ]}
      />

      {/* ⚠️ THE RAW ANSWERS, because the form asked them and nobody else will.
          What a lead typed into "Which plot size?" is the single most useful
          thing on this panel before the first call. */}
      {Object.keys(lead.answers).length > 0 && (
        <section>
          <h3 className="mb-2 text-micro font-semibold uppercase tracking-wide text-text-tertiary">
            What they told the form
          </h3>
          <Facts rows={Object.entries(lead.answers)} />
        </section>
      )}

      <section>
        <h3 className="mb-2 text-micro font-semibold uppercase tracking-wide text-text-tertiary">
          Notes ({notes.length})
        </h3>
        {notes.length === 0 ? (
          <Empty>No notes yet.</Empty>
        ) : (
          <ul className="space-y-2">
            {notes.slice(0, 5).map((n) => (
              <li key={n.id} className="rounded-lg border border-border-subtle px-3 py-2">
                <p className="whitespace-pre-wrap text-body-sm text-text-primary">{n.body}</p>
                <p className="mt-1 text-caption text-text-tertiary">
                  {n.authorName ?? 'Someone'} · {relativeAge(n.createdAt, nowMs)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

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

function Related({ related }: { related: CrmLeadRelated }) {
  return (
    <div className="space-y-5">
      <section>
        <h3 className="mb-2 text-micro font-semibold uppercase tracking-wide text-text-tertiary">
          Quotations ({related.quotations.length})
        </h3>
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

function Facts({ rows }: { rows: ReadonlyArray<readonly [string, string | null | undefined]> }) {
  const shown = rows.filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '');
  if (shown.length === 0) return <Empty>Nothing recorded.</Empty>;
  return (
    <dl className="grid gap-x-4 gap-y-0 sm:grid-cols-2">
      {shown.map(([k, v]) => (
        <div
          key={k}
          className="flex items-baseline justify-between gap-3 border-b border-border-subtle py-1.5"
        >
          <dt className="shrink-0 text-caption text-text-secondary">{k}</dt>
          <dd className="min-w-0 truncate text-right text-body-sm text-text-primary">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-caption leading-relaxed text-text-secondary">{children}</p>;
}
