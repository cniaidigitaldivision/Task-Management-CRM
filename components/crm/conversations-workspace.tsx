'use client';

import * as React from 'react';
import type { Route } from 'next';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  BellPlus,
  CalendarClock,
  ChevronRight,
  CircleAlert,
  FileText,
  Mail,
  MoreVertical,
  NotebookPen,
  Pencil,
  Phone,
  Search,
  UserRound,
  Video,
  WandSparkles,
  X,
} from 'lucide-react';

import { LeadConversationTab, useConversationSummary } from '@/components/crm/lead-conversation-tab';
import { LeadOverviewTab } from '@/components/crm/lead-overview-tab';
import { RecordOutcome } from '@/components/crm/record-outcome';
import { RelatedItemsDialog, seedRelated } from '@/components/crm/related-items';
import { EditLeadDetails } from '@/components/crm/edit-lead-details';
import { FollowUpWizard } from '@/components/crm/follow-up-wizard';
import { nextSteps } from '@/lib/domain/crm-next-step';
import { qualificationGaps } from '@/lib/domain/crm-qualification';
import { AgentBadge } from '@/components/crm/agent-mode';
import { agentStatesAction, setAgentModeAction } from '@/app/actions/crm-whatsapp';
import { useToast } from '@/components/ui/toast';
import { STAGE_ORDER, stageLabel as stageName } from '@/lib/domain/crm-stages';
import { MAIL_BLUE, WA_GREEN, WhatsAppMark } from '@/components/crm/whatsapp-mark';
import { leadBundlesAction } from '@/app/actions/crm-lead-bundles';
import type { AgentMode, AgentState, CrmConversation, CrmLeadBundle } from '@/lib/db/queries/crm-leads';
import { quotationStatusLabel, quotationStatusToken } from '@/lib/domain/crm-quotations';
import { stageToken } from '@/lib/domain/crm-stages';
import { relativeAge } from '@/lib/view/relative-age';
import { cn } from '@/lib/utils';

/* ============================================================================
 * CONVERSATIONS — the three panes
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-18, with a design: *"like WhatsApp on an app like that… I want
 * that instant thing."*
 *
 * ── ⚠️ WHY THE THREAD IS `LeadConversationTab` AND NOT A NEW COMPONENT ──────
 * That component already carries everything a real conversation needs: the
 * WhatsApp bubble layout, the 24-hour window and its template route, reply and
 * reaction, voice notes, attachments, saved replies, the email composer, and the
 * five-second poll that makes a client's reply appear without a refresh. Writing
 * a second one to match a screenshot would mean a second place for every one of
 * those rules to drift — and the drawer and this page would slowly disagree
 * about what a message is.
 *
 * So this file is the CHROME the design asks for — the list, the header, the
 * context rail — around the thread that already works.
 *
 * ── ⚠️ AND NOTHING HERE WAITS ──────────────────────────────────────────────
 * Every conversation's messages are already in `bundles` before a name is
 * clicked: the server sent the first nine, and the effect below fetches the rest
 * in the background. Switching is `setState` over memory — no query, no server
 * render, no spinner. The URL is updated behind the change (law 2), so a refresh
 * and the back button still work without ever gating the click.
 * ========================================================================= */

type Channel = 'whatsapp' | 'email' | null;

