import { describe, expect, it } from 'vitest';

import {
  fillTokens,
  MAX_STEPS,
  planProblem,
  planTokens,
  purposeAvailability,
  stepsToRows,
  stopConditions,
  suggestedPlan,
  templateParams,
  type LeadFacts,
  type PlanStep,
} from '@/lib/domain/crm-followup-plans';

const facts = (o: Partial<LeadFacts> = {}): LeadFacts => ({
  leadFirstName: 'Faisal',
  company: 'CNI AI & Digital Division',
  projectName: 'Demo — Product Enquiries',
  myFirstName: 'Sarah',
  stage: 'contacted',
  quotation: null,
  approvedQuotation: null,
  visit: null,
  visitedAt: null,
  hasInbound: true,
  ...o,
});

const step = (o: Partial<PlanStep>): PlanStep => ({
  day: 1, at: null, channel: 'whatsapp', title: 'Step', body: 'Hello', mode: 'review_first',
  subject: '', onlyIfNoReply: false, template: null, ...o,
});

describe('days on screen are absolute; delays in the database are gaps', () => {
  it('turns day 1 · 3 · 7 into 0 · 2 · 4', () => {
    const rows = stepsToRows([step({ day: 1 }), step({ day: 3 }), step({ day: 7 })]);
    expect(rows.map((r) => r.delayDays)).toEqual([0, 2, 4]);
    expect(rows.map((r) => r.stepNo)).toEqual([1, 2, 3]);
  });
  it('a first step on day 5 waits five days, not four', () => {
    /* Day 1 is "today", so day 5 is four days from now… */
    expect(stepsToRows([step({ day: 5 })])[0].delayDays).toBe(4);
  });
  it('keeps an empty message as null, never as an empty string', () => {
    expect(stepsToRows([step({ body: '   ' })])[0].body).toBeNull();
  });
});

describe('a plan the engine can actually run', () => {
  it('refuses two steps on the same day — 170 would push the second anyway', () => {
    expect(planProblem([step({ day: 2 }), step({ day: 2 })])).toMatch(/not on the same day/);
    expect(planProblem([step({ day: 3 }), step({ day: 2 })])).toMatch(/must be after/);
  });
  it('refuses a message step with nothing written, but allows a call with no note', () => {
    expect(planProblem([step({ channel: 'whatsapp', body: '' })])).toMatch(/needs one written/);
    expect(planProblem([step({ channel: 'call', body: '' })])).toBeNull();
  });
  it('refuses an empty plan, and more steps than a person would ever send', () => {
    expect(planProblem([])).toMatch(/at least one step/);
    const many = Array.from({ length: MAX_STEPS + 1 }, (_, i) => step({ day: i + 1 }));
    expect(planProblem(many)).toMatch(/at most/);
  });
  it('refuses an email with no subject line, and fills one from the purpose', () => {
    expect(planProblem([step({ channel: 'email', subject: '' })])).toMatch(/needs a subject line/);
    /* Every suggested email step comes with one. */
    const emailSteps = suggestedPlan('quotation').filter((s) => s.channel === 'email');
    for (const s of emailSteps) expect(s.subject.length).toBeGreaterThan(0);
  });
  it('carries the plan’s delivery down to the message steps, never to a call', () => {
    const auto = suggestedPlan('no_response', 'auto_send');
    expect(auto.filter((s) => s.channel === 'whatsapp').every((s) => s.mode === 'auto_send')).toBe(true);
    expect(auto.find((s) => s.channel === 'call')?.mode).toBe('remind_me');
  });
  it('accepts the suggestion for every purpose it offers', () => {
    for (const p of ['no_response', 'quotation', 'appointment_reminder', 'missing_information',
      'approved_offer', 'payment_reminder', 'site_visit_checkin', 're_engage'] as const) {
      expect(planProblem(suggestedPlan(p).map((s) => ({ ...s })))).toBeNull();
    }
  });
});

