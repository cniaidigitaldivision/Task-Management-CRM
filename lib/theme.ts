/* ============================================================================
 * THEME RESOLUTION — pure helpers
 * ----------------------------------------------------------------------------
 * FR-201 · FR-202 · FR-203 · FR-204
 *
 * Two distinct values, deliberately kept separate:
 *
 *   PREFERENCE  'light' | 'dark' | null    what the user chose, or nothing yet
 *   RESOLVED    'light' | 'dark'           what is actually rendered
 *
 * ── 'system' WAS REMOVED, AND null IS WHAT REPLACED IT ───────────────────────
 * Owner decision, session 15: a sun and a moon, nothing else.
 *
 * It could not simply be deleted. The string still arrives from two places —
 * `localStorage` in any browser that used the application before today, and
 * `users.theme`, whose Postgres enum still carries it and still defaults to it.
 * Treating an unrecognised value as light would flip a dark user to light on
 * their next visit.
 *
 * So the read path answers `null` for "no explicit choice", which covers a
 * legacy 'system', a missing key and a corrupted one with the same honest
 * answer. `null` follows the device; the provider then persists the concrete
 * result, once, and the ambiguity is gone for good.
 *
 * The resolved value is what reaches <html data-theme>, so CSS never has to
 * reconcile an attribute against a media query.
 * ========================================================================= */

import { THEMES, THEME_STORAGE_KEY, type ResolvedTheme, type Theme } from './domain/constants';

export const DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)';

/**
 * Browser chrome colours for `<meta name="theme-color">`.
 *
 * These are the one place a literal colour is unavoidable: the browser reads
 * this value before our stylesheet exists, so it cannot resolve a CSS
 * variable. They mirror `--bg-base` for each theme in styles/tokens.css and
 * must be updated together with it.
 *
 * Kept here, outside `app/` and `components/`, so the BR-025 lint rule stays
 * absolute for everything that *can* use a token.
 */
export const BROWSER_THEME_COLOR = {
  light: '#ffffff',
  dark: '#061417',
} as const;

/** Narrows unknown input — a corrupted or hand-edited localStorage value must
 *  never be able to put the app into an invalid state. */
export function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value);
}

/** Resolves a preference to the concrete theme that will be rendered. */
export function resolveTheme(
  preference: Theme | null,
  systemPrefersDark: boolean,
): ResolvedTheme {
  return preference ?? (systemPrefersDark ? 'dark' : 'light');
}

/** Reads the OS preference. Returns false in any non-browser context. */
export function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(DARK_MEDIA_QUERY).matches;
}

/**
 * The stored preference, or `null` when there is not one.
 *
 * `null` covers three cases that all mean the same thing to the caller: nothing
 * stored, a legacy 'system', and a corrupted value. Private browsing can throw
 * on localStorage, which is the third.
 */
export function readStoredTheme(): Theme | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function writeStoredTheme(preference: Theme): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    /* Storage unavailable — the in-memory preference still applies for this
       session. Failing to persist must never break the page. */
  }
}

export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** Where the circular wipe should grow from — viewport pixels. */
export interface WipeOrigin {
  readonly x: number;
  readonly y: number;
}

/**
 * True when the browser can run the circular theme wipe and the person has not
 * asked it not to.
 *
 * Feature-detected rather than assumed: `startViewTransition` is absent in
 * Firefox and older Safari, and calling it there is a TypeError that would take
 * the theme change down with it.
 */
export function canWipe(): boolean {
  if (typeof document === 'undefined') return false;
  if (typeof document.startViewTransition !== 'function') return false;
  if (typeof window.matchMedia === 'function' && window.matchMedia(REDUCED_MOTION_QUERY).matches) {
    return false;
  }
  return true;
}

