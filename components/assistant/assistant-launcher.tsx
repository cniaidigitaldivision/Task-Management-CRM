'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ExternalLink, Sparkles, X } from 'lucide-react';

import { AssistantChat } from '@/components/assistant/assistant-chat';
import { LogoMark } from '@/components/brand/logo';
import { IconButton } from '@/components/ui/button';
import { APP_NAME } from '@/lib/domain/constants';

/* ============================================================================
 * THE FLOATING LAUNCHER, AND THE PANEL IT OPENS
 * ----------------------------------------------------------------------------
 * Owner, 2026-08-26: *"I want to add the AI assistance icon in the bottom
 * right. When clicked, a chat opens."*
 *
 * ── ⚠️ IT IS NEVER RENDERED FOR SOMEBODY WHO MAY NOT USE IT ────────────────
 * `app/(app)/layout.tsx` resolves `mayUseAssistant` on the server and does not
 * mount this component at all for anybody else — it is not hidden with CSS and
 * not disabled. A Member's page payload contains no launcher, no chat, and no
 * action reference. Same rule the finance page follows, and for the same
 * reason: a Client Component's props are serialised into the RSC payload, so
 * "rendered but hidden" is readable in view-source.
 *
 * ── ⚠️ THE PANEL IS MODELESS, AND IT USED TO BE A `<Drawer>` ───────────────
 * Owner, 2026-08-27: *"when the AI assistant chat is open in the bottom right,
 * it should not blur the background page. The background page was still working
 * and the chat was open. It will not close unless I click on the close button
 * [...] It would not be like that: if I click somewhere on the screen, that chat
 * will be closed."*
 *
 * That is a different KIND of surface, not a restyled one. `<Drawer>` is built
 * on `dialog.showModal()`, and every one of its behaviours is the opposite of
 * what was asked for:
 *
 *   · `::backdrop` dims and blurs the page          → asked for no blur
 *   · the top layer makes everything else inert     → asked for a working page
 *   · the backdrop-dismiss gesture closes on a click → asked to close only on ✕
 *   · the scroll lock freezes the page behind it    → asked for a working page
 *
 * Reaching for `variant="panel"` on the shared Drawer was the first attempt and
 * it was wrong: it changed the geometry and kept all four behaviours. Those
 * belong to a modal, and this is not one. So this is a plain positioned panel,
 * and what a modal would have given for free is re-supplied deliberately below
 * — Escape, and focus that moves in and comes back.
 *
 * ⚠️ THE COST, STATED: no focus trap. That is correct for a modeless surface —
 * tabbing out to the page behind is the POINT, since the page is meant to stay
 * usable — but it means this must never hold anything that requires a decision
 * before continuing. It holds a chat. Keep it that way.
 *
 * ── ⚠️ z-index: THE PANEL IS z-40, THE LAUNCHER z-30, THE RAIL z-50 ────────
 * The sidebar is `fixed z-50`, and `components/vault/credential-details.tsx:46`
 * records what happens to anything that tries to outrank it: on a screen with
 * the rail showing, the rail wins and the thing underneath is unreachable. So
 * the panel sits ABOVE page content and BELOW the navigation, which is the
 * right order — when the mobile nav is open, the nav wins.
 *
 * ── ⚠️ AND IT DISAPPEARS ON THE ASSISTANT'S OWN PAGES ──────────────────────
 * Owner: *"This AI chat button at the bottom right should not appear in the AI
 * assistant because the AI assistant already has a chat, right?"* — right. Two
 * chats on one screen is not a shortcut, it is a question about which one is
 * real.
 *
 * ⚠️ Decided HERE, in the browser, rather than in `app/(app)/layout.tsx` where
 * this is mounted. That layout is a Server Component and does not re-run on a
 * client-side navigation, so a check there would be correct on a hard load and
 * stale the moment somebody clicked "AI Assistant" in the rail — the button
 * would linger until the next full refresh. `usePathname` follows every
 * navigation.
 *
 * ⚠️ That is a PRESENTATION rule, not a permission. Who may see this at all is
 * still decided on the server, by not mounting the component.
 * ========================================================================= */

