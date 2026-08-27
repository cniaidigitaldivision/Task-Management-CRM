/* ============================================================================
 * WHAT SERVICE IS THIS CREDENTIAL FOR?
 * ----------------------------------------------------------------------------
 * Owner, 2026-08-24: *"properly use their icon if it's Facebook, properly use
 * their Facebook icons… with a proper icon to represent whether it's Facebook,
 * Gmail, TikTok, Instagram, any other credential domain, even a domain
 * credential, or any CRM credential related to this project."*
 *
 * ── ⚠️ WHY THIS IS DERIVED AND NOT A COLUMN ──────────────────────────────────
 * `credentials.kind` already exists and is no use for an icon: it is a broad
 * category — 'social', 'email', 'hosting' — so every social login would get the
 * same glyph and the Facebook one would not look like Facebook.
 *
 * The alternative was a migration adding an explicit `service`, plus a picker on
 * the form. More exact, and every credential already stored would show a generic
 * icon until somebody went back and edited it — which nobody does. Deriving it
 * from the URL works on existing rows the moment it ships, and the URL is already
 * there because being clickable is the whole reason the field exists.
 *
 * ── THE HOST IS THE EVIDENCE; THE LABEL IS A LAST RESORT ─────────────────────
 * A host is a fact. A label is whatever somebody typed, so matching on it is a
 * guess — "GC Royal — Facebook Page" happens to work, "Client main account" does
 * not, and "Facebook ad budget spreadsheet" would match and be wrong. So the URL
 * is tried first and the label only when there is no URL at all.
 *
 * ── PURE, AND TESTED ─────────────────────────────────────────────────────────
 * No React, no icon components. It returns a NAME — either a platform slug the
 * brand tiles already know (lib/brand/platform-marks.ts) or one of a few generic
 * families — and the component decides how to draw it. That keeps this file
 * testable and stops a second copy of the host table appearing in a `.tsx`.
 * ========================================================================= */

/** The families with no brand mark of their own. Drawn as a tinted lucide tile. */
export const GENERIC_SERVICES = [
  'email',
  'domain',
  'analytics',
  'advertising',
  'crm',
  'api',
  'software',
  'client',
  'other',
] as const;
export type GenericService = (typeof GENERIC_SERVICES)[number];

/**
 * ── ⚠️ `'platform'` WAS RENAMED TO `'brand'`, AND `slug` TO `mark` ────────────
 * The old names encoded an assumption that stopped being true on 2026-08-24: that
 * the only credentials with a real logo were the eleven SOCIAL platforms, because
 * those were the only marks the repo held. Everything else — Gmail, WordPress,
 * cPanel, Google Analytics — was `generic` and drew a lucide family glyph, which
 * is what the owner was looking at when they asked for "a proper logo".
 *
 * A `slug` is a `public.platforms` row. A `mark` is a key into the brand-mark
 * tables, which now cover both platforms and services (lib/brand/service-marks.ts).
 * Gmail has a mark and is not a platform, so the two words had to come apart.
 */
export type CredentialService =
  /** We hold a real logo. `mark` resolves through `brandMark()`. */
  | { readonly kind: 'brand'; readonly mark: string; readonly label: string }
  /** No logo — the brand withdrew it, or we simply do not have it. Family glyph. */
  | { readonly kind: 'generic'; readonly service: GenericService; readonly label: string };

/* ── HOST → BRAND ─────────────────────────────────────────────────────────────
   Ordered longest-first at match time, not here, so 'business.facebook.com'
   cannot be swallowed by 'facebook.com'. Every slug on the right must exist in
   PLATFORM_MARKS or the tile falls back to a monogram — which is survivable, but
   the test at the foot of the spec file checks it anyway. */