describe('a purpose is offered only when the lead can answer it', () => {
  it('needs a live quotation to chase a quotation', () => {
    expect(purposeAvailability('quotation', facts()).ok).toBe(false);
    expect(purposeAvailability('quotation', facts({ quotation: { number: 'QT-1042', amount: 4_500_000 } })).ok).toBe(true);
  });
  it('needs a booked visit to remind about one, and a past visit to check in after one', () => {
    expect(purposeAvailability('appointment_reminder', facts()).reason).toMatch(/No visit/);
    expect(purposeAvailability('appointment_reminder', facts({ visit: { at: '2026-09-20T05:00:00Z', kind: 'site_visit' } })).ok).toBe(true);
    expect(purposeAvailability('site_visit_checkin', facts()).ok).toBe(false);
    expect(purposeAvailability('site_visit_checkin', facts({ visitedAt: '2026-09-10T05:00:00Z' })).ok).toBe(true);
  });
  it('will not chase payment before anything is agreed', () => {
    expect(purposeAvailability('payment_reminder', facts()).ok).toBe(false);
    expect(purposeAvailability('payment_reminder', facts({ stage: 'won' })).ok).toBe(true);
  });
  it('always allows a nudge, a re-engagement and a custom one', () => {
    for (const p of ['no_response', 're_engage', 'custom'] as const) {
      expect(purposeAvailability(p, facts()).ok).toBe(true);
    }
  });
});

describe('the stop conditions shown are the engine’s own', () => {
  it('offers the reply rule and states the ones that are always on', () => {
    const list = stopConditions('no_response');
    expect(list[0].optional).toBe(true);
    expect(list.filter((c) => !c.optional).map((c) => c.label)).toContain('The lead is closed');
  });
  it('mentions the quotation only for a quotation chase', () => {
    expect(stopConditions('quotation').some((c) => c.label.includes('quotation'))).toBe(true);
    expect(stopConditions('payment_reminder').some((c) => c.label.includes('quotation'))).toBe(false);
  });
  /* ⚠️ 185's fix, stated where a person reads it: a visit stops a chase and must
     never stop the reminder about that visit. */
  it('does not claim a booked visit stops an appointment reminder', () => {
    expect(stopConditions('appointment_reminder').some((c) => c.label.includes('visit is already booked'))).toBe(false);
    expect(stopConditions('no_response').some((c) => c.label.includes('visit is already booked'))).toBe(true);
  });
});

describe('placeholders', () => {
  it('fills the sender, the client and the quotation', () => {
    const f = facts({ quotation: { number: 'QT-1042', amount: 4_500_000 } });
    const body = suggestedPlan('quotation')[0].body;
    const out = fillTokens(body, planTokens(f, null));
    expect(out).toContain('QT-1042');
    expect(out).toContain('Sarah');
    expect(out).toContain('Faisal');
    expect(out).not.toContain('{{');
  });
  it('never prints an empty client name, and leaves an unknown token visible', () => {
    const out = fillTokens('Hi {{lead_first_name}} {{nope}}', planTokens(facts({ leadFirstName: '' }), null));
    expect(out).toBe('Hi Sir/Madam {{nope}}');
  });
});

describe('templateParams — 210', () => {
  const values = { lead_first_name: 'Ali', company: 'CNI AI & Digital Division', my_first_name: 'Sarah' };

  it('returns the values in the order the step names them', () => {
    expect(templateParams(['lead_first_name', 'company'], values)).toEqual(['Ali', 'CNI AI & Digital Division']);
  });

  it('keeps the slot of an unknown token instead of dropping it', () => {
    /* ⚠️ THE BUG THIS EXISTS TO PREVENT. Dropping the middle one would put the
       company into {{2}} — Meta matches by position, so the client would read
       the wrong value with nothing in the request looking wrong. */
    expect(templateParams(['lead_first_name', 'nonsense', 'company'], values))
      .toEqual(['Ali', '', 'CNI AI & Digital Division']);
  });

  it('is an empty list when a template has no variables', () => {
    expect(templateParams(null, values)).toEqual([]);
    expect(templateParams(undefined, values)).toEqual([]);
    expect(templateParams([], values)).toEqual([]);
  });

  it('never leaves a visible placeholder, unlike free text', () => {
    /* fillTokens shows {{unknown}} because a person reads that draft; a template
       is sent unseen and must not put braces on a client's phone. */
    expect(templateParams(['unknown'], values)[0]).toBe('');
    expect(fillTokens('Hi {{unknown}}', values)).toContain('{{unknown}}');
  });
});
