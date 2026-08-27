'use client';

import * as React from 'react';
import Image from 'next/image';
import { AlertTriangle, ArrowUp, Loader2 } from 'lucide-react';

import { askAssistantAction } from '@/app/actions/assistant';
import { AnswerText } from '@/components/assistant/answer-text';
import { AssistantChart } from '@/components/assistant/assistant-chart';
import { BrainMark } from '@/components/assistant/brain-mark';
import {
  getConversation,
  getServerConversation,
  nextTurnId,
  subscribeConversation,
  updateConversation,
} from '@/components/assistant/conversation-store';
import { Avatar } from '@/components/ui/avatar';
import { APP_NAME } from '@/lib/domain/constants';
import type { ChartSpec } from '@/lib/domain/report-charts';
import { cn } from '@/lib/utils';

/* ============================================================================
 * THE CONVERSATION
 * ----------------------------------------------------------------------------
 * One component, used both on the assistant page and inside the floating
 * drawer, so the two cannot drift into two different chats.
 *
 * ── ⚠️ IT SHOWS WHAT IT LOOKED AT ──────────────────────────────────────────
 * Every answer carries the tools that produced it. That is not decoration: the
 * assistant's whole claim is that its figures came from the live database, and
 * a reader who cannot see WHERE a number came from has only the model's tone to
 * go on — which is exactly the thing `lib/ai/narrative.ts` warns about
 * (*"occasionally wrong and always fluent"*).
 *
 * ── ⚠️ AND IT SHOWS WHEN A FIGURE WAS INVENTED ─────────────────────────────
 * `unverifiedFigures` comes from `verifyFigures`, which reads the answer back
 * and reports any number that appeared in no tool result. When it is non-empty
 * the answer is shown WITH a warning rather than hidden — the prose is usually
 * still useful, and silently discarding it would leave somebody staring at
 * nothing with no explanation.
 *
 * ── THE LAYOUT, 2026-08-27 ─────────────────────────────────────────────────
 * Owner, supplying a reference design: each turn is a titled block — who said
 * it, when, then what was said — rather than a bare bubble. Two reasons that is
 * better here than the usual chat bubble:
 *
 *   · an ANSWER is not a remark. It is a small report with headings, bullets,
 *     sometimes a chart and a provenance line, and a bubble cannot hold that
 *     shape without looking broken.
 *   · the timestamp matters. "What did it tell me this morning" is a real
 *     question about a tool that reads live data, and an answer with no time on
 *     it cannot be checked against what the numbers were then.
 * ========================================================================= */

export interface ChatTurn {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly content: string;
  /** Wall-clock, captured when the turn was created. See `clockTime`. */
  readonly at: string;
  readonly chart?: ChartSpec | null;
  readonly toolsUsed?: readonly string[];
  readonly unverifiedFigures?: readonly string[];
  readonly failed?: boolean;
}

/* What the tools are called, in words somebody would use. The model's tool
   names are for the model; these are for the reader. */
const TOOL_LABEL: Readonly<Record<string, string>> = {
  search_everything: 'searched',
  list_tasks: 'tasks',
  person_snapshot: 'one person',
  team_workload: 'workload',
  list_projects: 'projects',
  project_snapshot: 'one project',
  weekly_trend: 'weekly trend',
  attendance_summary: 'attendance',
  publishing_stats: 'publishing',
  finance_summary: 'finance',
  payroll_month: 'payroll',
  subscriptions: 'subscriptions',
  credential_directory: 'vault directory',
  recent_activity: 'activity',
};

/**
 * `10:21 AM`.
 *
 * ⚠️ Assembled from the parts rather than `toLocaleTimeString`, for the reason
 * every date helper in this codebase gives: the browser's locale and the
 * server's are not the same, and a difference between them is a hydration
 * mismatch. Nothing here is server-rendered today — the transcript starts empty
 * — but the next person to add a saved conversation would inherit the bug.
 *
 * ⚠️ Called from an EVENT HANDLER only, never during render. A clock read makes
 * a render non-deterministic and the react-compiler lint refuses it, correctly.
 */
function clockTime(when: Date): string {
  const hours = when.getHours();
  const suffix = hours < 12 ? 'AM' : 'PM';
  const shown = hours % 12 === 0 ? 12 : hours % 12;
  return `${shown}:${String(when.getMinutes()).padStart(2, '0')} ${suffix}`;
}

