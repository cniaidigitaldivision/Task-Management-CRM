/* ============================================================================
 * PLANNING A FOLLOW-UP — the purposes, the suggested plans, and what is allowed
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-17, with a design for the New follow-up dialog: nine purposes,
 * a suggested plan beside them ("Day 1 · Day 3 · Day 7"), a goal and a stop
 * condition, and the choice between ONE follow-up and a scheduler.
 *
 * Pure: no database, no React, no clock beyond what the caller passes. The
 * dialog draws what this returns and the server action validates with the SAME
 * functions, so a rule cannot be enforced on one side and not the other.
 *
 * ── ⚠️ THE NINE PURPOSES ARE THE DATABASE'S OWN ENUM ────────────────────────
 * `public.crm_followup_purpose` (153). They are not a list invented for this
 * screen, which is why a card can be turned into a row without a lookup table.
 *
 * ── ⚠️ A CARD IS OFFERED ONLY WHEN THE LEAD CAN ANSWER IT ───────────────────
 * "Quotation follow-up" on a lead with no live quotation is a plan whose first
 * message has nothing to refer to, and 170 would stop the run on its first pass
 * ("the quotation is no longer live"). The reason is said on the card instead.
 *
 * ── ⚠️ DAYS ARE ABSOLUTE ON SCREEN AND RELATIVE IN THE DATABASE ─────────────
 * The owner's design says "Day 1, Day 3, Day 7" — days since the plan started,
 * counting the first as day 1. `crm_sequence_steps.delay_days` is the gap from
 * the step before (170 adds it to `now()` when it queues the previous one), so
 * day 1/3/7 is stored as 0/2/4. Getting this backwards would send three messages
 * on the same morning.
 * ========================================================================= */

export type FollowUpPurpose =
  | 'no_response'
  | 'quotation'
  | 'appointment_reminder'
  | 'missing_information'
  | 'approved_offer'
  | 'payment_reminder'
  | 'site_visit_checkin'
  | 're_engage'
  | 'custom';

export type PlanChannel = 'whatsapp' | 'email' | 'call' | 'task';

/** Who acts on a step. `auto_send` is the machine — see NOTHING_SENDS_YET. */
export type PlanMode = 'remind_me' | 'review_first' | 'auto_send';

export interface PlanStep {
  /** Day 1 is the day the plan starts. */
  readonly day: number;
  /**
   * The hour this step should go out, as `HH:MM` in Karachi. Null inherits the
   * time the plan happens to be running at.
   *
   * ⚠️ WITHOUT THIS EVERY STEP FIRED AT THE FIRST ONE'S HOUR. The engine computed
   * `now() + delay_days` at the moment the previous step ran, so a three-step
   * plan went out at the same minute three times (207).
   */
  readonly at: string | null;
  readonly channel: PlanChannel;
  readonly title: string;
  readonly body: string;
  readonly mode: PlanMode;
  /** Email only. An email with no subject line is a spam folder. */
  readonly subject: string;
  /** Skip this step if the client has written since the plan started. */
  readonly onlyIfNoReply: boolean;
  /**
   * The approved WhatsApp template this step falls back to outside the 24-hour
   * window. ⚠️ Only Meta can approve one; the dialog lists what this account has.
   */
  readonly template: { readonly name: string; readonly language: string } | null;
}

/**
 * How a plan is carried out — the owner's own first question on the dialog:
 * *"How would you like to proceed?"*
 *
 * ⚠️ `auto_send` IS REAL NOW (187–190). `/api/cron/crm-followups` advances the
 * sequences and delivers what may go out: free text on WhatsApp inside the
 * 24-hour window, an approved template outside it, email at any time.
 *
 * ⚠️ AND IT IS STILL NARROWED BY THE ENGINE, NEVER WIDENED. A step marked
 * auto-send that would be free text outside the window is handed back to a
 * person (`review_first`) rather than attempted — the screen says so before
 * anybody chooses it.
 */
