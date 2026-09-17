'use client';

import * as React from 'react';
import type { Route } from 'next';
import Link from 'next/link';
import {
  CalendarClock,
  CirclePlus,
  ExternalLink,
  Mail,
  MoreVertical,
  PauseCircle,
  Phone,
  X,
} from 'lucide-react';

import {
  MAIL_BLUE,
  PAUSED_ORANGE,
  WA_GREEN,
  WhatsAppMark,
} from '@/components/crm/whatsapp-mark';
import { RecordOutcome } from '@/components/crm/record-outcome';
import { initialsOf } from '@/components/ui/avatar';
import type {
  CrmLeadEvent,
  CrmLeadNote,
  CrmLeadRecord,
  CrmLeadRelated,
  CrmConversationSummary,
  CrmLeadRow,
  CrmMessage,
} from '@/lib/db/queries/crm-leads';
import {
  activityLabel,
  STAGE_ORDER,
  stageLabel,
  stageToken,
  temperatureLabel,
  temperatureToken,
} from '@/lib/domain/crm-stages';
import { displayPhone } from '@/lib/domain/phone';
import {
  LeadConversationTab,
  useConversationSummary,
} from '@/components/crm/lead-conversation-tab';
import { LeadOverviewTab } from '@/components/crm/lead-overview-tab';
import { LeadFollowUpsTab, type FollowUpComposer } from '@/components/crm/lead-followups-tab';
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

export const TABS: ReadonlyArray<{ key: Tab; label: string }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'conversations', label: 'Conversations' },
  { key: 'followups', label: 'Follow-ups' },
  { key: 'related', label: 'Related items' },
  { key: 'activity', label: 'Activity' },
];

/* ============================================================================
 * ONE DRAWER, FROM THE CLICK TO THE RECORD
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-17: *"when I click on the drawer, for the time it is rendering,
 * it shows me the old design. After it has rendered it shows me a new UI that is
 * very disgusting… It instantly shows the drawer in the latest UI."*
 *
 * ⚠️⚠️ TWO COMPONENTS DREW THIS DRAWER, AND ONLY ONE OF THEM WAS REDESIGNED.
 * `lead-drawer-shell.tsx` opened in the click's own frame from the row, and this
 * replaced it once the record arrived. Its own header said the two were "the
 * same frame, to the pixel". They were — until the Overview and Conversations
 * tabs were rebuilt here and nobody rebuilt the shell. Every click then drew the
 * old 36rem drawer and swapped it for this one, which is the flash the owner saw.
 *
 * So the shell is gone and this component draws both moments. The header, the
 * four figures and the tab bar come straight from the clicked row, which already
 * carries every one of them; only the tab BODIES wait, and they wait inside this
 * design. Two components promising to look identical will drift the first time
 * somebody changes one. One component cannot.
 * ========================================================================= */

/** One header control: 32px, the drawer's rhythm, whatever it opens. */
const TILE =
  'grid size-8 place-items-center rounded-lg border border-border-default text-text-primary transition-colors hover:bg-bg-subtle';

/** The clicked row, as a record — for the frames before the server answers. */
export function leadFromRow(row: CrmLeadRow): CrmLeadRecord {
  return {
    id: row.id,
    projectId: '',
    projectName: row.projectName ?? '',
    propertyId: null,
    propertyLabel: row.propertyLabel,
    fullName: row.fullName,
    phone: row.phone,
    phoneE164: row.phoneE164,
    email: row.email,
    city: row.city,
    answers: {},
    stage: row.stage,
    temperature: row.temperature,
    lostReason: null,
    nextAction: row.nextAction,
    nextActionAt: row.nextActionAt,
    submittedAt: row.submittedAt,
    importedAt: row.submittedAt,
    firstContactedAt: null,
    closedAt: null,
    ownerId: row.ownerId,
    ownerName: row.ownerName,
    formName: row.formName,
    campaignName: row.campaignName,
    source: row.source ?? '',
    externalId: null,
    /* ⚠️ Unknown, not unasked. The Overview shows "Loading…" for these while
       `loading` is set, rather than reading five nulls as "never asked". */
    budgetBand: null,
    authority: null,
    purpose: null,
    timeline: null,
    paymentMode: null,
    locationPreference: null,
    qualificationNote: null,
    budget: null,
    qualifiedAt: null,
    sells: row.sells,
    nextActionType: null,
  };
}

