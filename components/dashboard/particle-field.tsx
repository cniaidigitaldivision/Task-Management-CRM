'use client';

import * as React from 'react';

import { REDUCED_MOTION_QUERY } from '@/lib/theme';
import { cn } from '@/lib/utils';

/* ============================================================================
 * THE PARTICLE FIELD
 * ----------------------------------------------------------------------------
 * A constellation drifting behind the dashboard: points of light that wander,
 * and draw a line to any neighbour they come close to. The mesh therefore forms
 * and dissolves on its own as the points move, which is what makes it read as
 * alive rather than as a looping texture.
 *
 * ── ⚠️ THE LINE COST IS QUADRATIC, AND THAT IS THE WHOLE DESIGN PROBLEM ─────
 * Naively, every point tests every other: 120 points is 7,140 pairs per frame,
 * and doubling the count quadruples the work. Two things keep it cheap:
 *
 *   · the pair loop starts at `i + 1`, so each pair is examined once rather
 *     than twice — half the work, and it also stops every line being stroked
 *     twice at double opacity;
 *   · the distance test is done on the SQUARE, never the square root. `Math.hypot`
 *     per pair is the single most expensive thing this file could do, and
 *     comparing squares answers exactly the same question.
 *
 * ── ⚠️ NO STATE, NO REACT, ONE CANVAS ───────────────────────────────────────
 * Positions live in a plain array and are mutated in place inside the frame
 * loop. Putting them in state would re-render the tree sixty times a second for
 * a decoration; this way React mounts the canvas once and never hears from it
 * again.
 * ========================================================================= */

interface Mote {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
}

/** Points per million square pixels — density, so a wide screen is not sparse. */
const DENSITY = 62;
const MAX_MOTES = 130;
/** Below this separation two motes are joined. Squared at use. */
const LINK_DISTANCE = 132;
/** How far the cursor's influence reaches. */
const CURSOR_REACH = 190;

