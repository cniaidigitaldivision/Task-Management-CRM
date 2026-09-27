import { describe, expect, it } from 'vitest';

import {
  areaCheck,
  areaLabel,
  areaSqft,
  characterChips,
  countProperties,
  displayArea,
  filterProperties,
  money,
  parseDimensions,
  propertyChanges,
  statusNeedsPaperwork,
  shareable,
  shareText,
  sizeLabel,
  statusLook,
  SELECTABLE_STATUSES,
  TEMPLATE_COLUMNS,
  type PropertyLike,
} from '../crm-property';

/* Real row shapes, taken from the seeded scheme rather than invented. */
const A101: PropertyLike & { roadWidthFt: number | null } = {
  id: '1', code: 'PROP-A101', plotNumber: 'A-101', block: 'A', kind: 'Residential plot',
  projectName: 'Chitral Royal Homes [demo]', projectId: 'p1',
  sizeMarla: 5, areaSqft: 1125, dimensions: '25 × 45 ft',
  basePrice: 4_500_000, premiumCharges: 0, status: 'available',
  facing: 'North facing', category: 'Standard', isCorner: false, isParkFacing: false,
  isMainBoulevard: false, updatedAt: '2026-09-21', roadWidthFt: 30,
};
const B401: PropertyLike = {
  id: '2', code: 'PROP-B401', plotNumber: 'B-401', block: 'B', kind: 'Residential plot',
  projectName: 'Chitral Royal Homes [demo]', projectId: 'p1',
  sizeMarla: 20, areaSqft: 4500, dimensions: '50 × 90 ft',
  basePrice: 12_500_000, premiumCharges: 1_875_000, status: 'on_hold',
  facing: 'West facing', category: 'Boulevard', isCorner: false, isParkFacing: false,
  isMainBoulevard: true, updatedAt: '2026-09-17',
};
const C301: PropertyLike = {
  ...B401, id: '3', code: 'PROP-C301', plotNumber: 'C-301', block: 'C',
  sizeMarla: 10, areaSqft: 2250, basePrice: 8_500_000, status: 'sold',
  category: 'Park facing', isParkFacing: true, isMainBoulevard: false,
  /* ⚠️ Spelt out, not inherited from B401's spread above — the first draft of
     this fixture let C301 keep West facing and the facing filter looked broken
     when it was the fixture that was wrong. */
  facing: 'South facing',
};

describe('size, and the Kanal nobody says in Marla', () => {
  it('reads a plot the way a salesperson says it', () => {
    expect(sizeLabel(5)).toBe('5 Marla');
    expect(sizeLabel(10)).toBe('10 Marla');
    expect(sizeLabel(20)).toBe('1 Kanal');
    expect(sizeLabel(40)).toBe('2 Kanal');
    expect(sizeLabel(45)).toBe('2 Kanal 5 Marla');
  });

  it('says nothing rather than zero when the size is missing', () => {
    expect(sizeLabel(null)).toBe('—');
    expect(sizeLabel(0)).toBe('—');
    expect(sizeLabel(Number.NaN)).toBe('—');
  });
});

describe('area comes from the PROJECT standard, never a constant', () => {
  /* ⚠️ THE WHOLE POINT OF THE OWNER'S INSTRUCTION. The same 5 Marla plot is
     1,125 sq ft in a 225 scheme and 1,361 in a 272 one. A constant in code
     would make one of those silently wrong by 21%. */
  it('gives a different area for the same size under a different standard', () => {
    expect(areaSqft(5, 225)).toBe(1125);
    expect(areaSqft(5, 272)).toBe(1360);
    expect(areaSqft(20, 225)).toBe(4500);
  });

  it('refuses a nonsense standard rather than returning a nonsense area', () => {
    expect(areaSqft(5, 0)).toBeNull();
    expect(areaSqft(5, Number.NaN)).toBeNull();
  });

  /* ⚠️ A plot SOLD at 1,125 sq ft was sold at 1,125 sq ft. Correcting the
     scheme's standard afterwards must not restate what a buyer agreed to. */
  it('keeps the stored area even when the standard would compute another', () => {
    expect(displayArea(1125, 5, 272)).toBe(1125);
  });

  it('computes only when nothing was stored', () => {
    expect(displayArea(null, 5, 225)).toBe(1125);
    expect(displayArea(0, 5, 225)).toBe(1125);
  });

  it('formats with a thousands separator', () => {
    expect(areaLabel(1125)).toBe('1,125 sq ft');
    expect(areaLabel(null)).toBe('—');
  });
});