export function ConversationsWorkspace({
  conversations,
  bundles: seeded,
  openLeadId,
  channel,
  search,
  viewerName,
  nowMs,
}: {
  conversations: readonly CrmConversation[];
  bundles: Record<string, CrmLeadBundle>;
  openLeadId: string | null;
  channel: Channel;
  search: string;
  viewerName: string;
  nowMs: number;
}) {
  const router = useRouter();
  const urlParams = useSearchParams();
  const [, startTransition] = React.useTransition();
  const toast = useToast();

  /* ── WHO WRITES THE REPLY, per lead (212) ─────────────────────────────────
     ⚠️ CHANGED IN THE CLICK'S OWN FRAME, confirmed underneath (Rule Zero, law 1).
     The rows carry the server's answer; this holds what somebody chose since, and
     is dropped for a lead the moment the server's own row agrees — or put back
     if the server refused. */
  const [chosen, setChosen] = React.useState<Record<string, AgentMode>>({});

  /* ── ⚠️ WHO IS ANSWERING, KEPT LIVE (2026-09-22) ──────────────────────────
     Owner: *"while the agent has handed over to the salesperson … on the UI it
     is showing that AI is responding. When I refresh … I can see that the AI
     has stopped."* The thread already polls for messages; nothing polled for
     the MODE, so a handover the webhook made never reached an open screen.

     ⚠️ THE SERVER WINS, EXCEPT WHILE A CHOICE IS IN FLIGHT. `chosen` is what
     somebody just picked and is the truth until their write lands; after that
     this poll is the truth, so an agent that hands itself over changes the
     badge within five seconds without a refresh. */
  const [live, setLive] = React.useState<Record<string, AgentState>>({});
  const pending = React.useRef<Set<string>>(new Set());
  const leadKey = conversations.map((c) => c.leadId).join(',');

  React.useEffect(() => {
    if (!leadKey) return;
    let alive = true;
    const ids = leadKey.split(',');
    const read = async () => {
      if (document.visibilityState !== 'visible') return;
      const states = await agentStatesAction(ids).catch(() => []);
      if (!alive || states.length === 0) return;
      setLive(Object.fromEntries(states.map((st) => [st.leadId, st])));
      /* A choice the server has caught up with stops being an override. */
      setChosen((held) => {
        const next = { ...held };
        let touched = false;
        for (const st of states) {
          if (pending.current.has(st.leadId)) continue;
          if (next[st.leadId] !== undefined) {
            delete next[st.leadId];
            touched = true;
          }
        }
        return touched ? next : held;
      });
    };
    void read();
    const t = window.setInterval(read, 5_000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [leadKey]);
  const [seenRows, setSeenRows] = React.useState(conversations);
  if (seenRows !== conversations) {
    setSeenRows(conversations);
    setChosen((held) => {
      const next = { ...held };
      for (const c of conversations) if (next[c.leadId] === c.agentMode) delete next[c.leadId];
      return next;
    });
  }
  const rows = React.useMemo(
    () =>
      conversations.map((c) => {
        /* The poll's answer, then anything chosen since — in that order. */
        const st = live[c.leadId];
        const base = st
          ? { ...c, agentMode: st.agentMode, handoffAt: st.handoffAt, handoffReason: st.handoffReason }
          : c;
        return chosen[c.leadId] === undefined
          ? base
          : {
              ...base,
              agentMode: chosen[c.leadId],
              /* Choosing any mode by hand answers the handoff (212). */
              handoffAt: null,
              handoffReason: null,
            };
      }),
    [conversations, chosen, live],
  );

  const setMode = (leadId: string, next: AgentMode) => {
    const before = rows.find((r) => r.leadId === leadId)?.agentMode ?? 'off';
    setChosen((held) => ({ ...held, [leadId]: next }));
    /* ⚠️ THE POLL MUST NOT UNDO A CHOICE MID-FLIGHT. Marked until the write
       lands; after that the server's answer is the one that counts. */
    pending.current.add(leadId);
    void setAgentModeAction(leadId, next)
      .then((r) => {
        if (r.ok) {
          /* Believe it at once, so the badge does not wait for the next beat. */
          setLive((held) => ({
            ...held,
            [leadId]: { leadId, agentMode: next, handoffAt: null, handoffReason: null },
          }));
          return;
        }
        setChosen((held) => ({ ...held, [leadId]: before }));
        toast({ tone: 'error', text: r.error ?? 'That did not save.' });
      })
      .finally(() => pending.current.delete(leadId));
  };

  /* ── ⚠️ THE URL RECORDS WHAT IS OPEN; IT DOES NOT DECIDE WHEN IT OPENS ────
     Law 2, and the same shape `use-panel.ts` documents. Plain state here would
     be a back-button bug: Back changes the address and state does not rewind. */
  const urlLead = urlParams.get('lead') ?? openLeadId;
  const [wish, setWish] = React.useState<string | null | undefined>(undefined);
  if (wish !== undefined && wish === urlLead) setWish(undefined);
  const activeId = wish === undefined ? urlLead : wish;

  const open = (leadId: string) => {
    setWish(leadId); /* this frame */
    const next = new URLSearchParams(urlParams.toString());
    next.set('lead', leadId);
    /* ⚠️ `replace`, not `push`: twenty names clicked while reading one list
       should not be twenty entries to press Back through. */
    startTransition(() => router.replace(`/conversations?${next}` as Route, { scroll: false }));
  };

  /* ── Everything already fetched, plus whatever the background brings ────── */
  const [bundles, setBundles] = React.useState(seeded);
  /* ⚠️ STATE, NOT A REF, to notice a new server render. React's own
     "adjusting state when a prop changes" pattern — a ref read during render is
     what `react-hooks/refs` refuses, and it has caught me three times today. A
     fresh render (a filter change, a save) is newer than what we hold, so its
     bundles win. */
  const [seenSeed, setSeenSeed] = React.useState(seeded);
  if (seenSeed !== seeded) {
    setSeenSeed(seeded);
    setBundles((held) => ({ ...held, ...seeded }));
  }

  React.useEffect(() => {
    const missing = conversations.map((c) => c.leadId).filter((id) => !bundles[id]);
    if (missing.length === 0) return;
    let alive = true;
    /* ⚠️ IN THE BACKGROUND, AND IT NEVER BLOCKS A CLICK. A conversation whose
       bundle has not landed yet still opens — on what the list row knows — and
       fills in underneath. */
    void leadBundlesAction(missing.slice(0, 40)).then((result) => {
      if (alive && Object.keys(result.bundles).length > 0) {
        setBundles((held) => ({ ...result.bundles, ...held }));
      }
    });
    return () => {
      alive = false;
    };
    /* eslint-disable-next-line react-hooks/exhaustive-deps -- by id list, not by
       the bundles object, which this effect itself replaces. */
  }, [conversations]);

  const active = activeId ? rows.find((c) => c.leadId === activeId) ?? null : null;
  const bundle = activeId ? bundles[activeId] ?? null : null;

  /* ── ⚠️ EVERYTHING OPENS HERE, NOTHING NAVIGATES ──────────────────────────
     Owner, 2026-09-18: *"anything that I click, like View Lead Details, should
     either expand here or show a modal here. It should not bring me to some lead
     page or a drawer."*

     So the quick links and the context rail no longer carry `<Link href>`. They
     set one of these, and the panel opens over this page — the same components
     the drawer uses, so nothing about what they do or what they are allowed to
     write changes. */
  const [panel, setPanel] = React.useState<null | PanelKey>(null);
  const [relatedTab, setRelatedTab] =
    React.useState<'quotations' | 'properties' | 'appointments' | 'bookings' | 'invoices' | 'files'>('quotations');
  /* The stage the dropdown was set to — Record outcome opens on it (155). */
  const [outcomeStage, setOutcomeStage] = React.useState<string | null>(null);

  /* ⚠️ CLOSED WHEN THE CONVERSATION CHANGES. A panel left open over a different
     lead would be showing one person's record beside another's thread. */
  const [panelFor, setPanelFor] = React.useState<string | null>(activeId);
  if (panelFor !== activeId) {
    setPanelFor(activeId);
    if (panel) setPanel(null);
    if (outcomeStage) setOutcomeStage(null);
  }

  /* ── The filters write the URL, because they change what the SERVER lists ── */
  const setChannel = (next: Channel) => {
    const params = new URLSearchParams(urlParams.toString());
    if (next) params.set('channel', next);
    else params.delete('channel');
    params.delete('lead');
    startTransition(() => router.replace(`/conversations?${params}` as Route, { scroll: false }));
  };

  const [typed, setTyped] = React.useState(search);
  /* ⚠️ ADJUSTED DURING RENDER, NOT IN AN EFFECT — the same rule as the seed
     above. An effect that calls setState to mirror a prop renders twice and
     `react-hooks/set-state-in-effect` refuses it. */
  const [seenSearch, setSeenSearch] = React.useState(search);
  if (seenSearch !== search) {
    setSeenSearch(search);
    setTyped(search);
  }

  React.useEffect(() => {
    if (typed === search) return;
    const t = window.setTimeout(() => {
      const params = new URLSearchParams(urlParams.toString());
      if (typed.trim()) params.set('q', typed.trim());
      else params.delete('q');
      params.delete('lead');
      startTransition(() => router.replace(`/conversations?${params}` as Route, { scroll: false }));
    }, 250);
    return () => window.clearTimeout(t);
    /* eslint-disable-next-line react-hooks/exhaustive-deps -- debounced on the text alone. */
  }, [typed]);

  return (
    /* ⚠️ NO PADDING OF ITS OWN, AND FULL HEIGHT. Owner, 2026-09-18: *"the padding
       on the right side is a little different from other pages… I want it to
       display fully from the top down."* The shell's own `<main>` already pads
       every page (`px-4 py-4 sm:px-6 sm:py-4`), so the `p-6` this had was a
       SECOND gutter on top of it — which is exactly the difference they saw. And
       the height now subtracts the real topbar and that padding rather than a
       `--app-header-h` variable which does not exist, so the three panes reach
       the bottom of the window instead of stopping short.

       ⚠️⚠️ AND `100dvh` IS DIVIDED BY THE SCALE, OR IT STOPS 10% SHORT. Owner,
       2026-09-19, with a screenshot: *"increase the height… to the height of this
       whole screen."* `body` carries `zoom: 0.9` (`--ui-scale`), and a height
       computed from the window is then DRAWN at 90% like everything else inside
       it — so "the full window" painted as 821px of a 912px window. Measured,
       not reasoned: at windows of 912, 1014 and 760px the old rule's bottom edge
       landed at 821, 913 and 684; dividing by the scale lands it at 912, 1014
       and 760, exactly. (The body itself MULTIPLIES by the scale — see
       `app/layout.tsx` — because a length declared ON the zoomed element behaves
       the other way round. Same zoom, opposite correction, and both measured.) */
    /* ⚠️ …AND TWO PIXELS LESS. At the 0.9 scale the calc lands a fraction of a
       pixel past the window, which rounds up to one — and a one-pixel page gives
       the whole window a scrollbar that scrolls nothing. Owner, 2026-09-21:
       *"you have added the scrollbar but the scrollbar will not scroll the lead
       content."* Measured: page 640 in a 639 window. */
    <div className="-mx-4 -my-4 flex h-[calc(100dvh/var(--ui-scale)-var(--topbar-height)-2px)] min-h-0 flex-col gap-3 px-4 py-4 sm:-mx-6 sm:-my-4 sm:px-6">
      <Header channel={channel} onChannel={setChannel} total={conversations.length} />

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] xl:grid-cols-[minmax(0,21rem)_minmax(0,1fr)_minmax(0,19rem)]">
        <ListPane
          conversations={rows}
          activeId={activeId}
          onOpen={open}
          typed={typed}
          onTyped={setTyped}
          nowMs={nowMs}
        />

        <ThreadPane
          conversation={active}
          bundle={bundle}
          viewerName={viewerName}
          onAgentMode={(next) => active && setMode(active.leadId, next)}
          onOpenDetails={() => setPanel('details')}
          onOpenFollowUps={() => setPanel('details')}
        />

        <ContextPane
          conversation={active}
          bundle={bundle}
          onStage={(next) => setOutcomeStage(next)}
          onOpen={(which, tab) => {
            if (tab) setRelatedTab(tab);
            setPanel(which);
          }}
        />
      </div>

      {/* ── The panels, over this page ─────────────────────────────────── */}
      {panel === 'details' && active && bundle && (
        <RecordPanel
          title={active.fullName ?? 'Lead details'}
          subtitle={[active.projectName, active.city].filter(Boolean).join(' · ')}
          onClose={() => setPanel(null)}
          onEdit={() => setPanel('edit')}
        >
          <LeadOverviewTab
            loading={false}
            lead={bundle.record.lead}
            notes={bundle.record.notes}
            activity={bundle.record.activity}
            related={bundle.related}
            phone={active.phoneE164 ?? ''}
            viewerName={viewerName}
            /* ⚠️ ITS TABS BECOME THIS PAGE'S PANELS. The overview offers the
               drawer's other tabs; here "conversations" is the screen behind this
               panel, and the rest open the follow-ups the same way. */
            onTab={(tab) => {
              if (tab === 'conversations') setPanel(null);
              else if (tab === 'related') setPanel('related');
              else setPanel('details');
            }}
            nowMs={nowMs}
            lastDirection={active.lastDirection}
          />
        </RecordPanel>
      )}

      {panel === 'related' && active && bundle && (
        <RelatedItemsDialog
          lead={bundle.record.lead}
          sender={bundle.related.sender}
          seed={seedRelated(bundle.record.lead, bundle.related)}
          initialTab={relatedTab}
          onAttach={() => setPanel(null)}
          onClose={() => setPanel(null)}
          onChooseUnit={() => setPanel(null)}
          onRecordOutcome={() => {
            setPanel(null);
            setOutcomeStage(bundle.record.lead.stage);
          }}
        />
      )}

      {panel === 'followup' && active && bundle && (
        <FollowUpWizard
          lead={bundle.record.lead}
          related={bundle.related}
          viewerName={viewerName}
          nowMs={nowMs}
          onClose={() => setPanel(null)}
          onCreated={() => {
            const leadId = active.leadId;
            setPanel(null);
            /* The rail's "Next follow-up" is read from this lead's record — read
               it again underneath; the fresh copy wins over the one held. */
            void leadBundlesAction([leadId]).then((r) => setBundles((held) => ({ ...held, ...r.bundles })));
          }}
        />
      )}

      {panel === 'edit' && active && bundle && (
        <EditLeadDetails lead={bundle.record.lead} onClose={() => setPanel('details')} />
      )}

      {/* ⚠️ THE SAME RECORD OUTCOME MODAL AS EVERYWHERE ELSE. The owner's rule of
          2026-09-17: every stage change asks what happened, on whichever screen
          the change was made. */}
      {outcomeStage && active && (
        <RecordOutcome
          leadId={active.leadId}
          leadName={active.fullName ?? 'this lead'}
          currentStage={bundle?.record.lead.stage ?? active.stage}
          proposedStage={outcomeStage}
          onClose={() => setOutcomeStage(null)}
        />
      )}
    </div>
  );
}

/**
 * A full-height panel over the page.
 *
 * ⚠️ NOT A ROUTE, AND NOT THE DRAWER. It renders the same components the drawer
 * does, so there is one definition of what a lead's overview is — but it opens
 * here, which is the whole of the owner's request.
 */
export function RecordPanel({
  title,
  subtitle,
  onClose,
  onEdit,
  children,
}: {
  title: string;
  subtitle: string;
  onClose: () => void;
  onEdit: () => void;
  children: React.ReactNode;
}) {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={onClose}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="flex h-[min(46rem,92vh)] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-border-subtle bg-bg-surface shadow-2xl"
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-border-subtle px-5 py-4">
          <Avatar name={title} />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-body font-semibold text-text-primary">{title}</h2>
            <p className="truncate text-caption text-text-secondary">{subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onEdit}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border-default px-3 py-1.5 text-caption font-medium text-text-primary transition-colors hover:bg-bg-subtle"
          >
            <Pencil className="size-3.5" aria-hidden="true" />
            Edit details
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid size-8 shrink-0 place-items-center rounded-lg text-text-secondary transition-colors hover:bg-bg-subtle hover:text-text-primary"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

/* ── The page's own head ─────────────────────────────────────────────────── */

function Header({
  channel,
  onChannel,
  total,
}: {
  channel: Channel;
  onChannel: (next: Channel) => void;
  total: number;
}) {
  return (
    <header className="shrink-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-h1 font-semibold text-text-primary">Conversations</h1>
          <p className="text-body-sm text-text-secondary">
            Chat and email with your leads — all in one place.
          </p>
        </div>
        <p className="shrink-0 text-right text-caption text-text-secondary">
          {new Date().toLocaleDateString('en-GB', {
            weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Karachi',
          })}
          <span className="block">Asia/Karachi</span>
        </p>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="rounded-xl border border-border-default bg-bg-surface px-3.5 py-2 text-body-sm font-medium text-text-primary">
          All my leads ({total})
        </span>
        <Chip active={channel === null} onClick={() => onChannel(null)}>
          All channels
        </Chip>
        <Chip active={channel === 'whatsapp'} onClick={() => onChannel('whatsapp')}>
          <span style={{ color: channel === 'whatsapp' ? '#ffffff' : WA_GREEN }}>
            <WhatsAppMark className="size-4" />
          </span>
          WhatsApp
        </Chip>
        <Chip active={channel === 'email'} onClick={() => onChannel('email')}>
          <Mail
            className="size-4"
            style={{ color: channel === 'email' ? '#ffffff' : MAIL_BLUE }}
            aria-hidden="true"
          />
          Email
        </Chip>
      </div>
    </header>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex items-center gap-2 rounded-xl border px-3.5 py-2 text-body-sm font-medium transition-colors',
        active
          ? 'border-accent-primary bg-accent-primary text-white'
          : 'border-border-default bg-bg-surface text-text-primary hover:bg-bg-subtle',
      )}
    >
      {children}
    </button>
  );
}