export const DELIVERY_CHOICES: ReadonlyArray<{
  key: PlanMode;
  label: string;
  detail: string;
}> = [
  { key: 'remind_me', label: 'Remind me', detail: 'Set a reminder to follow up later. Nothing is sent.' },
  { key: 'review_first', label: 'Review first', detail: 'The message is drafted and waits for you to press send.' },
  { key: 'auto_send', label: 'Auto-send', detail: 'Sent automatically at the time you choose.' },
];

export interface LeadFacts {
  readonly leadFirstName: string;
  readonly company: string;
  readonly projectName: string;
  readonly myFirstName: string;
  readonly stage: string;
  /** The live quotation, if one is out. */
  readonly quotation: { readonly number: string; readonly amount: number } | null;
  /** A quotation that has been approved — what "Approved offer" is about. */
  readonly approvedQuotation: { readonly number: string } | null;
  /** The next booked visit or meeting. */
  readonly visit: { readonly at: string; readonly kind: string } | null;
  /** A visit that has already happened. */
  readonly visitedAt: string | null;
  /** Has the client ever written to us? */
  readonly hasInbound: boolean;
}

export interface PurposeCard {
  readonly key: FollowUpPurpose;
  readonly label: string;
  readonly blurb: string;
  /** Shown as a badge on the card — the screenshot's "Manager approval". */
  readonly badge: string | null;
  readonly goal: (f: LeadFacts) => string;
}

/* ── The nine, in the owner's own order ──────────────────────────────────── */

export const PURPOSE_CARDS: readonly PurposeCard[] = [
  {
    key: 'no_response',
    label: 'No response',
    blurb: 'Polite nudge after no reply yet.',
    badge: null,
    goal: () => 'Get any reply at all, so the conversation can start.',
  },
  {
    key: 'quotation',
    label: 'Quotation follow-up',
    blurb: 'Follow up on a sent quotation.',
    badge: null,
    goal: (f) =>
      f.quotation
        ? `Get a reply about ${f.quotation.number} — confirm interest, answer questions, or move to the next step.`
        : 'Get a reply about the quotation that was sent.',
  },
  {
    key: 'appointment_reminder',
    label: 'Appointment reminder',
    blurb: 'Remind about a scheduled meeting.',
    badge: null,
    goal: () => 'Make sure they turn up, and know where and when.',
  },
  {
    key: 'missing_information',
    label: 'Missing information',
    blurb: 'Request additional details.',
    badge: null,
    goal: () => 'Get the details needed to qualify them or prepare a quotation.',
  },
  {
    key: 'approved_offer',
    label: 'Approved offer',
    blurb: 'Follow up on an approved offer.',
    badge: 'Manager approved',
    goal: (f) =>
      f.approvedQuotation
        ? `Get a decision on the approved offer ${f.approvedQuotation.number}.`
        : 'Get a decision on the approved offer.',
  },
  {
    key: 'payment_reminder',
    label: 'Payment reminder',
    blurb: 'Gentle reminder about payment.',
    badge: null,
    goal: () => 'Get the agreed payment made, or a date for it.',
  },
  {
    key: 'site_visit_checkin',
    label: 'Site visit check-in',
    blurb: 'Follow up after a site visit.',
    badge: null,
    goal: () => 'Hear what they thought of the visit and what they want next.',
  },
  {
    key: 're_engage',
    label: 'Re-engage lead',
    blurb: 'Reconnect with an inactive lead.',
    badge: null,
    goal: () => 'Find out whether they are still looking, without pressure.',
  },
  {
    key: 'custom',
    label: 'Custom',
    blurb: 'Create a custom follow-up message.',
    badge: null,
    goal: () => 'Whatever you write it to do.',
  },
];

export function purposeLabel(purpose: string): string {
  return PURPOSE_CARDS.find((p) => p.key === purpose)?.label ?? 'Follow-up';
}

/* ── Can this lead answer this purpose? ──────────────────────────────────── */

export interface Availability {
  readonly ok: boolean;
  /** Why not — said on the card, never discovered after pressing it. */
  readonly reason: string | null;
}

