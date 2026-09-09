import { describe, expect, it } from 'vitest';

import {
  OPEN_STAGES,
  STAGE_ORDER,
  activityLabel,
  isOpen,
  isStage,
  stageLabel,
  stageToken,
  TEMPERATURES,
  temperatureLabel,
  temperatureToken,
} from '../crm-stages';

/* ============================================================================
 * THE PIPELINE VOCABULARY
 * ----------------------------------------------------------------------------
 * The values below are the exact enum members migration 111 created. If somebody
 * adds a stage to the database and not to this module, the first test fails —
 * which is the point. A stage that reaches the screen with no label falls back
 * to its raw name, and `follow_up` printed on a client-facing list is the kind
 * of thing nobody notices until it is in a screenshot.
 * ========================================================================= */

/** Copied from `select enumlabel from pg_enum` on 2026-09-10, not from the
 *  module under test — a fixture derived from the code proves nothing. */
const ENUM_STAGES = [
  'new',
  'contacted',
  'follow_up',
  'qualified',
  'visited',
  'scheduled',
  'negotiation',
  'won',
  'lost',
];

const ENUM_TEMPERATURES = ['hot', 'warm', 'cold'];

const ENUM_ACTIVITY = [
  'imported',
  'assigned',
  'stage_changed',
  'note_added',
  'call_attempted',
  'call_connected',
  'call_no_answer',
  'whatsapp_sent',
  'email_sent',
  'won',
  'lost',
];

describe('every database value has a word', () => {
  it('covers all nine stages, and no invented ones', () => {
    expect([...STAGE_ORDER].sort()).toEqual([...ENUM_STAGES].sort());
  });

  it('gives every stage a label that is not its raw name', () => {
    for (const stage of ENUM_STAGES) {
      expect(stageLabel(stage)).not.toBe(stage);
      expect(stageLabel(stage)).not.toContain('_');
    }
  });

  it('gives every temperature and activity kind a label', () => {
    expect([...TEMPERATURES].sort()).toEqual([...ENUM_TEMPERATURES].sort());
    for (const kind of ENUM_ACTIVITY) {
      expect(activityLabel(kind)).not.toContain('_');
    }
  });

  it('phrases an activity as an outcome, not as an event name', () => {
    /* This column is read at a glance beside seven others; `call_no_answer`
       would make a salesperson decode their own screen. */
    expect(activityLabel('call_no_answer')).toBe('No answer');
    expect(activityLabel('call_connected')).toBe('Spoke');
  });
});

describe('the order is the pipeline', () => {
  it('starts at new and ends with the two exits', () => {
    expect(STAGE_ORDER[0]).toBe('new');
    expect(STAGE_ORDER.slice(-2)).toEqual(['won', 'lost']);
  });

  it('⚠️ treats won and lost as exits, not as progress', () => {
    /* They sit last because they have to sit somewhere. Reading the index as a
       score is how a "pipeline health" figure ends up rewarding lost deals —
       `lost` would outrank `negotiation`. Code asks isOpen instead. */
    expect(STAGE_ORDER.indexOf('lost')).toBeGreaterThan(STAGE_ORDER.indexOf('negotiation'));
    expect(isOpen('lost')).toBe(false);
    expect(isOpen('won')).toBe(false);
    expect(isOpen('negotiation')).toBe(true);
  });

  it('lists exactly the seven open stages', () => {
    expect(OPEN_STAGES).toHaveLength(7);
    expect(OPEN_STAGES).not.toContain('won');
    expect(OPEN_STAGES).not.toContain('lost');
  });
});

describe('an unknown value', () => {
  it('shows itself rather than hiding as "Unknown"', () => {
    /* A stage added to the enum but not to this module should look odd on
       screen, not vanish into a label that conceals which one it was. */
    expect(stageLabel('archived')).toBe('archived');
    expect(temperatureLabel('lukewarm')).toBe('lukewarm');
    expect(activityLabel('sms_sent')).toBe('sms_sent');
  });

  it('still returns a usable colour token, so nothing renders as var(--undefined)', () => {
    expect(stageToken('archived')).toBe('neutral-500');
    expect(temperatureToken('lukewarm')).toBe('neutral-500');
  });

  it('is rejected by the type guard, which is what keeps it out of SQL', () => {
    /* `stage` reaches the query as an enum comparison — an unknown value there
       is a 500, not an empty list, and the URL is editable by hand. */
    expect(isStage('new')).toBe(true);
    expect(isStage('archived')).toBe(false);
    expect(isStage('')).toBe(false);
  });
});

describe('colour tokens', () => {
  it('gives each stage its own hue, so the strip reads as a funnel', () => {
    const tokens = STAGE_ORDER.map(stageToken);
    expect(new Set(tokens).size).toBe(STAGE_ORDER.length);
  });

  it('names tokens that exist in the theme, never a bare colour', () => {
    /* Passed to `<Badge token>` as `var(--${token})`. A hex here would bypass
       the theme and fail in one of the two colour schemes. */
    for (const token of STAGE_ORDER.map(stageToken)) {
      expect(token).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(token).not.toContain('#');
    }
  });
});
