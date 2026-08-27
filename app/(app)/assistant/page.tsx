import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowRight, Gauge } from 'lucide-react';

import { AssistantStage } from '@/components/assistant/assistant-stage';
import { BrainVideo } from '@/components/assistant/brain-video';
import { requireUser } from '@/lib/auth/current-user';
import { assistantAccessFor } from '@/lib/db/queries/assistant';
import { mayUseAssistant } from '@/lib/domain/assistant-access';
import { can } from '@/lib/domain/permissions';

export const metadata: Metadata = { title: 'AI Assistant' };

/* ============================================================================
 * THE ASSISTANT
 * ----------------------------------------------------------------------------
 * Owner, 2026-08-27, with a reference design:
 *
 *   "On the AI assistant page this chat should be at the bottom. Exclude all
 *    the things from this page and make a button on the top right of this page
 *    where I can see who is asking, the spend, our views [...] I just want this
 *    chat to stick to the bottom and display the video in the center. Don't
 *    zoom in on the video, just play it, and don't add a scrollbar."
 *
 * ── ⚠️ THIS PAGE IS EXACTLY ONE SCREEN TALL, AND THAT IS THE WHOLE LAYOUT ───
 * Every other page in this product is a document: it is as tall as its content
 * and the window scrolls. This one is an application surface — a backdrop with
 * a console pinned to the bottom of it — and the two cannot be mixed. If the
 * page grows by even a few pixels the document scrolls, the video slides up out
 * of frame, and the input somebody is typing into walks off the bottom edge.
 *
 * So the root has a COMPUTED, FIXED height and everything inside it fits:
 *
 *     100vh / --ui-scale  − --topbar-height  − 2rem
 *     └── the window       └── the bar above  └── the shell's own py-4
 *
 * ⚠️ THE `/ var(--ui-scale)` IS NOT DECORATION. The shell puts `zoom: 0.9` on
 * `<body>`, and a viewport unit resolves in the ZOOMED coordinate space — a
 * plain `100vh` painted 900 real pixels on a 1000px window and left a 60px
 * strip of nothing. Measured twice while building the first version of this
 * page. `dialog.tsx` records the same trap for its own max-height and reaches
 * for `dvh`, which does not help here: the problem is the zoom, not the browser
 * chrome.
 *
 * ⚠️ AND THE SUBTRACTED TERMS ARE A CONTRACT WITH `app-shell.tsx`. If the top
 * bar's height token changes, or `<main>`'s padding does, this line has to
 * change with it or the page will scroll by the difference. There is no way to
 * express "the space my parent has left me" in CSS without a container query on
 * a parent that does not have a definite height either.
 *
 * ⚠️ THE TRAILING `- 2px` IS NOT A FUDGE, IT IS THE ROUNDING. `zoom: 0.9` makes
 * every length in the document a multiple of 0.9, and browser layout is stored
 * in 1/64ths of a pixel — so an exact fit lands a fraction over and the document
 * grows a scrollbar for less than one pixel of content. Measured: the version
 * without this reported `scrollHeight − clientHeight = 1` in both themes, which
 * is a full scrollbar for nothing. Two pixels of slack is invisible and cannot
 * come back.
 *
 * ── ⚠️ THE ONE ACCESS CASE THIS PAGE STILL HAS TO HANDLE ───────────────────
 * `layout.tsx` refuses anybody who may neither ask nor administer. That leaves
 * one person who reaches this file and should not see a chat box: an ADMIN who
 * has been switched off by name. They are here legitimately — the switches are
 * theirs to manage — but every question they typed would be refused by the
 * action, so they are sent to the screen they can actually use.
 *
 * ⚠️ It asks the SAME composed helper the layout does rather than re-deriving
 * the rule, which is what stops the two drifting apart. Second checks are only
 * dangerous when they are second OPINIONS.
 *
 * ── ⚠️ WHAT USED TO BE HERE AND IS NOT ANY MORE ────────────────────────────
 * The access roster and the usage tables. Owner: *"Exclude all the things from
 * this page."* They now live at `/assistant/activity`, behind the button in the
 * corner. Nothing was deleted; it moved, and it grew a drill-down on the way.
 * ========================================================================= */