/**
 * Applies the resolved theme to the document, optionally wiping it in.
 *
 * FR-213 — CSS transitions are suppressed for one frame during the swap. Without
 * this the page visibly sweeps between palettes property by property, which reads
 * as a glitch rather than a deliberate change. That suppression is what lets the
 * wipe be the *only* motion: the palette changes instantly underneath a moving
 * mask, exactly as in the reference video.
 *
 * ── THE SWAP MUST NEVER DEPEND ON THE ANIMATION ──────────────────────────────
 * `swap()` is the whole of the theme change and it is the transition's callback,
 * so it runs whether or not there is a transition to run it in: unsupported
 * browser, reduced motion, a hidden tab (the browser skips the animation but
 * still invokes the callback), or a transition abandoned because another one
 * started. There is no path where the animation fails and the theme does not
 * change — which is the failure that would actually matter.
 *
 * ── WHY `origin` IS IN PIXELS AND WRITTEN BEFORE THE TRANSITION STARTS ───────
 * `--wipe-x`/`--wipe-y` are read by the `theme-wipe` keyframes on
 * `::view-transition-new(root)`, and those pseudo-elements inherit custom
 * properties from the root element. Written first, so the first frame of the
 * animation already has the right centre; written after, the circle would begin
 * at the default 50% 50% and jump.
 *
 * The origin is the button the person actually pressed. That is the entire reason
 * the effect reads as caused rather than played, and it is why this takes a
 * coordinate instead of animating from the centre.
 */
export function applyTheme(resolved: ResolvedTheme, origin?: WipeOrigin | null): void {
  if (typeof document === 'undefined') return;

  const root = document.documentElement;

  const swap = () => {
    root.classList.add('theme-transitions-disabled');
    root.setAttribute('data-theme', resolved);
    root.style.colorScheme = resolved;

    // Force a reflow so the class above takes effect before it is removed.
    void root.offsetHeight;

    const release = () => root.classList.remove('theme-transitions-disabled');

    /* One frame is the intent: the class must survive exactly long enough for the
       palette to land without any property transitioning to it.
       ── AND A BACKSTOP, BECAUSE rAF DOES NOT ALWAYS COME ─────────────────────
       `requestAnimationFrame` does not fire in a hidden tab. On its own that left
       the class latched — and it carries `transition: none !important` and
       `animation-duration: 0.01ms !important` for every element on the page, so a
       theme changed in a background tab could come back to a page where nothing
       animates at all. Seen while verifying this: the staggered reveals computed a
       420ms duration as 0.01ms.

       A hidden tab does still run timers, throttled. Whichever arrives first wins
       and the second call removes nothing, so a visible tab behaves exactly as
       before — rAF at about 16ms, long before the timer. */
    window.requestAnimationFrame(release);
    window.setTimeout(release, 250);
  };

  if (!origin || !canWipe()) {
    swap();
    return;
  }

  root.style.setProperty('--wipe-x', `${Math.round(origin.x)}px`);
  root.style.setProperty('--wipe-y', `${Math.round(origin.y)}px`);

  /* ── THE REJECTIONS HAVE TO BE SWALLOWED, NOT IGNORED ─────────────────────
     A `ViewTransition` exposes three promises and two of them reject whenever the
     browser declines to animate: `InvalidStateError: Transition was aborted
     because of invalid state` in a hidden tab, and an abort whenever a second
     transition supersedes the first — somebody pressing the toggle twice quickly.
     Both are normal outcomes of this design, and neither is a fault.

     Simply not awaiting them is not the same as handling them. It produces an
     unhandled promise rejection, which is exactly what filled the console with
     `InvalidStateError` while this was being verified. Explicitly ignored here, so
     a real error elsewhere is still visible in a console that is otherwise quiet.

     `catch` on both, not just one: `ready` rejects when the animation never
     starts, `finished` when it never completes, and a transition can do either. */
  const transition = document.startViewTransition(swap);
  const ignore = () => {};
  transition.ready?.catch(ignore);
  transition.finished?.catch(ignore);
  transition.updateCallbackDone?.catch(ignore);
}

/** The centre of an element, for use as a wipe origin. */
export function originOf(element: Element | null | undefined): WipeOrigin | null {
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

/**
 * The pre-paint script, as a string.
 *
 * FR-204 — this runs synchronously in <head>, before first paint, so a
 * dark-theme user never sees a white flash. It is deliberately terse (it
 * ships on every page load) and defensive (a storage failure must fall back,
 * never throw).
 */
export const THEME_PRE_PAINT_SCRIPT = `(function(){try{var k=${JSON.stringify(
  THEME_STORAGE_KEY,
)};var p=null;try{p=localStorage.getItem(k)}catch(e){}var d=(p==="light"||p==="dark")?p==="dark":window.matchMedia(${JSON.stringify(
  DARK_MEDIA_QUERY,
)}).matches;var r=d?"dark":"light";var e=document.documentElement;e.setAttribute("data-theme",r);e.style.colorScheme=r}catch(_){document.documentElement.setAttribute("data-theme","light")}})();`;