describe('money', () => {
  it('writes whole rupees with separators', () => {
    expect(money(4_500_000)).toBe('PKR 4,500,000');
    expect(money(0)).toBe('PKR 0');
    expect(money(null)).toBe('—');
  });
});

describe('availability', () => {
  it('names the five the owner asked for', () => {
    expect(SELECTABLE_STATUSES).toEqual(['available', 'reserved', 'sold', 'on_hold', 'blocked']);
  });

  /* ⚠️ `withdrawn` predates her list and still exists on rows, so it must READ
     even though it is never offered. A status that renders blank is a row that
     looks broken. */
  it('can still read a status it will never offer', () => {
    expect(statusLook('withdrawn').label).toBe('Withdrawn');
    expect(SELECTABLE_STATUSES).not.toContain('withdrawn');
  });

  it('separates a hold from a block, because they are different answers', () => {
    expect(statusLook('on_hold').label).toBe('On hold');
    expect(statusLook('blocked').label).toBe('Blocked');
    expect(statusLook('on_hold').meaning).not.toBe(statusLook('blocked').meaning);
  });

  it('falls back to Available rather than rendering nothing', () => {
    expect(statusLook(undefined).label).toBe('Available');
    expect(statusLook('nonsense-from-the-database').label).toBe('Available');
  });
});

describe('the character chips', () => {
  it('says a plain plot is plain, rather than showing nothing', () => {
    expect(characterChips(A101)).toEqual(['Standard', 'Non-corner', 'Not park-facing']);
  });

  it('names what the plot actually is', () => {
    expect(characterChips(C301)).toContain('Park facing');
    expect(characterChips(B401)).toContain('Main boulevard');
  });

  /* The reference misspells this chip; the corrected word is the one shipped. */
  it('spells Standard correctly', () => {
    expect(characterChips({ category: null })[0]).toBe('Standard');
  });

  /* ⚠️ FOUND IN A BROWSER, not here. A corner plot's category and its flag
     both say "Corner", and React's duplicate-key warning in the console was the
     only symptom — on screen it read `Corner · Corner · Not park-facing`. */
  it('never says the same thing twice', () => {
    const corner = characterChips({ category: 'Corner', isCorner: true });
    expect(corner).toEqual(['Corner', 'Not park-facing']);
    expect(new Set(corner).size).toBe(corner.length);

    const park = characterChips({ category: 'Park facing', isParkFacing: true });
    expect(new Set(park).size).toBe(park.length);
  });
});

describe('search and filters', () => {
  const rows = [A101, B401, C301];

  it('finds a plot however the number is punctuated', () => {
    for (const q of ['A-101', 'a101', 'A 101', 'prop-a101', 'PROPA101']) {
      expect(filterProperties(rows, { search: q }).map((r) => r.code)).toEqual(['PROP-A101']);
    }
  });

  it('searches the size the way it is displayed', () => {
    expect(filterProperties(rows, { search: '1 Kanal' }).map((r) => r.code)).toEqual(['PROP-B401']);
  });

  it('narrows by tab, block, size, type, status and price', () => {
    expect(filterProperties(rows, { tab: 'sold' }).map((r) => r.code)).toEqual(['PROP-C301']);
    expect(filterProperties(rows, { block: 'B' }).map((r) => r.code)).toEqual(['PROP-B401']);
    expect(filterProperties(rows, { size: '5 Marla' }).map((r) => r.code)).toEqual(['PROP-A101']);
    expect(filterProperties(rows, { priceBand: 'under-5m' }).map((r) => r.code)).toEqual(['PROP-A101']);
    expect(filterProperties(rows, { priceBand: 'over-20m' })).toEqual([]);
    expect(filterProperties(rows, { facing: 'West facing' }).map((r) => r.code)).toEqual(['PROP-B401']);
  });

  it('treats "all" as no filter at all', () => {
    expect(filterProperties(rows, { tab: 'all', block: 'all', size: 'all', priceBand: '' })).toHaveLength(3);
  });

  it('combines filters rather than replacing them', () => {
    expect(filterProperties(rows, { block: 'B', tab: 'sold' })).toEqual([]);
    expect(filterProperties(rows, { block: 'C', tab: 'sold' }).map((r) => r.code)).toEqual(['PROP-C301']);
  });
});