const BRAND_HOSTS: ReadonlyArray<readonly [string, string, string]> = [
  /* ⚠️ Meta's own properties get META'S mark, not Facebook's `f`. Business Suite
     and Ads Manager are Meta products that happen to live on a facebook.com
     subdomain; the owner's mockup shows the Meta infinity mark on the "Meta
     Business Suite" row, and it is right — an `f` there says "a Facebook page",
     which is the thing being managed rather than the thing being logged into. */
  ['business.facebook.com', 'meta', 'Meta Business'],
  ['developers.facebook.com', 'meta', 'Meta for Developers'],
  ['facebook.com', 'facebook', 'Facebook'],
  ['fb.com', 'facebook', 'Facebook'],
  ['instagram.com', 'instagram', 'Instagram'],
  ['tiktok.com', 'tiktok', 'TikTok'],
  ['youtube.com', 'youtube', 'YouTube'],
  ['studio.youtube.com', 'youtube', 'YouTube Studio'],
  ['linkedin.com', 'linkedin', 'LinkedIn'],
  ['web.whatsapp.com', 'whatsapp', 'WhatsApp'],
  ['whatsapp.com', 'whatsapp', 'WhatsApp'],
  ['business.google.com', 'google_business', 'Google Business'],
  ['pinterest.com', 'pinterest', 'Pinterest'],
  ['snapchat.com', 'snapchat', 'Snapchat'],
  ['threads.net', 'threads', 'Threads'],
  ['threads.com', 'threads', 'Threads'],
  ['twitter.com', 'x', 'X'],
  ['x.com', 'x', 'X'],
];

/* ── HOST → GENERIC FAMILY ────────────────────────────────────────────────────
   Only hosts worth naming. Anything unmatched falls back to the credential's own
   `kind`, which is what the field was always for. */
/* ── HOST → SERVICE ───────────────────────────────────────────────────────────
   `[pattern, family, label, mark?]`.

   ── ⚠️ THE FOURTH ELEMENT IS THE WHOLE POINT OF THE 2026-08-24 REVISION ──────
   Owner: *"Please use a proper logo. For example use a Gmail logo… If you don't
   have it please go to Google and bring that logo over here."*

   Before it, this table had three columns and every row on it drew a lucide
   FAMILY glyph — an envelope for Gmail, a globe for WordPress and cPanel, a bar
   chart for Google Analytics. Right as a category, useless as recognition. The
   marks now exist in lib/brand/service-marks.ts and this column names them.

   ⚠️ A row with NO mark is deliberate, not unfinished. Outlook, Salesforce,
   Pipedrive, Bluehost, SiteGround, SendGrid, Twilio, OpenAI, Canva and Adobe are
   absent from simple-icons — mostly withdrawn at the brand's own request, the same
   reason LinkedIn is geometry rather than a path — and a logo drawn from memory is
   either wrong on screen or a trademark nobody agreed to reproduce. They keep the
   family glyph, which is honest.

   ⚠️ `ads.tiktok.com` points at `tiktok`, a PLATFORM mark. That is not a mistake:
   `brandMark()` resolves platform and service keys through one lookup precisely so
   a TikTok ads account can wear the TikTok logo without the mark being copied into
   a second table. */