/** What the row knows of the related records — the figures strip reads these. */
export function relatedFromRow(row: CrmLeadRow): CrmLeadRelated {
  return {
    /* ⚠️ THE ROW'S OWN QUOTATION, so the strip prints QT-1042 and its value in
       the first frame. The desk's lateral already picks the current version. */
    quotations: row.quotationNumber
      ? [{
          id: `row-${row.id}`,
          number: row.quotationNumber,
          version: 1,
          status: row.quotationStatus ?? 'sent',
          netAmount: row.quotationAmount ?? 0,
          requestedDiscount: 0,
          approvedDiscount: 0,
          validUntil: row.quotationValidUntil,
          propertyLabel: row.propertyLabel,
          preparedByName: null,
          approvedByName: null,
          createdAt: row.submittedAt,
        }]
      : [],
    appointments: [],
    followUps: [],
    sender: null,
    summary: null,
    sequence:
      row.sequenceState && row.sequenceState !== 'not_started'
        ? {
            id: '',
            name: '',
            purpose: 'custom',
            state: row.sequenceState,
            step: row.sequenceStep ?? 0,
            total: row.sequenceTotal ?? 0,
            pauseReason: row.sequenceNote,
            startedAt: row.submittedAt,
            nextStepAt: null,
            quotationId: null,
            steps: [],
          }
        : null,
    sequenceOptions: [],
    draft: null,
  };
}

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
  loading = false,
  onSummary,
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
  /** Drawn from the clicked row; the record is on its way. See `leadFromRow`. */
  loading?: boolean;
  /** A summary was just written — the desk keeps it with this lead's drawer. */
  onSummary?: (leadId: string, summary: CrmConversationSummary) => void;
}) {
  const panel = React.useRef<HTMLDivElement>(null);

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

  /* ⚠️ A TAB IS CLIENT STATE. The desk records it in the URL with
     `history.replaceState`; this used to route through the server and re-render
     the whole page for every tab clicked inside an open drawer. */
  const go = (t: Tab) => onTab(t);

  /* Focus starts inside. Escape is handled by `usePanel`, on the instant path. */
  React.useEffect(() => {
    panel.current?.focus();
  }, []);

  const phone = displayPhone(lead.phoneE164, lead.phone);

  /* The summary is written from here, not from inside the tab — see the hook. */
  const reportSummary = React.useCallback(
    (summary: CrmConversationSummary) => onSummary?.(lead.id, summary),
    [onSummary, lead.id],
  );
  const conversationSummary = useConversationSummary({
    leadId: lead.id,
    messages,
    noteCount: notes.length,
    stored: related.summary,
    loading,
    eager: activeTab === 'conversations',
    onSummary: reportSummary,
  });
  const [menuOpen, setMenuOpen] = React.useState(false);
  /* The Follow-ups tab's composer — opened from the drawer's foot, drawn in the tab. */
  const [composer, setComposer] = React.useState<FollowUpComposer>(null);
  /* ⚠️ THE STAGE DROPDOWN OPENS "Record outcome", it does not write.
     Owner, 2026-09-17: *"Each time the state changes it shows this modal.
     Whether the drawer is open and then I change the state, it also shows this
     modal above that."* A stage moved with no outcome, no note and no next
     action is exactly the silent edit the form exists to prevent — and it was
     silent here while the desk's own dropdown asked properly. */
  const [outcomeStage, setOutcomeStage] = React.useState<string | null>(null);

  /* ⚠️ THE LIVE ONE, not the newest row. A superseded v1 still exists (176) and
     printing its figure on the strip would show a price nobody is offering any
     more — to the person about to repeat it on the phone. */
  const live =
    related.quotations.find(
      (q) => !['superseded', 'rejected', 'expired'].includes(q.status),
    ) ?? null;
  const isOpen = lead.stage !== 'won' && lead.stage !== 'lost';
  /* The unit's own kind, taken from the label the rest of the product already
     prints rather than re-derived into a second wording. */
  const unitKind = lead.propertyLabel?.split('·')[0]?.trim() ?? null;

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
        /* ⚠️ 38rem — 547px on screen under the 0.9 zoom. Owner, 2026-09-17, twice:
           46rem (662px) and then 42rem (605px) were both *"too much"*. The Overview's
           two columns still fit side by side here at about 270px each. */
          aria-busy={loading}
          className="relative flex h-full w-full max-w-[38rem] flex-col border-l border-border-default bg-bg-surface shadow-2xl outline-none"
      >
        {/* ── Header ────────────────────────────────────── */}
        <div className="shrink-0 border-b border-border-subtle px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 gap-3">
              <span className="grid size-11 shrink-0 place-items-center rounded-full bg-accent-primary/10 text-body-sm font-semibold text-accent-primary">
                {initialsOf(lead.fullName ?? '?')}
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="truncate text-h3 font-semibold text-text-primary">
                    {lead.fullName ?? 'Name not given'}
                  </h2>
                  {/* ⚠️ "Active" MEANS THE LEAD IS OPEN, not that anybody is online.
                      A presence badge on a client would be inventing a signal we
                      have no way at all to observe. */}
                  <span
                    className="rounded-full px-2 py-0.5 text-caption font-medium"
                    style={{
                      background: isOpen
                        ? 'color-mix(in oklab, var(--feedback-success) 14%, transparent)'
                        : 'var(--bg-subtle)',
                      color: isOpen ? 'var(--feedback-success)' : 'var(--text-secondary)',
                    }}
                  >
                    {isOpen ? 'Active' : stageLabel(lead.stage)}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-caption text-text-secondary">
                  {lead.projectName}
                  {lead.city ? ` · ${lead.city}` : ''}
                </p>
                {lead.propertyLabel && (
                  <p className="truncate text-caption text-text-secondary">{lead.propertyLabel}</p>
                )}
                {/* ⚠️ ONLY WHAT IS RECORDED. The reference shows "Residential" and
                    "Hot lead"; the first is the unit's own kind and the second is
                    `temperature`. Neither is drawn when unset — an empty chip is a
                    fact nobody established, dressed as one they did. */}
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {unitKind && (
                    <span className="rounded-md bg-bg-subtle px-2 py-0.5 text-caption text-text-secondary">
                      {unitKind}
                    </span>
                  )}
                  {lead.temperature && (
                    <span
                      className="rounded-md px-2 py-0.5 text-caption font-medium"
                      style={{
                        background: `color-mix(in oklab, var(--${temperatureToken(lead.temperature)}) 14%, transparent)`,
                        color: `var(--${temperatureToken(lead.temperature)})`,
                      }}
                    >
                      {temperatureLabel(lead.temperature)} lead
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* ⚠️ FOUR EQUAL TILES IN THE DRAWER'S OWN RHYTHM. Owner, 2026-09-17: *"those
                icons are out of rhythm with this drawer, so make them all equally a
                little small."* The previous pass made them 40px with a 24px WhatsApp
                mark in a green-filled box — louder than the name beside them. Now
                every tile, the menu and the close button share one 32px square and
                a 16px glyph; the channel is carried by the glyph's colour alone.

                ⚠️ EMAIL IS ALWAYS PRESENT, at the owner's repeated request — quieter
                with no address, and it says why on hover. */}
            <div className="flex shrink-0 items-center gap-1.5">
              {lead.phoneE164 && (
                <a
                  href={`tel:${lead.phoneE164}`}
                  aria-label="Call"
                  title="Call"
                  className={TILE}
                >
                  <Phone className="size-4" aria-hidden="true" />
                </a>
              )}
              {lead.phoneE164 && (
                <button
                  type="button"
                  onClick={() => go('conversations')}
                  aria-label="Open the WhatsApp thread"
                  title="WhatsApp"
                  className={TILE}
                  style={{ color: WA_GREEN }}
                >
                  <WhatsAppMark className="size-4" />
                </button>
              )}
              {lead.email ? (
                <a
                  href={`mailto:${lead.email}`}
                  aria-label={`Email ${lead.email}`}
                  title={lead.email}
                  className={TILE}
                  style={{ color: MAIL_BLUE }}
                >
                  <Mail className="size-4" aria-hidden="true" />
                </a>
              ) : (
                <span
                  role="img"
                  aria-label="No email address on this lead yet"
                  title="No email address on this lead yet"
                  className={cn(TILE, 'cursor-not-allowed border-dashed hover:bg-transparent')}
                  style={{ color: `color-mix(in oklab, ${MAIL_BLUE} 45%, transparent)` }}
                >
                  <Mail className="size-4" aria-hidden="true" />
                </span>
              )}

              {/* ⚠️ THE THREE DOTS ARE A REAL MENU, not a decoration. The full
                  record lived on a link icon here and the owner asked for it gone:
                  four channel buttons and a fifth that opens a page is one thing
                  too many on a row read left to right. Everything that is not a
                  channel moves behind the dots. */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setMenuOpen((v) => !v)}
                  aria-label="More"
                  aria-expanded={menuOpen}
                  className={cn(TILE, 'text-text-secondary hover:text-text-primary')}
                >
                  <MoreVertical className="size-4" aria-hidden="true" />
                </button>
                {menuOpen && (
                  <div className="absolute right-0 z-20 mt-1 w-48 overflow-hidden rounded-xl border border-border-default bg-bg-surface py-1 shadow-lg">
                    <Link
                      href={`/leads/${lead.id}` as Route}
                      className="flex items-center gap-2 px-3 py-2 text-caption text-text-primary hover:bg-bg-subtle"
                    >
                      <ExternalLink className="size-3.5" aria-hidden="true" />
                      Open the full record
                    </Link>
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        go('activity');
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-caption text-text-primary hover:bg-bg-subtle"
                    >
                      <CalendarClock className="size-3.5" aria-hidden="true" />
                      See everything that happened
                    </button>
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={close}
                aria-label="Close"
                className="grid size-8 place-items-center rounded-lg text-text-secondary transition-colors hover:bg-bg-subtle hover:text-text-primary"
              >
                <X className="size-4" />
              </button>
            </div>
          </div>

          {/* ── The four figures ─────────────────────────────────
              ⚠️ EVERY ONE READ FROM A ROW. A lead with no quotation shows a dash
              rather than a figure borrowed from somewhere else — a value on this
              strip is what somebody repeats to a client on the phone. */}
          {/* ⚠️ DIVIDED, because four figures in a row with nothing between them
              read as one sentence. The rule is on the LEFT of each cell except
              the first, so it never hangs off the end. */}
          <dl className="mt-3 grid grid-cols-2 gap-y-3 sm:grid-cols-4">
            <div className="pr-3">
              <dt className="text-caption text-text-secondary">Stage</dt>
              <dd className="mt-0.5">
                {/* ⚠️ A REAL SELECT, and it writes. The owner asked for a dropdown
                    and a coloured pill that cannot be changed is the worse half of
                    one. `lost` is absent: it needs a reason (111's constraint), so
                    offering it here would produce a refusal rather than a change —
                    Record Outcome owns that. */}
                <select
                  value={lead.stage}
                  onChange={(e) => setOutcomeStage(e.target.value)}
                  className="w-full rounded-md border-0 px-2 py-1 text-caption font-medium focus:outline-none"
                  style={{
                    backgroundColor: `color-mix(in oklab, var(--${stageToken(lead.stage)}) 14%, transparent)`,
                    color: `var(--${stageToken(lead.stage)})`,
                  }}
                >
                  {STAGE_ORDER.map((v) => (
                    <option key={v} value={v}>
                      {stageLabel(v)}
                    </option>
                  ))}
                </select>
              </dd>
            </div>
            <div className="border-border-subtle px-3 sm:border-l">
              <dt className="text-caption text-text-secondary">Quotation</dt>
              <dd className="mt-0.5 text-body-sm font-semibold text-text-primary">
                {live ? `${live.number}${live.version > 1 ? ` v${live.version}` : ''}` : '—'}
              </dd>
            </div>
            <div className="border-border-subtle px-3 sm:border-l">
              <dt className="text-caption text-text-secondary">Value</dt>
              <dd className="mt-0.5 text-body-sm font-semibold text-text-primary">
                {live ? `PKR ${live.netAmount.toLocaleString('en-PK')}` : '—'}
              </dd>
            </div>
            <div className="border-border-subtle px-3 sm:border-l">
              <dt className="text-caption text-text-secondary">Next follow-up</dt>
              <dd className="mt-0.5 flex items-center gap-1.5 text-body-sm text-text-primary">
                {related.sequence?.state === 'paused' ? (
                  <>
                    {/* ⚠️ ORANGE, AND IT IS NOT A TOKEN. Paused is a warning state
                        and must stay orange whatever the palette does — the same
                        reasoning that hard-codes WhatsApp's green. */}
                    <PauseCircle
                      className="size-4 shrink-0"
                      style={{ color: PAUSED_ORANGE }}
                      aria-hidden="true"
                    />
                    <span className="leading-tight">Paused after reply</span>
                  </>
                ) : lead.nextActionAt ? (
                  <span className="truncate">
                    {new Date(lead.nextActionAt).toLocaleDateString('en-GB', {
                      day: 'numeric', month: 'short', timeZone: 'Asia/Karachi',
                    })}
                  </span>
                ) : (
                  <span className="text-text-secondary">Nothing planned</span>
                )}
              </dd>
            </div>
          </dl>
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
              {!loading && t.key === 'conversations' && messages.length > 0 && ` (${messages.length})`}
              {t.key === 'related' && related.quotations.length > 0 && ` (${related.quotations.length})`}
            </button>
          ))}
        </div>

        {/* ── Body ─────────────────────────────────────────────────────── */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {activeTab === 'overview' && (
            <LeadOverviewTab
              loading={loading}
              lead={lead}
              notes={notes}
              activity={activity}
              related={related}
              phone={phone}
              viewerName={viewerName}
              onTab={go}
            />
          )}
          {activeTab === 'conversations' && (
            <LeadConversationTab
              leadId={lead.id}
              messages={messages}
              /* The written record — the Summary view reads from the same
                 rows the Overview tab's notes card does, so the two can never
                 disagree about what was said. */
              notes={notes}
              summary={conversationSummary}
              loading={loading}
              sender={related.sender}
              /* ⚠️ THE ENGINE'S OWN REASON (170), not a sentence guessed here.
                 Two explanations of the same pause start disagreeing. */
              sequencePaused={
                related.sequence?.state === 'paused'
                  ? (related.sequence.pauseReason ?? 'the client replied')
                  : null
              }
              leadName={lead.fullName ?? 'This lead'}
              viewerName={viewerName}
              projectName={lead.projectName}
              onReviewFollowUp={() => go('followups')}
            />
          )}
          {/* ⚠️ "Loading…", NEVER AN EMPTY LIST, for the tabs the row cannot
              draw. "No follow-ups" in the half-second before they arrive is the
              kind of small lie somebody books a duplicate on. */}
          {loading && (activeTab === 'related' || activeTab === 'activity') && (
            <p className="py-6 text-center text-caption text-text-secondary">Loading…</p>
          )}
          {activeTab === 'followups' && (
            <LeadFollowUpsTab
              lead={lead}
              related={related}
              viewerName={viewerName}
              nowMs={nowMs}
              loading={loading}
              composer={composer}
              onComposer={setComposer}
              onReviewReply={() => go('conversations')}
            />
          )}
          {!loading && activeTab === 'related' && (
            <Related
              related={related}
              lead={lead}
              onRaiseQuotation={onRaiseQuotation}
              onChooseUnit={onChooseUnit}
            />
          )}
          {!loading && activeTab === 'activity' && <Activity activity={activity} nowMs={nowMs} />}
        </div>

        {/* ── The three things a salesperson does from here ──────────────
            ⚠️ FIXED TO THE FOOT, OUTSIDE THE SCROLLING BODY. The reference puts
            them there and it is right: on a long Overview the actions would
            otherwise be below the fold on the one screen somebody opens in order
            to act.

            ⚠️ AND EACH ONE IS ABSENT RATHER THAN DISABLED WHEN IT CANNOT WORK. A
            greyed "Send email" on a lead with no address is a button somebody
            presses twice before reading it — 640 of 641 real leads have no email,
            so this is the common case, not the edge.

            ⚠️ ON THE OVERVIEW ONLY. Owner, 2026-09-17: *"Below WhatsApp the Follow
            Up button is showing in the Conversation tab. It will be in the Overview
            tab, that's fine, but not in the Conversation tab."* Under the composer
            it was a second row of buttons below the Send button — two places to
            act, stacked, on the one tab that already has its own. */}
        {/* ⚠️ THE FOLLOW-UPS TAB HAS ITS OWN FOOT, as the reference draws it: a
            reminder for yourself, or a follow-up with the client. Both open the
            composer at the top of the tab rather than a dialog over the drawer. */}
        {activeTab === 'followups' && !loading && (
          <div className="grid shrink-0 grid-cols-2 gap-2 border-t border-border-subtle px-5 py-3">
            <button
              type="button"
              onClick={() => setComposer((c) => (c === 'reminder' ? null : 'reminder'))}
              aria-pressed={composer === 'reminder'}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-border-default px-3 py-2.5 text-body-sm font-medium text-text-primary transition-colors hover:bg-bg-subtle"
            >
              <CalendarClock className="size-4" aria-hidden="true" />
              Add reminder
            </button>
            <button
              type="button"
              onClick={() => setComposer((c) => (c === 'follow_up' ? null : 'follow_up'))}
              aria-pressed={composer === 'follow_up'}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-accent-primary px-3 py-2.5 text-body-sm font-semibold text-white transition-opacity hover:opacity-90"
            >
              <CirclePlus className="size-4" aria-hidden="true" />
              New follow-up
            </button>
          </div>
        )}
        {activeTab === 'overview' && (
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
            onClick={() => {
              setComposer('follow_up');
              go('followups');
            }}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-accent-primary px-3 py-2.5 text-body-sm font-semibold text-white transition-opacity hover:opacity-90"
          >
            <CalendarClock className="size-4" aria-hidden="true" />
            Add follow-up
          </button>
        </div>
        )}
      </div>

      {/* ⚠️ ABOVE THE DRAWER, NOT INSTEAD OF IT. The desk swaps one for the other;
          from in here the drawer is the context somebody is recording FROM, and
          taking it away to ask about the stage loses the conversation they were
          reading. `RecordOutcome` is z-[60], this is z-50. */}
      {outcomeStage && (
        <RecordOutcome
          leadId={lead.id}
          leadName={lead.fullName ?? 'this lead'}
          currentStage={lead.stage}
          proposedStage={outcomeStage}
          onClose={() => setOutcomeStage(null)}
        />
      )}
    </div>
  );
}

/* ---- Overview ------------------------------------------------------------
   ⚠️ MOVED OUT to `lead-overview-tab.tsx` on 2026-09-17, when the owner's
   reference turned it from a list of facts into a lifecycle strip, two columns
   and three cards. It was the largest thing in this file and it is the one tab
   that will keep changing. */

/* ---- Conversation --------------------------------------------------------
   ⚠️ MOVED OUT to `lead-conversation-tab.tsx` on 2026-09-17, when the owner's
   reference turned it from a list of bubbles into a filtered two-channel thread
   with a pause banner and a composer that names its own sending number. */


/* ---- Follow-ups ----------------------------------------------------------
   ⚠️ MOVED OUT to `lead-followups-tab.tsx` on 2026-09-17, when the owner's
   reference turned a read-only list into a working tab: the sequence step by
   step with Review reply · Reschedule · Stop, and follow-ups a person can plan,
   complete and cancel. Its visits section went with it. */

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
