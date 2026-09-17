/* ============================================================================
 * QUALIFICATION — BANT, AND WHAT IT LETS YOU SAY ABOUT A LEAD
 * ----------------------------------------------------------------------------
 * Pure: no database, no clock, no React. The form runs these so nobody is told
 * "no" after filling a panel in, and migration 167's trigger enforces the same
 * gate, because a rule that lives only in a component is not a rule.
 *
 * ── ⚠️ QUALIFICATION IS A GATE, NOT A WAYPOINT ─────────────────────────────
 * It sits third — new · contacted · QUALIFIED · … — because its job is to decide
 * whether to spend money on somebody. A site visit is the most expensive thing a
 * salesperson does, and qualifying after it means paying for it first.
 *
 * ── ⚠️ "NOT DISCLOSED" IS AN ANSWER. NULL IS NOT. ──────────────────────────
 * Every axis carries an unknown value on purpose. A client who will not say
 * their budget is a fact about the lead, not a reason to block the salesperson.
 * What the gate refuses is reaching `qualified` having never ASKED — and four
 * recorded unknowns produce a `cold` suggestion, which is the right answer.
 *
 * ── ⚠️ THE TEMPERATURE IS SUGGESTED, NEVER SET ─────────────────────────────
 * Owner, 2026-09-16: *"On the basis of this response I will set their
 * temperature."* So this returns a proposal with the REASONS that drove it, and
 * a human commits it. The same stance the rota takes: an ordered rule somebody
 * can argue with beats a score that can only be asserted at them.
 * ========================================================================= */

export const BUDGET_BANDS = [
  'under_2m', '2m_to_4m', '4m_to_6m', '6m_to_10m', 'over_10m', 'not_disclosed',
] as const;
export const AUTHORITIES = [
  'sole_decider', 'shares_decision', 'not_the_decider', 'unknown',
] as const;
export const PURPOSES = [
  'investment', 'build_to_live', 'build_to_rent', 'resale', 'business_use', 'other', 'unknown',
] as const;
export const TIMELINES = [
  'within_1_month', '1_to_3_months', '3_to_6_months', '6_to_12_months',
  'just_exploring', 'unknown',
] as const;
export const PAYMENT_MODES = ['full_cash', 'instalments', 'mixed', 'unknown'] as const;

export type BudgetBand = (typeof BUDGET_BANDS)[number];
export type Authority = (typeof AUTHORITIES)[number];
export type Purpose = (typeof PURPOSES)[number];
export type Timeline = (typeof TIMELINES)[number];
export type PaymentMode = (typeof PAYMENT_MODES)[number];

const BUDGET_LABEL: Record<BudgetBand, string> = {
  under_2m: 'Under 20 lakh',
  '2m_to_4m': '20 – 40 lakh',
  '4m_to_6m': '40 – 60 lakh',
  '6m_to_10m': '60 lakh – 1 crore',
  over_10m: 'Over 1 crore',
  not_disclosed: 'Would not say',
};

const AUTHORITY_LABEL: Record<Authority, string> = {
  sole_decider: 'Decides alone',
  shares_decision: 'Decides with family',
  not_the_decider: 'Someone else decides',
  unknown: "Didn't find out",
};

const PURPOSE_LABEL: Record<Purpose, string> = {
  investment: 'Investment',
  build_to_live: 'To build and live in',
  build_to_rent: 'To build and rent out',
  resale: 'To resell',
  business_use: 'Business use',
  other: 'Something else',
  unknown: "Didn't find out",
};

const TIMELINE_LABEL: Record<Timeline, string> = {
  within_1_month: 'Within a month',
  '1_to_3_months': '1 – 3 months',
  '3_to_6_months': '3 – 6 months',
  '6_to_12_months': '6 – 12 months',
  just_exploring: 'Just exploring',
  unknown: "Didn't find out",
};

const PAYMENT_LABEL: Record<PaymentMode, string> = {
  full_cash: 'Full cash',
  instalments: 'Instalments',
  mixed: 'Part cash, part instalments',
  unknown: "Didn't find out",
};

/* ⚠️ AN UNRECOGNISED VALUE SHOWS ITSELF rather than "Unknown" — a label added to
   an enum and forgotten here should look odd on screen, not vanish into a word
   that conceals which one it was. Same rule as `stageLabel`. */
