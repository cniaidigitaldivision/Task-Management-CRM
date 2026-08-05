'use client';

/* ============================================================================
 * THEME PROVIDER
 * ----------------------------------------------------------------------------
 * FR-201 · FR-202 · FR-203 · FR-204 · FR-213
 *
 * Holds the user's theme preference and keeps <html data-theme> in sync.
 *
 * Built on useSyncExternalStore rather than useState + useEffect. Both the
 * stored preference and the OS colour setting are genuinely external stores,
 * and modelling them as such removes the cascading render that the
 * read-on-mount pattern produces — plus it gives correct, explicit SSR
 * behaviour instead of a guess that gets corrected after hydration.
 *
 * Hand-rolled rather than pulling in a library: the pre-paint behaviour and
 * the transition suppression on swap are the two things that make theming
 * feel considered rather than janky, and both are worth owning outright.
 *
 * Persistence today is localStorage. Step 6 adds the users.theme column and
 * passes the server-known preference in via `initialPreference`, at which
 * point it syncs across devices with no change to this component.
 * ========================================================================= */

import * as React from 'react';

import type { ResolvedTheme, Theme } from '@/lib/domain/constants';
import {
  DARK_MEDIA_QUERY,
  applyTheme,
  readStoredTheme,
  resolveTheme,
  systemPrefersDark,
  writeStoredTheme,
} from '@/lib/theme';

/* --------------------------------------------------------------------------
 * External store 1 — the stored preference
 * ------------------------------------------------------------------------ */

const preferenceListeners = new Set<() => void>();

/** Notifies subscribers after this tab writes a new preference. The `storage`
 *  event only fires in *other* tabs, so same-tab updates need this. */
function emitPreferenceChange(): void {
  for (const listener of preferenceListeners) listener();
}

function subscribePreference(onChange: () => void): () => void {
  preferenceListeners.add(onChange);
  window.addEventListener('storage', onChange);
  return () => {
    preferenceListeners.delete(onChange);
    window.removeEventListener('storage', onChange);
  };
}

const getPreference = (): Theme => readStoredTheme();
/** The server cannot know the preference; `system` is the documented default
 *  (FR-203) and the pre-paint script has already corrected the paint. */
const getPreferenceOnServer = (): Theme => 'system';

/* --------------------------------------------------------------------------
 * External store 2 — the OS colour setting
 * ------------------------------------------------------------------------ */

function subscribeSystemDark(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => {};
  }
  const media = window.matchMedia(DARK_MEDIA_QUERY);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

const getSystemDark = (): boolean => systemPrefersDark();
const getSystemDarkOnServer = (): boolean => false;

/* --------------------------------------------------------------------------
 * External store 3 — hydration status
 * ------------------------------------------------------------------------ */

const subscribeNothing = (): (() => void) => () => {};
const hydratedOnClient = (): boolean => true;
const hydratedOnServer = (): boolean => false;

/* --------------------------------------------------------------------------
 * Context
 * ------------------------------------------------------------------------ */

interface ThemeContextValue {
  /** What the user chose. */
  preference: Theme;
  /** What is actually rendered right now. */
  resolved: ResolvedTheme;
  setTheme: (next: Theme) => void;
  /** Cycles light → dark → system. Used by the compact toggle. */
  cycleTheme: () => void;
  /** False until the client has read the stored preference. Controls that
   *  depend on the preference must not announce a value before this is true,
   *  or they will state the wrong one to a screen reader on first paint. */
  isHydrated: boolean;
}

const ThemeContext = React.createContext<ThemeContextValue | null>(null);

const CYCLE_ORDER: readonly Theme[] = ['light', 'dark', 'system'];

export function ThemeProvider({
  children,
  initialPreference,
}: {
  children: React.ReactNode;
  /** Server-known preference, once accounts exist (Step 6). */
  initialPreference?: Theme;
}) {
  const preference = React.useSyncExternalStore(
    subscribePreference,
    getPreference,
    getPreferenceOnServer,
  );
  const prefersDark = React.useSyncExternalStore(
    subscribeSystemDark,
    getSystemDark,
    getSystemDarkOnServer,
  );
  const isHydrated = React.useSyncExternalStore(
    subscribeNothing,
    hydratedOnClient,
    hydratedOnServer,
  );

  const resolved = resolveTheme(preference, prefersDark);

  // Adopt the server-known preference when it disagrees with local storage —
  // the account setting is authoritative across devices.
  React.useEffect(() => {
    if (!initialPreference) return;
    if (readStoredTheme() === initialPreference) return;
    writeStoredTheme(initialPreference);
    emitPreferenceChange();
  }, [initialPreference]);

  // Sync the DOM to the resolved theme.
  //
  // Two guards, both load-bearing:
  //   · Wait for hydration. The server render assumes light; applying that
  //     before the client snapshot arrives would flip a dark user to light
  //     and straight back — a visible flash, which is exactly what the
  //     pre-paint script exists to prevent.
  //   · Skip when the DOM already agrees. In the common case the pre-paint
  //     script got it right, so this effect touches nothing at all.
  React.useEffect(() => {
    if (!isHydrated) return;
    if (document.documentElement.getAttribute('data-theme') === resolved) return;
    applyTheme(resolved);
  }, [isHydrated, resolved]);

  const setTheme = React.useCallback((next: Theme) => {
    writeStoredTheme(next);
    emitPreferenceChange();
  }, []);

  const cycleTheme = React.useCallback(() => {
    const current = readStoredTheme();
    const nextIndex = (CYCLE_ORDER.indexOf(current) + 1) % CYCLE_ORDER.length;
    writeStoredTheme(CYCLE_ORDER[nextIndex]);
    emitPreferenceChange();
  }, []);

  const value = React.useMemo<ThemeContextValue>(
    () => ({ preference, resolved, setTheme, cycleTheme, isHydrated }),
    [preference, resolved, setTheme, cycleTheme, isHydrated],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = React.useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used inside <ThemeProvider>.');
  }
  return context;
}
