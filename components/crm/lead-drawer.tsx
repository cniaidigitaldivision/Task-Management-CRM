'use client';

import * as React from 'react';
import type { Route } from 'next';
import Link from 'next/link';
import {
  CalendarClock,
  CirclePlus,
  ClipboardCheck,
  Pencil,
  ExternalLink,
  Eye,
  FileText,
  Home,
  Send,
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
import { EditLeadDetails } from '@/components/crm/edit-lead-details';
import { RelatedItemsDialog, seedRelated } from '@/components/crm/related-items';
import { initialsOf } from '@/components/ui/avatar';
import type {
  AgentMode,
  CrmLeadEvent,
  CrmLeadNote,
  CrmLeadRecord,
  CrmLeadRelated,
  CrmConversationSummary,
  CrmLeadRow,
  CrmMessage,
} from '@/lib/db/queries/crm-leads';
import {
  STAGE_ORDER,
  stageLabel,
  stageToken,
  temperatureLabel,
  temperatureToken,
} from '@/lib/domain/crm-stages';
import { appointmentKindLabel } from '@/lib/domain/crm-appointments';
import { quotationStatusLabel, quotationStatusToken } from '@/lib/domain/crm-quotations';
import { displayPhone } from '@/lib/domain/phone';
import {
  LeadConversationTab,
  useConversationSummary,
} from '@/components/crm/lead-conversation-tab';
import { plannedSummary } from '@/lib/domain/crm-planned';
import { setAgentModeAction } from '@/app/actions/crm-whatsapp';
import { useToast } from '@/components/ui/toast';
import { LeadActivityTab } from '@/components/crm/lead-activity-tab';
import { LeadOverviewTab } from '@/components/crm/lead-overview-tab';
import { LeadFollowUpsTab, type FollowUpComposer } from '@/components/crm/lead-followups-tab';
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
    /* ⚠️ `off` UNTIL THE RECORD ARRIVES. The desk row does not carry the mode,
       and showing "AI agent" for the half-second before the real answer lands
       would be a control claiming something untrue. */
    agentMode: 'off',
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
    counts: { bookings: 0, invoices: 0, files: 0 },
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
  const toast = useToast();
  const [menuOpen, setMenuOpen] = React.useState(false);

  /* ⚠️ THE CHOICE THIS FRAME, THE RECORD UNDERNEATH — the same shape the
     Conversations page uses, and the same reason: the click must land before the
     server answers. Dropped the moment the record itself agrees. */
  const [agentWish, setAgentWish] = React.useState<AgentMode | null>(null);
  const [seenMode, setSeenMode] = React.useState(lead.agentMode);
  if (seenMode !== lead.agentMode) {
    setSeenMode(lead.agentMode);
    if (agentWish === lead.agentMode) setAgentWish(null);
  }
  const agentMode = agentWish ?? lead.agentMode;
  /* The Follow-ups tab's composer — opened from the drawer's foot, drawn in the tab. */
  const [composer, setComposer] = React.useState<FollowUpComposer>(null);
  /* ⚠️ THE STAGE DROPDOWN OPENS "Record outcome", it does not write.
     Owner, 2026-09-17: *"Each time the state changes it shows this modal.
     Whether the drawer is open and then I change the state, it also shows this
     modal above that."* A stage moved with no outcome, no note and no next
     action is exactly the silent edit the form exists to prevent — and it was
     silent here while the desk's own dropdown asked properly. */
  const [outcomeStage, setOutcomeStage] = React.useState<string | null>(null);
  /* ⚠️ THE FULL RECORDS ARE A DIALOG, NOT THE TAB. Five tabs of master-and-detail
     do not fit a 38rem drawer, and the owner's own designs draw them wide. The
     tab keeps its summary — what is attached, what is quoted, what is booked —
     and this opens the records themselves. */
  const [relatedOpen, setRelatedOpen] = React.useState(false);
  const [relatedTab, setRelatedTab] =
    React.useState<'quotations' | 'properties' | 'appointments' | 'bookings' | 'invoices'>('quotations');
  const [editing, setEditing] = React.useState(false);
  /* What the Related items dialog handed to the composer, if anything. */
  const [handoff, setHandoff] = React.useState<{
    id: number;
    files: readonly File[];
    text: string;
    /** Which composer it belongs to — the person chose in the dialog. */
    channel: 'whatsapp' | 'email';
    subject?: string;
  } | null>(null);

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
                    {/* ⚠️ BEHIND THE DOTS, WITH THE OTHER TWO. Owner, 2026-09-18:
                        *"in the drawer where the three buttons at the top are
                        appearing… plus add the edit option."* A correction is not
                        a channel, so it belongs in this menu rather than as a
                        sixth tile on a row somebody reads left to right. */}
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        setEditing(true);
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-caption text-text-primary hover:bg-bg-subtle"
                    >
                      <Pencil className="size-3.5" aria-hidden="true" />
                      Edit details
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
        {/* ⚠️ FIVE EQUAL SHARES OF THE WIDTH, NOT FIVE LABELS PUSHED LEFT.
            Owner, 2026-09-18: *"all the tabs are just left-aligned so make them
            properly distributed, not just left-aligned. Space them equally so that
            it will look good or balanced."* `flex-1 basis-0` gives every tab the
            same width whatever its label weighs, so the row reads as a bar across
            the drawer rather than a cluster with dead space after it.

            ⚠️ AND THE COUNT IS BARE TEXT, NOT A PILL, BECAUSE IT HAS TO FIT.
            Measured in the running app: at 38rem each tab gets 102px, and
            "Conversations" is 83px of it. A pill's own padding put the pair over
            the line and truncated the longest label the moment a message arrived.
            Two digits fit; a third does not, so the count caps at 99+ — the
            busiest lead in the database has 14 messages.

            ⚠️ AND `scrollWidth` LIED ABOUT IT. Under the 0.9 body zoom the used
            width was 82.7px against 83px of text, which every integer measurement
            rounds to "83 fits 83" while the browser draws the ellipsis. The
            screenshot is what caught it; px-2 on the bar and px-1 on each tab give
            the row the few pixels the reading could not see. */}
        <div className="flex gap-1 border-b border-border-subtle px-2 py-2">
          {TABS.map((t) => {
            const count =
              t.key === 'conversations'
                ? !loading && messages.length > 0
                  ? messages.length
                  : null
                : t.key === 'related' && related.quotations.length > 0
                  ? related.quotations.length
                  : null;
            const on = activeTab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => go(t.key)}
                aria-pressed={on}
                title={t.label}
                className={cn(
                  'flex min-w-0 flex-1 basis-0 items-center justify-center gap-1 rounded-lg px-1 py-1.5 text-caption font-medium transition-colors',
                  on
                    ? 'bg-accent-primary text-white'
                    : 'text-text-secondary hover:bg-bg-subtle hover:text-text-primary',
                )}
              >
                <span className="truncate">{t.label}</span>
                {count !== null && (
                  <span
                    className={cn(
                      'shrink-0 text-micro tabular-nums',
                      on ? 'text-white/80' : 'text-text-tertiary',
                    )}
                  >
                    {count > 99 ? '99+' : count}
                  </span>
                )}
              </button>
            );
          })}
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
              nowMs={nowMs}
              lastDirection={messages.length > 0 ? messages[messages.length - 1].direction : null}
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
              leadEmail={lead.email}
              /* ⚠️ THE SAME CONTROL THE CONVERSATIONS PAGE HAS. Owner, 2026-09-19:
                 *"in the drawer, there is no dropdown showing my reply,
                 suggestion and AI agent."* One lead, two screens, one answer —
                 and the change is optimistic here for the same reason it is
                 there: a mode that waits for a round trip is a mode nobody
                 trusts. */
              agentMode={agentMode}
              onAgentMode={(next) => {
                const before = agentMode;
                setAgentWish(next);
                void setAgentModeAction(lead.id, next).then((r) => {
                  if (r.ok) return;
                  setAgentWish(before);
                  toast({ tone: 'error', text: r.error ?? 'That did not save.' });
                });
              }}
              handoff={handoff}
              onHandoffUsed={() => setHandoff(null)}
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
            <>
              <Related
                related={related}
                lead={lead}
                onRaiseQuotation={onRaiseQuotation}
                onChooseUnit={onChooseUnit}
                onOpen={(t) => {
                  setRelatedTab(t);
                  setRelatedOpen(true);
                }}
              />
            </>
          )}
          {!loading && activeTab === 'activity' && (
            <LeadActivityTab
              leadId={lead.id}
              activity={activity}
              notes={notes}
              related={related}
              nowMs={nowMs}
              viewerName={viewerName}
              onTab={go}
              onOpenRelated={(t) => {
                setRelatedTab(t);
                setRelatedOpen(true);
              }}
            />
          )}
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
      {relatedOpen && (
        <RelatedItemsDialog
          lead={lead}
          sender={related.sender}
          /* ⚠️ THE DIALOG OPENS ON WHAT IS ALREADY HERE. Its own read follows. */
          seed={seedRelated(lead, related)}
          initialTab={relatedTab}
          onAttach={({ files, text, channel, subject }) => {
            setHandoff({ id: Date.now(), files, text, channel, subject });
            setRelatedOpen(false);
            go('conversations');
          }}
          onClose={() => setRelatedOpen(false)}
          onChooseUnit={() => {
            setRelatedOpen(false);
            onChooseUnit();
          }}
          onRecordOutcome={() => {
            setRelatedOpen(false);
            setOutcomeStage(lead.stage);
          }}
        />
      )}

      {editing && <EditLeadDetails lead={lead} onClose={() => setEditing(false)} />}

      {outcomeStage && (
        <RecordOutcome
          leadId={lead.id}
          leadName={lead.fullName ?? 'this lead'}
          currentStage={lead.stage}
          proposedStage={outcomeStage}
          /* ⚠️ FROM ROWS THE DRAWER IS ALREADY HOLDING. The form must not go
             and ask the server whether this lead has a plan; law 3. */
          planned={plannedSummary({
            nextAction: lead.nextAction,
            nextActionAt: lead.nextActionAt,
            sequence: related.sequence,
            followUps: related.followUps,
            appointments: related.appointments,
            nowMs,
          })}
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

/* ---- Related items · the drawer's own summary ------------------------------
   Owner, 2026-09-17: *"in the Related Items tab there should only be a summary
   and there should be a button which, when clicked, will make this modal pop
   up."* So this is a summary and nothing more — the records themselves, their
   previews and their actions live in `RelatedItemsDialog`.

   ⚠️ AND IT COSTS THE DRAWER NOTHING. Everything here is already in the bundle
   the drawer loads; the counts are three scalar subqueries. Bookings, invoices
   and files are read only when somebody opens the dialog. */

function Related({
  related,
  lead,
  onRaiseQuotation,
  onChooseUnit,
  onOpen,
}: {
  related: CrmLeadRelated;
  lead: CrmLeadRecord;
  onRaiseQuotation: () => void;
  onChooseUnit: () => void;
  /** Opens the dialog, on the tab that was asked for. */
  onOpen: (tab: 'quotations' | 'properties' | 'appointments' | 'bookings' | 'invoices') => void;
}) {
  const live =
    related.quotations.find((q) => !['superseded', 'rejected', 'expired'].includes(q.status)) ??
    related.quotations[0] ??
    null;
  const visit = related.appointments.find((a) => ['scheduled', 'confirmed'].includes(a.status)) ?? null;

  const chips: ReadonlyArray<{ key: Parameters<typeof onOpen>[0]; label: string; n: number }> = [
    { key: 'quotations', label: 'Quotations', n: related.quotations.length },
    { key: 'properties', label: 'Properties', n: lead.propertyId ? 1 : 0 },
    { key: 'appointments', label: 'Appointments', n: related.appointments.length },
    { key: 'bookings', label: 'Bookings', n: related.counts.bookings },
    { key: 'invoices', label: 'Invoices', n: related.counts.invoices },
  ];

  return (
    <div className="space-y-3">
      {/* ── What there is, and the way in ──────────────────────────────── */}
      <div className="flex flex-wrap gap-1.5">
        {chips.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => onOpen(c.key)}
            className={cn(
              'rounded-lg border px-2.5 py-1.5 text-caption font-medium transition-colors',
              c.n > 0
                ? 'border-[var(--pick-border)] bg-[var(--pick-bg)] text-text-primary'
                : 'border-border-subtle text-text-secondary hover:bg-bg-subtle',
            )}
          >
            {c.label} ({c.n})
          </button>
        ))}
      </div>

      {/* ── The quotation ──────────────────────────────────────────────── */}
      <section className="rounded-xl border border-border-subtle bg-bg-surface">
        <header className="flex items-center gap-2.5 border-b border-border-subtle px-3.5 py-2.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-bg-subtle text-text-secondary">
            <FileText className="size-4" aria-hidden="true" />
          </span>
          <h3 className="min-w-0 flex-1 truncate text-body-sm font-semibold text-text-primary">Quotation</h3>
          {live ? (
            <span
              className="shrink-0 rounded-md px-2 py-0.5 text-caption font-medium"
              style={{
                color: `var(--${quotationStatusToken(live.status)})`,
                background: `color-mix(in oklab, var(--${quotationStatusToken(live.status)}) 12%, transparent)`,
              }}
            >
              {quotationStatusLabel(live.status)}
            </span>
          ) : (
            <button
              type="button"
              onClick={onRaiseQuotation}
              className="shrink-0 rounded-lg border border-border-default px-2.5 py-1 text-caption font-medium text-text-primary transition-colors hover:bg-bg-subtle"
            >
              Raise one
            </button>
          )}
        </header>

        {live ? (
          <div className="space-y-3 px-3.5 py-3">
            <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-4">
              <Cell label={`${live.number}${live.version > 1 ? ` v${live.version}` : ''}`} value={lead.projectName} strong />
              <Cell label="Value" value={`PKR ${live.netAmount.toLocaleString('en-PK')}`} strong />
              <Cell
                label="Valid to"
                value={live.validUntil
                  ? new Date(live.validUntil).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Karachi' })
                  : 'Open-ended'}
                strong
              />
              <Cell
                label="Raised"
                value={new Date(live.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Karachi' })}
                strong
              />
            </div>

            {/* ⚠️ WHO THE CLIENT SEES IT FROM. The same name the WhatsApp composer
                prints — a quotation signed by a business the client has never
                heard of is the one thing worse than none. */}
            <div className="border-t border-border-subtle pt-2.5">
              <p className="text-caption text-text-secondary">Sender (customer-facing)</p>
              <p className="text-body-sm font-medium text-text-primary">
                {related.sender?.displayName ?? lead.projectName}
              </p>
            </div>

            <div className="flex items-center gap-3 rounded-xl border border-border-subtle px-3 py-2.5">
              <span
                className="grid size-9 shrink-0 place-items-center rounded-lg text-caption font-bold text-white"
                style={{ background: live.pdfPath ? 'var(--feedback-error)' : 'var(--border-default)' }}
                aria-hidden="true"
              >
                PDF
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body-sm font-medium text-text-primary">
                  {live.pdfPath ? `${live.number}.pdf` : 'No PDF attached yet'}
                </span>
                <span className="block text-caption text-text-secondary">
                  {live.pdfPath ? 'Attached to this quotation' : 'Upload it in Related items'}
                </span>
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => onOpen('quotations')}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-border-default px-3 py-2 text-body-sm font-medium text-text-primary transition-colors hover:bg-bg-subtle"
              >
                <Eye className="size-4" aria-hidden="true" />
                Preview
              </button>
              <button
                type="button"
                onClick={() => onOpen('quotations')}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-border-default px-3 py-2 text-body-sm font-medium text-text-primary transition-colors hover:bg-bg-subtle"
              >
                <Send className="size-4" aria-hidden="true" />
                Send
              </button>
            </div>
          </div>
        ) : (
          <p className="px-3.5 py-3 text-caption leading-relaxed text-text-secondary">
            Nothing quoted yet. A quotation names the unit and the price, so the rest of this tab has something to be
            about.
          </p>
        )}
      </section>

      {/* ── The unit ───────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-border-subtle bg-bg-surface">
        <header className="flex items-center gap-2.5 border-b border-border-subtle px-3.5 py-2.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-bg-subtle text-text-secondary">
            <Home className="size-4" aria-hidden="true" />
          </span>
          <h3 className="min-w-0 flex-1 truncate text-body-sm font-semibold text-text-primary">Property</h3>
          <button
            type="button"
            onClick={onChooseUnit}
            className="shrink-0 rounded-lg border border-border-default px-2.5 py-1 text-caption font-medium text-text-primary transition-colors hover:bg-bg-subtle"
          >
            {lead.propertyLabel ? 'Change' : 'Choose one'}
          </button>
        </header>
        {lead.propertyLabel ? (
          <div className="flex items-center gap-3 px-3.5 py-3">
            {/* ⚠️ NO PHOTOGRAPH, BECAUSE THERE IS NONE. `crm_properties` keeps no
                image; a stock picture of somebody else's plot on a record a
                salesperson quotes from is worse than a plain tile. */}
            <span className="grid size-14 shrink-0 place-items-center rounded-lg bg-bg-subtle text-text-tertiary">
              <Home className="size-6" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-body-sm font-semibold text-text-primary">{lead.propertyLabel}</p>
              <p className="truncate text-caption text-text-secondary">
                {lead.projectName}
                {lead.city ? ` · ${lead.city}` : ''}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onOpen('properties')}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-border-default px-2.5 py-1.5 text-caption font-medium text-text-primary transition-colors hover:bg-bg-subtle"
            >
              View details
              <ExternalLink className="size-3.5" aria-hidden="true" />
            </button>
          </div>
        ) : (
          <p className="px-3.5 py-3 text-caption leading-relaxed text-text-secondary">
            No unit attached. Choosing one is what lets a quotation name a plot and a price rather than a figure typed
            from memory.
          </p>
        )}
      </section>

      {/* ── The visit ──────────────────────────────────────────────────── */}
      <section className="flex flex-wrap items-center gap-3 rounded-xl border border-border-subtle bg-bg-surface px-3.5 py-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-bg-subtle text-text-secondary">
          <CalendarClock className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-body-sm font-semibold text-text-primary">
            {visit ? appointmentKindLabel(visit.kind) : 'Site visit not scheduled'}
          </p>
          <p className="truncate text-caption text-text-secondary">
            {visit
              ? `${new Date(visit.scheduledAt).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Karachi' })}${visit.location ? ` · ${visit.location}` : ''}`
              : 'Schedule a site visit to move this lead forward.'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onOpen('appointments')}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-border-default px-2.5 py-1.5 text-caption font-medium text-text-primary transition-colors hover:bg-bg-subtle"
        >
          <CalendarClock className="size-3.5" aria-hidden="true" />
          {visit ? 'View visit' : 'Schedule visit'}
        </button>
      </section>

      {/* ── The booking ────────────────────────────────────────────────────
          Owner, 2026-09-17: *"Also add View Booking, which is basically just
          booking the property. Book Property is when he sends payment and the
          property is reserved. When these two things are done, the property
          booking is done."*

          ⚠️ TWO FACTS, ONE ROW. The count is all the drawer carries (the bundle
          keeps rows out of the drawer's own load), so this says whether there is
          a booking and opens the tab that holds both halves. */}
      <section className="flex flex-wrap items-center gap-3 rounded-xl border border-border-subtle bg-bg-surface px-3.5 py-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-bg-subtle text-text-secondary">
          <ClipboardCheck className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-body-sm font-semibold text-text-primary">
            {related.counts.bookings > 0
              ? `${related.counts.bookings} booking${related.counts.bookings > 1 ? 's' : ''} on this lead`
              : 'Property not booked'}
          </p>
          <p className="truncate text-caption text-text-secondary">
            {related.counts.bookings > 0
              ? 'Payment evidence and the plot hold are in Bookings.'
              : 'Booking it sends the payment for verification and holds the plot.'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onOpen('bookings')}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-border-default px-2.5 py-1.5 text-caption font-medium text-text-primary transition-colors hover:bg-bg-subtle"
        >
          <ClipboardCheck className="size-3.5" aria-hidden="true" />
          {related.counts.bookings > 0 ? 'View booking' : 'Book property'}
        </button>
      </section>

      <button
        type="button"
        onClick={() => onOpen('quotations')}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border-default px-3 py-2.5 text-body-sm font-medium text-text-secondary transition-colors hover:bg-bg-subtle hover:text-text-primary"
      >
        <CirclePlus className="size-4" aria-hidden="true" />
        Open related items
      </button>
    </div>
  );
}

function Cell({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-caption text-text-secondary">{label}</p>
      <p className={cn('truncate text-body-sm', strong ? 'font-semibold text-text-primary' : 'text-text-primary')}>
        {value}
      </p>
    </div>
  );
}

/* ---- Small parts ---------------------------------------------------------- */

