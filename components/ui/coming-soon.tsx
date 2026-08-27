import * as React from 'react';
import { Sparkles, type LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

import { Card, CardBody } from './card';

/* ============================================================================
 * COMING SOON — the panel for a tab that is honestly empty
 * ----------------------------------------------------------------------------
 * Owner, 2026-08-24: *"right now it's showing 'Coming Soon' but it's not looking
 * good. Please make it good."* And of Analytics: *"this has nothing to show.
 * Instead of showing this, show 'Coming Soon'."*
 *
 * Two tabs were each hand-rolling their own version of this. Content had a
 * circle, a bold line and a sentence; Analytics had a grey icon over a paragraph
 * apologising for not reading the Meta API. Neither looked designed, and they did
 * not look like each other — which is what makes an unfinished feature read as a
 * broken one rather than as a planned one.
 *
 * ── WHY THIS IS A COMPONENT AND NOT A SNIPPET ────────────────────────────────
 * There are two of these today and there will be more: an unbuilt tab is a
 * recurring state in a product this size. One component means the fifth one costs
 * nothing and cannot look different from the first four.
 *
 * ── WHAT MAKES IT NOT LOOK CHEAP ─────────────────────────────────────────────
 * Three things, all deliberate:
 *
 *   1. IT SAYS WHAT THE FEATURE WILL DO. A bare "coming soon" tells the reader
 *      nothing except that somebody has not finished. `bullets` turns the empty
 *      state into a description of the plan, which is information rather than an
 *      apology.
 *   2. IT SAYS WHERE TO GO NOW. `insteadOf` points at the screen that already
 *      answers the question, so nobody is left at a dead end.
 *   3. IT IS BUILT ON THE BRAND TINT, NOT ON GREY. A grey panel reads as
 *      disabled. The soft brand wash and the ringed tile read as "not yet",
 *      which is the true statement.
 *
 * No illustration and no placeholder chart. A fake chart in an Analytics tab is
 * the one thing here that would be actively dishonest — somebody would screenshot
 * it. See the note in the project workspace where this replaced exactly that
 * temptation.
 * ========================================================================= */

export function ComingSoon({
  icon: Icon,
  title,
  description,
  bullets,
  insteadOf,
  className,
}: {
  /** The tab's own icon, so the panel is recognisably part of that tab. */
  icon: LucideIcon;
  /** What is coming. A noun phrase — "Content planning", not "This feature". */
  title: string;
  /** One or two sentences. Why it does not exist yet is more useful than that it
   *  does not: a reader who knows the reason stops filing it as a bug. */
  description: React.ReactNode;
  /** What it will do, once it does. Three or four short lines is the useful
   *  range — this is a description, not a specification. */
  bullets?: readonly string[];
  /** Where to go in the meantime. Rendered under a rule, so it reads as a
   *  footnote rather than as part of the promise. */
  insteadOf?: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardBody className="px-5 py-10 sm:px-8 sm:py-14">
        <div className="mx-auto flex max-w-[38rem] flex-col items-center text-center">
          {/* The ringed tile. Two nested layers rather than one bordered circle:
              the outer wash is what stops the icon looking like it is floating on
              a blank panel, and it is cheap because both are colour-mixed from
              the same token. */}
          <span
            className="flex size-16 items-center justify-center rounded-2xl"
            style={{
              backgroundColor:
                'color-mix(in oklab, var(--accent-primary) var(--tint-soft), var(--bg-surface))',
            }}
          >
            <span
              className="flex size-11 items-center justify-center rounded-xl"
              style={{
                backgroundColor:
                  'color-mix(in oklab, var(--accent-primary) var(--tint-strong), var(--bg-surface))',
              }}
            >
              <Icon className="size-5 text-text-brand" strokeWidth={1.9} aria-hidden="true" />
            </span>
          </span>

          {/* The chip. Small, gold-free, and above the title rather than beside
              it — beside the title it competes with it for the same glance. */}
          <span
            className="mt-4 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-micro font-bold tracking-[0.08em] uppercase"
            style={{
              backgroundColor:
                'color-mix(in oklab, var(--accent-primary) var(--tint-strong), var(--bg-surface))',
              color: 'color-mix(in oklab, var(--accent-primary) 88%, var(--text-primary))',
            }}
          >
            <Sparkles className="size-3" strokeWidth={2.25} aria-hidden="true" />
            Coming soon
          </span>

          <h3 className="mt-2.5 text-h3 font-semibold text-text-primary">{title}</h3>

          <p className="mt-2 text-caption leading-relaxed text-text-secondary">{description}</p>

          {bullets && bullets.length > 0 && (
            /* Left-aligned inside a centred block: centred body text is fine for
               two lines and unreadable for a list, because the eye loses the
               start of each line. */
            <ul className="mt-5 w-full space-y-2 text-left">
              {bullets.map((line) => (
                <li key={line} className="flex items-start gap-2.5">
                  <span
                    aria-hidden="true"
                    className="mt-[7px] size-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: 'var(--accent-primary)' }}
                  />
                  <span className="text-caption text-text-secondary">{line}</span>
                </li>
              ))}
            </ul>
          )}

          {insteadOf && (
            <p
              className={cn(
                'mt-6 w-full border-t border-border-subtle pt-4',
                'text-micro text-text-tertiary',
              )}
            >
              {insteadOf}
            </p>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
