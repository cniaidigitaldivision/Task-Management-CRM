/* ============================================================================
 * THE ADD-LEAD RULES
 * ----------------------------------------------------------------------------
 * The ones worth a test are the ones that only break in production: a landline
 * that must not be refused, a colleague's lead that must not be retyped, and a
 * plan with no date that would never reach anybody's day.
 * ========================================================================= */
import { describe, expect, it } from 'vitest';

import {
  ADD_LEAD_SOURCES,
  duplicateVerdict,
  isAddLeadSource,
  newLeadProblems,
  phoneWarning,
  type DuplicateLike,
  type NewLeadInput,
} from '@/lib/domain/crm-new-lead';

const base: NewLeadInput = {
  projectId: '11111111-1111-1111-1111-111111111111',
  fullName: 'Ayesha Khan',
  phone: '0300 1234567',
  email: '',
  city: 'Islamabad',
  source: 'walk_in',
  sourceDetail: 'Showroom desk',
  enquiry: 'Asked about a 5 marla corner plot.',
  budget: '',
  whatsappConsent: true,
  preferredChannel: 'whatsapp',
  preferredTime: 'Evenings',
  nextAction: '',
  nextActionAt: null,
  nextActionType: null,
};

const dupe = (over: Partial<DuplicateLike>): DuplicateLike => ({
  kind: 'lead',
  name: 'Ayesha Khan',
  projectName: 'Chitral Royal Homes',
  sameProject: true,
  isOpen: true,
  isMine: false,
  ownerName: 'Sahad',
  stage: 'contacted',
  ...over,
});

describe('which sources a person may pick', () => {
  it('⚠️ never the two the machines write', () => {
    /* Filing a hand-typed walk-in as `meta_lead_ad` puts it in the reporting
       bucket of a campaign that never produced it, and that campaign's
       cost-per-lead is wrong from then on. */
    expect(isAddLeadSource('meta_lead_ad')).toBe(false);
    expect(isAddLeadSource('import')).toBe(false);
  });

  it('does offer the ones a salesperson actually meets', () => {
    for (const s of ['walk_in', 'referral', 'whatsapp', 'website']) {
      expect(ADD_LEAD_SOURCES).toContain(s);
    }
  });
});

describe('what the form must refuse', () => {
  it('a lead with no name', () => {
    expect(newLeadProblems({ ...base, fullName: '  ' })).toEqual([
      expect.stringContaining('name'),
    ]);
  });

  it('⚠️ a lead with no phone AND no email — but not one missing only an email', () => {
    /* The row would sit on somebody's desk showing overdue forever, because no
       contact attempt can ever be made against it. */
    expect(
      newLeadProblems({ ...base, phone: '', email: '' }).some((p) => p.includes('contact')),
    ).toBe(true);
    expect(newLeadProblems({ ...base, phone: '0300 1234567', email: '' })).toHaveLength(0);
  });

  it('⚠️ but NEVER a landline, which toE164 cannot parse', () => {
    /* 051-1234567 is a real Islamabad number and normalises to null. Refusing it
       would throw away a genuine enquiry because it is not a mobile — and
       lib/domain/phone.ts already settled that null is a real answer. */
    expect(newLeadProblems({ ...base, phone: '051-1234567' })).toHaveLength(0);
    expect(phoneWarning('051-1234567')).toContain('WhatsApp');
    expect(phoneWarning('0300 1234567')).toBeNull();
  });

  it('⚠️ a plan with no date, which would never reach anybody\'s day', () => {
    const problems = newLeadProblems({ ...base, nextAction: 'Call back', nextActionAt: null });
    expect(problems.some((p) => p.includes('when'))).toBe(true);
  });

  it('⚠️ and a date with no plan', () => {
    const problems = newLeadProblems({
      ...base,
      nextAction: '',
      nextActionAt: '2026-09-20T10:00:00.000Z',
    });
    expect(problems.some((p) => p.includes('what'))).toBe(true);
  });

  it('⚠️ the contradiction: they said no to WhatsApp and prefer WhatsApp', () => {
    const problems = newLeadProblems({
      ...base,
      whatsappConsent: false,
      preferredChannel: 'whatsapp',
    });
    expect(problems.some((p) => p.includes('no to WhatsApp'))).toBe(true);
  });

  it('but "nobody asked yet" stays a legitimate answer', () => {
    /* NULL consent is the honest default. A form that forced a yes/no would put
       a guess into the column the sequence engine reads before it may send. */
    expect(newLeadProblems({ ...base, whatsappConsent: null })).toHaveLength(0);
  });

  it('names the field rather than saying "invalid"', () => {
    for (const p of newLeadProblems({ ...base, fullName: '', phone: '', email: '' })) {
      expect(p.length).toBeGreaterThan(20);
      expect(p).not.toMatch(/invalid|error/i);
    }
  });
});

describe('somebody we already know', () => {
  it('⚠️ blocks a colleague\'s OPEN lead on the same project, with no override', () => {
    /* The quietest way to take a colleague's lead is to retype it and let the
       rota hand it to you. This is the one case the database refuses outright
       (CRM05), and the screen has to say the same thing. */
    const v = duplicateVerdict([dupe({})]);
    expect(v.verdict).toBe('blocked');
    expect(v.message).toContain('Sahad');
  });

  it('only warns when the open lead is already theirs', () => {
    const v = duplicateVerdict([dupe({ isMine: true, ownerName: 'Sarah' })]);
    expect(v.verdict).toBe('confirm');
  });

  it('⚠️ a lead on ANOTHER project is not a duplicate', () => {
    /* One person asking about Chitral and then about Executive Housing is two
       enquiries — which is why crm_clients has no project_id (111). Worth
       saying; not worth blocking. */
    const v = duplicateVerdict([
      dupe({ sameProject: false, projectName: 'Executive Housing' }),
    ]);
    expect(v.verdict).toBe('confirm');
    expect(v.message).toContain('Executive Housing');
  });

  it('mentions a past customer before the first call', () => {
    const v = duplicateVerdict([
      dupe({ kind: 'client', sameProject: false, isOpen: false, ownerName: null, stage: null }),
    ]);
    expect(v.verdict).toBe('confirm');
    expect(v.message).toContain('bought');
  });

  it('says nothing when we know nobody', () => {
    expect(duplicateVerdict([])).toEqual({ verdict: 'none', message: null });
  });

  it('⚠️ the block wins over every softer finding, whatever the order', () => {
    /* A person can match several rows at once — an old closed lead, a client
       record, and a colleague's live one. The refusal must not be hidden behind
       a friendlier message that happened to sort first. */
    const v = duplicateVerdict([
      dupe({ kind: 'client', sameProject: false, isOpen: false }),
      dupe({ sameProject: false, isOpen: true, projectName: 'Executive Housing' }),
      dupe({}),
    ]);
    expect(v.verdict).toBe('blocked');
  });
});