describe('the cards', () => {
  it('counts the five figures off the rows on screen', () => {
    const c = countProperties([A101, B401, C301]);
    expect(c).toMatchObject({ total: 3, available: 1, reserved: 0, sold: 1, held: 1 });
  });

  it('counts a hold and a block together, as the design does', () => {
    const held = countProperties([{ ...A101, status: 'blocked' }, { ...B401, status: 'on_hold' }]);
    expect(held.held).toBe(2);
  });

  /* ⚠️ A gap never looks like a zero — the Performance page's rule, kept. */
  it('gives no percentage at all when there is nothing to divide by', () => {
    expect(countProperties([]).availablePct).toBeNull();
    expect(countProperties([A101]).availablePct).toBe(100);
  });
});

describe('the import template', () => {
  it('asks for the four things a property cannot exist without', () => {
    const required = TEMPLATE_COLUMNS.filter((c) => c.required).map((c) => c.key);
    expect(required).toEqual(['code', 'plotNumber', 'sizeMarla', 'basePrice']);
  });

  it('has a unique header per column, since the importer matches on them', () => {
    const headers = TEMPLATE_COLUMNS.map((c) => c.header.toLowerCase());
    expect(new Set(headers).size).toBe(headers.length);
  });
});

describe('⚠️ what a customer may see', () => {
  const shared = shareable(A101, 225);

  it('carries the plot, the size, the price and nothing else', () => {
    expect(Object.keys(shared).sort()).toEqual(
      ['area', 'basePrice', 'block', 'character', 'code', 'dimensions', 'facing',
       'kind', 'plotNumber', 'premiumCharges', 'projectName', 'roadWidthFt', 'size', 'status'].sort(),
    );
  });

  /* ⚠️ THE TEST THAT MATTERS. An allow-list means a column added tomorrow is
     private until somebody decides otherwise — so a note written for the sales
     team cannot reach the buyer by default. */
  it('drops an internal field even when it is handed one', () => {
    const withSecrets = {
      ...A101,
      notes: 'Owner will drop to 4.2M if pushed',
      createdById: 'user-1',
      isTestData: true,
    } as unknown as PropertyLike & { roadWidthFt: number | null };

    const out = shareable(withSecrets, 225) as unknown as Record<string, unknown>;
    expect(out.notes).toBeUndefined();
    expect(out.createdById).toBeUndefined();
    expect(out.isTestData).toBeUndefined();
    expect(JSON.stringify(out)).not.toContain('4.2M');
  });

  it('writes a message a customer can read', () => {
    const text = shareText(shared);
    expect(text).toContain('A-101 · Block A');
    expect(text).toContain('Size: 5 Marla (1,125 sq ft)');
    expect(text).toContain('Price: PKR 4,500,000');
    expect(text).not.toContain('Premium');
  });

  it('names a premium when there is one', () => {
    expect(shareText(shareable(B401, 225))).toContain('Premium: PKR 1,875,000');
  });
});

