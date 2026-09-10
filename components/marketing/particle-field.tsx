'use client';

/* ============================================================================
 * AMBIENT PARTICLE FIELD — motes, links, and a pointer that disturbs them
 * ----------------------------------------------------------------------------
 * Owner's brief: brighter motes, thin lines between them, and something that
 * responds to the cursor.
 *
 * ── HOW THIS AVOIDS LOOKING LIKE EVERY OTHER PARTICLE CANVAS ────────────────
 * The parts that make that effect look like a demo are the ones tuned down
 * here rather than left out:
 *
 *   · Links are hairlines (0.6px) whose opacity falls off with the SQUARE of
 *     distance, so the web thins out fast instead of turning into a net.
 *   · A mote links to at most a few neighbours. Without that cap the middle of
 *     a dense patch becomes a solid triangle of lines.
 *   · The pointer does not shove anything. It has its own, larger link radius,
 *     it brightens what it is near, and it pulls very gently — an eddy, not a
 *     repulsion field.
 *   · One slow diagonal drift with wrap-around; nothing bounces off an edge.
 *
 * ── WHY CANVAS ──────────────────────────────────────────────────────────────
 * ~110 elements each with its own transform animation is 110 composited layers
 * and a long style recalc on every resize. One canvas is one layer.
 * ========================================================================= */

import * as React from 'react';

type Mote = {
  x: number;
  y: number;
  r: number;
  /** 0 = far, 1 = near. Drives size, speed and brightness together. */
  depth: number;
  /** Phase offset so the field does not pulse in unison. */
  phase: number;
  /** Per-frame nudge from the pointer, decayed back to zero. */
  vx: number;
  vy: number;
};

/** Motes per million device-independent pixels — density, not a fixed count,
 *  so a wide monitor is not sparser than a laptop. */
const DENSITY = 66;
const MAX_MOTES = 110;
/** How close two motes must be to draw a line, and how close the pointer must
 *  be to reach one. The pointer's radius is larger so its web is the feature. */
const LINK_DIST = 132;
const POINTER_DIST = 200;
/** ⚠️ Cap the lines out of any one mote. In a dense patch an uncapped search
 *  fills the middle with a solid wedge of hairlines and the delicacy is gone. */
const MAX_LINKS_PER_MOTE = 4;