/** A filter chip in the list, smaller than the page's own. */
function ListChip({
  on,
  onClick,
  dot,
  count,
  children,
}: {
  on: boolean;
  onClick: () => void;
  dot?: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={on}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-caption font-medium transition-colors',
        on
          ? 'border-accent-primary bg-accent-primary text-white'
          : 'border-border-default bg-bg-surface text-text-primary hover:bg-bg-subtle',
      )}
    >
      {dot && <span className="size-2 rounded-full" style={{ background: dot }} aria-hidden="true" />}
      {children}
      {count !== undefined && count > 0 && (
        <span className={cn('tabular-nums', on ? 'text-white/80' : 'text-text-secondary')}>{count}</span>
      )}
    </button>
  );
}

/* ── 1 · The list ────────────────────────────────────────────────────────── */

function ListPane({
  conversations,
  activeId,
  onOpen,
  typed,
  onTyped,
  nowMs,
}: {
  conversations: readonly CrmConversation[];
  activeId: string | null;
  onOpen: (id: string) => void;
  typed: string;
  onTyped: (v: string) => void;
  nowMs: number;
}) {
  /* ⚠️ ALL · AI HANDOFF · AI RESPONDING — the owner's screenshot, filtered
     on the rows already here. A server round trip to narrow a list the page is
     holding would be law 3 broken for nothing. */
  const [only, setOnly] = React.useState<'all' | 'handoff' | 'agent'>('all');
  const handoffs = conversations.filter((c) => c.handoffAt !== null).length;
  const responding = conversations.filter((c) => c.agentMode === 'agent' && c.handoffAt === null).length;
  const shown =
    only === 'handoff'
      ? conversations.filter((c) => c.handoffAt !== null)
      : only === 'agent'
        ? conversations.filter((c) => c.agentMode === 'agent' && c.handoffAt === null)
        : conversations;

  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-border-subtle bg-bg-surface">
      <div className="shrink-0 space-y-2.5 border-b border-border-subtle p-3">
        <div role="tablist" aria-label="Filter by assistant" className="flex flex-wrap gap-1.5">
          <ListChip on={only === 'all'} onClick={() => setOnly('all')}>
            All
          </ListChip>
          <ListChip on={only === 'handoff'} onClick={() => setOnly('handoff')} dot="var(--feedback-error)" count={handoffs}>
            AI handoff
          </ListChip>
          <ListChip on={only === 'agent'} onClick={() => setOnly('agent')} dot="var(--feedback-success)" count={responding}>
            AI responding
          </ListChip>
        </div>
        <label className="flex items-center gap-2 rounded-xl border border-border-default bg-bg-base px-3 py-2">
          <Search className="size-4 shrink-0 text-text-secondary" aria-hidden="true" />
          <input
            value={typed}
            onChange={(e) => onTyped(e.target.value)}
            placeholder="Search conversations…"
            aria-label="Search conversations"
            className="min-w-0 flex-1 bg-transparent text-body-sm text-text-primary placeholder:text-text-tertiary focus:outline-none"
          />
        </label>
      </div>

      {shown.length === 0 ? (
        <p className="flex flex-1 items-center justify-center px-6 py-10 text-center text-caption text-text-secondary">
          {only === 'handoff'
            ? 'Nothing is waiting on you. When the assistant stops and asks for a person, the conversation appears here.'
            : only === 'agent'
              ? 'The assistant is not answering any conversation.'
              : 'No conversations yet. A thread appears here the moment you or the client sends something.'}
        </p>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {shown.map((c) => (
            <li key={c.leadId}>
              <button
                type="button"
                onClick={() => onOpen(c.leadId)}
                aria-current={c.leadId === activeId}
                className={cn(
                  'relative flex w-full items-start gap-3 border-b border-border-subtle px-3.5 py-3 text-left transition-colors',
                  c.leadId === activeId ? 'bg-[var(--pick-bg)]' : 'hover:bg-bg-subtle',
                )}
              >
                {/* The bar the design puts against the open row. */}
                {c.leadId === activeId && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-y-0 left-0 w-[3px] rounded-r-full bg-accent-primary"
                  />
                )}
                <Avatar name={c.fullName} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className="min-w-0 flex-1 truncate text-body-sm font-semibold text-text-primary">
                      {c.fullName ?? 'Unnamed lead'}
                    </span>
                    <span className="shrink-0 text-caption text-text-secondary">
                      {c.lastAt ? relativeAge(c.lastAt, nowMs) : ''}
                    </span>
                  </span>
                  <span className="block truncate text-caption text-text-secondary">
                    {[c.projectName, c.city].filter(Boolean).join(' · ')}
                  </span>
                  <span className="mt-0.5 flex items-center gap-1.5">
                    <span
                      className={cn(
                        'min-w-0 flex-1 truncate text-caption',
                        /* ⚠️ THEIR MESSAGE READS LOUDER THAN OURS, because a
                           reply nobody has answered is the only row on this list
                           that is actually owed something. */
                        c.awaitingReply ? 'font-medium text-text-primary' : 'text-text-secondary',
                      )}
                    >
                      {c.lastBody?.trim() || (c.lastChannel === 'email' ? 'Email sent' : 'Attachment')}
                    </span>
                    <ChannelMark channel={c.lastChannel} />
                  </span>
                  {(c.handoffAt || c.agentMode !== 'off') && (
                    <span className="mt-1 block">
                      <AgentBadge mode={c.agentMode} handoffAt={c.handoffAt} />
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ChannelMark({ channel }: { channel: 'whatsapp' | 'email' | null }) {
  if (channel === 'email') {
    return <Mail className="size-4 shrink-0" style={{ color: MAIL_BLUE }} aria-label="Email" />;
  }
  return (
    <span className="shrink-0" style={{ color: WA_GREEN }} aria-label="WhatsApp">
      <WhatsAppMark className="size-4" />
    </span>
  );
}

function Avatar({ name, size = 'md' }: { name: string | null; size?: 'md' | 'lg' }) {
  const initials =
    (name ?? '?')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join('') || '?';
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid shrink-0 place-items-center rounded-full bg-bg-subtle font-semibold text-text-secondary',
        size === 'lg' ? 'size-12 text-body' : 'size-10 text-caption',
      )}
    >
      {initials}
    </span>
  );
}

/* ── 2 · The thread ──────────────────────────────────────────────────────── */

function ThreadPane({
  conversation,
  bundle,
  viewerName,
  onOpenDetails,
  onOpenFollowUps,
  onAgentMode,
}: {
  conversation: CrmConversation | null;
  bundle: CrmLeadBundle | null;
  viewerName: string;
  onOpenDetails: () => void;
  onOpenFollowUps: () => void;
  onAgentMode: (next: AgentMode) => void;
}) {
  if (!conversation) {
    return (
      <section className="hidden min-h-0 flex-col items-center justify-center rounded-2xl border border-border-subtle bg-bg-surface p-10 text-center lg:flex">
        <p className="text-body-sm font-medium text-text-primary">Pick a conversation</p>
        <p className="mt-1 max-w-xs text-caption text-text-secondary">
          Everything you and your leads have said, on WhatsApp and by email, in one thread each.
        </p>
      </section>
    );
  }

  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-border-subtle bg-bg-surface">
      <header className="flex shrink-0 items-center gap-3 border-b border-border-subtle px-4 py-3">
        <Avatar name={conversation.fullName} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-body font-semibold text-text-primary">
            {conversation.fullName ?? 'Unnamed lead'}
          </p>
          <p className="truncate text-caption text-text-secondary">
            {[conversation.projectName, conversation.city].filter(Boolean).join(' · ')}
          </p>
        </div>
        {/* ⚠️ A WHATSAPP CALL, NOT A PHONE CALL — the owner's rule of 2026-09-17:
            a salesperson calls from the business number, never their own handset,
            so the record survives them leaving. */}
        <HeaderAction
          href={conversation.phoneE164 ? `https://wa.me/${conversation.phoneE164.replace(/\D/g, '')}` : null}
          label="WhatsApp call"
        >
          <Phone className="size-4" aria-hidden="true" />
        </HeaderAction>
        <HeaderAction
          href={conversation.phoneE164 ? `https://wa.me/${conversation.phoneE164.replace(/\D/g, '')}` : null}
          label="WhatsApp video call"
        >
          <Video className="size-4" aria-hidden="true" />
        </HeaderAction>
        {/* ⚠️ OPENS HERE. It used to link to the drawer on another page, which is
            exactly what the owner asked to stop happening. */}
        <HeaderAction onClick={onOpenDetails} label="Open the full record">
          <MoreVertical className="size-4" aria-hidden="true" />
        </HeaderAction>
      </header>

      {/* ⚠️ A HANDOFF IS THE LOUDEST THING ON THE SCREEN, and it says WHAT. A
          client asked something the assistant would not answer and is waiting on
          a person — "needs your attention" would make somebody re-read the thread
          to find out why. Replying clears it (212). */}
      {conversation.handoffAt && (
        <div
          role="alert"
          className="flex shrink-0 items-start gap-2.5 border-b px-4 py-2.5"
          style={{
            borderColor: 'color-mix(in oklab, var(--feedback-error) 25%, transparent)',
            background: 'color-mix(in oklab, var(--feedback-error) 8%, var(--bg-surface))',
          }}
        >
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-feedback-error" aria-hidden="true" />
          <p className="min-w-0 flex-1 text-body-sm text-text-primary">
            <span className="font-semibold">The assistant needs you</span>
            {' — '}
            {conversation.handoffReason ?? 'it stopped and is waiting for a person'}.
            <span className="block text-caption text-text-secondary">Reply below and the conversation stays with you.</span>
          </p>
        </div>
      )}

      {/* ⚠️ THE THREAD THAT ALREADY WORKS — see this file's header. While a
          bundle is still on its way the tab is told `loading`, so it says so
          rather than claiming the conversation is empty (law 3). */}
      <div className="flex min-h-0 flex-1 flex-col px-4 pb-4 pt-3">
        <ThreadBody
          key={conversation.leadId}
          conversation={conversation}
          bundle={bundle}
          viewerName={viewerName}
          onOpenFollowUps={onOpenFollowUps}
          onAgentMode={onAgentMode}
        />
      </div>
    </section>
  );
}

function HeaderAction({
  href,
  onClick,
  label,
  children,
}: {
  href?: string | null;
  onClick?: () => void;
  label: string;
  children: React.ReactNode;
}) {
  const className =
    'grid size-9 shrink-0 place-items-center rounded-xl border border-border-default text-text-secondary transition-colors hover:bg-bg-subtle hover:text-text-primary';
  if (onClick) {
    return (
      <button type="button" onClick={onClick} aria-label={label} title={label} className={className}>
        {children}
      </button>
    );
  }
  if (!href) {
    return (
      <span
        role="img"
        aria-label={`${label} — not available`}
        title={`${label} — this lead has no number`}
        className={cn(className, 'cursor-not-allowed border-dashed opacity-50')}
      >
        {children}
      </span>
    );
  }
  if (href.startsWith('http')) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" aria-label={label} title={label} className={className}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href as Route} aria-label={label} title={label} className={className}>
      {children}
    </Link>
  );
}

/**
 * The thread itself.
 *
 * ⚠️ ITS OWN COMPONENT BECAUSE OF THE SUMMARY HOOK. `useConversationSummary` is
 * a hook, and hooks cannot be called after an early return — mounting it here,
 * keyed by lead, also means switching conversation resets the composer rather
 * than carrying one lead's half-typed message to another.
 */
function ThreadBody({
  conversation,
  bundle,
  viewerName,
  onOpenFollowUps,
  onAgentMode,
}: {
  conversation: CrmConversation;
  bundle: CrmLeadBundle | null;
  viewerName: string;
  onOpenFollowUps: () => void;
  onAgentMode: (next: AgentMode) => void;
}) {
  const messages = bundle?.messages ?? [];
  const notes = bundle?.record?.notes ?? [];
  const related = bundle?.related ?? null;

  const summary = useConversationSummary({
    leadId: conversation.leadId,
    messages,
    noteCount: notes.length,
    stored: related?.summary ?? null,
    loading: !bundle,
    eager: true,
  });

  return (
    <LeadConversationTab
      leadId={conversation.leadId}
      messages={messages}
      notes={notes}
      summary={summary}
      loading={!bundle}
      sender={related?.sender ?? null}
      sequencePaused={
        related?.sequence?.state === 'paused'
          ? (related.sequence.pauseReason ?? 'the client replied')
          : null
      }
      leadName={conversation.fullName ?? 'This lead'}
      leadEmail={conversation.email}
      viewerName={viewerName}
      projectName={conversation.projectName ?? ''}
      onReviewFollowUp={onOpenFollowUps}
      agentMode={conversation.agentMode}
      onAgentMode={onAgentMode}
    />
  );
}

/* ── 3 · The lead's context ──────────────────────────────────────────────── */

/* 'followup' — the SAME wizard the lead drawer and the Appointments page open
   (owner, 2026-09-21: *"Also add that follow-up modal over here."*). */
type PanelKey = 'details' | 'related' | 'edit' | 'followup';
type RelatedTab = 'quotations' | 'properties' | 'appointments' | 'bookings' | 'invoices' | 'files';

function ContextPane({
  conversation,
  bundle,
  onStage,
  onOpen,
}: {
  conversation: CrmConversation | null;
  bundle: CrmLeadBundle | null;
  onStage: (next: string) => void;
  onOpen: (which: PanelKey, tab?: RelatedTab) => void;
}) {
  if (!conversation) return <aside className="hidden xl:block" />;

  /* ⚠️ `record` is the whole bundle (notes, activity, siblings); the lead's
     own columns are on `record.lead`. */
  const lead = bundle?.record?.lead ?? null;
  const related = bundle?.related ?? null;
  const quote =
    related?.quotations.find((q) => !['superseded', 'rejected', 'expired'].includes(q.status)) ??
    related?.quotations[0] ??
    null;
  const nextFollowUp =
    related?.followUps
      ?.filter((f) => f.status === 'planned' || f.status === 'due')
      .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt))[0] ?? null;

  /* ⚠️ WHEN NOTHING IS SCHEDULED, SAY WHAT TO DO — the same suggestion the
     Overview card makes, from the same function, so the two panels cannot give a
     salesperson two different answers about one lead. */
  const suggestion =
    bundle && !nextFollowUp
      ? nextSteps({
          stage: bundle.record.lead.stage,
          lastDirection: conversation?.lastDirection ?? null,
          planned: Boolean(bundle.record.lead.nextAction),
          qualificationGaps: qualificationGaps(bundle.record.lead).length,
          hasQuotation: (related?.quotations.length ?? 0) > 0,
        })[0] ?? null
      : null;

  return (
    /* ⚠️ THE HEADING STAYS; ONLY WHAT IS UNDER IT SCROLLS. Owner, 2026-09-21:
       *"The heading should be added from below"* — the scrollbar starts below
       "Lead context", and the content scrolls inside it. */
    <aside className="hidden min-h-0 flex-col overflow-hidden rounded-2xl border border-border-subtle bg-bg-surface xl:flex">
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border-subtle px-4 py-3">
        <h2 className="text-body-sm font-semibold text-text-primary">Lead context</h2>
        <button
          type="button"
          onClick={() => onOpen('details')}
          className="inline-flex items-center gap-1 text-caption font-medium text-accent-primary hover:underline"
        >
          View details
          <ChevronRight className="size-3.5" aria-hidden="true" />
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        <div className="flex items-start gap-3">
          <Avatar name={conversation.fullName} size="lg" />
          <div className="min-w-0">
            <p className="truncate text-body font-semibold text-text-primary">
              {conversation.fullName ?? 'Unnamed lead'}
            </p>
            <p className="truncate text-caption text-text-secondary">{conversation.projectName}</p>
            {conversation.city && (
              <p className="truncate text-caption text-text-secondary">{conversation.city}</p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Reach
            href={conversation.phoneE164 ? `https://wa.me/${conversation.phoneE164.replace(/\D/g, '')}` : null}
            label="WhatsApp"
            tint={WA_GREEN}
          >
            <WhatsAppMark className="size-4" />
          </Reach>
          <Reach
            href={conversation.email ? `mailto:${conversation.email}` : null}
            label="Email"
            tint={MAIL_BLUE}
          >
            <Mail className="size-4" aria-hidden="true" />
          </Reach>
        </div>

        {/* ⚠️ A REAL DROPDOWN, AND IT ASKS WHAT HAPPENED. Owner, 2026-09-18:
            *"there is also a stage dropdown and that will be a dropdown when I
            click… the outcome modal will again be the same modal."* Changing it
            here opens `RecordOutcome`, exactly as the drawer does — the stage is
            never written straight from a select (155).
            ⚠️ `lost` is absent: it needs a reason (111's constraint), so offering
            it would produce a refusal rather than a change. */}
        <Row label="Stage">
          <select
            value={lead?.stage ?? conversation.stage}
            disabled={!bundle}
            onChange={(e) => onStage(e.target.value)}
            aria-label="Stage"
            className="w-full rounded-md border-0 px-2 py-1 text-caption font-medium focus:outline-none disabled:opacity-60"
            style={{
              backgroundColor: `color-mix(in oklab, var(--${stageToken(lead?.stage ?? conversation.stage)}) 14%, transparent)`,
              color: `var(--${stageToken(lead?.stage ?? conversation.stage)})`,
            }}
          >
            {STAGE_ORDER.map((v) => (
              <option key={v} value={v}>
                {stageName(v)}
              </option>
            ))}
          </select>
        </Row>

        <Row label="Quotation">
          {quote ? (
            <>
              <span className="block font-semibold text-accent-primary">{quote.number}</span>
              <span className="block tabular-nums text-text-primary">
                PKR {quote.netAmount.toLocaleString('en-PK')}
              </span>
              {quote.propertyLabel && (
                <span className="block text-text-secondary">{quote.propertyLabel}</span>
              )}
              <span
                className="mt-0.5 inline-block rounded-md px-1.5 py-0.5 text-caption font-medium"
                style={{
                  color: `var(--${quotationStatusToken(quote.status)})`,
                  background: `color-mix(in oklab, var(--${quotationStatusToken(quote.status)}) 12%, transparent)`,
                }}
              >
                {quotationStatusLabel(quote.status)}
              </span>
            </>
          ) : (
            <span className="text-text-secondary">{bundle ? 'None raised yet' : 'Loading…'}</span>
          )}
        </Row>

        <Row label="Next follow-up">
          {nextFollowUp ? (
            <>
              <span className="block text-text-primary">
                {new Date(nextFollowUp.dueAt).toLocaleString('en-GB', {
                  weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
                  hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Karachi',
                })}
              </span>
              <span className="block text-text-secondary">{nextFollowUp.title}</span>
            </>
          ) : suggestion ? (
            <>
              <span className="block text-text-secondary">Nothing scheduled</span>
              <span className="mt-0.5 flex items-start gap-1 font-medium text-accent-primary">
                <WandSparkles className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                {suggestion.title}
              </span>
            </>
          ) : (
            <span className="text-text-secondary">{bundle ? 'Nothing planned' : 'Loading…'}</span>
          )}
          <button
            type="button"
            onClick={() => onOpen('followup')}
            disabled={!bundle}
            className="mt-1 inline-flex items-center gap-1 font-semibold text-accent-primary hover:underline disabled:opacity-50"
          >
            <BellPlus className="size-3.5" aria-hidden="true" /> Schedule follow-up
          </button>
        </Row>

        {related?.sequence && (
          <Row label="Follow-up status">
            <span className="text-text-primary">
              {related.sequence.state === 'paused'
                ? `Paused — ${related.sequence.pauseReason ?? 'the client replied'}`
                : `${related.sequence.name} · step ${related.sequence.step} of ${related.sequence.total}`}
            </span>
          </Row>
        )}

        <Row label="Owner">
          <span className="text-text-primary">{lead?.ownerName ?? '—'}</span>
        </Row>

        <div className="border-t border-border-subtle pt-3">
          <p className="mb-2 text-caption font-semibold text-text-primary">Quick links</p>
          {/* ⚠️ NONE OF THESE NAVIGATE. Each opens over this page. */}
          <QuickLink onClick={() => onOpen('details')} icon={UserRound}>
            View lead details
          </QuickLink>
          <QuickLink onClick={() => onOpen('related', 'quotations')} icon={FileText}>
            View quotation
          </QuickLink>
          <QuickLink onClick={() => onOpen('details')} icon={NotebookPen}>
            Add a note
          </QuickLink>
          <QuickLink onClick={() => onOpen('followup')} icon={BellPlus}>
            Schedule a follow-up
          </QuickLink>
          <QuickLink onClick={() => onOpen('related', 'appointments')} icon={CalendarClock}>
            Book an appointment
          </QuickLink>
        </div>
      </div>
    </aside>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] items-start gap-2 text-caption">
      <span className="text-text-secondary">{label}</span>
      <span className="min-w-0">{children}</span>
    </div>
  );
}

function Reach({
  href,
  label,
  tint,
  children,
}: {
  href: string | null;
  label: string;
  tint: string;
  children: React.ReactNode;
}) {
  const className = 'grid size-10 place-items-center rounded-xl border transition-colors';
  if (!href) {
    return (
      <span
        role="img"
        aria-label={`${label} — not available`}
        title={`No ${label.toLowerCase()} on this lead`}
        className={cn(className, 'cursor-not-allowed border-dashed border-border-subtle opacity-50')}
        style={{ color: tint }}
      >
        {children}
      </span>
    );
  }
  return (
    <a
      href={href}
      target={href.startsWith('http') ? '_blank' : undefined}
      rel={href.startsWith('http') ? 'noopener noreferrer' : undefined}
      aria-label={label}
      title={label}
      className={cn(className, 'border-border-default hover:bg-bg-subtle')}
      style={{ color: tint }}
    >
      {children}
    </a>
  );
}

function QuickLink({
  onClick,
  icon: Icon,
  children,
}: {
  onClick: () => void;
  icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' }>;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-lg px-1 py-2 text-left text-caption text-text-primary transition-colors hover:bg-bg-subtle"
    >
      <Icon className="size-4 shrink-0 text-text-secondary" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">{children}</span>
      <ChevronRight className="size-3.5 shrink-0 text-text-tertiary" aria-hidden="true" />
    </button>
  );
}
