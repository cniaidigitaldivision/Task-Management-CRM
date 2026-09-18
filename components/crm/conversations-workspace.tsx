'use client';

import * as React from 'react';
import type { Route } from 'next';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ChevronRight,
  FileText,
  Mail,
  MoreVertical,
  NotebookPen,
  Phone,
  Search,
  UserRound,
  Video,
} from 'lucide-react';

import { LeadConversationTab, useConversationSummary } from '@/components/crm/lead-conversation-tab';
import { MAIL_BLUE, WA_GREEN, WhatsAppMark } from '@/components/crm/whatsapp-mark';
import { leadBundlesAction } from '@/app/actions/crm-lead-bundles';
import type { CrmConversation, CrmLeadBundle } from '@/lib/db/queries/crm-leads';
import { quotationStatusLabel, quotationStatusToken } from '@/lib/domain/crm-quotations';
import { stageLabel, stageToken } from '@/lib/domain/crm-stages';
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

  const active = activeId ? conversations.find((c) => c.leadId === activeId) ?? null : null;
  const bundle = activeId ? bundles[activeId] ?? null : null;

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
    <div className="flex h-[calc(100dvh-var(--app-header-h,4rem))] min-h-0 flex-col gap-4 p-4 sm:p-6">
      <Header channel={channel} onChannel={setChannel} total={conversations.length} />

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] xl:grid-cols-[minmax(0,21rem)_minmax(0,1fr)_minmax(0,19rem)]">
        <ListPane
          conversations={conversations}
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
          onOpenFollowUps={() =>
            active && router.push(`/my-leads?lead=${active.leadId}&tab=followups` as Route)
          }
        />

        <ContextPane conversation={active} bundle={bundle} />
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
  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-border-subtle bg-bg-surface">
      <div className="shrink-0 border-b border-border-subtle p-3">
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

      {conversations.length === 0 ? (
        <p className="flex flex-1 items-center justify-center px-6 py-10 text-center text-caption text-text-secondary">
          No conversations yet. A thread appears here the moment you or the client sends something.
        </p>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {conversations.map((c) => (
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
  onOpenFollowUps,
}: {
  conversation: CrmConversation | null;
  bundle: CrmLeadBundle | null;
  viewerName: string;
  onOpenFollowUps: () => void;
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
        <HeaderAction href={`/my-leads?lead=${conversation.leadId}`} label="Open the full record">
          <MoreVertical className="size-4" aria-hidden="true" />
        </HeaderAction>
      </header>

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
        />
      </div>
    </section>
  );
}

function HeaderAction({
  href,
  label,
  children,
}: {
  href: string | null;
  label: string;
  children: React.ReactNode;
}) {
  const className =
    'grid size-9 shrink-0 place-items-center rounded-xl border border-border-default text-text-secondary transition-colors hover:bg-bg-subtle hover:text-text-primary';
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
}: {
  conversation: CrmConversation;
  bundle: CrmLeadBundle | null;
  viewerName: string;
  onOpenFollowUps: () => void;
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
    />
  );
}

/* ── 3 · The lead's context ──────────────────────────────────────────────── */

function ContextPane({
  conversation,
  bundle,
}: {
  conversation: CrmConversation | null;
  bundle: CrmLeadBundle | null;
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

  return (
    <aside className="hidden min-h-0 flex-col overflow-y-auto rounded-2xl border border-border-subtle bg-bg-surface xl:flex">
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border-subtle px-4 py-3">
        <h2 className="text-body-sm font-semibold text-text-primary">Lead context</h2>
        <Link
          href={`/my-leads?lead=${conversation.leadId}` as Route}
          className="inline-flex items-center gap-1 text-caption font-medium text-accent-primary hover:underline"
        >
          View details
          <ChevronRight className="size-3.5" aria-hidden="true" />
        </Link>
      </header>

      <div className="space-y-4 px-4 py-4">
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

        <Row label="Stage">
          <span
            className="inline-block rounded-md px-2 py-0.5 text-caption font-medium"
            style={{
              color: `var(--${stageToken(lead?.stage ?? conversation.stage)})`,
              background: `color-mix(in oklab, var(--${stageToken(lead?.stage ?? conversation.stage)}) 14%, transparent)`,
            }}
          >
            {stageLabel(lead?.stage ?? conversation.stage)}
          </span>
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
          ) : (
            <span className="text-text-secondary">{bundle ? 'Nothing planned' : 'Loading…'}</span>
          )}
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
          <QuickLink href={`/my-leads?lead=${conversation.leadId}`} icon={UserRound}>
            View lead details
          </QuickLink>
          <QuickLink href={`/my-leads?lead=${conversation.leadId}&tab=related`} icon={FileText}>
            View quotation
          </QuickLink>
          <QuickLink href={`/my-leads?lead=${conversation.leadId}&tab=overview`} icon={NotebookPen}>
            Add a note
          </QuickLink>
          <QuickLink href={`/my-leads?lead=${conversation.leadId}&tab=followups`} icon={Mail}>
            Schedule follow-up
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
  href,
  icon: Icon,
  children,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' }>;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href as Route}
      className="flex items-center gap-2.5 rounded-lg px-1 py-2 text-caption text-text-primary transition-colors hover:bg-bg-subtle"
    >
      <Icon className="size-4 shrink-0 text-text-secondary" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">{children}</span>
      <ChevronRight className="size-3.5 shrink-0 text-text-tertiary" aria-hidden="true" />
    </Link>
  );
}