export function AssistantChat({
  who,
  avatarUrl,
  suggestions = [],
  className,
  compact = false,
  decorated = false,
  intro = false,
}: {
  who: string;
  avatarUrl: string | null;
  suggestions?: readonly string[];
  className?: string;
  compact?: boolean;
  /** Paint the brain behind the conversation. On the page, not in the drawer —
   *  see the note beside it. */
  decorated?: boolean;
  /**
   * Introduce the assistant by name, beside its mark.
   *
   * ⚠️ ON IN THE DRAWER, OFF ON THE PAGE, AND THAT IS DELIBERATE. The page is
   * already titled "AI Assistant" in the breadcrumb and the rail, so a third
   * label saying the same thing is the one the reader stops seeing. The drawer
   * floats over an unrelated screen with nothing around it to say what it is —
   * which is what the owner asked for: *"add the Taskly AI assistance [...] I
   * am a Taskly AI assistant."*
   */
  intro?: boolean;
}) {
  /* ── ⚠️ THE CONVERSATION IS NOT COMPONENT STATE ──────────────────────────
     It lives in a module store, so closing the floating panel does not throw
     the transcript away and reopening continues where it left off — and the
     panel and the full page are the same conversation. See
     `conversation-store.ts` for why context would not have worked here.

     ⚠️ The draft is deliberately NOT shared. Two mount points sharing one
     half-typed sentence would mean opening the panel silently pre-fills it
     with something typed on another screen. */
  const { turns, threadId, pending: busy } = React.useSyncExternalStore(
    subscribeConversation,
    getConversation,
    getServerConversation,
  );

  const [draft, setDraft] = React.useState('');

  const scrollRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLTextAreaElement>(null);

  /* Keep the newest turn in view.
   *
   * ⚠️ Scrolls the CONTAINER, not `endRef.scrollIntoView()`. That method walks
   * up every scrollable ancestor, so with the transcript now scrolling
   * internally it would ALSO scroll the page — jumping the whole screen every
   * time an answer arrived. Setting `scrollTop` moves this box and nothing
   * else.
   *
   * `turns.length` rather than `turns`, because the array identity changes on
   * re-renders that added nothing.
   *
   * ⚠️ `behavior` depends on whether this is a REOPEN or a new message. On
   * mount — the panel being reopened onto an existing conversation — the
   * transcript must already be at the bottom, and a smooth scroll animates from
   * the top on every open. `mounted` is what tells the two apart. */
  const mounted = React.useRef(false);
  React.useEffect(() => {
    const box = scrollRef.current;
    if (!box) return;
    box.scrollTo({
      top: box.scrollHeight,
      behavior: mounted.current ? 'smooth' : 'auto',
    });
    mounted.current = true;
  }, [turns.length, busy]);

  const send = async (question: string) => {
    const asked = question.trim();
    if (asked === '' || busy) return;

    setDraft('');

    /* The question appears immediately. Waiting for the round trip to show
       somebody their own words is three seconds of wondering whether the button
       worked. */
    const mine: ChatTurn = {
      id: nextTurnId('q'),
      role: 'user',
      content: asked,
      at: clockTime(new Date()),
    };

    /* ⚠️ `threadId` is read from the store INSIDE the updater rather than from
       the closure. Two questions sent before the first answer returns would
       otherwise both see `null` and create two threads. */
    let sentThread: string | null = null;
    updateConversation((prev) => {
      sentThread = prev.threadId;
      return { ...prev, turns: [...prev.turns, mine], pending: true };
    });

    const response = await askAssistantAction(asked, sentThread ?? threadId);

    /* ⚠️ Stamped when the answer LANDED, not when the question was sent. The
       two are three to five seconds apart, and the time that matters for a
       figure is the moment the database was read. */
    const at = clockTime(new Date());

    /* ⚠️ Written to the STORE, not to component state — so an answer still
       arrives if the panel was closed while it was in flight, and is there when
       it is reopened. */
    updateConversation((prev) =>
      response.ok
        ? {
            turns: [
              ...prev.turns,
              {
                id: nextTurnId('a'),
                role: 'assistant',
                content: response.answer,
                at,
                chart: response.chart,
                toolsUsed: response.toolsUsed,
                unverifiedFigures: response.unverifiedFigures,
              },
            ],
            threadId: response.threadId,
            pending: false,
          }
        : {
            ...prev,
            turns: [
              ...prev.turns,
              {
                id: nextTurnId('e'),
                role: 'assistant',
                content: response.error,
                at,
                failed: true,
              },
            ],
            pending: false,
          },
    );

    inputRef.current?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    /* Enter sends, Shift+Enter breaks the line — the convention everywhere
       else, and the one people try first. */
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void send(draft);
    }
  };

  return (
    <div className={cn('relative flex flex-col', className)}>
      {/* ── ⚠️ THE BRAIN, BEHIND THE CONVERSATION ───────────────────────────
          Owner, 2026-08-27: *"in the chat, add an image there [...] Beautifully
          add some brain images, like the brain image you also use in the
          dashboard for AI Assistant."*

          The same transparent cut-out `control-room.tsx` uses, so the two
          screens are recognisably the same product rather than two takes on a
          brain.

          ⚠️ On the CARD, not inside the scroll area. Put in the transcript it
          would slide away with the first answer and never be seen again, which
          is the opposite of decoration.

          ⚠️ And it must stay this faint. It sits directly behind body text that
          has to clear 4.5:1, and the measurement that matters is against the
          painted pixels rather than the card's declared colour — see
          `hero-contrast.mjs`. 7% is what survived that check with room to
          spare; a designer's instinct to "make it a bit more visible" is
          exactly how this screen fails WCAG in light mode only, where nobody
          reviewing in dark would see it.

          ⚠️ `-z-0` is NOT the same as `z-0` here and the difference is the
          whole thing. The card is opaque; a plain `z-0` puts this in the same
          stacking level as the transcript, where the later sibling wins and the
          brain vanishes under it. Negative pulls it behind its siblings while
          staying in front of the card's own background. */}
      {decorated && (
        <Image
          src="/dashboard/brain-cutout.png"
          alt=""
          aria-hidden="true"
          width={520}
          height={520}
          priority={false}
          className="pointer-events-none absolute right-[-3rem] bottom-[-2rem] -z-0 h-auto w-[20rem] max-w-[70%] opacity-[0.07] select-none"
        />
      )}

      {/* ── ⚠️ THE TRANSCRIPT SCROLLS; THE PAGE DOES NOT ────────────────────
          Owner, 2026-08-27: *"When the chat history is getting long, add a
          scrollbar to the chat area."* And, separately: *"don't add a
          scrollbar"* — meaning the PAGE. Both are satisfied by the same
          arrangement: this box overflows, its parent has a fixed height, and
          the document never grows.

          `min-h-0` is the load-bearing class and it is easy to omit. A flex
          child's default `min-height` is `auto`, which means "at least my
          content" — so `flex-1 overflow-y-auto` alone does NOT scroll: the
          child grows to fit the transcript and pushes the input off the bottom
          of the card. `min-h-0` lets it be shorter than its content, which is
          what gives the overflow something to do.

          `overscroll-contain` stops a scroll that reaches the end of the
          transcript from continuing into the page behind it.

          `relative z-10` so every turn sits ON the brain rather than under it. */}
      <div
        ref={scrollRef}
        className={cn(
          'relative z-10 min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain',
          compact ? 'px-4 py-4' : 'px-1 py-1',
        )}
      >
        {/* ── ⚠️ A GREETING, NOT A DISCLAIMER ────────────────────────────────
            Owner, 2026-08-27: *"the chat box should not mention that it asks
            about people, project tenders, money and the answer comes from a
            live database [...] Do this in a proper professional way, like how
            Gemini greets."*

            The old copy was a specification of the feature, addressed to
            nobody. This addresses the person by name and offers somewhere to
            start — which is what an opening screen is for. The caveat that used
            to live here has not been deleted, only moved: it sits under the
            input, where it belongs, in one line.

            ⚠️ It STAYS at the top of the transcript once a conversation begins,
            rather than being swapped out for the first turn — that is what the
            owner's reference design does, and it means the suggestions are
            still reachable by scrolling up instead of vanishing after one
            question. */}
        <div className={cn(compact ? 'pb-3' : 'px-2 pt-3 pb-4')}>
          <div className="flex items-start gap-3">
            {/* ⚠️ Only where it introduces something. On the page the brain is
                already the whole backdrop and a second one at 88px beside the
                greeting is the same picture twice. */}
            {intro && <BrainMark size="lg" className="-mt-1 hidden sm:grid" />}

            <div className="min-w-0">
              <p
                className={cn('leading-tight font-semibold', compact ? 'text-h3' : 'text-h2')}
              >
                <span style={{ color: 'var(--accent-primary)' }}>
                  Hello, {who.split(' ')[0]}
                </span>
                <span aria-hidden="true"> 👋</span>
              </p>

              {intro ? (
                <>
                  <p className="mt-1 text-caption font-semibold text-text-primary">
                    I&rsquo;m your {APP_NAME} AI Assistant.
                  </p>
                  {/* ⚠️ What it is FOR, in the owner's own framing — not a list
                      of what it can reach. The first version of this screen
                      enumerated people, projects, money and the live database,
                      and the owner's verdict was that it read as a
                      specification addressed to nobody. */}
                  <p className="mt-1 text-micro text-text-secondary">
                    I can pull insights, checks and summaries out of your workspace, so you can
                    decide faster.
                  </p>
                </>
              ) : (
                <p className="mt-1 text-body text-text-secondary">How can I help you today?</p>
              )}
            </div>
          </div>

          {suggestions.length > 0 && (
            <div className={cn(intro && 'mt-4 border-t border-border-subtle pt-3')}>
              {!intro && (
                <p className="mt-4 text-micro font-medium text-text-tertiary">Try asking</p>
              )}
              <div className={cn('flex flex-wrap gap-2', !intro && 'mt-2')}>
                {suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    disabled={busy}
                    onClick={() => void send(s)}
                    className="rounded-full border border-border-subtle bg-bg-surface px-3 py-1.5 text-caption text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary disabled:opacity-50"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {turns.map((turn) =>
          turn.role === 'user' ? (
            /* ── What you asked ──────────────────────────────────────────────
               ⚠️ Offset right and capped at 85%, so the two sides of the
               conversation are told apart by SHAPE before anybody reads a name.
               The name and the time are still there, because on a screen an
               Admin may later read back, "who said this" must not depend on
               which margin it happens to sit against. */
            <div key={turn.id} className="flex justify-end pl-[8%]">
              <div className="w-full rounded-[var(--radius-lg)] rounded-tr-sm border border-border-subtle bg-bg-surface-sunken px-3.5 py-2.5">
                <div className="flex items-center gap-2">
                  <Avatar name={who} src={avatarUrl} size="xs" />
                  <span className="text-micro font-semibold text-text-primary">You</span>
                  <span className="tabular ml-auto text-micro text-text-tertiary">{turn.at}</span>
                </div>
                <p className="mt-1.5 text-caption whitespace-pre-wrap text-text-primary">
                  {turn.content}
                </p>
              </div>
            </div>
          ) : (
            <div key={turn.id} className="flex justify-start pr-[6%]">
              <div className="w-full rounded-[var(--radius-lg)] rounded-tl-sm border border-border-subtle bg-bg-surface px-3.5 py-2.5 shadow-[var(--shadow-sm)]">
                <div className="flex items-center gap-2">
                  <BrainMark size="xs" />
                  <span className="text-micro font-semibold text-text-primary">
                    {APP_NAME} AI
                  </span>
                  <span className="tabular ml-auto text-micro text-text-tertiary">{turn.at}</span>
                </div>

                {/* ⚠️ A failure is plain text, never run through the formatter.
                    An error message has no structure to render, and passing one
                    through a markdown parser is how a stray `-` in an upstream
                    message turns into a bullet. */}
                {turn.failed ? (
                  <p className="mt-1.5 text-caption" style={{ color: 'var(--feedback-error)' }}>
                    {turn.content}
                  </p>
                ) : (
                  <div className="mt-1.5 text-text-secondary">
                    <AnswerText text={turn.content} />
                  </div>
                )}

                {turn.chart && <AssistantChart spec={turn.chart} />}

                {/* ⚠️ Shown, not hidden. The model was told not to compute; this
                    is where it did anyway, and the reader deserves to know which
                    number to re-check rather than trusting a fluent sentence. */}
                {turn.unverifiedFigures && turn.unverifiedFigures.length > 0 && (
                  <p
                    className="mt-2 flex items-start gap-1.5 text-micro"
                    style={{ color: 'var(--money-due)' }}
                  >
                    <AlertTriangle className="mt-px h-3 w-3 shrink-0" aria-hidden="true" />
                    <span>
                      Check {turn.unverifiedFigures.join(', ')} —{' '}
                      {turn.unverifiedFigures.length === 1
                        ? 'that figure was'
                        : 'those figures were'}{' '}
                      not in anything it looked up.
                    </span>
                  </p>
                )}

                {/* ⚠️ `text-secondary`, not `text-tertiary`. Measured against
                    the card: tertiary is 3.94:1 at 11px, which fails WCAG's 4.5
                    for body text. This line is how somebody checks where a
                    figure came from — the last thing that should be hard to
                    read. Secondary clears it. */}
                {turn.toolsUsed && turn.toolsUsed.length > 0 && (
                  <p className="mt-2 border-t border-border-subtle pt-1.5 text-micro text-text-secondary">
                    Looked at: {turn.toolsUsed.map((t) => TOOL_LABEL[t] ?? t).join(' · ')}
                  </p>
                )}
              </div>
            </div>
          ),
        )}

        {busy && (
          <div className="flex items-center gap-2.5 px-2 text-caption text-text-secondary">
            <Loader2
              className="h-3.5 w-3.5 shrink-0 animate-spin"
              style={{ color: 'var(--accent-primary)' }}
              aria-hidden="true"
            />
            Reading the database…
          </div>
        )}
      </div>

      {/* ── The box ────────────────────────────────────────────────────────
          ⚠️ `relative z-10` for the same reason as the transcript: the brain is
          behind the whole card, and an input somebody types into must not be. */}
      <div
        className={cn(
          'relative z-10 shrink-0',
          compact ? 'border-t border-border-subtle p-3' : 'pt-3',
        )}
      >
        <div className="flex items-end gap-2 rounded-[var(--radius-lg)] border border-border-default bg-bg-surface px-2.5 py-2 focus-within:border-border-brand">
          {/* ⚠️ THREE ROWS, NOT ONE. Owner, 2026-08-27: *"this chat area should
              extend 2 or 3 rows."* A one-line box makes a two-sentence question
              scroll inside a 32px slot while it is being typed, which is where
              people give up and ask a shorter, worse question. `max-h-40` still
              caps it, so a pasted paragraph cannot swallow the transcript. */}
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            rows={compact ? 2 : 3}
            maxLength={2000}
            placeholder="Ask anything about the division…"
            aria-label="Ask the assistant"
            className="max-h-40 flex-1 resize-none bg-transparent px-1.5 py-1 text-caption leading-relaxed text-text-primary outline-none placeholder:text-text-tertiary"
          />

          {/* ⚠️ `.assistant-orb`, NOT `.assistant-launcher`. The orb is the
              shared look — the brand ramp, the border, the focus ring — so one
              place decides what "the assistant's own button" is. The launcher
              class adds a pulsing halo on top, which belongs on a floating
              button somebody has not noticed yet and never on a control they
              are already looking at.

              This used to wear the launcher class with `after:hidden` bolted on
              to cancel that halo. tokens.css records why that was worse than it
              looked: a probe searching for the floating launcher matched THIS
              button and reported it present on a page that hides it. */}
          <button
            type="button"
            disabled={busy || draft.trim() === ''}
            onClick={() => void send(draft)}
            aria-label="Send"
            className="assistant-orb relative grid h-9 w-9 shrink-0 place-items-center rounded-full transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <ArrowUp className="h-4 w-4" strokeWidth={2.25} aria-hidden="true" />
            )}
          </button>
        </div>

        {/* The caveat the owner asked to remove from the opening screen. It is
            not deleted, only moved to where a caveat belongs — one line under
            the box, rather than a paragraph greeting somebody.

            ⚠️ `text-secondary` for the same contrast reason as above. */}
        <p className="mt-1.5 px-1 text-micro text-text-secondary">
          Reads what you can see. Cannot change anything. Never shows a password. Check
          anything important.
        </p>
      </div>
    </div>
  );
}