export function purposeAvailability(purpose: FollowUpPurpose, f: LeadFacts): Availability {
  switch (purpose) {
    case 'quotation':
      return f.quotation
        ? { ok: true, reason: null }
        : { ok: false, reason: 'No live quotation on this lead yet.' };
    case 'approved_offer':
      return f.approvedQuotation
        ? { ok: true, reason: null }
        : { ok: false, reason: 'No approved offer yet — a manager approves it first.' };
    case 'appointment_reminder':
      return f.visit
        ? { ok: true, reason: null }
        : { ok: false, reason: 'No visit or meeting is booked.' };
    case 'site_visit_checkin':
      return f.visitedAt
        ? { ok: true, reason: null }
        : { ok: false, reason: 'No visit has happened yet.' };
    case 'payment_reminder':
      /* ⚠️ A payment reminder before anything is agreed reads as pressure from a
         business they have not bought from. The ladder is: approved → won. */
      return f.approvedQuotation || f.stage === 'won'
        ? { ok: true, reason: null }
        : { ok: false, reason: 'Nothing has been agreed to pay for yet.' };
    default:
      return { ok: true, reason: null };
  }
}

/* ── What the engine will actually do, in words ──────────────────────────── */

export interface StopCondition {
  readonly label: string;
  readonly detail: string;
  /** False for the rules that are always on — they are shown, not offered. */
  readonly optional: boolean;
}

/**
 * ⚠️ THESE ARE 170's OWN RULES, NOT A DESCRIPTION OF THEM. Every line here is a
 * branch of `app.crm_sequence_stop_reason`; if that function changes, this list
 * is wrong and its test fails. A dialog that promised a condition the engine
 * does not check would be worse than one that promised nothing.
 */
export function stopConditions(purpose: FollowUpPurpose): readonly StopCondition[] {
  const always: StopCondition[] = [
    { label: 'The lead is closed', detail: 'Won or lost — nothing further is sent.', optional: false },
    { label: 'They asked not to be messaged', detail: 'A stated no stops every plan.', optional: false },
  ];
  if (purpose === 'quotation') {
    always.push({
      label: 'The quotation is no longer live',
      detail: 'Expired, rejected or replaced by a new version.',
      optional: false,
    });
  }
  if (purpose === 'no_response' || purpose === 're_engage' || purpose === 'quotation') {
    always.push({
      label: 'A visit is already booked',
      detail: 'They have agreed to come; chasing them to come stops.',
      optional: false,
    });
  }
  return [
    {
      label: 'Stop on any reply',
      detail: 'The plan pauses the moment the client replies on any channel, so you read it first.',
      optional: true,
    },
    ...always,
  ];
}

/* ── The suggested plan ──────────────────────────────────────────────────── */

const WA = 'whatsapp' as const;

/* A subject line per purpose — only ever used by an email step. */
export function suggestedSubject(purpose: FollowUpPurpose): string {
  return SUBJECT[purpose];
}

const SUBJECT: Record<FollowUpPurpose, string> = {
  quotation: 'Your quotation {{quotation_number}}',
  no_response: 'Following up on your enquiry',
  appointment_reminder: 'Your visit on {{visit_when}}',
  missing_information: 'A couple of quick questions',
  approved_offer: 'Your approved offer {{quotation_number}}',
  payment_reminder: 'A reminder about your payment',
  site_visit_checkin: 'Thank you for visiting us',
  re_engage: 'Are you still looking?',
  custom: 'Following up',
};

/**
 * ⚠️ WRITTEN IN PLACEHOLDERS, FILLED PER SENDER AND PER CLIENT — the same
 * `{{name}}` form as the saved replies in the chat, so one plan reads correctly
 * whoever runs it.
 *
 * ⚠️ AND IT PROMISES NOTHING THE CRM DOES NOT KNOW. No price, no discount, no
 * date that is not already a row — the guardrail that `lib/ai/reply-suggestion.ts`
 * learned the hard way.
 */
