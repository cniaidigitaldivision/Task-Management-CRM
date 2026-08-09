'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';

/* ============================================================================
 * FLOATING SCROLLBAR — a horizontal bar that stays on screen
 * ----------------------------------------------------------------------------
 * Owner instruction, Session 19: *"for scrolling towards the left or right the
 * scrollbar is literally at the bottom — I don't want to scroll down to the
 * bottom just for moving to the right."*
 *
 * The task board is about 2,370px wide (eight 286px columns plus gaps) and as
 * TALL as its fullest column, which is thousands of pixels. A scroll container's
 * horizontal bar sits at the bottom of the CONTAINER, not the bottom of the
 * screen — so reaching it meant scrolling to the end of the longest column
 * first, every time.
 *
 * ── HOW IT WORKS ─────────────────────────────────────────────────────────────
 * A second, empty scroll container — this one only as tall as a scrollbar — is
 * given a spacer exactly as wide as the real content. It therefore gets a
 * scrollbar with identical proportions. The two scroll positions are mirrored,
 * so dragging either moves both.
 *
 * `position: sticky; bottom: 0` does the rest, and does it without measuring
 * anything: while the board's end is below the fold the bar rides the bottom of
 * the viewport, and the moment the board's real end scrolls into view the bar
 * settles into its natural place underneath it. No scroll listener, no
 * viewport arithmetic, nothing to keep in step on resize.
 *
 * ── WHY THE REAL SCROLLBAR IS HIDDEN RATHER THAN LEFT ALONE ──────────────────
 * Two bars for one scroller looks broken, and the owner's specific worry about
 * this approach was that it would. `.scrollbar-hidden` suppresses the BAR only —
 * wheel, shift-wheel, trackpad, keyboard and programmatic scrolling all still
 * work on the real element, which is also what the drag auto-scroll drives.
 * There is exactly one bar at any moment, and it is always reachable.
 *
 * ── THE SYNC CANNOT LOOP ─────────────────────────────────────────────────────
 * Assigning `scrollLeft` fires a `scroll` event, so mirroring naively is an
 * infinite bounce. Each handler compares before it assigns: by the time the
 * echo arrives the two values are equal and it does nothing. No flags, no
 * requestAnimationFrame, no debounce.
 * ========================================================================= */

/* ── The scroller's geometry is EXTERNAL state, so it is read as external state
 * ---------------------------------------------------------------------------
 * `useSyncExternalStore`, matching components/brand/theme-provider.tsx and the
 * rail pin in app-shell.tsx. Two reasons it is the right tool rather than an
 * effect with `setState`:
 *
 *  1. It gets a correct FIRST value without measuring in an effect body, which
 *     is the cascading render `react-hooks/set-state-in-effect` exists to stop.
 *
 *  2. It does not depend on ResizeObserver's initial callback. The first version
 *     did, on the reasonable belief that observing an element always delivers
 *     one — and it does, EXCEPT while the page is not being rendered. In a
 *     background tab (`visibilityState: "hidden"`) the resize-observation step
 *     never runs, so the bar never appeared. React re-reads the snapshot itself
 *     immediately after subscribing, so the measurement lands either way.
 *
 * The snapshot is a STRING, not an object. `useSyncExternalStore` compares
 * snapshots by identity, so returning a fresh `{ scrollWidth, clientWidth }`
 * each call would re-render forever. */
function useScrollGeometry(targetRef: React.RefObject<HTMLElement | null>) {
  const subscribe = React.useCallback(
    (onChange: () => void) => {
      const target = targetRef.current;
      if (!target) return () => {};

      /* The scroller for width changes — the navigation rail opening animates
         it over 240ms — and its content for changes to the content's width. */
      const observer = new ResizeObserver(onChange);
      observer.observe(target);
      if (target.firstElementChild) observer.observe(target.firstElementChild);
      window.addEventListener('resize', onChange);

      return () => {
        observer.disconnect();
        window.removeEventListener('resize', onChange);
      };
    },
    [targetRef],
  );

  const getSnapshot = React.useCallback(() => {
    const target = targetRef.current;
    return target ? `${target.scrollWidth}:${target.clientWidth}` : '0:0';
  }, [targetRef]);

  /* Nothing is measurable on the server, and the bar is hidden at 0:0 anyway. */
  const getServerSnapshot = React.useCallback(() => '0:0', []);

  const snapshot = React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [scrollWidth, clientWidth] = snapshot.split(':').map(Number);

  return {
    contentWidth: scrollWidth,
    /* A pixel of tolerance — sub-pixel layout rounding otherwise reports a
       permanent one-pixel overflow at some zoom levels. */
    overflowing: scrollWidth - clientWidth > 1,
  };
}

export function FloatingScrollbar({
  targetRef,
  className,
}: {
  /** The element that actually scrolls. Give it `.scrollbar-hidden`. */
  targetRef: React.RefObject<HTMLElement | null>;
  /** Bleed classes, so the bar lines up with the scroller it represents. */
  className?: string;
}) {
  const proxyRef = React.useRef<HTMLDivElement>(null);
  const { contentWidth, overflowing } = useScrollGeometry(targetRef);

  /* ── Mirror, in both directions ────────────────────────────────────────────
     Re-runs when `overflowing` flips, because until then the proxy is display:
     none and setting `scrollLeft` on it would silently do nothing. */
  React.useEffect(() => {
    const target = targetRef.current;
    const proxy = proxyRef.current;
    if (!target || !proxy || !overflowing) return;

    const fromTarget = () => {
      if (proxy.scrollLeft !== target.scrollLeft) proxy.scrollLeft = target.scrollLeft;
    };
    const fromProxy = () => {
      if (target.scrollLeft !== proxy.scrollLeft) target.scrollLeft = proxy.scrollLeft;
    };

    /* Adopt whatever position the board is already at — it may have been
       scrolled before this became visible. */
    fromTarget();

    target.addEventListener('scroll', fromTarget, { passive: true });
    proxy.addEventListener('scroll', fromProxy, { passive: true });
    return () => {
      target.removeEventListener('scroll', fromTarget);
      proxy.removeEventListener('scroll', fromProxy);
    };
  }, [targetRef, overflowing]);

  return (
    <div
      /* `aria-hidden`: this is a duplicate control for something already
         reachable. The real scroller keeps its keyboard and assistive-technology
         behaviour; announcing an empty second scroll region would only add
         noise. */
      aria-hidden="true"
      className={cn(
        'sticky bottom-0 z-30',
        /* Readable over whatever card it happens to be floating above, without
           looking like a band pasted across the page. */
        'border-t border-border-subtle bg-bg-base/85 backdrop-blur-sm',
        !overflowing && 'hidden',
        className,
      )}
    >
      <div ref={proxyRef} className="h-3 overflow-x-auto overflow-y-hidden">
        <div style={{ width: contentWidth, height: 1 }} />
      </div>
    </div>
  );
}
