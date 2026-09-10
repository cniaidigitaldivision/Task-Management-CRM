'use client';

/* ============================================================================
 * FLOW FIELD — currents of light drifting through the overview band
 * ----------------------------------------------------------------------------
 * ── ⚠️ WHAT THIS REPLACED, AND WHY ──────────────────────────────────────────
 * This was a constellation: dots joined to their neighbours by lines, with the
 * cursor lighting the ones near it. The owner's verdict was that they had seen
 * it in a lot of places, and they were right — it is the particles.js effect
 * and it is on a thousand sites. Tuning it well does not make it less familiar.
 *
 * So the STRUCTURE changed rather than the settings. There are no dots and no
 * links here. Invisible agents are carried along an invisible vector field and
 * the only thing drawn is the path each one takes: thin luminous threads that
 * curve, converge and thin out, like a long exposure of a current. The canvas
 * is never cleared — each frame erases a few percent of what is already there,
 * which is what leaves the trails and lets them fade instead of vanishing.
 *
 * It also happens to say the right thing for this product. Work moving through
 * a system is what the page is about, and a field of currents is that picture;
 * a lattice of connected dots is a network diagram, which is not.
 *
 * ── THE FIELD ITSELF ────────────────────────────────────────────────────────
 * Three layered sine waves rather than a Perlin implementation. It is a few
 * lines instead of a few hundred, it is smooth and non-repeating at this scale,
 * and drifting the phases makes the whole current slowly reorganise so the
 * shape is never quite the same twice.
 * ========================================================================= */

import * as React from 'react';

type Agent = {
  x: number;
  y: number;
  /** Frames left before it is respawned. Staggered so they do not all go at
   *  once, which would show as a visible pulse across the whole field. */
  life: number;
  /** 0 = faint and slow, 1 = bright and quick. */
  weight: number;
};

/** Agents per million device-independent pixels. */
const DENSITY = 185;
const MAX_AGENTS = 320;
/** How much of the canvas is erased each frame. Lower = longer trails.
 *
 *  ⚠️ THIS ACCUMULATES, AND IT TAKES ABOUT TWO MINUTES TO SETTLE. Each frame
 *  deposits light and erases a fixed fraction, so brightness climbs until the
 *  two balance. MEASURED at this value: mean alpha 3.6 at 10s, 12.2 at 110s,
 *  with the per-interval delta shrinking geometrically to an equilibrium near
 *  15/255 — about 6%, and pixels above 120 stay flat at 0.06% throughout, so
 *  it settles into a haze rather than washing out. Text contrast was checked
 *  AT that settled state, not at load; a sweep run seconds after page load
 *  reads a field far dimmer than the one somebody who lingers actually sees.
 *
 *  Lower this and the equilibrium rises proportionally. Anything under about
 *  .02 has not levelled off before a visitor has read the page. */
const FADE = 0.032;
const LIFE_MIN = 90;
const LIFE_VAR = 150;
/** How far the cursor's swirl reaches, and how hard it turns the current. */
const POINTER_DIST = 230;
const SWIRL = 2.1;

export function ParticleField({ className }: { className?: string }) {
  const ref = React.useRef<HTMLCanvasElement>(null);

  React.useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const host = canvas.parentElement;

    const still = window.matchMedia('(prefers-reduced-motion: reduce)');
    let agents: Agent[] = [];
    let width = 0;
    let height = 0;
    let raf = 0;
    let running = false;
    let last = 0;
    let px: number | null = null;
    let py: number | null = null;

    const spawn = (a: Agent) => {
      a.x = Math.random() * width;
      a.y = Math.random() * height;
      a.life = LIFE_MIN + Math.random() * LIFE_VAR;
      a.weight = Math.random();
    };

    const seed = () => {
      const count = Math.min(MAX_AGENTS, Math.round((width * height) / 1_000_000 * DENSITY));
      agents = Array.from({ length: count }, () => {
        const a: Agent = { x: 0, y: 0, life: 0, weight: 0 };
        spawn(a);
        /* Stagger the first generation's lifespans, or the whole field
           respawns on the same frame and the band blinks. */
        a.life = Math.random() * (LIFE_MIN + LIFE_VAR);
        return a;
      });
    };

    const measure = () => {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return false;
      width = rect.width;
      height = rect.height;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      return true;
    };

    /** The direction of the current at a point, in radians. */
    const flow = (x: number, y: number, t: number) =>
      Math.sin(x * 0.0016 + t * 0.00012) * 1.5 +
      Math.cos(y * 0.0021 - t * 0.00016) * 1.5 +
      Math.sin((x + y) * 0.0009 + t * 0.0001) * 1.2;

    const step = (t: number, dt: number) => {
      /* ⚠️ ERASE, DO NOT CLEAR. `destination-out` takes a few percent of the
         alpha off everything already drawn, which is what turns each agent's
         path into a fading trail. `clearRect` would wipe the trails and leave
         a field of disconnected dashes. */
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = `rgba(0, 0, 0, ${FADE})`;
      ctx.fillRect(0, 0, width, height);

      /* Additive, so where threads cross the light gathers rather than the
         newer one simply covering the older. */
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';

      for (const a of agents) {
        const x0 = a.x;
        const y0 = a.y;

        let angle = flow(a.x, a.y, t);

        /* The cursor does not push the agents; it bends the FIELD around
           itself, so the current visibly curls past rather than the threads
           being shoved aside. */
        if (px !== null && py !== null) {
          const dx = a.x - px;
          const dy = a.y - py;
          const d2 = dx * dx + dy * dy;
          if (d2 < POINTER_DIST * POINTER_DIST) {
            const near = 1 - Math.sqrt(d2) / POINTER_DIST;
            angle += Math.atan2(dy, dx) * near * 0.5 + near * near * SWIRL;
          }
        }

        const speed = (16 + a.weight * 34) * dt;
        a.x += Math.cos(angle) * speed;
        a.y += Math.sin(angle) * speed;
        a.life -= 1;

        const gone = a.life <= 0 || a.x < -20 || a.x > width + 20 || a.y < -20 || a.y > height + 20;
        if (gone) {
          spawn(a);
          continue;
        }

        /* Faint per segment on purpose: with additive blending the trail
           builds its brightness up over many frames, and a heavy stroke would
           blow out to white within a second. */
        const alpha = 0.055 + a.weight * 0.13;
        ctx.strokeStyle =
          a.weight > 0.72
            ? `rgba(170, 240, 242, ${alpha})`
            : `rgba(47, 163, 169, ${alpha * 1.35})`;
        ctx.lineWidth = 0.6 + a.weight * 1.2;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(a.x, a.y);
        ctx.stroke();
      }

      ctx.globalCompositeOperation = 'source-over';
    };

    const draw = (t: number) => {
      const dt = last ? Math.min((t - last) / 1000, 0.05) : 0.016;
      last = t;
      step(t, dt);
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
      /* A still image of the same field: run it forward without presenting
         each frame, so the threads exist but nothing ever moves. */
      for (let i = 0; i < 180; i++) step(i * 16, 0.016);
      return;
    }

    const watcher = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) start();
        else stop();
      },
      { threshold: 0 },
    );
    watcher.observe(canvas);

    /* ⚠️ Listened for on the BAND, not the canvas: the canvas is
       `pointer-events: none` so it can never swallow a click meant for the
       screenshot or a card, which also means it gets no pointer events itself. */
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
