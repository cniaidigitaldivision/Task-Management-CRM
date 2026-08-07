import type { Metadata } from 'next';

import { LogoHero } from '@/components/brand/logo';
import { ORGANISATION_NAME } from '@/lib/domain/constants';

export const metadata: Metadata = {
  title: { default: 'Sign in', template: '%s · CNI CRM' },
};

/* ============================================================================
 * THE SIGN-IN SHELL
 * ----------------------------------------------------------------------------
 * ── REBUILT 2026-08-07 · "too much green all over" ───────────────────────────
 * It was a teal-washed page: a tinted base colour plus two large radial
 * gradients across the whole viewport. Every surface carried the brand, so
 * nothing did — the eye had nowhere to land, and the one control that matters
 * on this screen competed with the wallpaper behind it.
 *
 * Now: a plain surface, a neutral card, and teal on exactly one thing — the
 * button. That is the whole point of an accent colour and it only works when
 * it is rare.
 *
 * The organisation name is set in the gold gradient, one step larger. It is the
 * only decorative element left, which is what lets it read as deliberate rather
 * than as more decoration.
 *
 * ── THE LOGO IS THE FULL ARTWORK HERE, AND ONLY HERE ─────────────────────────
 * The navigation rail uses the mark plus real text because its dark-teal
 * wordmark is illegible on a near-black rail. This page is white, so the
 * artwork works exactly as supplied — with the quiet halo, not the old bloom.
 * ========================================================================= */

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-bg-surface px-4 py-10">
      <main className="w-full max-w-[26rem]">
        <div className="mb-8 flex flex-col items-center gap-4 text-center">
          <LogoHero width={230} />

          {/* One size up from the caption it was, and the only gradient on the
              page. `.text-gold-gradient` falls back to a solid contrast-checked
              gold if the clip is unsupported — see styles/tokens.css. */}
          <p className="text-gold-gradient text-body font-semibold tracking-[0.12em] uppercase">
            {ORGANISATION_NAME}
          </p>
        </div>

        {children}

        <p className="mt-6 text-center text-micro text-text-tertiary">
          Access is provisioned by an administrator. There is no public sign-up.
        </p>
      </main>
    </div>
  );
}