describe('the area check — two ways of saying the same area', () => {
  it('agrees when the paperwork is right', () => {
    const c = areaCheck(5, 225, 25, 45);
    expect(c).toMatchObject({ fromStandard: 1125, fromDimensions: 1125, match: true, note: 'Measurements match' });
  });

  it('agrees on a 1 Kanal plot drawn either common way', () => {
    expect(areaCheck(20, 225, 50, 90).match).toBe(true);
    expect(areaCheck(20, 225, 45, 100).match).toBe(true);
  });

  /* ⚠️ THE CASE THE PANEL EXISTS FOR. Both numbers are individually valid and
     no database constraint can see the mistake — it surfaces when a buyer
     measures the plot. */
  it('catches a size that does not match its dimensions', () => {
    const c = areaCheck(5, 225, 30, 60);
    expect(c.match).toBe(false);
    expect(c.fromStandard).toBe(1125);
    expect(c.fromDimensions).toBe(1800);
    expect(c.note).toContain('60%');
  });

  it('moves with the project standard, not a constant', () => {
    /* 25 × 45 is right at 225 and wrong at 272 — which is the whole reason the
       standard is a project setting. */
    expect(areaCheck(5, 225, 25, 45).match).toBe(true);
    expect(areaCheck(5, 272, 25, 45).match).toBe(false);
  });

  it('asks for the missing figures rather than passing or failing', () => {
    const c = areaCheck(5, 225, null, null);
    expect(c.match).toBe(false);
    expect(c.deltaPct).toBeNull();
    expect(c.note).toContain('Enter a size');
  });
});

describe('a sheet writes dimensions a dozen ways', () => {
  it('reads every separator a scheme uses', () => {
    for (const raw of ['25 × 45 ft', '25 x 45', '25X45', '25*45 ft', '25 × 45']) {
      expect(parseDimensions(raw)).toEqual({ width: 25, length: 45 });
    }
  });

  it('keeps a decimal frontage', () => {
    expect(parseDimensions('22.5 × 50 ft')).toEqual({ width: 22.5, length: 50 });
  });

  /* ⚠️ Nulls, never a guess. A row with unreadable dimensions keeps none —
     inventing one would put a measurement on a plot that nobody measured. */
  it('refuses anything that is not two numbers', () => {
    for (const raw of ['', 'corner plot', '25 ft', null, undefined]) {
      expect(parseDimensions(raw)).toEqual({ width: null, length: null });
    }
  });
});

describe('the change preview', () => {
  const before = { 'Road size': '25 ft road', 'Base price': 'PKR 4,500,000', Facing: 'North' };

  it('lists only what actually moved', () => {
    const out = propertyChanges(before, { ...before, 'Road size': '30 ft road' });
    expect(out).toEqual([{ field: 'Road size', from: '25 ft road', to: '30 ft road' }]);
  });

  it('says nothing when nothing moved', () => {
    expect(propertyChanges(before, { ...before })).toEqual([]);
  });

  /* ⚠️ A preview that cries wolf is one nobody reads. Empty, null and an em
     dash all mean "not recorded" and must not be reported as a change. */
  it('does not report a change between the ways of saying "nothing"', () => {
    expect(propertyChanges({ Facing: null }, { Facing: '' })).toEqual([]);
    expect(propertyChanges({ Facing: '—' }, { Facing: '' })).toEqual([]);
    expect(propertyChanges({ Facing: '  North ' }, { Facing: 'North' })).toEqual([]);
  });

  it('reports filling in a blank, and clearing a value', () => {
    expect(propertyChanges({ Facing: null }, { Facing: 'North' }))
      .toEqual([{ field: 'Facing', from: '—', to: 'North' }]);
    expect(propertyChanges({ Facing: 'North' }, { Facing: '' }))
      .toEqual([{ field: 'Facing', from: 'North', to: '—' }]);
  });

  it('names the paperwork the two committing statuses need', () => {
    expect(statusNeedsPaperwork('sold')).toContain('booking');
    expect(statusNeedsPaperwork('reserved')).toContain('expiry');
    expect(statusNeedsPaperwork('available')).toBeNull();
    expect(statusNeedsPaperwork('on_hold')).toBeNull();
  });
});
