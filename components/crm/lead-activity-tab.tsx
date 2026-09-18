'use client';

import * as React from 'react';
import {
  ArrowRightLeft,
  CalendarClock,
  Download,
  FileText,
  Flame,
  Lock,
  Mail,
  MapPin,
  Phone,
  PhoneMissed,
  Send,
  StickyNote,
  Trophy,
  UserPlus,
  XCircle,
} from 'lucide-react';

import { addNoteAction } from '@/app/actions/crm-leads';
import { MAIL_BLUE, WA_GREEN, WhatsAppMark } from '@/components/crm/whatsapp-mark';
import { useToast } from '@/components/ui/toast';
import type { CrmLeadEvent, CrmLeadNote, CrmLeadRelated } from '@/lib/db/queries/crm-leads';
import {
  buildActivityFeed,
  feedClock,
  feedCounts,
  filterFeed,
  groupFeedByDay,
  FEED_FILTERS,
  type FeedEntry,
  type FeedFilter,
  type FeedMark,
} from '@/lib/domain/crm-activity-feed';
import { cn } from '@/lib/utils';

/* ============================================================================
 * THE ACTIVITY TAB — built to the owner's reference of 2026-09-18
 * ----------------------------------------------------------------------------
 * Filter chips, a timeline grouped by day, a coloured mark on every line, and
 * an internal note composer standing at the foot of it.
 *
 * ── ⚠️ CLICKING A CHIP TOUCHES NOTHING ─────────────────────────────────────
 * Rule Zero, laws 1 and 3: the whole feed is built once from rows the drawer is
 * already holding, and filtering is an array filter over that. No chip, no tab
 * and no "View details" here costs a round trip.
 *
 * ── ⚠️ AND THE NOTE APPEARS THE MOMENT IT IS WRITTEN ───────────────────────
 * It is drawn into the timeline at once, marked as saving, and reconciled when
 * the server's own list of notes arrives. A composer that empties and shows
 * nothing until a round trip returns is the exact delay Rule Zero exists to
 * stop — and if the write is refused, the line goes and the words come back.
 * ========================================================================= */

type IconLike = React.ComponentType<{ className?: string }>;

/**
 * ⚠️ THE MARK CARRIES THE COLOUR, AND THE CHANNEL COLOURS ARE THE PRODUCT'S OWN.
 * WhatsApp green and mail blue are the same two the drawer's header, the
 * composer and the Conversations page use. A sixth palette invented for this
 * tab would say "this is something else" about the very same message.
 */
const MARKS: Record<FeedMark, { icon: IconLike; tint: string }> = {
  whatsapp: { icon: WhatsAppMark, tint: WA_GREEN },
  email: { icon: Mail, tint: MAIL_BLUE },
  call: { icon: Phone, tint: 'var(--feedback-info)' },
  call_missed: { icon: PhoneMissed, tint: 'var(--feedback-warning)' },
  stage: { icon: ArrowRightLeft, tint: 'var(--accent-primary)' },
  won: { icon: Trophy, tint: 'var(--feedback-success)' },
  lost: { icon: XCircle, tint: 'var(--feedback-error)' },
  temperature: { icon: Flame, tint: 'var(--feedback-warning)' },
  note: { icon: StickyNote, tint: 'var(--accent-gold)' },
  next_action: { icon: CalendarClock, tint: 'var(--accent-primary)' },
  quotation: { icon: FileText, tint: MAIL_BLUE },
  appointment: { icon: MapPin, tint: 'var(--feedback-info)' },
  followup: { icon: Send, tint: 'var(--accent-primary)' },
  arrived: { icon: Download, tint: 'var(--text-secondary)' },
  assigned: { icon: UserPlus, tint: 'var(--text-secondary)' },
};

/** What each chip says when it has nothing under it — never a blank panel. */
const NOTHING: Record<FeedFilter, string> = {
  all: 'Nothing has happened on this lead yet.',
  messages: 'No WhatsApp, email or call has been recorded on this lead yet.',
  stage: 'The stage has not been changed yet.',
  followups: 'No follow-up, appointment or next action has been recorded yet.',
  documents: 'No quotation has been raised for this lead yet.',
  notes: 'No notes yet. Write the first one below.',
};

