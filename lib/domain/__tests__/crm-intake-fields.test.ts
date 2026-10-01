import { describe, expect, it } from 'vitest';

import {
  INTAKE_ALIASES,
  INTAKE_FIELDS,
  readIntakeFields,
} from '@/lib/domain/crm-intake-fields';

/* ============================================================================
 * READING SOMEBODY ELSE'S CONTACT FORM
 * ----------------------------------------------------------------------------
 * The cases that matter are all about a form this product did not write: field
 * names chosen years ago, inputs posted empty, and the honeypot — which has to
 * tell "the bot filled it in" apart from "the browser posted it blank, like
 * every other input on the page".
 * ========================================================================= */

describe('the names we document', () => {
  it('takes every field under its own name', () => {
    const body = Object.fromEntries(INTAKE_FIELDS.map((f) => [f, `v-${f}`]));
    expect(readIntakeFields(body)).toEqual(body);
  });

  it('ignores anything it does not recognise', () => {
    const out = readIntakeFields({
      fullName: 'Ayesha', phone: '03001234567',
      csrf_token: 'abc', utm_term: 'plots', submit: 'Send', 'g-recaptcha-response': 'x',
    });
    expect(out).toEqual({ fullName: 'Ayesha', phone: '03001234567' });
  });
});

describe("a form this product did not write", () => {
  it('reads a typical contact page', () => {
    /* The shape a small business site actually has. */
    const out = readIntakeFields({
      name: 'Sadia Rehman',
      mobile: '0300 0001234',
      mail: 'sadia@example.com',
      town: 'Karachi',
      message: 'Please send the price list',
    });
    expect(out).toEqual({
      fullName: 'Sadia Rehman',
      phone: '0300 0001234',
      email: 'sadia@example.com',
      city: 'Karachi',
      enquiry: 'Please send the price list',
    });
  });

  it('reads the campaign parameters a landing page carries', () => {
    const out = readIntakeFields({
      name: 'A', tel: '03001112222',
      utm_source: 'Facebook', utm_campaign: 'October plots',
    });
    expect(out.source).toBe('Facebook');
    expect(out.sourceDetail).toBe('October plots');
  });

  it('⚠️ prefers the documented name whatever order the body had them', () => {
    /* A body carrying both must not depend on which the site wrote first —
       that is a bug that shows up on one client's form and not another's. */
    const aliasFirst = readIntakeFields({ name: 'Alias', fullName: 'Documented' });
    const exactFirst = readIntakeFields({ fullName: 'Documented', name: 'Alias' });
    expect(aliasFirst.fullName).toBe('Documented');
    expect(exactFirst.fullName).toBe('Documented');
  });

  it('⚠️ takes the first value when a name is posted twice', () => {
    /* A hidden default plus a visible override posts both. Joining them would
       file a lead called "Ayesha,Ayesha Noor". */
    expect(readIntakeFields({ name: ['Ayesha', 'Ayesha Noor'] }).fullName).toBe('Ayesha');
  });

  it('trims, because a form posts what somebody typed', () => {
    expect(readIntakeFields({ name: '  Ayesha  ' }).fullName).toBe('Ayesha');
  });
});

describe('⚠️ the empty inputs every form posts', () => {
  it('drops them rather than keeping blanks', () => {
    /* A browser posts every input on the page, filled in or not. */
    const out = readIntakeFields({
      name: 'Ayesha', mobile: '03001234567',
      mail: '', town: '', message: '   ',
    });
    expect(out).toEqual({ fullName: 'Ayesha', phone: '03001234567' });
    expect('email' in out).toBe(false);
  });

  it('⚠️⚠️ and an EMPTY honeypot is not a bot', () => {
    /* THE CASE THAT MATTERS MOST. The trap is a real input on the page, so a
       real person's submission carries it empty. Treating "present" as "filled
       in" would silently discard every genuine enquiry from that form while
       answering 200 — the worst failure this endpoint has, because nobody
       anywhere would see an error. */
    const human = readIntakeFields({ name: 'Ayesha', phone: '03001234567', website_url: '' });
    expect('_trap' in human).toBe(false);

    const bot = readIntakeFields({ name: 'X', phone: '03001234567', website_url: 'http://spam' });
    expect(bot._trap).toBe('http://spam');
  });

  it('knows the honeypot under the names a generator produces', () => {
    for (const alias of ['website_url', 'honeypot', 'hp', 'bot-field', '_gotcha']) {
      expect(readIntakeFields({ [alias]: 'filled' })._trap).toBe('filled');
    }
  });
});

describe('the alias table itself', () => {
  it('⚠️ never maps to a field that does not exist', () => {
    /* A typo here would silently drop the field it was meant to rescue. */
    for (const [alias, target] of Object.entries(INTAKE_ALIASES)) {
      expect(INTAKE_FIELDS, `${alias} maps to ${target}`).toContain(target);
    }
  });

  it('⚠️ never aliases a documented name to something else', () => {
    /* `name` is not documented, so it may alias. `phone` is, and an entry
       mapping `phone` to anything would quietly rewrite a correct field. */
    for (const alias of Object.keys(INTAKE_ALIASES)) {
      expect(INTAKE_FIELDS as readonly string[]).not.toContain(alias);
    }
  });

  it('is keyed in lower case, because lookup lower-cases', () => {
    for (const alias of Object.keys(INTAKE_ALIASES)) {
      expect(alias).toBe(alias.toLowerCase());
    }
  });
});
