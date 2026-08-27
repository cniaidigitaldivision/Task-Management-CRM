import { describe, expect, it } from 'vitest';

import { credentialService, GENERIC_SERVICES } from '../credential-service';
import { PLATFORM_MARKS } from '@/lib/brand/platform-marks';
import { brandMark, brandMarkLabel } from '@/lib/brand/service-marks';

/* ============================================================================
 * THE ICON ON A CREDENTIAL ROW
 * ----------------------------------------------------------------------------
 * Owner, 2026-08-24: *"properly use their icon if it's Facebook, properly use
 * their Facebook icons… whether it's Facebook, Gmail, TikTok, Instagram, any
 * other credential domain, even a domain credential, or any CRM credential."*
 *
 * ⚠️ THIS HEADER SAID "Derived from the URL rather than stored" until 2026-08-24,
 * and that was the design right up until derivation failed twice in a day. There
 * are now three sources, in strict order, and each has its own block below:
 *
 *   1. `credentials.service`  what the person CHOSE (migration 051). Wins outright.
 *   2. the URL               a table of host substrings, longest match wins.
 *   3. the label             vetted needles, only where the URL cannot say.
 *
 * The stored choice did not replace the derivation — it sits in front of it, so
 * every credential recorded before the picker existed keeps the icon it has.
 *
 * The derivation tests remain the bulk of this file because a table of substrings
 * has exactly two failure modes and both are silent: the wrong entry wins, or an
 * ordinary label matches something it should not.
 * ========================================================================= */

const of = (url: string | null, label = 'Some account', kind = 'other') =>
  credentialService({ url, label, kind });