export function suggestedPlan(purpose: FollowUpPurpose, delivery: PlanMode = 'review_first'): readonly PlanStep[] {
  /* ⚠️ THE PLAN'S DELIVERY WINS ON A MESSAGE STEP, but a call or a task is
     always a person's — a machine cannot ring somebody. */
  const review: PlanMode = delivery;
  const remind: PlanMode = 'remind_me';
  const subject = SUBJECT[purpose];
  /* ⚠️ THE LITERALS BELOW STAY READABLE. A subject belongs to an email step and
     nothing else, and "only if no reply" is off unless somebody asks for it —
     both are filled in here rather than repeated on twenty objects. */
  type Draft = Omit<PlanStep, 'subject' | 'onlyIfNoReply' | 'template' | 'at'>;
  const finish = (steps: readonly Draft[]): readonly PlanStep[] =>
    /* ⚠️ `at: null` — a suggested plan proposes DAYS, not hours. Null means the
       step inherits the time the plan is running at, which is what every
       sequence did before 207; a person sets an hour only where they want one. */
    steps.map((s) => ({
      ...s,
      subject: s.channel === 'email' ? subject : '',
      onlyIfNoReply: false,
      template: null,
      at: null,
    }));
  return finish(plan());

  function plan(): readonly Draft[] {
  switch (purpose) {
    /* ⚠️ THE OWNER'S OWN THREE STEPS, from the design they sent: a WhatsApp
       check-in, then email — which has no 24-hour window and reaches the desk
       readers and the 44 leads in the Gulf who never answer on WhatsApp. */
    case 'quotation':
      return [
        { day: 1, channel: WA, title: 'WhatsApp check-in', mode: review,
          body: 'AoA {{lead_first_name}}, this is {{my_first_name}} from {{company}}. Did you get a chance to look at quotation {{quotation_number}}? Happy to go through it with you.' },
        { day: 3, channel: 'email', title: 'Email clarification', mode: review,
          body: 'Dear {{lead_first_name}},\n\nFollowing up on quotation {{quotation_number}}. I can explain the payment plan or arrange a site visit, whichever is more useful.\n\nDo let me know if anything on it is unclear.' },
        { day: 7, channel: 'email', title: 'Final check-in', mode: review,
          body: 'Dear {{lead_first_name}},\n\nJust checking whether you would like to keep this enquiry open. If the timing is not right, tell me when to come back to you and I will.' },
      ];
    case 'no_response':
      return [
        { day: 1, channel: WA, title: 'First nudge', mode: review,
          body: 'AoA {{lead_first_name}}, this is {{my_first_name}} from {{company}}. You enquired with us — is this a good time to talk about what you are looking for?' },
        { day: 3, channel: WA, title: 'Second nudge', mode: review,
          body: 'AoA {{lead_first_name}}, just making sure my message reached you. Let me know if you would rather I called instead.' },
        { day: 7, channel: 'call', title: 'WhatsApp call', mode: remind,
          body: 'Call them on WhatsApp from your own phone. If there is no answer, leave it for a fortnight.' },
      ];
    case 'appointment_reminder':
      return [
        { day: 1, channel: WA, title: 'Confirm the visit', mode: review,
          body: 'AoA {{lead_first_name}}, confirming our visit on {{visit_when}}. Please let me know if the time still suits you.' },
        { day: 2, channel: 'call', title: 'Day-before call', mode: remind,
          body: 'WhatsApp call to confirm they are coming, and share directions.' },
      ];
    case 'missing_information':
      return [
        { day: 1, channel: WA, title: 'Ask for the details', mode: review,
          body: 'AoA {{lead_first_name}}, to put the right options in front of you I need a little more detail. May I ask you two quick questions?' },
        { day: 3, channel: 'call', title: 'Ask on a call', mode: remind,
          body: 'WhatsApp call — some people answer on a call what they never answer in writing.' },
      ];
    case 'approved_offer':
      return [
        { day: 1, channel: WA, title: 'Share the approved offer', mode: review,
          body: 'AoA {{lead_first_name}}, I have the approved offer {{quotation_number}} ready for you. Shall I send it across?' },
        { day: 3, channel: 'call', title: 'Talk it through', mode: remind,
          body: 'WhatsApp call to answer whatever is holding the decision up.' },
        { day: 7, channel: WA, title: 'Last check', mode: review,
          body: 'AoA {{lead_first_name}}, just checking where you have got to with the offer. Let me know either way and I will keep the file updated.' },
      ];
    case 'payment_reminder':
      return [
        { day: 1, channel: WA, title: 'Polite reminder', mode: review,
          body: 'AoA {{lead_first_name}}, a gentle reminder about the agreed payment. Let me know if you need anything from our side to complete it.' },
        { day: 4, channel: 'call', title: 'Call about it', mode: remind,
          body: 'WhatsApp call to agree a date rather than repeat the reminder.' },
      ];
    case 'site_visit_checkin':
      return [
        { day: 1, channel: WA, title: 'Thanks for coming', mode: review,
          body: 'AoA {{lead_first_name}}, thank you for visiting us. What did you think? Happy to answer anything that came to mind afterwards.' },
        { day: 3, channel: 'call', title: 'Ask what they thought', mode: remind,
          body: 'WhatsApp call to hear their honest impression and what they want next.' },
      ];
    case 're_engage':
      return [
        { day: 1, channel: WA, title: 'Reconnect', mode: review,
          body: 'AoA {{lead_first_name}}, this is {{my_first_name}} from {{company}}. We spoke a while ago about {{project}}. Are you still looking?' },
        { day: 8, channel: WA, title: 'One more try', mode: review,
          body: 'AoA {{lead_first_name}}, no problem if the timing is wrong — tell me when to come back to you and I will.' },
      ];
    case 'custom':
    default:
      return [
        { day: 1, channel: WA, title: 'Follow-up', mode: review, body: '' },
      ];
  }
  }
}

