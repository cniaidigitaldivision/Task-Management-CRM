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

/* ── ⚠️ EVERY TOKEN HERE WAS MEASURED THROUGH THE BADGE, IN BOTH THEMES ─────
   Measured 2026-09-10 on the rendered component, not read off the palette: the
   Badge does not print the token, it prints
   `color-mix(in oklab, <token> 70%, var(--text-primary))`, so a hue that fails
   as raw ink can pass here and the other way round.

   Four of these were below the 4.5:1 floor in LIGHT and comfortably above it in
   dark — the exact shape recorded for the chart tokens, and the reason nobody
   caught it: dark theme passes, so review passes.

     follow_up  chart-3      4.35:1   (and 161°, the same green as `won`)
     visited    chart-6      3.32:1
     scheduled  accent-gold  3.72:1
     warm       accent-gold  3.72:1

   ⚠️ AND ALL FOUR WERE INVISIBLE. Every one of the 615 leads is `new`, so no
   other badge has ever rendered on a screen — these would have appeared for the
   first time the day somebody moved a lead through the pipeline in Step 6, on a
   screen already signed off.

   The replacements are measured, not guessed, and the pinks are kept four chips
   apart in the strip: */
const STAGES: Record<CrmStage, StageMeta> = {
  new: { label: 'New', token: 'accent-primary', open: true },
  contacted: { label: 'Contacted', token: 'chart-1', open: true },
  /* 5.07 light / 6.57 dark. Was chart-3, which failed AND was the same 161°
     green as `won` — a funnel whose third chip matched its last one. */
  follow_up: { label: 'Follow up', token: 'status-review', open: true },
  qualified: { label: 'Qualified', token: 'chart-4', open: true },
  /* 5.37 / 5.41. Keeps the gold this stage always had — `gold-700` is the step
     that is legible at BOTH ends, where `accent-gold` is a fill. The palette
     already records the same lesson one step further down:
     `--text-gold: var(--gold-800)  ⚠️ NOT gold-500 — fails contrast on white`. */
  visited: { label: 'Visited', token: 'gold-700', open: true },
  /* 6.24 / 6.62. Slate reads as booked-and-waiting, and it takes the second gold
     out of a strip that would otherwise have had two side by side. */
  scheduled: { label: 'Scheduled', token: 'status-backlog', open: true },
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
  /* ⚠️ `gold-700`, not `accent-gold` — 3.72:1 in light, measured. Same fix and
     same reason as `visited`; see the note above STAGES. */
  warm: { label: 'Warm', token: 'gold-700' },
  cold: { label: 'Cold', token: 'chart-1' },
};

export function temperatureLabel(value: string): string {
  return value in TEMPERATURE_META ? TEMPERATURE_META[value as CrmTemperature].label : value;
}

export function temperatureToken(value: string): string {
  return value in TEMPERATURE_META ? TEMPERATURE_META[value as CrmTemperature].token : 'neutral-500';
}

/* ---- Why a lead was lost -------------------------------------------------- */

/**
 * The nine values of `public.crm_lost_reason`, in the words the team says.
 *
 * ⚠️ ORDERED BY HOW OFTEN THEY GET PICKED, not alphabetically. This is a
 * dropdown somebody uses at the end of a call they would rather not have had;
 * the three the owner named first are first, and the further down the list a
 * reason is, the more thought it takes to choose it.
 *
 * ⚠️ `revisit_later` IS NOT A LOSS and it sits last for that reason. It is here
 * because giving it a name is what stops somebody filing an early enquiry under
 * "not serious" — see migration 111. Step 8's follow-up rules should pick these
 * leads back up rather than treat them as closed.
 */
export const LOST_REASONS = [
  'wrong_number',
  'not_serious',
  'budget_too_low',
  'no_answer',
  'wrong_location',
  'bought_elsewhere',
  'wants_what_we_dont_offer',
  'duplicate',
  'revisit_later',
] as const;

export type CrmLostReason = (typeof LOST_REASONS)[number];

const LOST_REASON_LABELS: Record<CrmLostReason, string> = {
  wrong_number: 'Wrong or invalid number',
  not_serious: 'Just browsing — not serious',
  budget_too_low: 'Budget too low',
  no_answer: 'Never answered',
  wrong_location: 'Wrong location',
  bought_elsewhere: 'Bought from a competitor',
  wants_what_we_dont_offer: 'Wants something we do not offer',
  duplicate: 'Duplicate',
  revisit_later: 'Timing — revisit later',
};

export function isLostReason(value: string): value is CrmLostReason {
  return Object.hasOwn(LOST_REASON_LABELS, value);
}

export function lostReasonLabel(reason: string): string {
  return isLostReason(reason) ? LOST_REASON_LABELS[reason] : reason;
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
  /* Added by migration 115 — the timeline had no word for either, so marking a
     lead hot or setting what is owed happened with the log silent about it. */
  temperature_set: 'Temperature set',
  next_action_set: 'Next action set',
  won: 'Won',
  lost: 'Lost',
};

export function activityLabel(kind: string): string {
  return ACTIVITY_LABELS[kind] ?? kind;
}