export function ParticleField({ className }: { className?: string }) {
  const canvas = React.useRef<HTMLCanvasElement>(null);
  const probe = React.useRef<HTMLSpanElement>(null);

  React.useEffect(() => {
    const node = canvas.current;
    const swatch = probe.current;
    if (!node || !swatch) return;

    const context = node.getContext('2d');
    if (!context) return;

    /* ── Colour, resolved through a probe ──────────────────────────────────
       A canvas cannot take `var(--accent-primary)`, and reading the custom
       property gives back whatever it was DECLARED as — usually another
       `var()`. Setting it as a real colour on a throwaway element makes the
       browser resolve the whole chain. */
    let ink = 'rgb(47, 163, 169)';
    const readInk = () => {
      swatch.style.color = 'var(--accent-primary)';
      ink = getComputedStyle(swatch).color || ink;
    };
    const rgba = (alpha: number) => {
      const parts = ink.match(/-?\d+(\.\d+)?/g);
      if (!parts || parts.length < 3) return ink;
      return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${alpha.toFixed(3)})`;
    };
    readInk();

    const motes: Mote[] = [];
    let width = 0;
    let height = 0;
    let dpr = 1;
    /* Off-canvas until the pointer actually arrives, so nothing is attracted to
       the top-left corner before the reader has moved the mouse. */
    const cursor = { x: -9999, y: -9999 };

    const resize = () => {
      const box = node.getBoundingClientRect();
      width = Math.max(1, Math.round(box.width));
      height = Math.max(1, Math.round(box.height));
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      node.width = Math.round(width * dpr);
      node.height = Math.round(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);

      const want = Math.min(MAX_MOTES, Math.round((width * height * DENSITY) / 1_000_000));
      /* ⚠️ Grown and trimmed rather than rebuilt. Re-seeding on every resize
         would make the whole field jump each time a panel above it reflows —
         and a browser fires resize continuously while a window is dragged. */
      while (motes.length < want) {
        motes.push({
          x: Math.random() * width,
          y: Math.random() * height,
          vx: (Math.random() - 0.5) * 0.22,
          vy: (Math.random() - 0.5) * 0.22,
          r: 0.9 + Math.random() * 1.5,
        });
      }
      motes.length = want;
    };

    /* ⚠️ PAINTING AND LOOPING ARE SEPARATE FUNCTIONS. They started as one, and
       that made the still case impossible to express: drawing a single frame
       meant calling the function that also schedules the next one, so "draw
       once" quietly became "draw forever". `paint` advances and draws; `loop`
       is the only thing that ever schedules. */
    const paint = (advance: boolean) => {
      context.clearRect(0, 0, width, height);

      if (advance) {
        for (const mote of motes) {
          mote.x += mote.vx;
          mote.y += mote.vy;

          /* Wrap rather than bounce. A bounce makes the edges read as walls and
             the motes pile up along them; wrapping keeps the field uniform. */
          if (mote.x < -8) mote.x = width + 8;
          if (mote.x > width + 8) mote.x = -8;
          if (mote.y < -8) mote.y = height + 8;
          if (mote.y > height + 8) mote.y = -8;
        }
      }

      /* ── Links ───────────────────────────────────────────────────────────
         `j = i + 1` so each pair is considered once; squared distances so no
         pair ever needs a square root. */
      const linkSq = LINK_DISTANCE * LINK_DISTANCE;
      for (let i = 0; i < motes.length; i += 1) {
        for (let j = i + 1; j < motes.length; j += 1) {
          const dx = motes[i].x - motes[j].x;
          const dy = motes[i].y - motes[j].y;
          const dSq = dx * dx + dy * dy;
          if (dSq > linkSq) continue;
          /* Fades out as the pair separates, so a link never blinks off. */
          context.strokeStyle = rgba(0.16 * (1 - dSq / linkSq));
          context.lineWidth = 1;
          context.beginPath();
          context.moveTo(motes[i].x, motes[i].y);
          context.lineTo(motes[j].x, motes[j].y);
          context.stroke();
        }
      }

      /* ── The cursor's own links ──────────────────────────────────────────
         The field reaches towards the pointer, which is what turns a backdrop
         into something that acknowledges the reader. Drawn brighter than the
         mote-to-mote links so the gesture is legible. */
      const reachSq = CURSOR_REACH * CURSOR_REACH;
      for (const mote of motes) {
        const dx = mote.x - cursor.x;
        const dy = mote.y - cursor.y;
        const dSq = dx * dx + dy * dy;
        if (dSq > reachSq) continue;
        context.strokeStyle = rgba(0.3 * (1 - dSq / reachSq));
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(mote.x, mote.y);
        context.lineTo(cursor.x, cursor.y);
        context.stroke();
      }

      for (const mote of motes) {
        context.fillStyle = rgba(0.5);
        context.beginPath();
        context.arc(mote.x, mote.y, mote.r, 0, Math.PI * 2);
        context.fill();
      }
    };

    let raf = 0;
    const loop = () => {
      paint(true);
      raf = window.requestAnimationFrame(loop);
    };

    resize();

    const still = () => window.matchMedia?.(REDUCED_MOTION_QUERY).matches ?? false;

    const start = () => {
      window.cancelAnimationFrame(raf);
      /* Under reduced motion the constellation is drawn ONCE and left standing.
         It is still a handsome texture at rest, and drawing it rather than
         leaving the canvas blank means the panel keeps its backdrop. */
      if (still()) paint(false);
      else raf = window.requestAnimationFrame(loop);
    };

    /* ⚠️ Observed, not listened for on `window`. This canvas is sized by its
       container, which changes when panels above it reflow — a window resize
       listener would miss every one of those. */
    const observer = new ResizeObserver(() => {
      resize();
      if (still()) paint(false);
    });
    observer.observe(node);

    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return;
      const box = node.getBoundingClientRect();
      cursor.x = event.clientX - box.left;
      cursor.y = event.clientY - box.top;
    };
    const onLeave = () => {
      cursor.x = -9999;
      cursor.y = -9999;
    };

    /* On the window, not the canvas: the canvas sits behind the panels and
       `pointer-events: none`, so it never receives a pointer event of its own. */
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerleave', onLeave);

    const motion = window.matchMedia?.(REDUCED_MOTION_QUERY);
    motion?.addEventListener('change', start);

    const watchTheme = new MutationObserver(() => {
      readInk();
      if (still()) paint(false);
    });
    watchTheme.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    start();

    return () => {
      window.cancelAnimationFrame(raf);
      observer.disconnect();
      watchTheme.disconnect();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerleave', onLeave);
      motion?.removeEventListener('change', start);
    };
  }, []);

  return (
    <div aria-hidden="true" className={cn('pointer-events-none absolute inset-0', className)}>
      <span ref={probe} className="absolute size-0 opacity-0" />
      <canvas ref={canvas} className="h-full w-full" />
    </div>
  );
}