const GENERIC_HOSTS: ReadonlyArray<readonly [string, GenericService, string, string?]> = [
  ['mail.google.com', 'email', 'Gmail', 'gmail'],
  ['gmail.com', 'email', 'Gmail', 'gmail'],
  /* ── ⚠️ THE VENDOR-LEVEL GOOGLE HOSTS ────────────────────────────────────
     These say WHO but not WHAT. `google.com/login`, `accounts.google.com` and
     `myaccount.google.com` are the shared sign-in — Gmail, Drive, Ads, Analytics
     and YouTube all send you there — so the URL identifies Google and nothing
     more. They resolve to Google's own G and are then refined by the label; see
     `VENDOR_PRODUCTS` for why that is not the same as letting a label override a
     URL.

     ⚠️ BARE `google.com` WAS MISSING ENTIRELY, and that was the bug the owner
     reported on 2026-08-24: the one real credential in the vault is
     `https://google.com/login` labelled "Gmail Login". It matched no pattern at
     all, fell through to `kind` ('other'), and drew a key glyph — while the label
     guess sat unused because a URL had been given. */
  ['accounts.google.com', 'email', 'Google Account', 'google'],
  ['myaccount.google.com', 'email', 'Google Account', 'google'],
  /* Concrete Google products, so they beat the bare host above by length and are
     NOT refined by a label. A "Facebook ad budget" spreadsheet stored against a
     Sheets URL has to stay a spreadsheet. */
  ['docs.google.com', 'software', 'Google Docs', 'google'],
  ['drive.google.com', 'software', 'Google Drive', 'google'],
  ['sheets.google.com', 'software', 'Google Sheets', 'google'],
  ['outlook.office.com', 'email', 'Outlook'],
  ['outlook.com', 'email', 'Outlook'],
  ['outlook.live.com', 'email', 'Outlook'],
  ['mail.zoho.com', 'email', 'Zoho Mail', 'zoho'],
  ['webmail', 'email', 'Webmail'],
  ['roundcube', 'email', 'Webmail', 'roundcube'],

  ['analytics.google.com', 'analytics', 'Google Analytics', 'googleanalytics'],
  ['search.google.com', 'analytics', 'Search Console', 'googlesearchconsole'],
  ['tagmanager.google.com', 'analytics', 'Tag Manager', 'googletagmanager'],

  ['ads.google.com', 'advertising', 'Google Ads', 'googleads'],
  ['adsmanager.facebook.com', 'advertising', 'Meta Ads Manager', 'meta'],
  ['ads.tiktok.com', 'advertising', 'TikTok Ads', 'tiktok'],

  ['hubspot.com', 'crm', 'HubSpot', 'hubspot'],
  ['salesforce.com', 'crm', 'Salesforce'],
  ['zoho.com', 'crm', 'Zoho', 'zoho'],
  ['pipedrive.com', 'crm', 'Pipedrive'],
  ['odoo.com', 'crm', 'Odoo', 'odoo'],

  ['cpanel', 'domain', 'cPanel', 'cpanel'],
  ['godaddy.com', 'domain', 'GoDaddy', 'godaddy'],
  ['namecheap.com', 'domain', 'Namecheap', 'namecheap'],
  ['hostinger', 'domain', 'Hostinger', 'hostinger'],
  ['cloudflare.com', 'domain', 'Cloudflare', 'cloudflare'],
  ['bluehost.com', 'domain', 'Bluehost'],
  ['siteground.com', 'domain', 'SiteGround'],
  ['wp-admin', 'domain', 'WordPress', 'wordpress'],
  ['wordpress.com', 'domain', 'WordPress', 'wordpress'],
  ['wordpress.org', 'domain', 'WordPress', 'wordpress'],
  ['shopify.com', 'domain', 'Shopify', 'shopify'],

  ['mailchimp.com', 'api', 'Mailchimp', 'mailchimp'],
  ['sendgrid.com', 'api', 'SendGrid'],
  ['twilio.com', 'api', 'Twilio'],
  ['openai.com', 'api', 'OpenAI'],
  ['console.anthropic.com', 'api', 'Anthropic', 'anthropic'],

  ['canva.com', 'software', 'Canva'],
  ['adobe.com', 'software', 'Adobe'],
  ['figma.com', 'software', 'Figma', 'figma'],

  /* ⚠️ LAST, AND IT MUST STAY THE SHORTEST GOOGLE PATTERN. Matching is
     longest-first, so every specific `*.google.com` above wins over this. It is
     the catch-all for "somewhere on google.com" — which is genuinely all a bare
     google.com URL tells us. */
  ['google.com', 'email', 'Google', 'google'],
];

/* ── VENDOR → THE PRODUCTS A LABEL MAY REFINE IT TO ───────────────────────────
   ── ⚠️ THIS IS NOT "THE LABEL OVERRIDES THE URL" ─────────────────────────────
   That rule stands and is tested: a specific host beats the label, always. This
   handles the different case where the host named a VENDOR and stopped — Google's
   sign-in page serves at least seven products, so `google.com/login` has told us
   who but not what, and the label is the only remaining evidence.

   Owner, 2026-08-24: *"Still no Gmail icon is used on the credential page."* The
   credential is `https://google.com/login` called "Gmail Login". Google's G was
   defensible; Gmail's M is what the row is actually for, and the label says so.

   ⚠️ SCOPED TO THE VENDOR'S OWN PRODUCTS, deliberately. An unscoped refinement
   would let "Client's Facebook budget" stored against a Google URL come back as
   Facebook, which is the very confusion the label-versus-URL rule exists to
   prevent. A Google host can only ever be refined into a Google product. */
