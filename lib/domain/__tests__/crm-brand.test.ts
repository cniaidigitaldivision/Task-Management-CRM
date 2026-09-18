import { describe, expect, it } from 'vitest';

import { clientFacingName, letterSubtitle } from '@/lib/domain/crm-brand';

describe('clientFacingName', () => {
  it('takes our own marker off the name a client reads', () => {
    /* The real row, and the real letter that went out on 18 Sep. */
    expect(clientFacingName('Demo — Product Enquiries [demo]')).toBe('Demo — Product Enquiries');
  });

  it('leaves a real business name exactly as the owner typed it', () => {
    expect(clientFacingName('CNI AI & Digital Division')).toBe('CNI AI & Digital Division');
    expect(clientFacingName('Chitral Royal Homes')).toBe('Chitral Royal Homes');
  });

  it('does not leave the separator the tag was hanging off', () => {
    expect(clientFacingName('Chitral Royal Homes — [test]')).toBe('Chitral Royal Homes');
    expect(clientFacingName('Phase II · [internal]')).toBe('Phase II');
  });

  it('is null rather than empty, so a caller must choose a fallback', () => {
    expect(clientFacingName('[demo]')).toBeNull();
    expect(clientFacingName('   ')).toBeNull();
    expect(clientFacingName(null)).toBeNull();
    expect(clientFacingName(undefined)).toBeNull();
  });
});

describe('letterSubtitle', () => {
  it('names the project under a different business name', () => {
    expect(letterSubtitle('CNI AI & Digital Division', 'Demo — Product Enquiries [demo]'))
      .toBe('Demo — Product Enquiries');
  });

  it('says nothing when the project is the business', () => {
    /* Chitral Royal Homes has no display name of its own, so both sides resolve
       to the project — and the same words twice reads as a broken template. */
    expect(letterSubtitle('Chitral Royal Homes', 'Chitral Royal Homes')).toBeNull();
    expect(letterSubtitle('chitral royal homes', 'Chitral Royal Homes')).toBeNull();
  });

  it('falls back to the project when there is no business name', () => {
    expect(letterSubtitle(null, 'Chitral Royal Homes')).toBe('Chitral Royal Homes');
  });

  it('is null when there is no project either', () => {
    expect(letterSubtitle('CNI AI & Digital Division', null)).toBeNull();
  });
});
