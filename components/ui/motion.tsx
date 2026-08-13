import * as React from 'react';

import { cn } from '@/lib/utils';

/* ============================================================================
 * REVEAL — staggered arrival
 * ----------------------------------------------------------------------------
 * Reference video 1: the panels do not all appear at once, they land in sequence
 * from the top left. `.reveal` in styles/tokens.css does the animating; this only
 * numbers the children, because the delay is `calc(var(--reveal-index) *
 * var(--duration-stagger))` and something has to set the index.
 *
 * A server component on purpose. The stagger is CSS from first paint — there is
 * no state, no effect and no client bundle, and a server-rendered page animates
 * in before any JavaScript has arrived.
 *
 * ── WHY A WRAPPER AND NOT A CLASS ON EACH CARD ────────────────────────────────
 * The index has to be the child's position, and writing `--reveal-index: 3` by
 * hand on the fourth card is a number that goes wrong the first time somebody
 * reorders them or makes one conditional. Here it is the array index, which
 * cannot disagree with the order on screen.
 *
 * Transform and opacity only — see the `.reveal` keyframes. Animating height or
 * margin would reflow the whole page once per frame per card, which on a
 * dashboard of twelve panels is the sort of thing that makes a redesign feel
 * slower than what it replaced. `prefers-reduced-motion` cancels the animation in
 * CSS and pins the end state, so nothing is left invisible.
 * ========================================================================= */

export function Reveal({
  children,
  as: Component = 'div',
  from = 0,
  className,
}: {
  children: React.ReactNode;
  as?: 'div' | 'ul' | 'section';
  /** First index, for a second group that should continue rather than restart. */
  from?: number;
  className?: string;
}) {
  const items = React.Children.toArray(children);

  return (
    <Component className={className}>
      {items.map((child, i) => (
        <div
          key={React.isValidElement(child) && child.key !== null ? child.key : i}
          className="reveal"
          style={{ '--reveal-index': from + i } as React.CSSProperties}
        >
          {child}
        </div>
      ))}
    </Component>
  );
}

/**
 * One element, revealed at a chosen position in a sequence.
 *
 * For a layout whose children are not siblings of one wrapper — a three-column
 * dashboard where the stagger should read across the columns rather than down
 * each one. `Reveal` cannot number those, because they are in different parents.
 */
export function RevealItem({
  children,
  index = 0,
  className,
}: {
  children: React.ReactNode;
  index?: number;
  className?: string;
}) {
  return (
    <div className={cn('reveal', className)} style={{ '--reveal-index': index } as React.CSSProperties}>
      {children}
    </div>
  );
}
