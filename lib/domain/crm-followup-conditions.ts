/* ============================================================================
 * FOLLOW-UP CONDITIONS — the words, and nothing else
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-22, with a design: *"These are basically follow-up checks or,
 * you can say, advanced settings … Right now it should be set to the default,
 * according to the default setting of follow-up, but if I want to change I can
 * change it over here and it will implement accordingly."*
 *
 * ── ⚠️ THE DEFAULTS ARE NOT HERE, AND MUST NOT BE ──────────────────────────
 * `app.crm_followup_default_conditions` owns them, because the SEND GATE
 * enforces them (247). A copy in TypeScript would be a second answer to the
 * same question, and the one the screen showed would be the one nobody checked.
 * The screen reads the resolved values back; this file only names them.
 *
 * ── ⚠️ TWO CHECKS ARE NOT SWITCHES ─────────────────────────────────────────
 * A closed lead and a stated no are the client's and the business's, not a
 * preference — `crm_sequence_stop_reason` has said so since 182, and 247 gave
 * them no column deliberately. They appear in the dialog as always-on, with the
 * reason, rather than as a switch that would quietly do nothing.
 * ========================================================================= */

/** What the database resolved for one follow-up, and how each check stands. */
export interface FollowUpConditions {
  readonly followUpId: string;
  readonly purpose: string;
  /** The setting in force — the row's own value, or the purpose's default. */
  readonly noReply: boolean;
  readonly quoteValid: boolean;
  readonly notBooked: boolean;
  /** What the purpose would give, so the dialog can say "default". */
  readonly noReplyDefault: boolean;
  readonly quoteValidDefault: boolean;
  readonly notBookedDefault: boolean;
  readonly onReply: OnReply;
  readonly onOptOut: OnOptOut;
  readonly onQuoteExpired: OnQuoteExpired;
  readonly maxAttempts: number;
  readonly retryGapMinutes: number;
  readonly attemptsSoFar: number;
  /** How it stands right now — the "Before sending" column, live. */
  readonly okNoReply: boolean;
  readonly okQuoteValid: boolean;
  readonly okNotBooked: boolean;
  readonly okLeadOpen: boolean;
  readonly okConsent: boolean;
  readonly quotationNumber: string | null;
  readonly quotationStatus: string | null;
  readonly quoteValidUntil: string | null;
  readonly leadStage: string;
  readonly bookedAt: string | null;
}

export type OnReply = 'hold' | 'cancel' | 'send_anyway';
export type OnOptOut = 'stop_sales' | 'stop_everything';
export type OnQuoteExpired = 'hold' | 'cancel' | 'send_anyway';

/** What a person may change. `null` on a toggle means "back to the default". */
export interface ConditionEdit {
  readonly noReply: boolean | null;
  readonly quoteValid: boolean | null;
  readonly notBooked: boolean | null;
  readonly onReply: OnReply;
  readonly onOptOut: OnOptOut;
  readonly onQuoteExpired: OnQuoteExpired;
  readonly maxAttempts: number;
  readonly retryGapMinutes: number;
}

export function editFrom(c: FollowUpConditions): ConditionEdit {
  return {
    /* ⚠️ AN EDIT STARTS AS "THE DEFAULT", NOT AS A COPY OF IT. Writing the
       resolved value back would pin this row to today's default for ever, and
       the owner asked for the opposite: the dialog opens on the default and
       only what they actually move becomes the row's own. */
    noReply: c.noReply === c.noReplyDefault ? null : c.noReply,
    quoteValid: c.quoteValid === c.quoteValidDefault ? null : c.quoteValid,
    notBooked: c.notBooked === c.notBookedDefault ? null : c.notBooked,
    onReply: c.onReply,
    onOptOut: c.onOptOut,
    onQuoteExpired: c.onQuoteExpired,
    maxAttempts: c.maxAttempts,
    retryGapMinutes: c.retryGapMinutes,
  };
}

/** Whether a toggle is showing the purpose's default or somebody's choice. */
export function isDefault(edit: ConditionEdit, key: 'noReply' | 'quoteValid' | 'notBooked'): boolean {
  return edit[key] === null;
}

/** The value a toggle should show: the row's own, else the resolved default. */
export function shown(edit: ConditionEdit, c: FollowUpConditions, key: 'noReply' | 'quoteValid' | 'notBooked'): boolean {
  const own = edit[key];
  if (own !== null) return own;
  return key === 'noReply' ? c.noReplyDefault : key === 'quoteValid' ? c.quoteValidDefault : c.notBookedDefault;
}

/** Turning a toggle writes an explicit value; matching the default clears it. */
export function toggle(
  edit: ConditionEdit,
  c: FollowUpConditions,
  key: 'noReply' | 'quoteValid' | 'notBooked',
): ConditionEdit {
  const next = !shown(edit, c, key);
  const dflt = key === 'noReply' ? c.noReplyDefault : key === 'quoteValid' ? c.quoteValidDefault : c.notBookedDefault;
  return { ...edit, [key]: next === dflt ? null : next };
}

export function isUnchanged(a: ConditionEdit, b: ConditionEdit): boolean {
  return (
    a.noReply === b.noReply &&
    a.quoteValid === b.quoteValid &&
    a.notBooked === b.notBooked &&
    a.onReply === b.onReply &&
    a.onOptOut === b.onOptOut &&
    a.onQuoteExpired === b.onQuoteExpired &&
    a.maxAttempts === b.maxAttempts &&
    a.retryGapMinutes === b.retryGapMinutes
  );
}

/* ── The switchable checks ───────────────────────────────────────────────── */