const labeller =
  <T extends string>(map: Record<T, string>) =>
  (value: string | null): string | null =>
    value === null ? null : (map[value as T] ?? value);

export const budgetBandLabel = labeller(BUDGET_LABEL);
export const authorityLabel = labeller(AUTHORITY_LABEL);
export const purposeLabel = labeller(PURPOSE_LABEL);
export const timelineLabel = labeller(TIMELINE_LABEL);
export const paymentModeLabel = labeller(PAYMENT_LABEL);

/** What the gate reads. Only these four; the rest are useful, not required. */
export interface Bant {
  readonly budgetBand: string | null;
  readonly authority: string | null;
  readonly purpose: string | null;
  readonly timeline: string | null;
}

/** The questions, in the order worth asking them. */
export const BANT_QUESTIONS: ReadonlyArray<{
  readonly field: keyof Bant;
  readonly letter: string;
  readonly label: string;
  readonly ask: string;
  readonly options: readonly string[];
  readonly labelOf: (v: string | null) => string | null;
}> = [
  {
    field: 'timeline',
    letter: 'T',
    label: 'When do they intend to buy?',
    /* ⚠️ TIMELINE IS ASKED FIRST, not last as the acronym suggests. It is the
       least intrusive question, the strongest single predictor, and somebody who
       answers "just exploring" has saved you the other three. */
    ask: 'Are you looking to buy soon, or still exploring your options?',
    options: TIMELINES,
    labelOf: timelineLabel,
  },
  {
    field: 'purpose',
    letter: 'N',
    label: 'What do they want it for?',
    ask: 'Are you looking at this as an investment, or to build on?',
    options: PURPOSES,
    labelOf: purposeLabel,
  },
  {
    field: 'budgetBand',
    letter: 'B',
    label: 'What can they spend?',
    ask: 'What range were you hoping to stay within?',
    options: BUDGET_BANDS,
    labelOf: budgetBandLabel,
  },
  {
    field: 'authority',
    letter: 'A',
    label: 'Who decides?',
    /* ⚠️ THE QUESTION THAT SAVES THE MOST DEALS, and it is asked last because it
       only works once there is rapport. In property the decision is a family;
       asking now kills the "I need to discuss with my brother" stall that
       otherwise surfaces at negotiation, where it costs most. */
    ask: 'Will anyone else be part of the decision with you?',
    options: AUTHORITIES,
    labelOf: authorityLabel,
  },
];

/**
 * What is still missing before this lead may be qualified.
 *
 * Sentences, not a boolean — each names the field, the same stance
 * `outcomeProblems` and `appointmentProblems` take. Empty means the gate opens.
 */
export function qualificationGaps(bant: Bant): string[] {
  return BANT_QUESTIONS.filter((q) => !bant[q.field]).map((q) => q.label);
}

export function isQualified(bant: Bant): boolean {
  return qualificationGaps(bant).length === 0;
}

/**
 * Has anybody started? Distinguishes "never asked" from "part way through", so
 * the drawer can say *Not qualified yet* rather than *2 of 4* on an untouched
 * lead.
 */
export function qualificationStarted(bant: Bant): boolean {
  return BANT_QUESTIONS.some((q) => Boolean(bant[q.field]));
}

export type Temperature = 'hot' | 'warm' | 'cold';

export interface TemperatureSuggestion {
  readonly temperature: Temperature;
  /** Why, in the order that mattered. Shown to the salesperson, never a score. */
  readonly reasons: readonly string[];
}

/* ⚠️ THE WEIGHTS ARE HERE AND THE SCORE IS NEVER SHOWN. A salesperson told
   "this is hot because they are buying within a month and decide alone" can
   disagree with a sentence. One told "6.2" can only be asserted at. The numbers
   exist to order the reasons, not to be displayed. */
const TIMELINE_WEIGHT: Record<string, number> = {
  within_1_month: 3, '1_to_3_months': 2, '3_to_6_months': 1,
  '6_to_12_months': 0, just_exploring: -2, unknown: 0,
};
const AUTHORITY_WEIGHT: Record<string, number> = {
  sole_decider: 2, shares_decision: 1, not_the_decider: -1, unknown: 0,
};
const PURPOSE_WEIGHT: Record<string, number> = {
  build_to_live: 2, investment: 1, build_to_rent: 1, resale: 1,
  business_use: 1, other: 0, unknown: 0,
};

