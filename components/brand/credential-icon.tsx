'use client';

import {
  BarChart3,
  Building2,
  Code2,
  Globe,
  KeyRound,
  Mail,
  Megaphone,
  Package,
  Users,
  type LucideIcon,
} from 'lucide-react';

import { brandMark, brandMarkLabel } from '@/lib/brand/service-marks';
import { credentialService, type GenericService } from '@/lib/domain/credential-service';
import { BrandTile } from '@/components/brand/platform-icon';
import { cn } from '@/lib/utils';

/* ============================================================================
 * THE TILE ON A CREDENTIAL ROW
 * ----------------------------------------------------------------------------
 * Two cases, one component. A credential whose URL names a platform gets that
 * platform's real app-icon tile — the same `PlatformIcon` the task drawer and the
 * project screens use, so a Facebook login looks like Facebook everywhere in the
 * product. Everything else gets a tinted glyph for its family.
 *
 * ── ⚠️ THE BRAND TILE IS COLOURED; THE GENERIC ONE IS NOT ────────────────────
 * Deliberate, and the whole reason the vault becomes scannable. Brand colour is
 * an external fact and carries real recognition, so Facebook blue and TikTok
 * black earn their place. A family — "hosting", "API key" — has no colour of its
 * own, and inventing eight is how a list of twenty rows turns into a fruit salad
 * nobody can read. Those sit on the brand tint instead, which reads as "one of
 * ours, no logo" rather than as a missing icon.
 *
 * ── ⚠️ WHERE THE ANSWER COMES FROM, IN ORDER ─────────────────────────────────
 * `lib/domain/credential-service.ts` decides, and since 2026-08-24 it asks three
 * questions rather than one:
 *
 *   1. `credentials.service`  what the person CHOSE when storing it (migration
 *                             051). Beats everything else and is the reason the
 *                             other two stopped being guesses that had to be right.
 *   2. the URL                a host table, longest pattern wins.
 *   3. the label              vetted needles, only when there is no URL, or to
 *                             finish a vendor-level host like `google.com`.
 *
 * ⚠️ THE HEADER HERE USED TO SAY "from the URL, not from a stored column". That
 * was true and it was the bug: derivation cannot answer `google.com/login`
 * labelled "Gmail Login", and no table of substrings ever will. The stored column
 * did not replace the derivation — it sits in front of it, so every row created
 * before the picker keeps working.
 * ========================================================================= */

const GENERIC_GLYPH: Readonly<Record<GenericService, LucideIcon>> = {
  email: Mail,
  domain: Globe,
  analytics: BarChart3,
  advertising: Megaphone,
  crm: Users,
  api: Code2,
  software: Package,
  client: Building2,
  other: KeyRound,
};

export function CredentialIcon({
  url,
  label,
  kind,
  service: chosen,
  size = 26,
  className,
}: {
  url: string | null;
  label: string;
  /** `credentials.kind` — the fallback when the URL names nothing. */
  kind: string;
  /** `credentials.service` — the mark the person PICKED when storing it
   *  (migration 051). Beats every inference below it. Null on rows created before
   *  the picker existed, which is why the derivation is still here. */
  service?: string | null;
  /** Pixels. Matches `PlatformIcon`'s numeric prop so the two agree. */
  size?: number;
  className?: string;
}) {
  /* `brandMarkLabel` is passed so the resolver can name and validate a CHOSEN
     mark without `lib/domain` importing `lib/brand` — see its `markLabel` note. */
  const service = credentialService({
    url,
    label,
    kind,
    service: chosen,
    markLabel: brandMarkLabel,
  });

  /* ── ⚠️ ONE LOOKUP, BOTH MARK TABLES ─────────────────────────────────────
     `brandMark` resolves a platform slug and a service key through the same call,
     so Gmail, cPanel and WordPress reach a real tile by exactly the route Facebook
     always did. This used to be `service.kind === 'platform'` and everything that
     was not one of the eleven social platforms fell to the glyph below — which is
     what the owner was looking at when they asked for a proper Gmail logo. */
  if (service.kind === 'brand') {
    const mark = brandMark(service.mark);
    /* ⚠️ Still checked. A mark key with no entry is a typo in the host table, and
       falling through to the family glyph is a better outcome than an empty tile —
       the same defensiveness `PlatformIcon` has for an unknown slug. */
    if (mark) {
      return (
        <BrandTile mark={mark} markKey={service.mark} size={size} className={className} />
      );
    }
  }

  /* The family glyph: a brand we hold no mark for (Outlook, Canva, Adobe — see
     the host table), or a credential with nothing to go on but its `kind`. */
  const family = service.kind === 'generic' ? service.service : 'other';
  const Glyph = GENERIC_GLYPH[family];

  return (
    <span
      /* `aria-hidden` throughout, like `PlatformIcon`: every caller renders the
         service's name beside it, and announcing the logo as well reads the same
         thing twice. */
      aria-hidden="true"
      className={cn('inline-grid shrink-0 place-items-center rounded-[28%]', className)}
      style={{
        width: size,
        height: size,
        backgroundColor:
          'color-mix(in oklab, var(--accent-primary) var(--tint-strong), var(--bg-surface))',
      }}
    >
      <Glyph
        className="text-text-brand"
        style={{ width: size * 0.56, height: size * 0.56 }}
        strokeWidth={2}
        aria-hidden="true"
      />
    </span>
  );
}

/** The service's display name — "Meta Business", "Gmail", "cPanel". Exported so a
 *  row can print what the tile is showing without deriving it twice. */
export function credentialServiceLabel(input: {
  url: string | null;
  label: string;
  kind: string;
  service?: string | null;
}): string {
  /* ⚠️ `markLabel` here too. Without it a chosen mark would be NAMED from the host
     tables while the tile beside it was DRAWN from the brand tables — so a row
     could show the Meta logo captioned "Meta Business" on one screen and "Meta" on
     another. One resolver, one set of inputs, both call sites. */
  return credentialService({ ...input, markLabel: brandMarkLabel }).label;
}
