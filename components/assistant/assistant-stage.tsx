'use client';

import * as React from 'react';
import { ChevronDown, Sparkles } from 'lucide-react';

import { AssistantChat } from '@/components/assistant/assistant-chat';
import { BrainMark } from '@/components/assistant/brain-mark';
import { getConversation, subscribeConversation } from '@/components/assistant/conversation-store';
import { IconButton } from '@/components/ui/button';
import { REDUCED_MOTION_QUERY } from '@/lib/theme';

/* ============================================================================
 * THE CHAT CARD ON THE ASSISTANT PAGE — WHICH CAN BE PUT AWAY
 * ----------------------------------------------------------------------------
 * Owner, 2026-08-27: *"on the assistant page, that chat area should also be
 * minimized so I can see the whole video or I can click again so it will be
 * open at this height again. Is it possible that when I open this page this is
 * minimized by default? After 1 or 2 seconds, when the page has properly
 * loaded, it will slightly open like a popup."*
 *
 * ── ⚠️ WHY IT OPENS BY ITSELF RATHER THAN WAITING TO BE CLICKED ────────────
 * Because the page's purpose is the chat. Somebody who navigated to "AI
 * Assistant" wants to ask something, and making them click once more to reach
 * the box would be a worse screen that happened to show more video. The delayed
 * entrance gives the backdrop a moment to be seen and then puts the box where
 * it is needed — which is what was asked for, and it is also why the minimised
 * state is a real control rather than the default resting state.
 *
 * ── ⚠️ 1.4 SECONDS, AND WHY NOT LESS OR MORE ───────────────────────────────
 * The clip is mounted a frame after first paint and takes roughly a second to
 * start playing (`brain-video.tsx`). Opening sooner reveals the card over a
 * still frame, which looks like a slow page rather than a deliberate entrance.
 * Much past two seconds and somebody who came here to type is waiting on an
 * animation — the one thing a delay must never cost.
 *
 * ── ⚠️ THE TIMER IS SKIPPED ONCE A CONVERSATION EXISTS ─────────────────────
 * Coming back to this page mid-conversation — from the floating panel, or via
 * the rail — must not hide the transcript for a second and a half and then
 * reveal it. The delay is an INTRODUCTION; it belongs only to a first visit
 * with nothing to show.
 *
 * ── ⚠️ AND IT IS SKIPPED ENTIRELY UNDER REDUCED MOTION ─────────────────────
 * Somebody who has asked the system not to animate things has not asked to wait
 * a second and a half for a box; the delay exists purely to make room for an
 * animation they will not see.
 * ========================================================================= */

const OPEN_AFTER_MS = 1400;