/* ── Filling the placeholders ────────────────────────────────────────────── */

export function planTokens(f: LeadFacts, visitWhen: string | null): Record<string, string> {
  return {
    lead_first_name: f.leadFirstName || 'Sir/Madam',
    my_first_name: f.myFirstName,
    company: f.company,
    project: f.projectName,
    quotation_number: f.approvedQuotation?.number ?? f.quotation?.number ?? 'the quotation',
    visit_when: visitWhen ?? 'the agreed time',
  };
}

/** ⚠️ An unknown placeholder is left visible rather than printed as nothing. */
export function fillTokens(body: string, values: Record<string, string>): string {
  return body.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (all, key: string) => values[key] ?? all);
}

/* ── Turning a plan into rows ────────────────────────────────────────────── */

export interface StepRow {
  readonly stepNo: number;
  readonly channel: PlanChannel;
  readonly delayDays: number;
  /** `HH:MM` in Karachi, or null to inherit — see `PlanStep.at`. */
  readonly sendAtTime: string | null;
  readonly title: string;
  readonly body: string | null;
  readonly mode: PlanMode;
  readonly subject: string | null;
  readonly onlyIfNoReply: boolean;
  readonly templateName: string | null;
  readonly templateLanguage: string | null;
}

/**
 * Absolute days on screen → the gaps the engine stores.
 * Day 1/3/7 becomes delays 0/2/4: the first falls when the plan starts.
 */
export function stepsToRows(steps: readonly PlanStep[]): readonly StepRow[] {
  let previous = 1;
  return steps.map((s, i) => {
    const delay = Math.max(0, Math.round(s.day - (i === 0 ? 1 : previous)));
    previous = s.day;
    return {
      stepNo: i + 1,
      channel: s.channel,
      delayDays: delay,
      /* ⚠️ VALIDATED HERE, NOT TRUSTED. It reaches SQL as a `time`, where a
         malformed value is a 500 rather than an ignored field. */
      sendAtTime: s.at && /^([01]\d|2[0-3]):[0-5]\d$/.test(s.at) ? s.at : null,
      title: s.title.trim(),
      body: s.body.trim() || null,
      mode: s.mode,
      subject: s.channel === 'email' ? (s.subject.trim() || s.title.trim()) : null,
      onlyIfNoReply: s.onlyIfNoReply,
      templateName: s.channel === 'whatsapp' ? (s.template?.name ?? null) : null,
      templateLanguage: s.channel === 'whatsapp' ? (s.template?.language ?? null) : null,
    };
  });
}

/* ── What a valid plan is ────────────────────────────────────────────────── */

export const MAX_STEPS = 6;
export const MAX_DAY = 90;
export const MAX_TITLE = 60;
export const MAX_BODY = 1500;

