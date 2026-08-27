import { describe, expect, it } from 'vitest';

import { LINKEDIN_SHAPES, PLATFORM_MARKS } from '../platform-marks';
import { BRAND_CHOICES, SERVICE_MARKS, brandMark } from '../service-marks';

/* ============================================================================
 * THE BRAND MARK DATA
 * ----------------------------------------------------------------------------
 * Owner, 2026-08-24: *"Please use a proper logo. For example use a Gmail logo and
 * use Facebook properly."*
 *
 * ── ⚠️ WHY THIS FILE EXISTS AT ALL ───────────────────────────────────────────
 * A brand mark is two to four thousand characters of coordinates, and there is no
 * unit test for "does this look like Gmail". What CAN be tested is the class of
 * failure that actually happens: a path that got mangled on the way in. A truncated
 * or half-escaped path does not throw and does not warn — the browser draws
 * whatever prefix parses and silently discards the rest, so the tile renders a
 * plausible-looking blob and nobody notices until a client sees it.
 *
 * These marks were extracted mechanically from `simple-icons` (CC0) rather than
 * typed out, which is the real defence. This is the seatbelt.
 * ========================================================================= */

const ALL = { ...PLATFORM_MARKS, ...SERVICE_MARKS };

describe('every mark is drawable', () => {
  it('has at least the eleven platforms and the twenty-one services', () => {
    /* A floor, not an exact count — marks get added. It catches the failure that
       matters: a generated file that came out empty or half-written. */
    expect(Object.keys(PLATFORM_MARKS).length).toBeGreaterThanOrEqual(11);
    expect(Object.keys(SERVICE_MARKS).length).toBeGreaterThanOrEqual(21);
  });

  for (const [key, mark] of Object.entries(ALL)) {
    describe(key, () => {
      it('has a label and a six-digit hex', () => {
        expect(mark.label.length).toBeGreaterThan(0);
        /* Six digits with a leading #, because the tile interpolates it straight
           into a `background` — a malformed value there is an invisible
           transparent tile rather than an error. */
        expect(mark.hex).toMatch(/^#[0-9A-Fa-f]{6}$/);
      });

      it('knocks out light or dark, and nothing else', () => {
        expect(['light', 'dark']).toContain(mark.glyph);
      });

      it('has path data that parses', () => {
        /* ⚠️ LinkedIn is the documented exception: it is absent from simple-icons
           (withdrawn at LinkedIn's request) and is described as geometry in
           `LINKEDIN_SHAPES`, which both renderers consume. */
        if (key === 'linkedin') {
          expect(mark.path).toBeUndefined();
          expect(LINKEDIN_SHAPES.arch.length).toBeGreaterThan(0);
          return;
        }

        /* ⚠️ A mark may instead carry REAL MULTI-PATH ARTWORK. Google Drive does:
           its three colours are diagonal wedges of a triangle, which the clipped
           -layers form cannot cut, so it ships the brand's own paths in the
           brand's own viewBox. Every piece of that art gets the same grammar
           check the single path gets — the failure it catches is a mangled
           escape surviving into the data, and six paths are six chances at it. */
        if (mark.art) {
          expect(mark.path, `${key} has both art and a path — pick one`).toBeUndefined();

          /* Four finite numbers. Asserted by parsing rather than by a regex: a
             viewBox is `minX minY width height` and what matters is that it IS
             those four numbers, which `Number` decides more honestly than a
             character class — and there is no escaping to get wrong. */
          const box = mark.art.viewBox.trim().split(/\s+/).map(Number);
          expect(box, `${key} viewBox is not four numbers`).toHaveLength(4);
          for (const value of box) expect(Number.isFinite(value)).toBe(true);
          expect(box[2], `${key} viewBox width`).toBeGreaterThan(0);
          expect(box[3], `${key} viewBox height`).toBeGreaterThan(0);

          expect(mark.art.paths.length).toBeGreaterThan(0);
          for (const piece of mark.art.paths) {
            expect(piece.fill, `${key} art fill`).toMatch(/^#[0-9A-Fa-f]{6}$/);
            /* Starts with a moveto, and holds only path grammar — the same two
               checks the single-path marks get, applied to each piece. Six paths
               are six chances for a mangled escape to survive into the data. */
            expect(piece.d, `${key} art path`).toMatch(/^[Mm]/);
            expect(piece.d, `${key} art path grammar`).toMatch(
              /^[MmLlHhVvCcSsQqTtAaZz0-9eE,.\s+-]+$/,
            );
          }
          return;
        }

        const path = mark.path;
        expect(path, `${key} has no path`).toBeTruthy();
        /* Starts with a moveto. Every valid path does, and a truncated one that
           lost its head does not. */
        expect(path).toMatch(/^[Mm]/);
        /* Only path grammar. This is what catches a mangled escape or a stray
           quote surviving into the data — the failure mode of generating a file
           through a shell. */
        expect(path).toMatch(/^[MmLlHhVvCcSsQqTtAaZz0-9eE,.\s+-]+$/);
        /* Long enough to be a logo rather than a fragment. The shortest real mark
           here is Anthropic's at ~170 characters. */
        expect(path!.length).toBeGreaterThan(100);
      });
    });
  }
});

describe('the resolver', () => {
  it('finds a platform slug and a service key through one call', () => {
    /* The whole reason `brandMark` exists — see its own note. A renderer only ever
       wants "the tile for this mark" and should not have to know which table a key
       came from. */
    expect(brandMark('facebook')).toBe(PLATFORM_MARKS.facebook);
    expect(brandMark('gmail')).toBe(SERVICE_MARKS.gmail);
  });

  it('returns null rather than throwing on nothing', () => {
    /* Called with `service.mark`, which is optional on the generic variant. */
    expect(brandMark(null)).toBeNull();
    expect(brandMark(undefined)).toBeNull();
    expect(brandMark('')).toBeNull();
    expect(brandMark('not-a-brand')).toBeNull();
  });

  it('⚠️ has no key collisions between the two tables', () => {
    /* Platforms win by design, so a collision would silently shadow a service
       mark. There are none today; this is what says so if one appears. */
    const overlap = Object.keys(SERVICE_MARKS).filter((k) => k in PLATFORM_MARKS);
    expect(overlap, `service keys shadowed by platform slugs: ${overlap.join(', ')}`).toEqual([]);
  });
});

describe('the picker list', () => {
  /* Owner, 2026-08-24: *"during the time of creation, it should be selected
     whether the credentials are Gmail, Facebook, TikTok, or anything like that."*
     `BRAND_CHOICES` is what the credential form renders as tiles. */
  it('offers every mark, so adding a logo adds a choice', () => {
    /* ⚠️ THE REASON IT IS DERIVED FROM THE TABLES. A hand-kept picker list is a
       third place to register a logo and the one that gets forgotten — the mark
       would exist, resolve and render everywhere, and simply never be offered. */
    expect(BRAND_CHOICES).toHaveLength(
      Object.keys(PLATFORM_MARKS).length + Object.keys(SERVICE_MARKS).length,
    );
  });

  it('names every choice from the mark itself', () => {
    /* So the caption under a tile cannot disagree with the tile. */
    for (const choice of BRAND_CHOICES) {
      expect(brandMark(choice.key)?.label, choice.key).toBe(choice.label);
    }
  });

  it('includes all eight logos the owner sent', () => {
    /* Gmail, Facebook, Instagram, TikTok, LinkedIn, WordPress, cPanel, Meta —
       attached as PNGs on 2026-08-24. All were already in the vector set; this
       pins that each is PICKABLE, which was the actual request. */
    const keys = BRAND_CHOICES.map((c) => c.key);
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
      expect(keys, `${mark} is not offered in the picker`).toContain(mark);
    }
  });

  it('has no duplicate keys, which would break React and the radio group', () => {
    const keys = BRAND_CHOICES.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('the marks the owner named', () => {
  /* Owner: *"use a Gmail logo and use Facebook properly."* Named explicitly so a
     future refactor that drops one fails here rather than on screen. */
  it('Gmail is red and has its envelope', () => {
    expect(SERVICE_MARKS.gmail.hex).toBe('#EA4335');
    expect(SERVICE_MARKS.gmail.glyph).toBe('light');
  });

  it('Facebook is Facebook blue', () => {
    expect(PLATFORM_MARKS.facebook.hex).toBe('#0866FF');
  });

  it('the two bright tiles use a dark glyph, because white would vanish', () => {
    /* Measured by WCAG relative luminance when the data was generated, not
       eyeballed. Mailchimp's yellow and GoDaddy's cyan are the only two above the
       0.45 threshold. */
    expect(SERVICE_MARKS.mailchimp.glyph).toBe('dark');
    expect(SERVICE_MARKS.godaddy.glyph).toBe('dark');
  });
});
