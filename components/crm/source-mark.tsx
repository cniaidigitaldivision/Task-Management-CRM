'use client';

import { DoorOpen, Globe, Upload, UserPlus } from 'lucide-react';

import { PlatformIcon } from '@/components/brand/platform-icon';
import { WA_GREEN, WhatsAppMark } from '@/components/crm/whatsapp-mark';
import { sourceMark } from '@/lib/domain/lead-source';

/* ============================================================================
 * WHERE A LEAD CAME FROM, AS A MARK
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-15: *"It should be dynamic such that it should know which logo
 * to use with which type of source."*
 *
 * ── ⚠️ THE MAPPING IS NOT IN THIS FILE, AND THAT IS THE DYNAMIC PART ───────
 * It lives on each source's own record in `lib/domain/lead-source.ts`, beside
 * its label and its default detail. This component asks that record and draws
 * what it is told.
 *
 * This file briefly held its own table of slugs. Two tables keyed by the same
 * thing drift, and the way they drift is that somebody adds a source to one of
 * them — so the new channel gets a name in the list and a grey box in the
 * column. One record now carries the label, the sub-label and the logo, and
 * adding a channel is a single line.
 *
 * ── ⚠️ A GREY MONOGRAM IS A FAILURE THAT LOOKS LIKE A SUCCESS ──────────────
 * `PlatformIcon` renders a neutral tile with the first letter for any slug it
 * cannot resolve. That is the right fallback for it and the wrong thing to rely
 * on here: a mistyped slug would ship as a plausible-looking tile rather than an
 * obvious blank. So the slugs are stated explicitly on the source records and
 * checked, rather than derived from the source's own name.
 *
 * ── ⚠️ AND NOT EVERY SOURCE IS A COMPANY ───────────────────────────────────
 * A walk-in, a referral and a website contact form are events, not brands.
 * `mark: null` on those records sends them here, to a plain glyph in the row's
 * own ink — which is the honest rendering, and keeps the column's weight even.
 * ========================================================================= */

const PLAIN: Record<string, typeof Globe> = {
  website: Globe,
  referral: UserPlus,
  walk_in: DoorOpen,
  import: Upload,
};

/* ⚠️ 24px, NOT 18 — owner, 2026-09-15: *"the Source leader is not looking more
   prominent."* At 18 the brand tile was smaller than the text beside it, so the
   logo read as decoration on the label rather than as the thing the column is
   for. A reader scanning this column is looking for the MARK; the words are the
   confirmation. The plain glyphs match it so the column keeps one weight. */
export function SourceMark({ source, size = 24 }: { source: string | null; size?: number }) {
  const slug = sourceMark(source);

  /* WhatsApp keeps the mark it wears everywhere else in this product, in its own
     green — a reader recognises the channel before they read the label. */
  if (slug === 'whatsapp') {
    return (
      <span aria-hidden="true" style={{ color: WA_GREEN }} className="inline-flex">
        <WhatsAppMark className="size-6" />
      </span>
    );
  }

  if (slug) return <PlatformIcon slug={slug} size={size} />;

  /* ⚠️ 20px, NOT 24 — a line glyph beside a filled tile. An outline pushes its
     strokes to the corners of its square and reads larger than a tile of the
     same nominal size, so matching the numbers would make the walk-ins and
     referrals louder than the brands they sit between. The optical size is what
     has to match, not the figure in the class name. */
  const Plain = (source && PLAIN[source]) || Globe;
  return <Plain className="size-5 text-text-secondary" aria-hidden="true" />;
}