describe('a brand the vault should recognise', () => {
  const CASES: ReadonlyArray<readonly [string, string]> = [
    ['https://facebook.com/gcroyal', 'facebook'],
    ['https://www.instagram.com/gcroyal', 'instagram'],
    ['https://www.tiktok.com/@gcroyal', 'tiktok'],
    ['https://studio.youtube.com/channel/abc', 'youtube'],
    ['https://linkedin.com/company/cni', 'linkedin'],
    ['https://web.whatsapp.com', 'whatsapp'],
    ['https://business.google.com/dashboard', 'google_business'],
    ['https://x.com/cniaid', 'x'],
    ['https://twitter.com/cniaid', 'x'],

    /* ── ⚠️ THE 2026-08-24 ADDITIONS ──────────────────────────────────────
       Owner: *"Please use a proper logo. For example use a Gmail logo… If you
       don't have it please go to Google and bring that logo over here."*

       Every one of these returned `generic` before, so it drew a lucide family
       glyph — an envelope for Gmail, a globe for WordPress and cPanel, a bar
       chart for Analytics. They are in this list, not a separate one, because
       "has a real logo" is now one property and it must hold for all of them. */
    ['https://mail.google.com/mail/u/0', 'gmail'],
    ['https://gmail.com', 'gmail'],
    ['https://gcroyal.com/wp-admin', 'wordpress'],
    ['https://wordpress.com/home/gcroyal.com', 'wordpress'],
    ['https://gcroyal.com/cpanel', 'cpanel'],
    ['https://analytics.google.com/analytics/web', 'googleanalytics'],
    ['https://search.google.com/search-console', 'googlesearchconsole'],
    ['https://tagmanager.google.com/#/home', 'googletagmanager'],
    ['https://ads.google.com/aw/campaigns', 'googleads'],
    ['https://accounts.google.com/login', 'google'],
    ['https://mailchimp.com/login', 'mailchimp'],
    ['https://dash.cloudflare.com', 'cloudflare'],
    ['https://hostinger.com/cpanel-login', 'hostinger'],
    ['https://www.namecheap.com/myaccount', 'namecheap'],
    ['https://sso.godaddy.com', 'godaddy'],
    ['https://gcroyal.myshopify.com/admin', 'shopify'],
    ['https://app.hubspot.com/contacts', 'hubspot'],
    ['https://www.figma.com/files', 'figma'],
    ['https://console.anthropic.com/settings', 'anthropic'],
    ['https://mail.zoho.com/zm/', 'zoho'],
    ['https://gcroyal.com/roundcube', 'roundcube'],

    /* ⚠️ META'S PROPERTIES GET META'S MARK, not Facebook's `f`. Business Suite
       and Ads Manager are Meta products on a facebook.com subdomain, and the
       owner's mockup shows the Meta infinity mark on that row. */
    ['https://business.facebook.com/latest/home', 'meta'],
    ['https://adsmanager.facebook.com/adsmanager', 'meta'],
    ['https://ads.tiktok.com/i18n/dashboard', 'tiktok'],
  ];

  for (const [url, mark] of CASES) {
    it(`${url} → ${mark}`, () => {
      const result = of(url);
      expect(result.kind).toBe('brand');
      expect(result.kind === 'brand' && result.mark).toBe(mark);
    });
  }

  it('⚠️ every mark it can return resolves to a real logo', () => {
    /* THE TEST THAT MAKES THE TABLE SAFE TO EDIT. A mark key with no entry draws
       a family glyph instead — survivable, invisible, and not what "use a proper
       logo" asked for. `brandMark` spans both tables, so a platform slug and a
       service key are checked by the same assertion. */
    for (const [url, mark] of CASES) {
      const resolved = brandMark(mark);
      expect(resolved, `no brand mark for '${mark}' (${url})`).not.toBeNull();
      /* A path or LinkedIn's geometry — one of the two has to be there, or the
         tile renders an empty coloured square. */
      if (mark !== 'linkedin') expect(resolved?.path, `no path for '${mark}'`).toBeTruthy();
      expect(resolved?.hex).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it('the platform marks are still reachable by their own slug', () => {
    /* `brandMark` prefers PLATFORM_MARKS, and that precedence is deliberate: those
       keys are a database column. If a service key ever collides with one, the
       platform must win. */
    for (const slug of Object.keys(PLATFORM_MARKS)) {
      expect(brandMark(slug)).toBe(PLATFORM_MARKS[slug]);
    }
  });

  it('a brand we hold no logo for stays generic rather than faking one', () => {
    /* ⚠️ Outlook, Canva, Adobe, Salesforce and the rest are absent from
       simple-icons — mostly withdrawn at the brand's own request. Reconstructing
       one from memory would be wrong on screen or a trademark nobody agreed to
       reproduce, so they keep the family glyph. This pins that as a decision. */
    for (const [url, family] of [
      ['https://outlook.office.com/mail', 'email'],
      ['https://www.canva.com/folder/all', 'software'],
      ['https://account.adobe.com', 'software'],
      ['https://login.salesforce.com', 'crm'],
      ['https://app.pipedrive.com', 'crm'],
    ] as const) {
      const result = of(url);
      expect(result.kind, url).toBe('generic');
      expect(result.kind === 'generic' && result.service).toBe(family);
    }
  });
});

describe('a service the person CHOSE beats every inference', () => {
  /* ============================================================================
   * ⚠️ MIGRATION 051, AND THE END OF GUESSING
   * ----------------------------------------------------------------------------
   * Owner, 2026-08-24: *"during the time of creation, it should be selected
   * whether the credentials are Gmail, Facebook, TikTok, or anything like that, so
   * select the image respectively."*
   *
   * Everything else in this file is inference, and inference failed twice in one
   * day. `credentials.service` is what the person said, and nothing below it may
   * argue — not the host, not the label, not the kind.
   * ========================================================================= */
  /* ⚠️ Narrows to the brand variant rather than letting each assertion write
     `result.kind === 'brand' && result.mark`. Every case in this block chooses a
     real mark, so a generic result is a failure of the thing under test — and
     throwing here says which service came back wrong, where an `&&` chain would
     just compare `false` against a string. */
  const chose = (service: string, url: string | null, label = 'Some account') => {
    const result = credentialService({
      url,
      label,
      kind: 'other',
      service,
      markLabel: brandMarkLabel,
    });
    if (result.kind !== 'brand') {
      throw new Error(`expected a brand for '${service}', got generic '${result.service}'`);
    }
    return result;
  };

  it('wins over a URL that says something else entirely', () => {
    /* THE CASE THAT MATTERS. Somebody stores their Gmail against the shared Google
       sign-in, or against their own domain's webmail, and picks Gmail. The URL must
       not overrule them. */
    expect(chose('gmail', 'https://accounts.google.com/login').mark).toBe('gmail');
    expect(chose('gmail', 'https://gcroyal.com/webmail').mark).toBe('gmail');
    expect(chose('facebook', 'https://linktr.ee/gcroyal').mark).toBe('facebook');
    expect(chose('tiktok', 'https://gcroyal.com/social').mark).toBe('tiktok');
  });

  it('wins over a label that says something else', () => {
    const result = chose('wordpress', null, 'Facebook page login');
    expect(result.kind === 'brand' && result.mark).toBe('wordpress');
  });

  it('works with no URL at all, which is half the point', () => {
    expect(chose('cpanel', null).mark).toBe('cpanel');
    expect(chose('meta', null).mark).toBe('meta');
  });

  it('takes its display name from the mark, not from a host table', () => {
    /* ⚠️ `business.facebook.com` is labelled "Meta Business" because that is which
       Meta PRODUCT the URL points at. A deliberate choice of the `meta` mark just
       means Meta, so the brand's own name is the right caption — and it is the same
       name the tile beside it uses. */
    expect(chose('meta', null).label).toBe('Meta');
    expect(chose('gmail', null).label).toBe('Gmail');
    expect(chose('cpanel', null).label).toBe('cPanel');
  });

  it('every one of the logos the owner sent can be chosen', () => {
    /* The eight images attached on 2026-08-24: Gmail, Facebook, Instagram, TikTok,
       LinkedIn, WordPress, cPanel and Meta. All were already in the vector set, and
       this pins that each is reachable BY CHOICE rather than only by a lucky URL. */
    for (const mark of [
      'gmail',
      'facebook',
      'instagram',
      'tiktok',
      'linkedin',
      'wordpress',
      'cpanel',
      'meta',
    ]) {
      const result = chose(mark, null);
      expect(result.kind === 'brand' && result.mark, mark).toBe(mark);
      expect(brandMark(mark), `${mark} has no logo to draw`).not.toBeNull();
    }
  });

  it('⚠️ falls back to inference for a mark that no longer exists', () => {
    /* A logo removed from `lib/brand` would otherwise leave every credential that
       named it rendering an empty coloured tile. Falling through gets them the
       URL-derived icon back — what they had before anybody chose. */
    const result = credentialService({
      url: 'https://facebook.com/gcroyal',
      label: 'Some account',
      kind: 'other',
      service: 'a-brand-we-deleted',
      markLabel: brandMarkLabel,
    });
    expect(result.kind === 'brand' && result.mark).toBe('facebook');
  });

  it('treats blank and whitespace as "not chosen"', () => {
    /* The picker posts an empty string for "Detect", and the action stores null.
       Both have to mean the same thing here. */
    for (const service of ['', '   ', null, undefined]) {
      const result = credentialService({
        url: 'https://instagram.com/gcroyal',
        label: 'x',
        kind: 'other',
        service,
        markLabel: brandMarkLabel,
      });
      expect(result.kind === 'brand' && result.mark).toBe('instagram');
    }
  });

  it('trusts a stored value when no mark table is supplied', () => {
    /* Without `markLabel` this module cannot check existence — it may not import
       `lib/brand`. Trusting is the right default: the render site checks again and
       degrades to a glyph, so the worst case is the picture we had before. */
    const result = credentialService({
      url: null,
      label: 'x',
      kind: 'other',
      service: 'shopify',
    });
    expect(result.kind === 'brand' && result.mark).toBe('shopify');
    expect(result.label).toBe('Shopify');
  });
});

describe('a vendor host the label has to finish', () => {
  /* ============================================================================
   * ⚠️ THE OWNER'S ACTUAL ROW, 2026-08-24
   * ----------------------------------------------------------------------------
   * *"Still no Gmail icon is used on the credential page."*
   *
   * The one credential in the vault is `https://google.com/login` labelled
   * "Gmail Login". Bare `google.com` was in NO table, so it matched nothing, fell
   * through to `kind` ('other') and drew a key glyph — while the label sat unused
   * because the guess only ran when there was no URL at all.
   *
   * These cases exist so that combination cannot silently regress again.
   * ========================================================================= */
  it('google.com/login labelled "Gmail Login" is Gmail', () => {
    const result = of('https://google.com/login', 'Gmail Login', 'other');
    expect(result.kind === 'brand' && result.mark).toBe('gmail');
    expect(result.label).toBe('Gmail');
  });

  it('the shared sign-in hosts behave the same way', () => {
    for (const url of [
      'https://accounts.google.com/login',
      'https://myaccount.google.com/security',
      'https://www.google.com/login',
    ]) {
      const result = of(url, 'Gmail Login', 'other');
      expect(result.kind === 'brand' && result.mark, url).toBe('gmail');
    }
  });

  it('falls back to Google itself when the label names no product', () => {
    /* The vendor mark is still a real logo, which is the point — the row gets
       Google's G rather than a generic key. */
    const result = of('https://google.com/login', 'Client main account', 'other');
    expect(result.kind === 'brand' && result.mark).toBe('google');
  });

  it('refines to the other Google products too', () => {
    for (const [label, mark] of [
      ['Google Analytics — GC Royal', 'googleanalytics'],
      ['Google Ads account', 'googleads'],
      ['Search Console access', 'googlesearchconsole'],
      ['YouTube channel login', 'youtube'],
    ] as const) {
      const result = of('https://accounts.google.com', label, 'other');
      expect(result.kind === 'brand' && result.mark, label).toBe(mark);
    }
  });

  it('⚠️ refines ONLY within the vendor, never across brands', () => {
    /* THE GUARD ON THE WHOLE MECHANISM. A Google host may become a Google
       product and nothing else — otherwise "Facebook ad budget" stored against a
       Google URL would come back as Facebook, which is exactly the confusion the
       label-versus-URL rule exists to prevent. */
    const result = of('https://google.com/login', 'Facebook ad budget', 'other');
    expect(result.kind === 'brand' && result.mark).toBe('google');
  });

  it('⚠️ a SPECIFIC host is never refined by the label', () => {
    /* `docs.google.com` says which product, so the label has nothing left to
       decide. This is the case the older test protected, now protected by a host
       entry rather than by the guess being switched off entirely. */
    const sheet = of('https://docs.google.com/spreadsheets/d/abc', 'Facebook ad budget', 'other');
    expect(sheet.label).toBe('Google Docs');

    const gmail = of('https://mail.google.com/mail/u/0', 'Google Ads login', 'other');
    expect(gmail.kind === 'brand' && gmail.mark).toBe('gmail');
  });
});

describe('the longest host pattern wins', () => {
  /* ⚠️ THE BUG THIS PREVENTS. Every one of these contains 'facebook.com', so a
     first-match-wins table in file order would label all three "Facebook" and
     the ads account would be indistinguishable from the page. */
  it('business.facebook.com is Meta Business, not Facebook', () => {
    expect(of('https://business.facebook.com/settings').label).toBe('Meta Business');
  });

  it('adsmanager.facebook.com is the Ads Manager, under Meta', () => {
    /* ⚠️ This asserted `generic` / `advertising` until 2026-08-24, because there
       was no Meta mark to draw. There is now, and an ads account showing Meta's
       logo with the label "Meta Ads Manager" is both prettier and more accurate
       than a megaphone glyph. The LABEL is what keeps it distinct from the page. */
    const result = of('https://adsmanager.facebook.com/adsmanager');
    expect(result.kind === 'brand' && result.mark).toBe('meta');
    expect(result.label).toBe('Meta Ads Manager');
  });

  it('plain facebook.com is still Facebook', () => {
    expect(of('https://facebook.com/gcroyal').label).toBe('Facebook');
  });

  it('⚠️ Facebook keeps the f while Meta properties take the infinity mark', () => {
    /* The distinction the owner's mockup draws. Both live on facebook.com, and
       they must not share a tile: an `f` on a Business Suite row says "a Facebook
       page", which is the thing being managed rather than the thing logged into.

       ⚠️ Each result is held in a local. Calling `of()` twice inside one
       expression does not narrow — TypeScript cannot know the second call returns
       the same variant as the first — and the version of this test that did read
       as if it worked while `.mark` was untyped. */
    const page = of('https://facebook.com/gcroyal');
    const suite = of('https://business.facebook.com/latest');

    expect(page.kind === 'brand' && page.mark).toBe('facebook');
    expect(suite.kind === 'brand' && suite.mark).toBe('meta');
  });
});

describe('the label a service reports, whether or not it has a logo', () => {
  /* ⚠️ THIS BLOCK WAS CALLED "services with no brand mark of their own" and
     asserted `kind: 'generic'` for every row. Eight of the ten now HAVE a mark
     (2026-08-24), so what it tests is the part that did not change: the human
     label. The label is what distinguishes Google Ads from Google Analytics —
     both are Google, both now have their own logo, and neither is identifiable
     from a tile alone. */
  const CASES: ReadonlyArray<readonly [string, string]> = [
    ['https://mail.google.com/mail/u/0', 'Gmail'],
    ['https://outlook.office.com/mail', 'Outlook'],
    ['https://analytics.google.com/analytics', 'Google Analytics'],
    ['https://ads.google.com/aw/campaigns', 'Google Ads'],
    ['https://app.hubspot.com/contacts', 'HubSpot'],
    ['https://gcroyal.com/cpanel', 'cPanel'],
    ['https://www.godaddy.com/domains', 'GoDaddy'],
    ['https://gcroyal.com/wp-admin', 'WordPress'],
    ['https://api.mailchimp.com', 'Mailchimp'],
    ['https://www.canva.com/brand', 'Canva'],
  ];

  for (const [url, label] of CASES) {
    it(`${url} → ${label}`, () => {
      expect(of(url).label).toBe(label);
    });
  }
});

describe('a URL somebody typed without a scheme', () => {
  it('still finds the brand', () => {
    /* ⚠️ Realistic: nothing constrains this column's shape — the URL check
       constraint is on `task_placements`, not here. `new URL()` throws on this,
       and throwing would mean no icon at all. */
    expect(of('facebook.com/gcroyal').label).toBe('Facebook');
  });

  it('handles www. and a trailing path', () => {
    expect(of('www.instagram.com/gcroyal/').label).toBe('Instagram');
  });

  it('is not confused by capitals', () => {
    expect(of('HTTPS://WWW.TIKTOK.COM/@GCRoyal').label).toBe('TikTok');
  });
});

describe('with no URL at all', () => {
  it('falls back to the stored kind', () => {
    const result = of(null, 'Client main account', 'hosting');
    expect(result.kind).toBe('generic');
    expect(result.kind === 'generic' && result.service).toBe('domain');
  });

  it('reads an obvious brand out of the label', () => {
    const result = of(null, 'GC Royal — Facebook page login', 'social');
    expect(result.kind).toBe('brand');
    expect(result.kind === 'brand' && result.mark).toBe('facebook');
  });

  it('reads the services too, not only the social platforms', () => {
    /* The mockup's own rows, as somebody would actually name them. */
    for (const [label, mark] of [
      ['Gmail Login', 'gmail'],
      ['WordPress Admin', 'wordpress'],
      ['Hosting / CPANEL', 'cpanel'],
      ['Mailchimp — newsletter', 'mailchimp'],
    ] as const) {
      const result = of(null, label, 'other');
      expect(result.kind === 'brand' && result.mark, label).toBe(mark);
    }
  });

  it('⚠️ prefers the longest needle, so "Meta Business Suite" is Meta', () => {
    /* Three needles match this label — 'meta business suite', 'meta business' and
       'business suite'. Without longest-first the answer would depend on table
       order, which is the bug the host matcher already had once. */
    const result = of(null, 'Meta Business Suite', 'social');
    expect(result.kind === 'brand' && result.mark).toBe('meta');
    expect(result.label).toBe('Meta Business');
  });

  it("⚠️ never guesses 'meta' from a bare substring", () => {
    /* THE REASON 'meta' IS NOT A NEEDLE ON ITS OWN. Metabase is a real BI tool a
       client might have, and "meta description" is ordinary SEO prose. Claiming
       either for Meta would put Facebook's parent logo on somebody's database. */
    for (const label of ['Metabase analytics', 'Meta description tool', 'metadata store']) {
      const result = of(null, label, 'other');
      expect(result.kind, label).toBe('generic');
    }
  });

  it("⚠️ never guesses 'x' from a label", () => {
    /* One letter would match an enormous share of real labels. The X account has
       to carry its URL to be recognised, which is the honest trade. */
    const result = of(null, 'Client x main account', 'social');
    expect(result.kind).toBe('generic');
  });

  it('does not guess from a label when a URL was given', () => {
    /* The URL is evidence and the label is a guess, so a label mentioning
       Facebook must not override a host that says otherwise — "Facebook ad
       budget sheet" stored against a Google Sheets URL is the realistic case.

       ⚠️ THE ASSERTION CHANGED ON 2026-08-24, THE PRINCIPLE DID NOT. This checked
       `kind === 'generic'`, which passed for the wrong reason: `docs.google.com`
       was in no table at all, so it fell through to the credential's `kind`. Now
       it is a recognised host WITH a logo, so the kind is 'brand' — and the thing
       actually worth asserting is that the answer is Google and not Facebook. */
    const result = of('https://docs.google.com/spreadsheets/d/abc', 'Facebook ad budget');
    expect(result.label).toBe('Google Docs');
    expect(result.kind === 'brand' && result.mark).not.toBe('facebook');
  });
});

describe('it always returns something drawable', () => {
  it('has no null case for a caller to handle', () => {
    for (const kind of ['client', 'hosting', 'social', 'api', 'nonsense', '']) {
      const result = of(null, '', kind);
      expect(result.kind === 'generic' && GENERIC_SERVICES).toContain(
        result.kind === 'generic' ? result.service : 'other',
      );
    }
  });

  it('survives an empty and a junk URL', () => {
    expect(of('').kind).toBe('generic');
    expect(of('not a url at all !!').kind).toBe('generic');
  });
});