export const CONDITION_ROWS = [
  {
    key: 'noReply' as const,
    label: 'No reply on email or WhatsApp',
    detail: 'Send only if the lead has not replied since our last message.',
  },
  {
    key: 'quoteValid' as const,
    label: 'Quotation is still valid',
    detail: 'Send only if the quotation has not expired or been rejected.',
  },
  {
    key: 'notBooked' as const,
    label: 'Lead is not already booked',
    detail: 'Send only if no visit or meeting is already in the diary.',
  },
];

/* ── The two that cannot be switched, and why ────────────────────────────── */

export const FIXED_ROWS = [
  {
    key: 'consent' as const,
    label: 'Contact permission is active',
    detail: 'Always on. Opting out is the client’s instruction, not a setting of ours.',
  },
  {
    key: 'leadOpen' as const,
    label: 'Lead is not closed',
    detail: 'Always on. Nothing is sent to a lead marked won or lost.',
  },
];

/* ── What happens if something changes before it goes ────────────────────── */

export const ON_REPLY_OPTIONS: ReadonlyArray<{ value: OnReply; label: string }> = [
  { value: 'hold', label: 'Hold it until you reply' },
  { value: 'cancel', label: 'Cancel this follow-up' },
  { value: 'send_anyway', label: 'Send it anyway' },
];

export const ON_OPT_OUT_OPTIONS: ReadonlyArray<{ value: OnOptOut; label: string }> = [
  { value: 'stop_sales', label: 'Stop pending sales messages' },
  { value: 'stop_everything', label: 'Stop everything, reminders too' },
];

export const ON_QUOTE_EXPIRED_OPTIONS: ReadonlyArray<{ value: OnQuoteExpired; label: string }> = [
  { value: 'hold', label: 'Hold it for your review' },
  { value: 'cancel', label: 'Cancel this follow-up' },
  { value: 'send_anyway', label: 'Send it anyway' },
];

export const GAP_OPTIONS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 5, label: '5 minutes' },
  { value: 10, label: '10 minutes' },
  { value: 30, label: '30 minutes' },
  { value: 60, label: '1 hour' },
  { value: 180, label: '3 hours' },
  { value: 360, label: '6 hours' },
];

/* ── The live column ─────────────────────────────────────────────────────── */

export interface LiveCheck {
  readonly label: string;
  readonly detail: string;
  readonly pass: boolean;
  /** Off means the check is not being applied to this follow-up at all. */
  readonly applied: boolean;
}

/* ⚠️ BUILT BY HAND, NOT BY `toLocaleDateString`. ICU renders September as
   "Sept" in en-GB, and every other date on these screens says "Sep" — two
   spellings of one month inside one dialog is the kind of thing that reads as a
   bug in the data. Karachi is UTC+5 with no DST, so the shift is arithmetic. */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const KARACHI_MS = 5 * 3_600_000;

const dayLabel = (iso: string) => {
  const d = new Date(Date.parse(iso) + KARACHI_MS);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

const whenLabel = (iso: string) => {
  const d = new Date(Date.parse(iso) + KARACHI_MS);
  const h = d.getUTCHours();
  const clock = `${h % 12 === 0 ? 12 : h % 12}:${String(d.getUTCMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}, ${clock}`;
};

/**
 * ⚠️ IT SAYS WHAT IS TRUE, NOT WHAT IS HOPED. A check that is switched off is
 * shown as not applied rather than as a tick — a green tick beside a rule
 * nobody is enforcing is the kind of thing somebody acts on.
 */
export function liveChecks(c: FollowUpConditions): LiveCheck[] {
  return [
    {
      label: 'No new reply',
      detail: c.okNoReply ? 'Nothing unanswered from the client.' : 'The client wrote last and is waiting on us.',
      pass: c.okNoReply,
      applied: c.noReply,
    },
    {
      label: 'Quotation valid',
      detail: c.quotationNumber
        ? `${c.quotationNumber}${c.quotationStatus ? ` is ${c.quotationStatus.replace(/_/g, ' ')}` : ''}${
            c.quoteValidUntil ? ` (until ${dayLabel(c.quoteValidUntil)})` : ''
          }`
        : 'No quotation is attached to this lead.',
      pass: c.okQuoteValid,
      applied: c.quoteValid,
    },
    {
      label: 'Nothing booked yet',
      detail: c.bookedAt ? `Already booked for ${whenLabel(c.bookedAt)}.` : 'No visit or meeting in the diary.',
      pass: c.okNotBooked,
      applied: c.notBooked,
    },
    {
      label: 'Lead still open',
      detail: `The lead is at ${c.leadStage.replace(/_/g, ' ')}.`,
      pass: c.okLeadOpen,
      applied: true,
    },
    {
      label: 'Permission available',
      detail: c.okConsent ? 'Contact permission is active.' : 'The client has opted out.',
      pass: c.okConsent,
      applied: true,
    },
  ];
}

/**
 * What the gate would do with this row right now — the one line worth saying
 * above everything else, because it is the question the dialog exists to
 * answer: will this actually go out?
 */
export function verdict(c: FollowUpConditions): { willSend: boolean; because: string } {
  const blocking = liveChecks(c).filter((k) => k.applied && !k.pass);
  if (c.attemptsSoFar >= c.maxAttempts) {
    return { willSend: false, because: `it has already been attempted ${c.attemptsSoFar} times` };
  }
  if (blocking.length === 0) return { willSend: true, because: 'every check it is given passes' };
  return {
    willSend: false,
    because: blocking.map((k) => k.label.toLowerCase()).join(' and ') + ' would stop it',
  };
}