export function ParticleField({ className }: { className?: string }) {
  const ref = React.useRef<HTMLCanvasElement>(null);

  React.useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const host = canvas.parentElement;

    const still = window.matchMedia('(prefers-reduced-motion: reduce)');
    let motes: Mote[] = [];
    let width = 0;
    let height = 0;
    let raf = 0;
    let running = false;
    /* Time-based, not frame-based: the drift must look the same on a 144Hz
       monitor as on a 60Hz one. */
    let last = 0;
    /** Pointer in canvas coordinates; null when it is not over the band. */
    let px: number | null = null;
    let py: number | null = null;

    const seed = () => {
      const count = Math.min(MAX_MOTES, Math.round((width * height) / 1_000_000 * DENSITY));
      motes = Array.from({ length: count }, () => {
        const depth = Math.random();
        return {
          x: Math.random() * width,
          y: Math.random() * height,
          r: 0.6 + depth * 1.8,
          depth,
          phase: Math.random() * Math.PI * 2,
          vx: 0,
          vy: 0,
        };
      });
    };

    const measure = () => {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return false;
      width = rect.width;
      height = rect.height;
      /* Capped at 2: a 3x screen triples the fill cost for a difference nobody
         can see on a 2px dot. */
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return true;
    };

    const draw = (t: number) => {
      const dt = last ? Math.min((t - last) / 1000, 0.05) : 0;
      last = t;
      ctx.clearRect(0, 0, width, height);

      for (const m of motes) {
        if (dt) {
          /* One direction for the whole field — up and slightly right — at a
             speed set by depth. */
          m.y -= (5 + m.depth * 15) * dt;
          m.x += (1.2 + m.depth * 4) * dt;

          /* A gentle pull toward the pointer, then friction. Deliberately weak:
             the cursor should disturb the field, not command it. */
          if (px !== null && py !== null) {
            const dx = px - m.x;
            const dy = py - m.y;
            const d2 = dx * dx + dy * dy;
            if (d2 < POINTER_DIST * POINTER_DIST && d2 > 1) {
              const d = Math.sqrt(d2);
              const pull = (1 - d / POINTER_DIST) * 26 * dt;
              m.vx += (dx / d) * pull;
              m.vy += (dy / d) * pull;
            }
          }
          m.vx *= 0.94;
          m.vy *= 0.94;
          m.x += m.vx * dt * 12;
          m.y += m.vy * dt * 12;

          if (m.y < -6) { m.y = height + 6; m.x = Math.random() * width; }
          if (m.y > height + 6) m.y = -6;
          if (m.x > width + 6) m.x = -6;
          if (m.x < -6) m.x = width + 6;
        }
      }

      /* ── Links first, so the motes sit ON the web rather than under it ──── */
      ctx.lineWidth = 0.6;
      for (let i = 0; i < motes.length; i++) {
        const a = motes[i];
        let drawn = 0;
        for (let j = i + 1; j < motes.length && drawn < MAX_LINKS_PER_MOTE; j++) {
          const bm = motes[j];
          const dx = a.x - bm.x;
          const dy = a.y - bm.y;
          const d2 = dx * dx + dy * dy;
          if (d2 > LINK_DIST * LINK_DIST) continue;
          drawn++;
          /* Squared falloff: the web thins out fast instead of becoming a net. */
          const near = 1 - d2 / (LINK_DIST * LINK_DIST);
          const alpha = near * near * 0.5 * (0.5 + (a.depth + bm.depth) / 2);
          ctx.strokeStyle = `rgba(96, 214, 217, ${alpha})`;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(bm.x, bm.y);
          ctx.stroke();
        }

        /* The pointer's own web — brighter, and reaching further. */
        if (px !== null && py !== null) {
          const dx = a.x - px;
          const dy = a.y - py;
          const d2 = dx * dx + dy * dy;
          if (d2 < POINTER_DIST * POINTER_DIST) {
            const near = 1 - d2 / (POINTER_DIST * POINTER_DIST);
            ctx.strokeStyle = `rgba(170, 242, 244, ${near * near * 0.58})`;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(px, py);
            ctx.stroke();
          }
        }
      }

      /* ── Then the motes ─────────────────────────────────────────────────── */
      for (const m of motes) {
        /* A slow breath, out of phase per mote. */
        const pulse = 0.66 + 0.34 * Math.sin(t / 2600 + m.phase);
        let alpha = (0.4 + m.depth * 0.58) * pulse;

        /* Brighter near the cursor. */
        if (px !== null && py !== null) {
          const dx = m.x - px;
          const dy = m.y - py;
          const d2 = dx * dx + dy * dy;
          if (d2 < POINTER_DIST * POINTER_DIST) {
            alpha = Math.min(1, alpha + (1 - d2 / (POINTER_DIST * POINTER_DIST)) * 0.5);
          }
        }

        const rad = m.r * 4.2;
        const g = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, rad);
        g.addColorStop(0, `rgba(178, 245, 246, ${alpha})`);
        g.addColorStop(0.36, `rgba(96, 214, 217, ${alpha * 0.5})`);
        g.addColorStop(1, 'rgba(47, 163, 169, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(m.x, m.y, rad, 0, Math.PI * 2);
        ctx.fill();
      }

      if (running) raf = window.requestAnimationFrame(draw);
    };

    const start = () => {
      if (running || still.matches) return;
      running = true;
      last = 0;
      raf = window.requestAnimationFrame(draw);
    };
    const stop = () => {
      running = false;
      window.cancelAnimationFrame(raf);
    };

    if (!measure()) return;
    seed();

    if (still.matches) {
      /* One static frame. The field is part of the picture, so it should still
         be there — it simply must not move, and the pointer must not stir it. */
      draw(0);
      return;
    }

    /* ⚠️ Only while it is on screen. A canvas animating behind three
       screenfuls of scrolled-past page is pure battery cost. */
    const watcher = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) start();
        else stop();
      },
      { threshold: 0 },
    );
    watcher.observe(canvas);

    /* ⚠️ Listened for on the BAND, not the canvas: the canvas is
       `pointer-events: none` so that it never swallows a click meant for the
       screenshot or a card, which also means it receives no pointer events of
       its own. Coordinates are converted through the canvas's own rect. */
    const onPointer = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      px = event.clientX - rect.left;
      py = event.clientY - rect.top;
    };
    const onLeave = () => { px = null; py = null; };
    const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    if (fine && host) {
      host.addEventListener('pointermove', onPointer, { passive: true });
      host.addEventListener('pointerleave', onLeave, { passive: true });
    }

    const onVisibility = () => (document.hidden ? stop() : start());
    document.addEventListener('visibilitychange', onVisibility);

    let resizeTimer = 0;
    const onResize = () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        if (measure()) seed();
      }, 160);
    };
    window.addEventListener('resize', onResize, { passive: true });

    const onPreference = () => {
      if (!still.matches) return;
      stop();
      onLeave();
      draw(0);
    };
    still.addEventListener('change', onPreference);

    return () => {
      stop();
      watcher.disconnect();
      if (fine && host) {
        host.removeEventListener('pointermove', onPointer);
        host.removeEventListener('pointerleave', onLeave);
      }
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('resize', onResize);
      still.removeEventListener('change', onPreference);
      window.clearTimeout(resizeTimer);
    };
  }, []);

  return <canvas ref={ref} className={className} aria-hidden="true" />;
}