const VENDOR_PRODUCTS: Readonly<Record<string, readonly string[]>> = {
  google: [
    'gmail',
    'googleanalytics',
    'googleads',
    'googlesearchconsole',
    'googletagmanager',
    'google_business',
    'youtube',
  ],
};

/* ── LABEL → BRAND, WHEN THERE IS NO URL AT ALL ───────────────────────────────
   `[needle, mark, label]`, matched longest-needle-first against a lowercased
   label.

   ── ⚠️ AN EXPLICIT TABLE, NOT DERIVED FROM THE HOST TABLES ──────────────────
   It used to be `BRAND_HOSTS.find(([, slug]) => slug !== 'x' && ...)` — the slugs
   doubled as label needles, with one hard-coded exception because a single 'x'
   matches half the labels in any vault. That exception was the warning: the set of
   names distinctive enough to guess from prose is NOT the set of brands we have
   marks for, and deriving one from the other means every mark added quietly adds a
   guess nobody vetted.

   ⚠️ 'meta' is absent for exactly that reason — it would claim Metabase, metadata
   and "meta description". The multi-word needles below catch the real cases
   without it. 'google' is absent too: Google Drive and Google Docs are not
   credentials of the same kind, and the family fallback handles them better. */
const LABEL_GUESSES: ReadonlyArray<readonly [string, string, string]> = [
  ['meta business suite', 'meta', 'Meta Business'],
  ['meta business', 'meta', 'Meta Business'],
  ['business suite', 'meta', 'Meta Business'],
  ['meta ads', 'meta', 'Meta Ads Manager'],
  ['google analytics', 'googleanalytics', 'Google Analytics'],
  ['search console', 'googlesearchconsole', 'Search Console'],
  ['tag manager', 'googletagmanager', 'Tag Manager'],
  ['google ads', 'googleads', 'Google Ads'],
  ['facebook', 'facebook', 'Facebook'],
  ['instagram', 'instagram', 'Instagram'],
  ['whatsapp', 'whatsapp', 'WhatsApp'],
  ['linkedin', 'linkedin', 'LinkedIn'],
  ['pinterest', 'pinterest', 'Pinterest'],
  ['snapchat', 'snapchat', 'Snapchat'],
  ['youtube', 'youtube', 'YouTube'],
  ['threads', 'threads', 'Threads'],
  ['tiktok', 'tiktok', 'TikTok'],
  ['wordpress', 'wordpress', 'WordPress'],
  ['mailchimp', 'mailchimp', 'Mailchimp'],
  ['cloudflare', 'cloudflare', 'Cloudflare'],
  ['namecheap', 'namecheap', 'Namecheap'],
  ['hostinger', 'hostinger', 'Hostinger'],
  ['godaddy', 'godaddy', 'GoDaddy'],
  ['shopify', 'shopify', 'Shopify'],
  ['hubspot', 'hubspot', 'HubSpot'],
  ['cpanel', 'cpanel', 'cPanel'],
  ['gmail', 'gmail', 'Gmail'],
  ['figma', 'figma', 'Figma'],
  ['odoo', 'odoo', 'Odoo'],
  ['zoho', 'zoho', 'Zoho'],
];

/** `credentials.kind` → the family to draw when the URL says nothing. */
const KIND_FALLBACK: Readonly<Record<string, GenericService>> = {
  client: 'client',
  hosting: 'domain',
  social: 'other',
  advertising: 'advertising',
  analytics: 'analytics',
  email: 'email',
  api: 'api',
  software: 'software',
  other: 'other',
};

