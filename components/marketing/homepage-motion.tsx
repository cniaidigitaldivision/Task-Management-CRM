'use client';

/* ============================================================================
 * THE HOMEPAGE'S MOTION
 * ----------------------------------------------------------------------------
 * Three things, all driven from one observer and one scroll handler so the page
 * never has a dozen listeners competing:
 *
 *   · sections reveal as they enter the viewport
 *   · the header earns a border once the page has moved
 *   · the menu marks the section you are looking at
 *
 * ── ⚠️ NOTHING IS HIDDEN UNTIL THIS COMPONENT SAYS SO ───────────────────────
 * The CSS hides `[data-reveal]` only under `.taskly-home[data-motion="on"]`,
 * and that attribute is set here. If this script never runs — a chunk that
 * fails, a browser too old, JavaScript switched off — the page stays fully
 * visible and merely static. Putting `opacity: 0` in the stylesheet instead
 * would leave those visitors staring at a blank page for ever.
 *
 * ── ⚠️ IT ALSO DOES NOTHING FOR ANYBODY WHO ASKED FOR STILLNESS ─────────────
 * `prefers-reduced-motion` is checked before the attribute is set, so a person
 * who asked their system to stop moving things gets the static page by the same
 * route, not a reduced version of the animation.
 * ========================================================================= */

import * as React from 'react';

/** The sections the menu can mark, in the order they appear. */
/* ⚠️ IN DOCUMENT ORDER, AND IT MUST STAY THAT WAY. The current-section logic
   below takes the LAST entry whose top has passed the threshold, so an array
   that disagrees with the page marks the wrong menu item. `layer` has no menu
   link of its own — it sits between the hero and "How it works" — and that is
   fine: nothing is marked while it is the section being read. */
const SECTIONS = ['layer', 'studio', 'thread', 'ai', 'films'] as const;

export function HomepageMotion() {
  React.useEffect(() => {
    const root = document.querySelector<HTMLElement>('.taskly-home');
    if (!root) return;

    const still = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (still.matches) return;

    /* From here on the page is allowed to hide things, because the code that
       shows them again is definitely running. */
    root.setAttribute('data-motion', 'on');

    const revealing = Array.from(root.querySelectorAll<HTMLElement>('[data-reveal]'));

    /* Stagger children within one group so a grid of cards arrives as a wave
       rather than all at once. Written as a delay per element, so the observer
       itself stays a plain add-a-class. */
    for (const group of Array.from(root.querySelectorAll<HTMLElement>('[data-reveal-group]'))) {
      const kids = Array.from(group.querySelectorAll<HTMLElement>('[data-reveal]'));
      kids.forEach((kid, i) => {
        kid.style.setProperty('--reveal-delay', `${Math.min(i, 6) * 70}ms`);
      });
    }

    const seen = new WeakSet<Element>();
    const shower = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting || seen.has(entry.target)) continue;
          seen.add(entry.target);
          entry.target.classList.add('in');
          /* Drop `will-change` once it has arrived: left on, it holds a
             compositor layer per element for the life of the page. */
          window.setTimeout(() => entry.target.classList.add('done'), 900);
          shower.unobserve(entry.target);
        }
      },
      /* Fires a little before the element is fully on screen, so the movement
         is finishing as it reaches a comfortable reading position. */
      { rootMargin: '0px 0px -12% 0px', threshold: 0.12 },
    );
    revealing.forEach((el) => shower.observe(el));

    /* ── The header and the current section ──────────────────────────────
       One rAF-throttled handler. A scroll listener that writes to the DOM on
       every event is the classic way to make a page feel heavy. */
    const header = root.querySelector<HTMLElement>('header');
    const links = new Map<string, HTMLAnchorElement>();
    for (const id of SECTIONS) {
      const a = root.querySelector<HTMLAnchorElement>(`nav.links a[href="#${id}"]`);
      if (a) links.set(id, a);
    }

    let queued = false;
    const onScroll = () => {
      if (queued) return;
      queued = true;
      window.requestAnimationFrame(() => {
        queued = false;

        if (header) header.classList.toggle('stuck', window.scrollY > 12);


        /* The section whose top is closest to a third of the way down. */
        let current = '';
        for (const id of SECTIONS) {
          const el = document.getElementById(id);
          if (!el) continue;
          if (el.getBoundingClientRect().top <= window.innerHeight * 0.34) current = id;
        }
        for (const [id, a] of links) {
          if (id === current) a.setAttribute('aria-current', 'true');
          else a.removeAttribute('aria-current');
        }
      });
    };

    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });

    /* ── The lit edge follows the pointer across a card ───────────────────
       ONE listener on the grid, not one per card: the highlight is drawn by CSS
       from --mx/--my, so this only has to write two numbers. `pointermove` is
       passive and the write is cheap enough not to need its own frame budget,
       but it is still skipped entirely for a coarse pointer — a finger has no
       hover, so on a phone this would fire on every tap for no visible effect. */
    const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    const cards = Array.from(root.querySelectorAll<HTMLElement>('.cell'));
    const onPointer = (event: PointerEvent) => {
      const card = (event.target as Element | null)?.closest<HTMLElement>('.cell');
      if (!card) return;
      const r = card.getBoundingClientRect();
      card.style.setProperty('--mx', `${event.clientX - r.left}px`);
      card.style.setProperty('--my', `${event.clientY - r.top}px`);
    };
    const grids = Array.from(root.querySelectorAll<HTMLElement>('.grid'));
    if (fine && cards.length) {
      for (const grid of grids) grid.addEventListener('pointermove', onPointer, { passive: true });
    }

    /* If somebody turns reduced motion on while the page is open, undo it all
       rather than leaving them mid-animation. */
    const onPreferenceChange = () => {
      if (!still.matches) return;
      root.removeAttribute('data-motion');
      revealing.forEach((el) => el.classList.add('in'));
    };
    still.addEventListener('change', onPreferenceChange);

    return () => {
      if (fine) for (const grid of grids) grid.removeEventListener('pointermove', onPointer);
      shower.disconnect();
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      still.removeEventListener('change', onPreferenceChange);
      root.removeAttribute('data-motion');
    };
  }, []);

  return null;
}
