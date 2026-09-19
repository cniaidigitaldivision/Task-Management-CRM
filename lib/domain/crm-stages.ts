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

/* ⚠️ `follow_up` AND `scheduled` ARE GONE FROM THIS LIST — migrations 148/149,
   on the owner's decision of 2026-09-14. They remain in the database enum
   because PostgreSQL has no `DROP VALUE`, and 149 proved no row wears either.

   The reasoning is the owner's and it is right: a follow-up is an ACTIVITY, not
   a position. A qualified lead, a lead holding a live quotation and a lead in
   negotiation can all be awaiting one — `next_action` + `next_action_at` already
   carry that, on any stage.

   ⚠️ AND "NEW REPLY" IS NOT HERE EITHER, though the reference design shows it as
   a stage. It is a conversation state: a lead that replies while in negotiation
   must still be in negotiation, or the funnel forgets where they were. */
export const STAGE_ORDER = [
  'new',
  'contacted',
  'qualified',
  'proposal_pending',
  'quotation_sent',
  'visit_scheduled',
  'visited',
  'negotiation',
  /* ⚠️ PARKED, NOT CLOSED — migration 205/206. A lead that was chased to the end
     of a sequence and never answered belongs here: it never said no, so it is not
     `lost`, and it is not moving, so it is not in the pipeline. The sequence puts
     it here by itself when every step went out in silence. */
  'nurture',
  'won',
  'lost',
] as const;

/** ⚠️ Retired, and kept only so a legacy row renders a word rather than a raw
 *  enum. Never offered in a picker; never counted in the strip. */
export const RETIRED_STAGES = ['follow_up', 'scheduled'] as const;

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
/* ⚠️ KEYED BY `string`, NOT `CrmStage`, and only here. `CrmStage` is now the
   TEN live stages, and this map must also answer for the two retired ones —
   `follow_up` and `scheduled` — because the database enum still holds them and a
   row written before 149, or by hand, must render a word rather than a raw
   label. `isStage()` below is what keeps the retired pair out of everything
   else. */
const STAGES: Record<string, StageMeta> = {
  /* ── THE COLOURS, RE-MEASURED 2026-09-19 ───────────────────────────────
     Owner: *"every stage should have a different colour. The grey is not looking
     prominent."* Right, and the audit found more than grey. Measured through the
     REAL chip (14% tint on bg-surface, token as ink) in both themes:

       new              accent-primary   **2.73:1** — below the 4.5 floor, on the
                                         stage every single lead starts in
       quotation_sent   status-backlog   28% saturation — the grey
       lost             neutral-500      20% saturation — the other grey
       nurture / won    chart-3 / feedback-success — **BOTH hue 161**, despite the
                                         old note here claiming each stage had
                                         its own
       contacted 224 / visit_scheduled 217 / quotation_sent 215 — three blues
                                         within 9°, so the funnel read as one band

     ⚠️ THE PREVIOUS FIGURES WERE TAKEN THROUGH THE BADGE COMPONENT, not
     through this chip, which is why they read as passing. A token is only as
     legible as the background it is actually drawn on.

     The rule now: **no two ADJACENT stages share a hue family**, every stage
     clears 4.5:1 on its own chip in BOTH themes, and the only muted colour left
     is `nurture` — where muted is the meaning. */
  new: { label: 'New', token: 'chart-1', open: true },                       /* 224 blue  5.64 */
  contacted: { label: 'Contacted', token: 'chart-4', open: true },           /* 258 violet 4.95 */
  /* ⚠️ RETIRED (149). Kept so a legacy row renders a word; absent from
     STAGE_ORDER so nothing offers it. */
  follow_up: { label: 'Follow up', token: 'status-review', open: true },
  qualified: { label: 'Qualified', token: 'status-done', open: true },       /* 160 green  8.27 */
  /* The client has asked for something and the clock is running on US. */
  proposal_pending: { label: 'Proposal pending', token: 'status-review', open: true }, /* 330 pink 5.95 */
  /* ⚠️ ORANGE, NOT SLATE — this was the grey the owner saw. A price is out
     with them and owed a chase; that is not a background state. */
  quotation_sent: { label: 'Quotation sent', token: 'chart-5', open: true }, /* 28 orange 9.01 */
  visit_scheduled: { label: 'Visit scheduled', token: 'status-todo', open: true }, /* 217 blue 5.70 */
  visited: { label: 'Visited', token: 'chart-6', open: true },               /* 45 gold   10.94 */
  /* ⚠️ RETIRED (149) — folded into the appointment record. */
  scheduled: { label: 'Scheduled', token: 'status-backlog', open: true },
  negotiation: { label: 'Negotiation', token: 'chart-2', open: true },       /* 337 pink  5.90 */
  /* ⚠️ `open: true`. A nurtured lead still counts as live and can still be won —
     it has only stopped answering.
     ⚠️ AND IT IS THE ONE STAGE THAT SHOULD BE QUIET. Parked is the meaning, so
     the muted teal-grey is the message rather than an oversight — and at 5.21:1
     it is still legible, which the old greys were chosen without checking. */
  nurture: { label: 'Nurture', token: 'neutral-500', open: true },           /* 187 grey  5.21 */
  won: { label: 'Won', token: 'feedback-success', open: false },             /* 161 green 5.57 */
  /* ⚠️ `status-blocked`, NOT `feedback-error`: the softer red measures 4.34:1
     on this chip in light and would have shipped just under the floor — caught
     by testing the replacement rather than assuming a red is a red. */
  lost: { label: 'Lost', token: 'status-blocked', open: false },             /* 0 red     5.57 */
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

/* ---- How fast somebody answers ------------------------------------------- */

/**
 * A response time, in the words a person would use.
 *
 * ⚠️ NULL IS "no calls yet", NOT ZERO, and the distinction is the whole point.
 * `median_response_minutes` is null until somebody logs a contact — rendering
 * that as `0m` would tell a manager their salesperson answers instantly, which
 * is the most flattering possible reading of no data at all. The caller decides
 * the wording; this returns null so it cannot be formatted by accident.
 *
 * ⚠️ AND IT ROUNDS DOWNWARD IN PRECISION AS IT GROWS. "4m" matters; "2h 10m"
 * matters; "3d" is enough once it is days — nobody acts differently on 3d 4h.
 */
export function responseTime(minutes: number | null | undefined): string | null {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return null;
  if (minutes < 0) return null;

  const m = Math.round(minutes);
  if (m < 1) return 'under a minute';
  if (m < 60) return `${m}m`;

  const hours = Math.floor(m / 60);
  if (hours < 24) {
    const rest = m % 60;
    return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
  }

  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  if (days < 7) return restHours === 0 ? `${days}d` : `${days}d ${restHours}h`;
  return `${days}d`;
}

/**
 * How a response time should READ — fast, or slow enough to act on.
 *
 * ⚠️ THE THRESHOLDS ARE A JUDGEMENT AND ARE NAMED AS ONE. Nothing in this
 * division's data says an hour is the line; it is the commonly cited one for
 * lead response, and it is here so the screen can be consistent rather than so
 * it can be authoritative. Once there are real outcomes, Step 12 can derive the
 * line that actually predicts a close — and this should then follow it.
 */
export function responseBand(minutes: number | null | undefined): 'fast' | 'fair' | 'slow' | null {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return null;
  if (minutes <= 60) return 'fast';
  if (minutes <= 60 * 24) return 'fair';
  return 'slow';
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
  /* 158's own kind for a lead somebody typed in. It was missing here, so the
     first line of a hand-made lead's timeline read 'created' in lower case. */
  created: 'Created',
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