/**
 * A URL reduced to the two things worth matching on: its host, and its host with
 * the path appended.
 *
 * ⚠️ BOTH, because the patterns are of two kinds. 'facebook.com' identifies a
 * service by its HOST; '/cpanel', '/wp-admin' and 'webmail' identify one by its
 * PATH on somebody's own domain — `gcroyal.com/cpanel` is a cPanel login and its
 * host says only 'gcroyal.com'. Matching everything against host+path instead
 * would be worse: a Google Sheet called `.../facebook-plan` would come back as
 * Facebook.
 *
 * ⚠️ Falls back to the raw string when `new URL()` throws, ON PURPOSE. Nothing
 * constrains this column's shape — the URL check constraint is on
 * `task_placements`, not here — so 'facebook.com/gcroyal' with no scheme is a
 * realistic value, and throwing would mean no icon at all.
 */
function partsOf(url: string): { host: string; full: string } {
  const trimmed = url.trim().toLowerCase();
  if (trimmed === '') return { host: '', full: '' };
  try {
    const parsed = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
    const host = parsed.host.replace(/^www\./, '');
    return { host, full: `${host}${parsed.pathname}${parsed.search}` };
  } catch {
    const raw = trimmed.replace(/^www\./, '');
    return { host: raw, full: raw };
  }
}

/** A pattern with a dot in it names a host; one without names a path marker. */
const isHostPattern = (pattern: string) => pattern.includes('.');

/**
 * A display name for a chosen mark key, from the tables this module already has.
 *
 * Only used when no `markLabel` callback was supplied — the brand's own name from
 * `lib/brand` is better and is what every real call site passes. This exists so a
 * test, or the report composer, can resolve a chosen service without reaching for
 * the mark tables.
 *
 * ⚠️ Prefers the LABEL_GUESSES name over a host label. Both tables can name the
 * same mark and they disagree on purpose: `business.facebook.com` is labelled
 * "Meta Business" because that is which Meta product the URL points at, while the
 * mark `meta` chosen from a picker just means Meta. The guess table holds the
 * brand-level name, which is the right answer for a deliberate choice.
 */
function labelForMark(mark: string): string {
  const guessed = LABEL_GUESSES.find(([, key]) => key === mark);
  if (guessed) return guessed[2];

  const branded = BRAND_HOSTS.find(([, key]) => key === mark);
  if (branded) return branded[2];

  const service = GENERIC_HOSTS.find(([, , , key]) => key === mark);
  if (service) return service[2];

  /* Not in any table: a mark added to `lib/brand` and not yet wired to a host.
     Its key is a reasonable name — 'shopify' reads as Shopify once capitalised —
     and it is only ever seen when the caller declined to pass `markLabel`. */
  return mark.charAt(0).toUpperCase() + mark.slice(1);
}

/**
 * Read a brand out of a label.
 *
 * @param only When given, the only marks that may be returned — used to keep a
 *             vendor-level host's refinement inside that vendor's own products.
 *             Null means anything in `LABEL_GUESSES`, which is only safe when
 *             there is no URL at all to contradict it.
 *
 * ⚠️ Longest needle first, the same rule the hosts use and for the same reason:
 * 'meta business suite' has to beat 'business suite', and 'google analytics' has
 * to beat a bare 'analytics' claim. Sorted at call time so the table above can
 * stay in readable order; it runs once per rendered row over a few dozen entries.
 */
function guessFromLabel(
  rawLabel: string,
  only: readonly string[] | null,
): CredentialService | null {
  const label = rawLabel.toLowerCase();

  const guess = [...LABEL_GUESSES]
    .filter(([, mark]) => only === null || only.includes(mark))
    .sort((a, b) => b[0].length - a[0].length)
    .find(([needle]) => label.includes(needle));

  return guess ? { kind: 'brand', mark: guess[1], label: guess[2] } : null;
}

