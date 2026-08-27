'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Pause, Play, RefreshCw } from 'lucide-react';

import { cn } from '@/lib/utils';

/* ============================================================================
 * THE LIVE BADGE
 * ----------------------------------------------------------------------------
 * Owner, 2026-08-25: *"I don't want a static dashboard… everything should be live
 * over there"*, and separately *"the page refresh"*.
 *
 * ── ⚠️ IT REFRESHES THE SERVER TREE, IT DOES NOT RELOAD THE PAGE ────────────
 * `router.refresh()` re-runs the page's server components and reconciles the
 * result into the live tree. `location.reload()` would also produce current
 * numbers, and would throw away the scroll position, every open filter, and the
 * entrance animation — a dashboard that visibly restarts every minute is worse
 * than one that is a minute stale.
 *
 * ── ⚠️ IT PAUSES WHEN THE TAB IS HIDDEN ─────────────────────────────────────
 * A background tab left open overnight would otherwise fire ~500 refreshes at a
 * database in another region, for a page nobody is looking at. `visibilitychange`
 * stops the clock and a return to the tab refreshes once, immediately, so what
 * you come back to is current rather than however old the last tick left it.
 *
 * ── ⚠️ THE CLOCK IS OWNED HERE, NOT DERIVED FROM A TIMESTAMP PROP ───────────
 * "Updated 40s ago" ticks once a second. Deriving that from a server-rendered
 * `now` would make the ENTIRE page a client component re-rendering every second.
 * This component holds the only per-second state on the screen, so a tick
 * re-renders one badge and nothing else.
 *
 * `suppressHydrationWarning` is not needed: the first render prints "just now",
 * which is what the server would have said too — the elapsed count only starts
 * once the effect has run in the browser.
 * ========================================================================= */

/** How often the page re-reads itself. */
const EVERY_MS = 60_000;

export function LiveBadge({
  onDark = false,
  className,
}: {
  /**
   * Fixed light inks for a surface that stays dark in both themes.
   *
   * ── ⚠️ WHY THIS IS A PROP AND NOT JUST NEW COLOURS ──────────────────────
   * A badge on a forced-dark panel cannot use `--text-secondary` /
   * `--bg-surface` — those follow the theme, and in light mode they would
   * paint dark-grey text on a near-black panel. Fixed light inks are correct
   * there and equally wrong on a themed card, so the two cases are genuinely
   * different rather than one being a tweak of the other.
   *
   * Defaults to the TOKEN version: the owner's 2026-08-25 correction ("keep
   * the theme the same") removed the dark hero this variant was built for, so
   * themed is now the normal case and `onDark` is the opt-in.
   */
  onDark?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const [live, setLive] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  /* Seconds since the last successful read. Not a timestamp: the only thing
     rendered is the elapsed count, and storing seconds keeps the tick a plain
     increment with no clock arithmetic and no timezone anywhere near it. */
  const [ago, setAgo] = React.useState(0);

  const refresh = React.useCallback(() => {
    setBusy(true);
    router.refresh();
    setAgo(0);
    /* The spinner is a fixed beat rather than a promise: `router.refresh()`
       returns void and gives no completion signal, so anything claiming to track
       it would be inventing one. Half a second reads as "that did something"
       without pretending to know when the server replied. */
    window.setTimeout(() => setBusy(false), 550);
  }, [router]);

  /* The clock. Always runs, so the badge stays honest while paused — a paused
     dashboard that still says "updated 3s ago" is the one genuinely misleading
     state this component could have. */
  React.useEffect(() => {
    const id = window.setInterval(() => setAgo((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  React.useEffect(() => {
    if (!live) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, EVERY_MS);
    return () => window.clearInterval(id);
  }, [live, refresh]);

  React.useEffect(() => {
    if (!live) return;
    const onShow = () => {
      /* Only if it is actually stale. Flicking between two tabs should not fire a
         read per flick. */
      if (document.visibilityState === 'visible' && ago >= EVERY_MS / 1000) refresh();
    };
    document.addEventListener('visibilitychange', onShow);
    return () => document.removeEventListener('visibilitychange', onShow);
  }, [live, ago, refresh]);

  /* The live dot is green in both cases — it is a status, not chrome. Everything
     else swaps: on the dark panel the inks are fixed and light, on a card they
     are the theme's own tokens. */
  const dot = live ? '#7fe0b2' : 'rgb(255 255 255 / 0.45)';

  return (
    <span
      className={cn(
        'inline-flex h-9 items-center gap-2 rounded-lg border px-2.5',
        onDark
          ? 'backdrop-blur-sm'
          : 'border-border-default bg-bg-surface',
        className,
      )}
      style={
        onDark
          ? {
              borderColor: 'rgb(255 255 255 / 0.18)',
              backgroundColor: 'rgb(255 255 255 / 0.10)',
            }
          : undefined
      }
    >
      <span className="relative flex size-2 shrink-0 items-center justify-center">
        {live && (
          <span
            aria-hidden="true"
            className="live-ping absolute inset-0 rounded-full"
            style={{ backgroundColor: onDark ? dot : 'var(--feedback-success)' }}
          />
        )}
        <span
          aria-hidden="true"
          className="relative size-2 rounded-full"
          style={{
            backgroundColor: onDark
              ? dot
              : live
                ? 'var(--feedback-success)'
                : 'var(--text-tertiary)',
          }}
        />
      </span>

      <span
        className={cn(
          'text-micro font-semibold whitespace-nowrap',
          !onDark && 'text-text-secondary',
        )}
        style={onDark ? { color: '#fff' } : undefined}
      >
        {live ? 'Live' : 'Paused'}
        <span
          className={cn('font-normal', !onDark && 'text-text-tertiary')}
          style={onDark ? { color: 'rgb(255 255 255 / 0.6)' } : undefined}
        >
          {' '}
          · {elapsed(ago)}
        </span>
      </span>

      <IconAction
        onDark={onDark}
        onClick={() => setLive((on) => !on)}
        label={live ? 'Pause automatic refresh' : 'Resume automatic refresh'}
      >
        {live ? (
          <Pause className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
        ) : (
          <Play className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
        )}
      </IconAction>

      <IconAction onDark={onDark} onClick={refresh} label="Refresh now">
        <RefreshCw
          className={cn('size-3.5', busy && 'animate-spin motion-reduce:animate-none')}
          strokeWidth={2.25}
          aria-hidden="true"
        />
      </IconAction>
    </span>
  );
}

function IconAction({
  onDark,
  onClick,
  label,
  children,
}: {
  onDark: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        'grid size-6 place-items-center rounded-md transition-colors duration-150',
        onDark
          ? 'text-white/70 hover:bg-white/20 hover:text-white'
          : 'text-text-tertiary hover:bg-bg-hover hover:text-text-primary',
      )}
    >
      {children}
    </button>
  );
}

/** `just now` · `40s ago` · `3m ago`. Assembled, never formatted. */
function elapsed(seconds: number): string {
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}
