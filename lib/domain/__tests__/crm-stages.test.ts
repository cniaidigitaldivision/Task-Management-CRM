import { describe, expect, it } from 'vitest';

import {
  LOST_REASONS,
  responseBand,
  responseTime,
  OPEN_STAGES,
  STAGE_ORDER,
  activityLabel,
  isLostReason,
  isOpen,
  isStage,
  lostReasonLabel,
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
  /* Added by migration 115 — Step 6 marks a temperature and sets a next action,
     and the log had no word for either. */
  'temperature_set',
  'next_action_set',
  'won',
  'lost',
];

/** The nine values of `crm_lost_reason`, likewise copied from `pg_enum`. */
const ENUM_LOST_REASONS = [
  'wrong_number',
  'not_serious',
  'budget_too_low',
  'wrong_location',
  'no_answer',
  'bought_elsewhere',
  'wants_what_we_dont_offer',
  'duplicate',
  'revisit_later',
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

describe('why a lead was lost', () => {
  it('covers every reason the database will accept, and invents none', () => {
    /* ⚠️ A reason in the enum but not here would render as `wrong_number` in a
       dropdown; one here but not in the enum reaches Postgres as an invalid
       enum cast and comes back a 500. Both directions matter. */
    expect([...LOST_REASONS].sort()).toEqual([...ENUM_LOST_REASONS].sort());
  });

  it('gives each one words a person would say out loud', () => {
    for (const reason of ENUM_LOST_REASONS) {
      expect(lostReasonLabel(reason)).not.toBe(reason);
      expect(lostReasonLabel(reason)).not.toContain('_');
    }
  });

  it('⚠️ puts the three the owner named first, first', () => {
    /* This is picked at the end of a call somebody would rather not have had.
       The further down the list a reason is, the more thought it takes. */
    expect(LOST_REASONS.slice(0, 3)).toEqual(['wrong_number', 'not_serious', 'budget_too_low']);
  });

  it('⚠️ keeps "revisit later" last, because it is not a loss', () => {
    /* It exists so an early enquiry does not get filed under "not serious".
       Step 8's follow-up rules should pick these back up. */
    expect(LOST_REASONS.at(-1)).toBe('revisit_later');
  });

  it('is rejected by the type guard, which is what keeps it out of SQL', () => {
    expect(isLostReason('budget_too_low')).toBe(true);
    expect(isLostReason('changed_their_mind')).toBe(false);
    expect(isLostReason('')).toBe(false);
  });

  it('shows an unknown reason rather than hiding it', () => {
    expect(lostReasonLabel('gazumped')).toBe('gazumped');
  });
});

describe('how fast somebody answers', () => {
  it('⚠️ says NOTHING when there are no calls, rather than zero', () => {
    /* THE ONE THAT MATTERS. `median_response_minutes` is null until somebody
       logs a contact, and rendering that as "0m" would tell a manager their
       salesperson answers instantly — the most flattering possible reading of
       no data at all. Null so it cannot be formatted by accident. */
    expect(responseTime(null)).toBeNull();
    expect(responseTime(undefined)).toBeNull();
    expect(responseBand(null)).toBeNull();
  });

  it('distinguishes no data from a genuine zero', () => {
    /* Somebody who rang within thirty seconds DID respond, and that is not the
       same fact as never having rung. */
    expect(responseTime(0)).toBe('under a minute');
    expect(responseTime(0.4)).toBe('under a minute');
    expect(responseBand(0)).toBe('fast');
  });

  it('reads in the units a person would say', () => {
    expect(responseTime(4)).toBe('4m');
    expect(responseTime(59)).toBe('59m');
    expect(responseTime(60)).toBe('1h');
    expect(responseTime(130)).toBe('2h 10m');
    expect(responseTime(60 * 24)).toBe('1d');
    expect(responseTime(60 * 27)).toBe('1d 3h');
  });

  it('drops the hours once it is a week — nobody acts on 9d 4h', () => {
    expect(responseTime(60 * 24 * 9 + 240)).toBe('9d');
  });

  it('refuses a nonsense value rather than printing NaN', () => {
    /* `first_contacted_at` before `submitted_at` would be negative — impossible,
       but a backdated entry makes it reachable, and "-3h" on a manager's screen
       is worse than a blank. */
    expect(responseTime(Number.NaN)).toBeNull();
    expect(responseTime(-5)).toBeNull();
    expect(responseBand(Number.NaN)).toBeNull();
  });

  it('bands it, with the thresholds stated as a judgement', () => {
    expect(responseBand(30)).toBe('fast');
    expect(responseBand(60)).toBe('fast');
    expect(responseBand(61)).toBe('fair');
    expect(responseBand(60 * 24)).toBe('fair');
    expect(responseBand(60 * 25)).toBe('slow');
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