/** The first thing wrong with this plan, in the words the dialog shows. */
export function planProblem(steps: readonly PlanStep[]): string | null {
  if (steps.length === 0) return 'A plan needs at least one step.';
  if (steps.length > MAX_STEPS) return `A plan can have at most ${MAX_STEPS} steps.`;
  let previous = 0;
  for (const [i, s] of steps.entries()) {
    const n = i + 1;
    if (!Number.isInteger(s.day) || s.day < 1) return `Step ${n} needs a day of 1 or more.`;
    if (s.day > MAX_DAY) return `Step ${n} is more than ${MAX_DAY} days away.`;
    /* ⚠️ TWO STEPS ON THE SAME DAY IS TWO MESSAGES IN ONE MORNING, and 170's
       one-chase-a-day cap would silently push the second to tomorrow anyway —
       so the plan on screen would not be the plan that ran. */
    if (s.day <= previous) return `Step ${n} must be after step ${i}, not on the same day.`;
    previous = s.day;
    if (!s.title.trim()) return `Step ${n} needs a name.`;
    if (s.title.length > MAX_TITLE) return `Step ${n}'s name is longer than ${MAX_TITLE} characters.`;
    if (s.body.length > MAX_BODY) return `Step ${n}'s message is longer than ${MAX_BODY} characters.`;
    if ((s.channel === 'whatsapp' || s.channel === 'email') && !s.body.trim()) {
      return `Step ${n} sends a message, so it needs one written.`;
    }
    /* ⚠️ AN EMAIL NEEDS ITS OWN SUBJECT. Falling back to the step's internal
       name would put "Gentle reminder" in a client's inbox — the one line they
       decide on before opening anything. */
    if (s.channel === 'email' && !s.subject.trim()) {
      return `Step ${n} is an email, so it needs a subject line.`;
    }
    if (s.subject.length > 160) return `Step ${n}'s subject is longer than 160 characters.`;
  }
  return null;
}

/* ── The lead's facts, read once and used everywhere ─────────────────────── */

/**
 * ⚠️ ONE READING OF THE LEAD, shared by the dialog that writes a plan and the
 * tab that draws it. Two copies would eventually disagree about which quotation
 * is live, and the message on screen would not be the message that was saved.
 *
 * Types only from the query layer — `import type` is erased, so this stays a
 * pure module a browser can run.
 */
export function leadFactsFrom(
  lead: {
    fullName: string | null;
    projectName: string;
    stage: string;
  },
  related: {
    quotations: ReadonlyArray<{ number: string; status: string; netAmount: number }>;
    appointments: ReadonlyArray<{ status: string; scheduledAt: string; kind: string }>;
    sender: { displayName: string | null } | null;
  },
  viewerName: string,
  nowMs: number,
): LeadFacts {
  const live = related.quotations.find((q) => !['superseded', 'rejected', 'expired'].includes(q.status)) ?? null;
  const approved = related.quotations.find((q) => q.status === 'approved') ?? null;
  const upcoming = related.appointments
    .filter((a) => ['scheduled', 'confirmed'].includes(a.status) && Date.parse(a.scheduledAt) >= nowMs)
    .sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt))[0] ?? null;
  const past = related.appointments
    .filter((a) => a.status === 'completed' || Date.parse(a.scheduledAt) < nowMs)
    .sort((a, b) => Date.parse(b.scheduledAt) - Date.parse(a.scheduledAt))[0] ?? null;
  const first = (s: string | null) => (s ?? '').trim().split(/\s+/)[0] ?? '';
  return {
    leadFirstName: first(lead.fullName),
    company: related.sender?.displayName || lead.projectName,
    projectName: lead.projectName,
    myFirstName: first(viewerName) || viewerName,
    stage: lead.stage,
    quotation: live ? { number: live.number, amount: live.netAmount } : null,
    approvedQuotation: approved ? { number: approved.number } : null,
    visit: upcoming ? { at: upcoming.scheduledAt, kind: upcoming.kind } : null,
    visitedAt: past?.scheduledAt ?? null,
    hasInbound: true,
  };
}