/* Clicked, not typed — the fastest way to learn what a tool like this is for is
   to see a good question already written. Chosen to span the tools: people,
   projects, time, and money. */
const SUGGESTIONS = [
  'Who is free to take more work this week?',
  'What is overdue right now?',
  'How is GC Royal Emporium doing?',
  'Who has been late this month?',
] as const;

const ADMIN_SUGGESTIONS = [
  'Did we make a profit last month?',
  'Is August payroll paid?',
] as const;

export default async function AssistantPage() {
  const user = await requireUser();
  const actor = { role: user.role, id: user.id };

  /* ⚠️ The corner button is only rendered for somebody the activity page will
     actually admit — its own layout applies the same permission and redirects.
     A visible link that bounces you back to where you were is worse than no
     link, and it is the sort of thing that only shows up when a Coordinator
     tries it. */
  const canSeeActivity =
    can(actor, 'assistant.view_usage') || can(actor, 'assistant.manage_access');

  /* An administrator who has been switched off. See the header — they belong on
     the activity screen, not in front of a box that refuses everything. */
  if (!mayUseAssistant(actor, await assistantAccessFor(user.id))) {
    redirect('/assistant/activity');
  }

  /* ⚠️ The finance questions are only OFFERED to somebody who can answer them.
     Suggesting "did we make a profit" to a Coordinator would produce a polite
     refusal every time — a control that exists to disappoint. The refusal
     itself still works if they type it; this is about not inviting it. */
  const suggestions = can(actor, 'finance.view')
    ? [...SUGGESTIONS.slice(0, 2), ...ADMIN_SUGGESTIONS]
    : SUGGESTIONS;

  return (
    /* ── ⚠️ FULL-BLEED: THE NEGATIVE MARGINS ARE THE POINT ────────────────
       Owner, 2026-08-27, on the second look: *"you can see that there is a
       space on top, left, right, and bottom. Please fill it."*

       The first attempt at a full-bleed backdrop put negative insets on the
       VIDEO (`-inset-x-6 -inset-y-4`) to reach past `<main>`'s padding. It
       measured correct and looked wrong, and the reason is one word on this
       element: `overflow-hidden`. A clipped ancestor clips a negative inset,
       so the video's box really was 1682px wide — and only 1639px of it was
       ever painted. `getBoundingClientRect` reports the layout box, not the
       visible one, which is exactly why measuring it agreed with the code and
       disagreed with the screen.

       So the CONTAINER goes full-bleed instead, cancelling `<main>`'s padding
       with negative margins, and the video simply fills it at `inset-0`. There
       is nothing left to clip. The padding then comes back on the content row
       below, where it belongs.

       ⚠️ The height loses the `- 2rem` that used to account for that padding,
       because this box now covers it. The `- 2px` stays: `zoom: 0.9` makes
       every length a multiple of 0.9 and layout is stored in 1/64ths, so an
       exact fit lands a fraction over and the document grows a scrollbar for
       less than one pixel of content. Measured. */
    <div
      className="relative -mx-4 -my-4 flex flex-col overflow-hidden sm:-mx-6"
      style={{
        height: 'calc(100vh / var(--ui-scale, 1) - var(--topbar-height) - 2px)',
      }}
    >
      <BrainVideo />

      {/* ── The corner ─────────────────────────────────────────────────────
          Owner: *"make a button on the top right of this page."*

          ⚠️ A LINK, not a dialog or a drawer. What sits behind it is a working
          screen with its own filters, its own drill-down and its own URL —
          things somebody bookmarks, reloads and sends to the other Admin. A
          modal would have made all three impossible in exchange for saving one
          navigation.

          ⚠️ `px-4 sm:px-6 pt-4` — the shell padding this container just
          cancelled, restored on the content rather than on the backdrop. */}
      <div className="relative z-10 flex shrink-0 items-start justify-end px-4 pt-4 sm:px-6">
        {canSeeActivity && (
          <Link
            href="/assistant/activity"
            className="glass glass-strong group inline-flex items-center gap-2 rounded-full border border-border-default px-3.5 py-2 text-caption font-medium text-text-primary transition-colors hover:border-border-brand"
          >
            <Gauge className="h-4 w-4 text-accent-primary" strokeWidth={1.75} aria-hidden="true" />
            Activity &amp; access
            <ArrowRight
              className="h-3.5 w-3.5 text-text-tertiary transition-transform group-hover:translate-x-0.5"
              aria-hidden="true"
            />
          </Link>
        )}
      </div>

      {/* ── The conversation ───────────────────────────────────────────────
          Owner: *"stick to the bottom so that the video in the background is
          easily more visible."* Then: *"reduce the chat area's height a little
          more."* Then: *"it should stick to the bottom. It should not rise
          up."*

          ── ⚠️ `mt-auto` PLUS A DEFINITE HEIGHT, NOT `flex-1` AFTER A SPACER ──
          The previous arrangement was a `clamp()`-sized spacer above a `flex-1`
          card, which is the same geometry written backwards — the card was
          "whatever is left", so every adjustment meant reasoning about the gap
          instead of about the card. Worse, it made the card grow to fill any
          space the spacer's `clamp` gave back, which is exactly the "rising up"
          the owner saw on a tall window.

          `mt-auto` pins the card to the bottom of the column and a definite
          height says how tall it is. The backdrop above is then simply what is
          left over — which is the right way round, because the instruction is
          about the card.

          ⚠️ `min(26rem, 74%)` — 26rem where there is room, and a proportion of
          the stage where there is not, so a short window shrinks the card
          rather than overflowing the page. Both terms are needed: a fixed
          height alone overflows at 720px, and a percentage alone gives a
          900px-tall chat box on a big monitor, which is a worse shape to read
          a paragraph in, not a better one.

          ── ⚠️ `bg-bg-surface`, AND NOT `.glass`. THIS WAS TRIED AND REJECTED ─
          The card was glass for one revision: a translucent tint with a blur,
          on the reasoning that letting the brain glow faintly through would tie
          the card to its backdrop.

          The owner's verdict, 2026-08-27: *"In the light theme remove this
          overlay. This overlay is not good so please do it in both themes."*
          And they are right. `.glass` in light mode is white at 88% — over a
          pale studio clip that reads as a milky sheet laid across the artwork
          rather than as a panel resting on it, and the mock dashboard panels in
          the video show through the conversation as grey ghosts.

          An opaque surface is also what their reference design shows: a clean
          white card, with the brain visible AROUND it, not under it. The card
          earns its place on the backdrop through its shadow and its radius, not
          by being see-through.

          ⚠️ This also removes the reason the text-contrast measurement was
          delicate. Body text now sits on a known token instead of on whatever
          frame the video happened to be showing. */}
      {/* ⚠️ `max-w-3xl`. It was `4xl` for one revision, on the owner's *"increase
          the chat area a little bit"* — and their next look reversed it: *"its
          width reduced a little also."* 48rem also holds an answer's bullet list
          inside a comfortable ~90-character measure, which 56rem did not. */}
      {/* ⚠️ `px-4 sm:px-6 pb-4` — the other half of the shell padding this
          container cancelled. Without it the card would sit flush against the
          window edges on a narrow screen. */}
      {/* ⚠️ The card's geometry, its minimise control and its delayed entrance
          all live in `AssistantStage` — it is a Client Component because every
          one of those is a browser concern, and keeping them together is what
          stops the open and minimised states drifting into two different
          widths. This page decides WHAT is on the screen; that decides how the
          card behaves. */}
      <AssistantStage
        who={user.fullName}
        avatarUrl={user.avatarUrl ?? null}
        suggestions={suggestions}
      />
    </div>
  );
}