export function LeadActivityTab({
  leadId,
  activity,
  notes,
  related,
  nowMs,
  viewerName,
  onTab,
  onOpenRelated,
}: {
  leadId: string;
  activity: readonly CrmLeadEvent[];
  notes: readonly CrmLeadNote[];
  related: CrmLeadRelated;
  nowMs: number;
  /** Whose name stands against a note that has not landed yet. */
  viewerName: string;
  onTab: (tab: 'conversations' | 'followups') => void;
  onOpenRelated: (tab: 'quotations' | 'appointments') => void;
}) {
  const toast = useToast();
  const [filter, setFilter] = React.useState<FeedFilter>('all');
  const [draft, setDraft] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  /* ⚠️ RECONCILED BY IDENTITY, NOT BY LENGTH. A note added and another withdrawn
     between two renders leaves the count where it was, and the optimistic line
     would stay on screen for ever beside the real one. */
  const [added, setAdded] = React.useState<readonly FeedEntry[]>([]);
  const [seenNotes, setSeenNotes] = React.useState(notes);
  if (seenNotes !== notes) {
    setSeenNotes(notes);
    if (added.length > 0) setAdded([]);
  }

  const feed = React.useMemo(
    () =>
      buildActivityFeed({
        activity,
        notes,
        quotations: related.quotations,
        appointments: related.appointments,
        followUps: related.followUps,
        nowMs,
      }),
    [activity, notes, related.quotations, related.appointments, related.followUps, nowMs],
  );

  const all = added.length > 0 ? [...added, ...feed] : feed;
  const counts = feedCounts(all);
  const days = groupFeedByDay(filterFeed(all, filter), nowMs);

  async function add() {
    const body = draft.trim();
    if (body === '' || saving) return;

    const id = `pending:${Date.now()}`;
    /* The line, the cleared box and the saving mark all in this frame. */
    setAdded((v) => [
      {
        id,
        at: Date.now(),
        group: 'notes',
        mark: 'note',
        title: 'Note added',
        detail: body,
        by: viewerName,
        opens: null,
        pending: true,
      },
      ...v,
    ]);
    setDraft('');
    setSaving(true);

    const result = await addNoteAction(leadId, body);
    setSaving(false);
    if (!result.ok) {
      /* ⚠️ THE WORDS COME BACK. Losing what somebody typed because the server
         said no is worse than the refusal itself — and `setDraft` only fills a
         box they have not started typing into again. */
      setAdded((v) => v.filter((e) => e.id !== id));
      setDraft((d) => (d === '' ? body : d));
      toast({ tone: 'error', text: result.error ?? 'That note did not save.' });
      return;
    }
    toast({ tone: 'ok', text: 'Note added.' });
  }

  return (
    <div className="flex min-h-full flex-col">
      {/* ── The chips ───────────────────────────────────────────────────── */}
      <div role="tablist" aria-label="Filter the activity" className="flex flex-wrap gap-1.5">
        {FEED_FILTERS.map((f) => {
          const on = filter === f.key;
          const n = counts[f.key];
          return (
            <button
              key={f.key}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setFilter(f.key)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-caption transition-colors',
                on
                  ? 'border-accent-primary bg-accent-primary font-semibold text-white'
                  : 'border-border-default font-medium text-text-secondary hover:bg-bg-subtle hover:text-text-primary',
              )}
            >
              {f.label}
              {/* ⚠️ THE COUNT IS ON THE CHIP, so nobody has to click five of them
                  to find out which ones hold anything. */}
              <span className={cn('tabular-nums', on ? 'text-white/80' : 'text-text-tertiary')}>{n}</span>
            </button>
          );
        })}
      </div>

      {/* ── The timeline ────────────────────────────────────────────────── */}
      {days.length === 0 ? (
        <p className="mt-6 text-caption leading-relaxed text-text-secondary">{NOTHING[filter]}</p>
      ) : (
        <div className="mt-3 flex-1">
          {days.map((day) => (
            <section key={day.key} className="mb-1">
              {/* WARNING: OPAQUE, NOT 95% WITH A BLUR. A heading a row shows through
                  while it scrolls under reads as two lines printed on top of each
                  other - seen in the screenshot, not guessed at. */}
              <h4 className="sticky top-0 z-10 -mx-5 bg-bg-surface px-5 py-1.5 text-caption font-semibold text-text-secondary">
                {day.label}
              </h4>
              <ol className="relative mt-1">
                {/* The thread the marks sit on. ⚠️ Behind them, not between them:
                    each mark's ground is opaque, so the line stops at its edge. */}
                <span
                  aria-hidden="true"
                  className="absolute bottom-3 left-[1.05rem] top-3 w-px bg-border-subtle"
                />
                {day.entries.map((e) => (
                  <Line key={e.id} entry={e} onTab={onTab} onOpenRelated={onOpenRelated} />
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}

      {/* ── Add an internal note ────────────────────────────────────────────
          ⚠️ STICKY, NOT FIXED, and inside the scroller rather than over it. The
          reference stands it at the foot of the panel; a `fixed` box would
          leave the flow and shift the list the moment it appeared. */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
        className="sticky bottom-0 z-20 -mx-5 -mb-4 mt-4 border-t border-border-subtle bg-bg-surface px-5 pb-3 pt-3"
      >
        <label className="block">
          <span className="block text-body-sm font-semibold text-text-primary">Add an internal note</span>
          <textarea
            value={draft}
            onChange={(ev) => setDraft(ev.target.value)}
            rows={2}
            placeholder="What was discussed, what was agreed, what to raise next time…"
            className="mt-1.5 w-full resize-y rounded-xl border border-border-subtle bg-bg-surface px-3 py-2 text-body-sm text-text-primary transition-colors placeholder:text-text-tertiary hover:border-border-default focus:border-accent-primary focus:outline-none"
          />
        </label>
        <div className="mt-2 flex items-center justify-between gap-2">
          {/* ⚠️ ONE VALUE, AND IT IS THE TRUTH. The reference shows a visibility
              selector; `crm_lead_notes` has no visibility column and the client
              never sees a note, so a dropdown offering "Shared with client"
              would be a promise this product cannot keep. It says what it is. */}
          <span
            className="inline-flex items-center gap-1.5 rounded-lg border border-border-default bg-bg-subtle px-2.5 py-1.5 text-caption font-medium text-text-secondary"
            title="Every note here is internal. The client never sees it."
          >
            <Lock className="size-3.5" aria-hidden="true" />
            Team only
          </span>
          <button
            type="submit"
            disabled={saving || draft.trim() === ''}
            className="inline-flex items-center gap-2 rounded-xl bg-accent-primary px-3.5 py-2 text-body-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            <StickyNote className="size-4" aria-hidden="true" />
            Add note
          </button>
        </div>
        <p className="mt-1.5 text-micro text-text-secondary">
          Notes stay on the record and cannot be edited afterwards.
        </p>
      </form>
    </div>
  );
}

function Line({
  entry,
  onTab,
  onOpenRelated,
}: {
  entry: FeedEntry;
  onTab: (tab: 'conversations' | 'followups') => void;
  onOpenRelated: (tab: 'quotations' | 'appointments') => void;
}) {
  const mark = MARKS[entry.mark];
  const Icon = mark.icon;

  const open =
    entry.opens === null
      ? null
      : () => {
          if (entry.opens === 'conversations' || entry.opens === 'followups') onTab(entry.opens);
          else if (entry.opens === 'quotations' || entry.opens === 'appointments') onOpenRelated(entry.opens);
        };

  return (
    <li className={cn('flex gap-3 rounded-xl py-2 transition-opacity', entry.pending && 'opacity-60')}>
      <span
        aria-hidden="true"
        className="relative z-10 grid size-[2.125rem] shrink-0 place-items-center rounded-full"
        style={{
          background: `color-mix(in oklab, ${mark.tint} 14%, var(--bg-surface))`,
          color: mark.tint,
        }}
      >
        <Icon className="size-4" />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="min-w-0 text-body-sm font-semibold text-text-primary">{entry.title}</p>
          {open && (
            <button
              type="button"
              onClick={open}
              className="shrink-0 text-caption font-medium text-accent-primary transition-colors hover:underline"
            >
              View details
            </button>
          )}
        </div>
        {entry.detail && (
          /* ⚠️ THREE LINES, THEN AN ELLIPSIS. A note can be a paragraph, and one
             long one would otherwise push a day's worth of history off screen. */
          <p className="mt-0.5 line-clamp-3 whitespace-pre-line text-caption leading-relaxed text-text-secondary">
            {entry.detail}
          </p>
        )}
        <p className="mt-0.5 text-caption text-text-tertiary">
          {feedClock(entry.at)} · {entry.by}
          {entry.pending && ' · Saving…'}
        </p>
      </div>
    </li>
  );
}