export function AssistantStage({
  who,
  avatarUrl,
  suggestions,
}: {
  who: string;
  avatarUrl: string | null;
  suggestions: readonly string[];
}) {
  /* ⚠️ Read through the store, not with `useState`, so arriving on this page
     with a conversation already going opens immediately. `turns.length` is all
     that is needed — subscribing to the whole conversation here would re-render
     the wrapper on every token of every answer for no reason. */
  const hasConversation =
    React.useSyncExternalStore(
      subscribeConversation,
      () => getConversation().turns.length,
      () => 0,
    ) > 0;

  const [open, setOpen] = React.useState(false);
  const cardRef = React.useRef<HTMLDivElement>(null);
  const pillRef = React.useRef<HTMLButtonElement>(null);

  /* ⚠️ Tracks whether the OPENING was a user action, so focus is only moved
     when somebody asked for it. Stealing focus from the page because a timer
     fired is how a screen reader loses its place mid-sentence. */
  const openedByHand = React.useRef(false);

  /* ── ⚠️ THE GUARD IS "DID SOMEBODY PUT IT AWAY", NOT "HAS THIS RUN" ──────
     Two bugs live here, one behind the other, and both are worth recording
     because each fix looks like it causes the next.

     1. The effect first depended on `[open, hasConversation]` with no guard at
        all, and the minimise button did nothing: clicking it set `open` to
        false, the effect re-ran, saw a conversation in progress, and reopened
        the card immediately. Measured — it never went away.

     2. The obvious fix — a `hasRun` ref and an empty dependency list — was
        WORSE, and silently so. React StrictMode invokes an effect twice in
        development: the first pass set the ref and scheduled the opening, the
        cleanup cancelled it, and the second pass returned early because the ref
        was already set. The card then never opened at all. Measured too, and it
        would have looked like a broken page rather than a broken guard.

     What the effect actually needs to know is not whether it has run before. It
     is whether the person has DELIBERATELY put the card away — and that is a
     fact about intent, which a re-run of the same effect must not forget and
     must not invent. Guarding on that is correct under StrictMode by
     construction: the effect is free to run any number of times and reaches the
     same conclusion each time. */
  const minimisedByHand = React.useRef(false);

  React.useEffect(() => {
    if (open || minimisedByHand.current) return;

    /* Already talking, or motion is unwelcome — no reason to wait. */
    const still = window.matchMedia?.(REDUCED_MOTION_QUERY).matches ?? false;
    if (hasConversation || still) {
      const frame = requestAnimationFrame(() => setOpen(true));
      return () => cancelAnimationFrame(frame);
    }

    /* ⚠️ setState from a TIMER, not synchronously in the effect body. The
       react-hooks lint refuses the latter — a synchronous setState in an effect
       is a second render caused by the first — and it is right to. */
    const timer = setTimeout(() => setOpen(true), OPEN_AFTER_MS);
    return () => clearTimeout(timer);
  }, [open, hasConversation]);

  React.useEffect(() => {
    if (!open || !openedByHand.current) return;
    openedByHand.current = false;
    const frame = requestAnimationFrame(() => {
      /* `preventScroll`: the page does not scroll, and asking the browser to
         reveal something inside a fixed-height column makes it try anyway. */
      cardRef.current?.querySelector('textarea')?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);

  /* ── Minimised ───────────────────────────────────────────────────────────
     A labelled bar rather than a bare icon, because this is the ONLY thing on
     the page once the card is away — an unlabelled circle in the middle of a
     video is a puzzle, and the page would look broken rather than tidy.

     ⚠️ It says what will come back. "Continue" when there is a transcript
     waiting, so putting the card away never reads as having thrown it out.

     ── ⚠️ 500px WIDE AND ~5rem TALL, WHICH IS DELIBERATELY OUT OF SCALE ─────
     Owner, 2026-08-27: *"That button is fine but can you increase its height and
     width? [...] make it double height and the width is, you can say, 500 px.
     Right now it's looking very small on the screen so I want to make it
     prominent."*

     They are right, and the reason is worth writing down: every other control
     in this product is sized against the content around it. This one sits alone
     on a full-screen video of a glowing brain, and a control keeps its
     proportions against its BACKDROP, not against a stylesheet. At the house
     pill size it read as a toast notification that had drifted to the middle of
     the screen.

     ⚠️ `w-[min(500px,100%)]` — the literal 500px asked for, with a floor so it
     cannot push the page sideways on a narrow window. `100%` rather than a
     viewport unit: the parent is already inset by the shell's padding, so a
     `vw` here would overflow by exactly that padding. */
  if (!open) {
    return (
      <div className="relative z-10 mx-auto mt-auto flex w-full max-w-3xl shrink-0 justify-center px-4 pb-6 sm:px-6">
        <button
          ref={pillRef}
          type="button"
          onClick={() => {
            openedByHand.current = true;
            /* Reopening by hand clears the "put away" flag, so a later
               navigation back to this page gets its entrance again. */
            minimisedByHand.current = false;
            setOpen(true);
          }}
          className="drawer-panel-in group inline-flex h-20 w-[min(500px,100%)] items-center gap-4 rounded-full border border-border-default bg-bg-surface pr-7 pl-4 shadow-[var(--shadow-xl)] transition-transform hover:scale-[1.02] active:scale-[0.98]"
        >
          <BrainMark size="md" />

          <span className="min-w-0 flex-1 text-left">
            <span className="block truncate text-h3 leading-tight font-semibold text-text-primary">
              {hasConversation ? 'Continue the conversation' : 'Ask the assistant'}
            </span>
            {/* ⚠️ A second line, only now that there is room for one. At the old
                size this would have been a two-line toast; at 80px tall the bar
                looked empty without it. */}
            <span className="block truncate text-caption text-text-secondary">
              {hasConversation
                ? 'Your chat is still here'
                : 'Ask about people, projects, or money'}
            </span>
          </span>

          <Sparkles
            className="h-6 w-6 shrink-0 text-accent-primary transition-transform group-hover:-translate-y-0.5"
            strokeWidth={1.75}
            aria-hidden="true"
          />
        </button>
      </div>
    );
  }

  /* ── Open ────────────────────────────────────────────────────────────────
     ⚠️ `min(26rem, 74%)` — 26rem where there is room, a proportion of the stage
     where there is not, so a short window shrinks the card rather than
     overflowing the page. Both terms are needed: a fixed height alone overflows
     at 720px, and a percentage alone gives a 900px-tall chat box on a big
     monitor, which is a worse shape to read a paragraph in, not a better one.

     ⚠️ `mt-auto` pins it to the bottom of the column. Owner: *"it should stick
     to the bottom. It should not rise up."* */
  return (
    <div
      className="relative z-10 mx-auto mt-auto flex w-full max-w-3xl shrink-0 flex-col px-4 pb-4 sm:px-6"
      style={{ height: 'min(26rem, 74%)' }}
    >
      <div
        ref={cardRef}
        className="drawer-panel-in relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[var(--radius-lg)] border border-border-default bg-bg-surface p-4 shadow-[var(--shadow-xl)]"
      >
        {/* ⚠️ Floated over the card's own padding rather than given a header
            row of its own. A titled bar here would repeat what the breadcrumb
            and the rail already say, to buy one button a place to sit. */}
        {/* ⚠️ RECORDS THE INTENT, then closes — in that order, and both are
            required. Setting only `open` was the bug twice over: the effect
            above re-runs, sees a conversation in progress, and reopens the card
            in the same frame. From the outside the button simply does nothing,
            which is the hardest kind of bug to report. */}
        <IconButton
          label="Minimise the assistant"
          icon={ChevronDown}
          size="sm"
          onClick={() => {
            minimisedByHand.current = true;
            setOpen(false);
          }}
          className="absolute top-2 right-2 z-20"
        />

        <AssistantChat
          who={who}
          avatarUrl={avatarUrl}
          suggestions={suggestions}
          decorated
          className="min-h-0 flex-1"
        />
      </div>
    </div>
  );
}
