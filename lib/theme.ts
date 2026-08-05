/* ============================================================================
 * THEME RESOLUTION — pure helpers
 * ----------------------------------------------------------------------------
 * FR-201 · FR-202 · FR-203 · FR-204
 *
 * Two distinct values, deliberately kept separate:
 *
 *   PREFERENCE  'light' | 'dark' | 'system'   what the user chose
 *   RESOLVED    'light' | 'dark'              what is actually rendered
 *
 * The preference is stored (localStorage now, the users row from Step 6).
 * The resolved value is written to <html data-theme>.
 *
 * Because `system` is always resolved to a concrete value before it reaches
 * the DOM, CSS never has to reconcile an attribute against a media query —
 * which removes an entire class of "theme is right in one place and wrong in
 * another" bugs.
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
export function resolveTheme(preference: Theme, systemPrefersDark: boolean): ResolvedTheme {
  if (preference === 'system') return systemPrefersDark ? 'dark' : 'light';
  return preference;
}

/** Reads the OS preference. Returns false in any non-browser context. */
export function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(DARK_MEDIA_QUERY).matches;
}

/** Reads the stored preference, falling back to `system` on anything invalid,
 *  missing, or inaccessible (private browsing can throw on localStorage). */
export function readStoredTheme(): Theme {
  if (typeof window === 'undefined') return 'system';
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(raw) ? raw : 'system';
  } catch {
    return 'system';
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

/**
 * Applies the resolved theme to the document.
 *
 * FR-213 — transitions are suppressed for one frame during the swap. Without
 * this the page visibly sweeps between palettes, which reads as a glitch
 * rather than a deliberate change.
 */
export function applyTheme(resolved: ResolvedTheme): void {
  if (typeof document === 'undefined') return;

  const root = document.documentElement;
  root.classList.add('theme-transitions-disabled');
  root.setAttribute('data-theme', resolved);
  root.style.colorScheme = resolved;

  // Force a reflow so the class above takes effect before it is removed.
  void root.offsetHeight;

  window.requestAnimationFrame(() => {
    root.classList.remove('theme-transitions-disabled');
  });
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
)};var p=null;try{p=localStorage.getItem(k)}catch(e){}if(p!=="light"&&p!=="dark"&&p!=="system")p="system";var d=p==="system"?window.matchMedia(${JSON.stringify(
  DARK_MEDIA_QUERY,
)}).matches:p==="dark";var r=d?"dark":"light";var e=document.documentElement;e.setAttribute("data-theme",r);e.style.colorScheme=r}catch(_){document.documentElement.setAttribute("data-theme","light")}})();`;
