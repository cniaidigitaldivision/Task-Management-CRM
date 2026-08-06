'use client';

import * as React from 'react';
import { RefreshCw, WifiOff } from 'lucide-react';

/* ============================================================================
 * THE LAST RESORT
 * ----------------------------------------------------------------------------
 * Shown when a page throws and nothing closer to the problem caught it. The
 * case that prompted it: a momentary DNS failure between the app and the
 * database took down the setup page with `getaddrinfo ENOTFOUND …` — a hostname
 * that resolved perfectly a second either side.
 *
 * `lib/db/client.ts` now retries that class of failure, so this should be rare.
 * When it does appear, two things matter:
 *
 * 1. RETRY IS THE FIRST THING OFFERED, because a transient network failure is by
 *    far the most likely cause and trying again is nearly always the fix. Making
 *    somebody hunt for the browser's reload button to recover from a blip is a
 *    small cruelty.
 *
 * 2. IT SAYS WHAT IS AND IS NOT AT RISK. "Something went wrong" leaves people
 *    wondering whether they lost work. Nothing here writes on a page render, so
 *    the honest answer is that nothing was lost, and saying so is worth more
 *    than any apology.
 *
 * ── WHY NO ERROR DETAIL IS SHOWN ─────────────────────────────────────────────
 * Next.js already replaces server error messages with an opaque digest in
 * production — the raw text (which contained the database hostname) only appears
 * in development. So there is nothing useful left to display and nothing gained
 * by trying. The digest is shown because it is the one thing that links what
 * somebody saw to the entry in the server log.
 * ========================================================================= */

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [retrying, setRetrying] = React.useState(false);

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4 py-16">
      <div className="w-full max-w-lg rounded-2xl border border-border-default bg-bg-surface p-6 shadow-[var(--shadow-lg)]">
        <span
          aria-hidden="true"
          className="inline-flex h-12 w-12 items-center justify-center rounded-xl"
          style={{
            backgroundColor:
              'color-mix(in oklab, var(--feedback-warning) var(--tint-soft), var(--bg-surface))',
            color: 'var(--feedback-warning)',
          }}
        >
          <WifiOff className="h-6 w-6" strokeWidth={2} />
        </span>

        <h1 className="mt-4 text-h2 text-text-primary">This page could not load</h1>

        <p className="mt-2 text-body-sm text-text-secondary">
          Almost always a brief network interruption between the application and the database.
          Trying again usually fixes it straight away.
        </p>

        <p className="mt-3 text-caption text-text-secondary">
          <span className="font-semibold text-text-primary">Nothing was lost.</span> Loading a page
          never changes anything, so whatever you had saved is still saved.
        </p>

        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              setRetrying(true);
              reset();
            }}
            disabled={retrying}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-[image:var(--gradient-brand)] px-3.5 text-body-sm font-semibold text-text-on-brand shadow-[var(--shadow-brand-glow)] focus-visible:outline-none disabled:opacity-50"
          >
            <RefreshCw
              className={retrying ? 'h-4 w-4 animate-spin' : 'h-4 w-4'}
              strokeWidth={2}
              aria-hidden="true"
            />
            {retrying ? 'Trying again…' : 'Try again'}
          </button>

          <a
            href="/login"
            className="inline-flex h-9 items-center rounded-lg border border-border-default bg-bg-surface px-3.5 text-body-sm font-semibold text-text-primary focus-visible:outline-none"
          >
            Back to sign in
          </a>
        </div>

        {error.digest && (
          <p className="mt-5 border-t border-border-subtle pt-4 text-micro text-text-tertiary">
            If it keeps happening, quote this when asking for help:{' '}
            <span className="font-mono text-text-secondary">{error.digest}</span>
          </p>
        )}
      </div>
    </div>
  );
}