export function AssistantLauncher({
  who,
  avatarUrl,
}: {
  who: string;
  avatarUrl: string | null;
}) {
  const [open, setOpen] = React.useState(false);
  const pathname = usePathname();

  const panelRef = React.useRef<HTMLDivElement>(null);
  const buttonRef = React.useRef<HTMLButtonElement>(null);

  /* ── ⚠️ ESCAPE, RE-SUPPLIED BY HAND ──────────────────────────────────────
     `<dialog>` gave this for free and a positioned div does not. It is kept
     even though the owner asked for the close button to be the way out,
     because Escape is not "clicking somewhere on the screen" — it is a
     deliberate keypress, it is what every overlay in this product already
     answers to, and for somebody who cannot use a mouse it is the ONLY way
     out. The instruction was about not losing a conversation to a stray
     click; this cannot be pressed by accident. */
  React.useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  /* ── ⚠️ FOCUS IN, AND FOCUS BACK ─────────────────────────────────────────
     The other thing `<dialog>` did for free. Without it a keyboard user opens
     the panel and their focus is still on the launcher behind it, so the next
     Tab walks into the page rather than into the chat — the panel is visible
     and unreachable.

     ⚠️ `preventScroll`. Focusing an element normally scrolls it into view, and
     the panel is `fixed` — so the browser scrolls the PAGE behind it trying to
     reveal something that never moves. On a long page that is a visible jump
     every time the panel opens.

     ⚠️ Returning focus is done in the close handler rather than in this
     effect's cleanup: cleanup also runs when the component unmounts on
     navigation, and yanking focus back to a button that is being removed lands
     it on `<body>`. */
  React.useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      panelRef.current?.querySelector('textarea')?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);

  const close = () => {
    setOpen(false);
    buttonRef.current?.focus({ preventScroll: true });
  };

  /* `/assistant` and everything under it — the chat page and the activity
     screen both belong to the feature, and neither wants a floating shortcut
     back to itself. ⚠️ The `/` guard stops `/assistant-archive`, or any future
     route that merely begins with those characters, matching by accident. */
  if (pathname === '/assistant' || pathname.startsWith('/assistant/')) return null;

  return (
    <>
      {/* ⚠️ `right-5` and NOT offset by `--rail`. The rail is on the LEFT, and
          the content column already carries `pl-[var(--rail)]` — a right-anchored
          button never overlaps it. Offsetting would push the launcher inward for
          no reason and look like a mistake at wide widths. */}
      <button
        ref={buttonRef}
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-label={open ? 'Close the assistant' : 'Ask the assistant'}
        title={open ? 'Close the assistant' : 'Ask the assistant'}
        aria-expanded={open}
        className="assistant-orb assistant-launcher fixed right-5 bottom-5 z-30 grid h-12 w-12 place-items-center rounded-full transition-transform duration-[var(--duration-fast)] hover:scale-105 active:scale-95"
      >
        {/* ⚠️ The icon states what the NEXT click does. A launcher that keeps
            its sparkle while the panel is open offers to open something that is
            already open. */}
        {open ? (
          <X className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
        ) : (
          <Sparkles className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
        )}
      </button>

      {open && (
        <div
          ref={panelRef}
          /* ⚠️ `role="dialog"` WITHOUT `aria-modal`. The element is a dialog —
              a named surface layered over the page — but it is explicitly not
              modal, and claiming otherwise tells a screen reader the rest of
              the page is unavailable when it is fully usable. */
          role="dialog"
          aria-label={`${APP_NAME} AI Assistant`}
          /* ── ⚠️ THE GEOMETRY, AND WHY EACH TERM IS THERE ──────────────────
              `bottom-20` clears the launcher (3rem tall at `bottom-5`), so the
              button stays visible and clickable while the panel is open — it
              is the close control as well as the open one.

              A FIXED height, not `max-h`. With a maximum only the panel is as
              tall as its content, so it opens at ~334px and then grows with
              every answer. Measured. A panel anchored to the BOTTOM grows
              UPWARD, so the header walks up the screen while somebody is
              reading it. A definite height means the transcript scrolls inside
              instead, which is what every other chat surface here does.

              ⚠️ The `dvh` is DIVIDED BY `--ui-scale`. The shell puts `zoom` on
              <body>, so a viewport unit resolves in the ZOOMED space — the trap
              `dialog.tsx` records for its own max-height and the assistant page
              records again. `dvh` rather than `vh` on top of that, because on a
              phone the browser's own chrome moves.

              ⚠️ `fixed` works here ONLY because `app-shell.tsx` renders the
              `launcher` prop outside `<main class="reveal-children">`. A
              transformed ancestor becomes the containing block for a fixed
              descendant, and this would be pinned to `<main>` instead of the
              viewport. That is written up on the `launcher` prop; do not move
              this back inside the layout column. */
          style={{ height: 'min(34rem, calc(76dvh / var(--ui-scale, 1)))' }}
          className="drawer-panel-in fixed right-5 bottom-20 z-40 flex w-[min(27rem,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-2xl border border-border-default bg-bg-surface shadow-[var(--shadow-xl)]"
        >
          <div className="flex shrink-0 items-center gap-2.5 border-b border-border-subtle px-4 py-3">
            {/* ── ⚠️ ONE MARK IN THE HEADER, AND IT IS THE LOGO ──────────────
                Owner: *"In the top bar you can say Taskly. If you can add the
                logo, that will be good."* Then, on seeing both: *"If you are
                using the Taskly logo then don't use a brain with the Taskly AI
                assistant in the header. Only use one image. That logo is fine
                here and the brain is near the bottom, which is good."*

                Right — the logo and the brain were saying the same thing twice
                in a 27rem-wide bar, and two marks side by side read as a
                co-branding lockup between two products rather than as one
                product's assistant. The brain still introduces the assistant in
                the greeting below, where it has room to be the subject. */}
            <LogoMark width={24} className="shrink-0" />

            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-caption leading-tight font-semibold text-text-primary">
                <span className="truncate">{APP_NAME} AI Assistant</span>
                {/* ⚠️ "Live" is a factual claim, not decoration: this assistant
                    reads the database at the moment you ask rather than
                    recalling anything, and that is the single most important
                    thing to know about its answers. */}
                <span
                  className="inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-micro font-medium"
                  style={{
                    background: 'color-mix(in oklab, var(--feedback-success) 14%, transparent)',
                    color: 'var(--feedback-success)',
                  }}
                >
                  <span
                    aria-hidden="true"
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ background: 'currentColor' }}
                  />
                  Live
                </span>
              </p>
              <p className="truncate text-micro text-text-tertiary">
                Answers from your live workspace
              </p>
            </div>

            {/* Somebody who wants room to work should be able to get there
                without hunting the sidebar for it. */}
            <Link
              href="/assistant"
              onClick={() => setOpen(false)}
              className="inline-flex shrink-0 items-center gap-1 text-micro font-medium text-text-brand underline-offset-2 hover:underline"
            >
              Open full page
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </Link>

            <IconButton label="Close the assistant" icon={X} size="sm" onClick={close} />
          </div>

          {/* ⚠️ `compact`, which tightens the padding — the panel is 27rem wide
              against the page's 48rem, and the page's spacing reads as slack
              here. Same component either way, so the two cannot drift into two
              different chats, and an answer is formatted identically in both.

              ⚠️ `min-h-0 flex-1` and no scroll of its own: the chat has a
              transcript that overflows internally and an input pinned under it.
              A wrapper with `overflow-y-auto` would give the panel a SECOND
              scrollbar outside the first, and the input would scroll away with
              the conversation. */}
          <AssistantChat
            who={who}
            avatarUrl={avatarUrl}
            compact
            intro
            className="min-h-0 flex-1"
            suggestions={['What is overdue?', 'Who is free this week?', "Today's priorities"]}
          />
        </div>
      )}
    </>
  );
}
