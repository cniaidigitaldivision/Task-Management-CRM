/* ============================================================================
 * THE PIPELINE VOCABULARY
 * ----------------------------------------------------------------------------
 * Nine stages, three temperatures, nine lost reasons — the exact values migration
 * 111 put in the enums. This module is the one place that turns them into words
 * and colours, so the filter menu, the counts strip and the table rows cannot
 * disagree about what `follow_up` is called or which end of the pipeline it sits
 * at.
 *
 * ── ⚠️ PURE, AND IT MUST STAY THAT WAY ─────────────────────────────────────
 * No clock, no database, no React. `lib/domain/` is unit-testable precisely
 * because of that rule, and the ordering below is the kind of thing that is
 * quietly got wrong once and then copied.
 *
 * ── ⚠️ THE ORDER IS THE PIPELINE, NOT THE ALPHABET ─────────────────────────
 * `STAGE_ORDER` is how far along a lead is. The counts strip reads left to right
 * as a funnel, so sorting these any other way would draw a funnel that widens in
 * the middle and mean nothing.
 *
 * ── ⚠️ AND `won`/`lost` ARE NOT STEPS, THEY ARE EXITS ──────────────────────
 * They sit at the end of the order because they have to sit somewhere, but
 * `isOpen` is what code should ask. A lead that is `lost` has not progressed
 * further than one that is `negotiation`; it has left. Treating the index as a
 * score is how a "pipeline health" figure ends up rewarding losing deals.
 * ========================================================================= */

export const STAGE_ORDER = [
  'new',
  'contacted',
  'follow_up',
  'qualified',
  'visited',
  'scheduled',
  'negotiation',
  'won',
  'lost',
] as const;

export type CrmStage = (typeof STAGE_ORDER)[number];

interface StageMeta {
  readonly label: string;
  /** A design token name, passed to `<Badge token>`. */
  readonly token: string;
  /** False for `won` and `lost` — see the header. */
  readonly open: boolean;
}

const STAGES: Record<CrmStage, StageMeta> = {
  new: { label: 'New', token: 'accent-primary', open: true },
  contacted: { label: 'Contacted', token: 'chart-1', open: true },
  follow_up: { label: 'Follow up', token: 'chart-3', open: true },
  qualified: { label: 'Qualified', token: 'chart-4', open: true },
  visited: { label: 'Visited', token: 'chart-6', open: true },
  scheduled: { label: 'Scheduled', token: 'accent-gold', open: true },
  /* ⚠️ NOT `feedback-warning`, for two reasons. Semantically, negotiation is a
     late-funnel stage, not a warning — the feedback tokens mean good/warning/
     critical and spending one on a neutral stage leaves nothing to say "this
     lead is in trouble" with later. And measured: feedback-warning through the
     Badge's mix gives **4.37:1 in light**, just under the 4.5 floor. */
  negotiation: { label: 'Negotiation', token: 'chart-2', open: true },
  won: { label: 'Won', token: 'feedback-success', open: false },
  lost: { label: 'Lost', token: 'neutral-500', open: false },
};

export function isStage(value: string): value is CrmStage {
  return Object.hasOwn(STAGES, value);
}

/** The word for a stage. Falls back to the raw value rather than to "Unknown" —
 *  a stage added to the enum without being added here should look odd on screen,
 *  not vanish into a label that hides which one it was. */
export function stageLabel(stage: string): string {
  return isStage(stage) ? STAGES[stage].label : stage;
}

export function stageToken(stage: string): string {
  return isStage(stage) ? STAGES[stage].token : 'neutral-500';
}

/** Whether the lead is still being worked. See the header — ask this, never the
 *  position in `STAGE_ORDER`. */
export function isOpen(stage: string): boolean {
  return isStage(stage) ? STAGES[stage].open : true;
}

export const OPEN_STAGES: readonly CrmStage[] = STAGE_ORDER.filter((s) => STAGES[s].open);

/* ---- Temperature --------------------------------------------------------- */

export const TEMPERATURES = ['hot', 'warm', 'cold'] as const;
export type CrmTemperature = (typeof TEMPERATURES)[number];

const TEMPERATURE_META: Record<CrmTemperature, { label: string; token: string }> = {
  hot: { label: 'Hot', token: 'feedback-error' },
  warm: { label: 'Warm', token: 'accent-gold' },
  cold: { label: 'Cold', token: 'chart-1' },
};

export function temperatureLabel(value: string): string {
  return value in TEMPERATURE_META ? TEMPERATURE_META[value as CrmTemperature].label : value;
}

export function temperatureToken(value: string): string {
  return value in TEMPERATURE_META ? TEMPERATURE_META[value as CrmTemperature].token : 'neutral-500';
}

/* ---- Activity, as a past-tense outcome ----------------------------------- */

/**
 * What the last thing that happened to this lead was, phrased as an outcome
 * rather than as an event name.
 *
 * ⚠️ "No answer", not `call_no_answer`. This column is read at a glance beside
 * eight others, and the enum's underscores are database vocabulary that would
 * make a salesperson decode their own screen.
 */
const ACTIVITY_LABELS: Record<string, string> = {
  imported: 'Imported',
  assigned: 'Assigned',
  stage_changed: 'Stage changed',
  note_added: 'Note added',
  call_attempted: 'Called',
  call_connected: 'Spoke',
  call_no_answer: 'No answer',
  whatsapp_sent: 'WhatsApp sent',
  email_sent: 'Email sent',
  won: 'Won',
  lost: 'Lost',
};

export function activityLabel(kind: string): string {
  return ACTIVITY_LABELS[kind] ?? kind;
}