export function credentialService(input: {
  url: string | null;
  label: string;
  kind: string;
  /** `credentials.service` — a mark key the person CHOSE. Migration 051. Null on
   *  every row created before that, and on anything imported. */
  service?: string | null;
  /** The brand's own display name for a mark key, or null if there is no such
   *  mark. Injected so this module stays free of `lib/brand` — see the note
   *  below. Doing existence and naming in one callback keeps it to one dependency
   *  rather than two that could disagree. */
  markLabel?: (key: string) => string | null;
}): CredentialService {
  /* ══ ⚠️ A CHOSEN SERVICE BEATS EVERYTHING ═══════════════════════════════════
     Owner, 2026-08-24: *"during the time of creation, it should be selected
     whether the credentials are Gmail, Facebook, TikTok, or anything like that,
     so select the image respectively."*

     Everything below this block is INFERENCE, and inference failed twice in one
     day: `google.com/login` labelled "Gmail Login" matched no host pattern, and
     `accounts.google.com` names a vendor rather than a product. Both were patched
     by adding patterns, which is a game with no end — there is always another
     host, and some URLs genuinely do not say which product they are for.

     The person storing the credential knows. Once they have said, nothing here
     should second-guess them: not the host, not the label, not the kind. So this
     returns first.

     ⚠️ `markLabel` IS INJECTED RATHER THAN IMPORTED. `lib/domain` may not depend
     on `lib/brand` — this module is pure, tested in isolation, and its host tables
     are read by the report composer on the server. Without the callback a stored
     value is trusted as-is and named from the host tables, which is the right
     default: an unrecognised key degrades to a family glyph at the render site
     anyway (see `CredentialIcon`), so the worst case is the picture we had before
     the choice existed.

     ⚠️ AND AN UNKNOWN KEY FALLS THROUGH rather than returning a brand nobody can
     draw. A mark removed from `lib/brand` would otherwise leave every credential
     that named it rendering an empty coloured tile; falling through gets them the
     URL-derived icon back, which is what they had before anybody chose. */
  const chosen = input.service?.trim();
  if (chosen) {
    const named = input.markLabel ? input.markLabel(chosen) : null;
    if (named !== null || !input.markLabel) {
      return { kind: 'brand', mark: chosen, label: named ?? labelForMark(chosen) };
    }
  }

  const { host, full } = input.url ? partsOf(input.url) : { host: '', full: '' };

  if (host !== '') {
    /* ── ⚠️ ONE SORTED PASS OVER BOTH TABLES, NOT BRANDS THEN GENERICS ───────
       Checking brands first was a bug the tests caught: every Meta property
       contains 'facebook.com', so `adsmanager.facebook.com` matched the brand
       table and came back as "Facebook" — making an ads account
       indistinguishable from the page it advertises. Longest pattern wins,
       across both tables, which is the only rule that gets subdomains right.

       Sorted at match time so the tables above can stay in readable order; the
       lists are a few dozen entries and this runs once per rendered row. */
    const candidates = [
      ...BRAND_HOSTS.map(([pattern, mark, label]) => ({
        pattern,
        result: { kind: 'brand', mark, label } as CredentialService,
      })),
      ...GENERIC_HOSTS.map(([pattern, service, label, mark]) => ({
        pattern,
        /* The one branch the fourth column buys: a host we hold a logo for
           becomes a brand, everything else keeps its family glyph. */
        result: (mark
          ? { kind: 'brand', mark, label }
          : { kind: 'generic', service, label }) as CredentialService,
      })),
    ].sort((a, b) => b.pattern.length - a.pattern.length);

    /* Hosts against the host; path markers against host+path. See `partsOf`. */
    const hit = candidates.find(({ pattern }) =>
      isHostPattern(pattern) ? host.includes(pattern) : full.includes(pattern),
    );

    if (hit) {
      /* ── ⚠️ A VENDOR-LEVEL HIT GETS ONE MORE LOOK AT THE LABEL ────────────
         Only when the mark it landed on is a vendor with named products, and only
         to one of THOSE products. See `VENDOR_PRODUCTS`. Everything else returns
         exactly what the host said. */
      if (hit.result.kind === 'brand') {
        const products = VENDOR_PRODUCTS[hit.result.mark];
        if (products) {
          const refined = guessFromLabel(input.label, products);
          if (refined) return refined;
        }
      }
      return hit.result;
    }
  }

  /* ── THE LABEL, WITH NO URL TO GO ON AT ALL ──────────────────────────────
     Unrestricted here, because there is no host to contradict it. */
  if (host === '') {
    const guess = guessFromLabel(input.label, null);
    if (guess) return guess;
  }

  const family = KIND_FALLBACK[input.kind] ?? 'other';
  return { kind: 'generic', service: family, label: input.kind };
}
