'use client';

import { DoorOpen, Globe, Upload, UserPlus } from 'lucide-react';

import { PlatformIcon } from '@/components/brand/platform-icon';
import { WA_GREEN, WhatsAppMark } from '@/components/crm/whatsapp-mark';

/* ============================================================================
 * WHERE A LEAD CAME FROM, AS A MARK
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-15: *"Proper icons are given and these icons are also present
 * in my system. Please use them."*
 *
 * They were right — `components/brand/platform-icon.tsx` has been drawing real
 * brand tiles since August, and the lead desk was rendering a coloured dot
 * beside a word instead. This routes each source to the mark that already
 * exists rather than adding a second set.
 *
 * ── ⚠️ TWO TABLES, ONE LOOKUP, AND THE SLUGS DIFFER FROM OURS ──────────────
 * `facebook`, `instagram` and `linkedin` are PLATFORM marks. `google` and `meta`
 * are SERVICE marks. `PlatformIcon` resolves across both, so the only thing that
 * matters here is passing the slug each table actually uses —
 * ⚠️ Google's is `google`, NOT `google_ads` or `google_business`, and a wrong
 * slug renders a grey monogram tile rather than failing, which is exactly the
 * kind of wrong that ships.
 *
 * ── ⚠️ AND TWO SOURCES HAVE NO LOGO, ON PURPOSE ────────────────────────────
 * A walk-in and a referral are not companies. Giving them an invented badge
 * would put a brand where none exists; they get a plain glyph in the ink colour
 * of the row, which is the honest rendering.
 *
 * ── ⚠️ `meta_lead_ad` STAYS "META" ─────────────────────────────────────────
 * All 643 imported leads carry it and Meta's payload never says whether the ad
 * ran on Facebook or Instagram. Drawing the Facebook logo over it would be a
 * guess printed as a fact — see `lib/domain/lead-source.ts`.
 * ========================================================================= */

/** Slugs the brand tables already hold. */
const BRAND_SLUG: Record<string, string> = {
  facebook: 'facebook',
  instagram: 'instagram',
  linkedin: 'linkedin',
  google: 'google',
  meta_lead_ad: 'meta',
};

export function SourceMark({ source, size = 18 }: { source: string | null; size?: number }) {
  if (!source) return <Globe className="size-[18px] text-text-tertiary" aria-hidden="true" />;

  const slug = BRAND_SLUG[source];
  if (slug) return <PlatformIcon slug={slug} size={size} />;

  /* WhatsApp keeps the mark it wears everywhere else in this product, in its own
     green — a reader recognises the channel before they read the label. */
  if (source === 'whatsapp') {
    return (
      <span aria-hidden="true" style={{ color: WA_GREEN }} className="inline-flex">
        <WhatsAppMark className="size-[18px]" />
      </span>
    );
  }

  const Plain =
    source === 'website' ? Globe
    : source === 'referral' ? UserPlus
    : source === 'walk_in' ? DoorOpen
    : source === 'import' ? Upload
    : Globe;

  return <Plain className="size-[18px] text-text-secondary" aria-hidden="true" />;
}
