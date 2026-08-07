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

const getPreference = (): Theme | null => readStoredTheme();
/** The server cannot know the preference. `null` means "not chosen", the
 *  device decides, and the pre-paint script has already corrected the paint. */
const getPreferenceOnServer = (): Theme | null => null;

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
  /** What the user chose, or null if they have not chosen. */
  preference: Theme | null;
  /** What is actually rendered right now. */
  resolved: ResolvedTheme;
  setTheme: (next: Theme) => void;
  /** Flips light ↔ dark. */
  cycleTheme: () => void;
  /** False until the client has read the stored preference. Controls that
   *  depend on the preference must not announce a value before this is true,
   *  or they will state the wrong one to a screen reader on first paint. */
  isHydrated: boolean;
}

const ThemeContext = React.createContext<ThemeContextValue | null>(null);

/* ── 'system' IS GONE, BUT IT STILL HAS TO BE HANDLED ─────────────────────
   Owner decision, session 15: light and dark only, a sun and a moon.

   It cannot simply be deleted from the type and forgotten. Two places still
   hand it over: `localStorage` on any browser that used the application before
   today, and `users.theme`, whose Postgres enum still has the value and whose
   default is still 'system'. A value that arrives and matches nothing would
   silently fall through to light — flipping a dark user to light on their next
   visit, which is precisely the flash the pre-paint script exists to prevent.

   So it is RESOLVED once, at the moment it is seen: whatever the person is
   actually looking at right now becomes their stored choice. Nobody's screen
   changes underneath them, and after one visit the value is gone for good. */


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
    /* The column still defaults to 'system' and its enum still carries the
       value, so it arrives here typed as Theme and is not one. Ignoring it
       leaves the device in charge, which is what it meant. */
    if ((initialPreference as string) === 'system') return;
    if (readStoredTheme() === initialPreference) return;
    writeStoredTheme(initialPreference);
    emitPreferenceChange();
  }, [initialPreference]);

  /* Retire a legacy 'system' preference, once, into whatever it currently
     resolves to. Runs after hydration so `prefersDark` is the real media query
     rather than the server's assumption. See the note on CYCLE_ORDER. */
  React.useEffect(() => {
    if (!isHydrated) return;
    if (readStoredTheme() !== null) return;
    writeStoredTheme(prefersDark ? 'dark' : 'light');
    emitPreferenceChange();
  }, [isHydrated, prefersDark]);

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

  /* Flips from what is RENDERED, not from what is stored. With no stored
     preference the two differ, and cycling from the stored null would jump to
     light for somebody currently looking at dark. */
  const cycleTheme = React.useCallback(() => {
    writeStoredTheme(resolved === 'dark' ? 'light' : 'dark');
    emitPreferenceChange();
  }, [resolved]);

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