/**
 * What temperature the answers imply.
 *
 * ⚠️ A SUGGESTION. The salesperson commits it — they heard the call and this
 * did not.
 */
export function suggestTemperature(bant: Bant): TemperatureSuggestion {
  const scored: Array<{ points: number; reason: string }> = [];

  const t = bant.timeline;
  if (t) {
    scored.push({
      points: TIMELINE_WEIGHT[t] ?? 0,
      reason:
        t === 'just_exploring'
          ? 'still just exploring'
          : t === 'unknown'
            ? 'no timeline established'
            : `buying ${(timelineLabel(t) ?? t).toLowerCase()}`,
    });
  }

  const a = bant.authority;
  if (a) {
    scored.push({
      points: AUTHORITY_WEIGHT[a] ?? 0,
      reason:
        a === 'sole_decider'
          ? 'decides alone'
          : a === 'shares_decision'
            ? 'decides with family'
            : a === 'not_the_decider'
              ? '⚠️ not the decision-maker'
              : 'who decides is unknown',
    });
  }

  const b = bant.budgetBand;
  if (b) {
    /* ⚠️ A REFUSED BUDGET SCORES ZERO, NOT NEGATIVE. Plenty of serious buyers
       will not name a number to a stranger on WhatsApp; treating that as a
       negative signal would mark the cautious wealthy as cold. */
    scored.push({
      points: b === 'not_disclosed' ? 0 : 2,
      reason: b === 'not_disclosed' ? 'would not give a budget' : `budget ${budgetBandLabel(b)}`,
    });
  }

  const p = bant.purpose;
  if (p) {
    scored.push({
      points: PURPOSE_WEIGHT[p] ?? 0,
      reason:
        p === 'unknown' ? 'purpose unknown' : `${(purposeLabel(p) ?? p).toLowerCase()}`,
    });
  }

  const total = scored.reduce((sum, s) => sum + s.points, 0);
  let temperature: Temperature = total >= 6 ? 'hot' : total >= 3 ? 'warm' : 'cold';

  /* ⚠️ TWO CAPS, BECAUSE "HOT" MEANS CLOSEABLE NOW — NOT "SCORED WELL".
     Weight-tuning could not express this: a wealthy, decisive buyer who is
     browsing still added up to hot, and so did one who cannot sign anything.
     Both are good leads and neither can be closed this week, so calling them hot
     sends a salesperson to spend today on a deal that cannot happen today.

     ⚠️ They cap rather than force cold — these are not bad leads. `just
     exploring` is next quarter's business and a proxy is one introduction away
     from the real buyer. Marking either cold is how a pipeline gets thrown out. */
  if (temperature === 'hot' && (bant.timeline === 'just_exploring' || bant.authority === 'not_the_decider')) {
    temperature = 'warm';
  }

  /* ⚠️ CAVEATS FIRST, AND NEVER DROPPED. Ranking by weight alone hid the very
     signal that decided the answer: a lead capped down to warm for having no
     decision-maker was explained by "buying within a month, budget stated, to
     build and live in" — three reasons that all argue for hot. An explanation
     that contradicts its own verdict is worse than none, because somebody acts
     on it.

     A caveat is anything scoring zero or below: the unknowns, the refusals, the
     two capping conditions. They are what change what a salesperson does next,
     so they lead — and the positive drivers fill whatever room is left. */
  const caveats = scored.filter((s) => s.points <= 0);
  const drivers = scored
    .filter((s) => s.points > 0)
    .sort((x, y) => y.points - x.points);

  const reasons = [...caveats, ...drivers].slice(0, 3).map((s) => s.reason);

  return {
    temperature,
    /* ⚠️ NEVER AN EMPTY REASON LIST. Four recorded unknowns score zero and would
       otherwise produce a bare "cold" that reads as a judgement rather than as
       the absence of one. */
    reasons: reasons.length > 0 ? reasons : ['nothing was established on the call'],
  };
}
