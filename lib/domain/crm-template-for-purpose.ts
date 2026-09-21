/* ============================================================================
 * WHICH TEMPLATE A FOLLOW-UP ALREADY IMPLIES
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-20:
 *
 *   *"Why should I choose the template at the time of creating the follow-up?
 *   It should auto-select… most of the time, even when I am trying or I'm
 *   testing, I forget to choose the template. When a salesperson is busy with a
 *   lot of other things, how can he remember? It's understood that after the
 *   24-hour window closes, we need a template."*
 *
 * They are right, and the cost of forgetting is not a warning — it is a step
 * that sits in the queue and never sends, discovered days later when the client
 * has gone quiet. The purpose already says what the message is for; the template
 * is a consequence of that, not a separate decision.
 *
 * ── ⚠️ CHOSEN, NEVER FORCED ────────────────────────────────────────────────
 * This picks a default for a field the salesperson can still change, including
 * back to "no template". It is the difference between a form that knows its own
 * job and a form that makes a decision on somebody's behalf and hides it — which
 * is why the wizard says, in words, which template it chose and why.
 *
 * ── ⚠️ APPROVED ONLY, AND MATCHED ON META'S OWN NAMES ──────────────────────
 * A PENDING template is refused at send time (132001), so offering one as the
 * default would hand back the same silent failure in a new costume. And the
 * names are matched loosely — `appointment_reminder`, `appointment_reminder_v2`
 * and `cni_appointment_reminder` are the same intent — because Meta renames
 * templates on approval and the owner creates new versions by hand.
 * ========================================================================= */

/**
 * What a template chosen in the wizard may ask for, in order.
 *
 * ⚠️ ONE CONVENTION, SO EVERY TEMPLATE IS WRITTEN THE SAME WAY: {{1}} is the
 * client's first name, {{2}} is the business name — the shape of the approved
 * greeting. The follow-up stores these token NAMES (228) and the sender resolves
 * them when it sends. A template asking for more — the five-blank appointment
 * ones, which the booking flow fills itself — cannot be filled from here, so
 * it is never offered: choosing it would be refused by Meta exactly as the
 * 09:30 reminder was on 2026-09-21.
 */
export const TEMPLATE_FILL = ['lead_first_name', 'company'] as const;

/** The token names a template with this many blanks is filled with. */
export function templateVarsFor(variables: number | undefined): string[] {
  const n = Math.max(0, Math.min(TEMPLATE_FILL.length, Math.round(variables ?? 0)));
  return TEMPLATE_FILL.slice(0, n);
}

/** Whether the wizard can fill every blank this template has. */
export function fillable(t: { readonly variables: number }): boolean {
  return t.variables <= TEMPLATE_FILL.length;
}

export interface ApprovedTemplate {
  readonly name: string;
  readonly language: string;
  readonly status: string;
  readonly variables: number;
  readonly buttons?: readonly string[];
}

export interface TemplateChoice {
  readonly name: string;
  readonly language: string;
  /** How many blanks it has — filled from TEMPLATE_FILL. */
  readonly variables: number;
  /** Why this one — shown to the salesperson, never guessed at silently. */
  readonly because: string;
}

/**
 * The words that identify each intent, best first.
 *
 * ⚠️ ORDER IS THE RULE. `appointment_confirmed` and `appointment_reminder` both
 * contain "appointment", so the more specific word has to win — otherwise a
 * reminder goes out reading "your visit is confirmed".
 */
/*
 * ⚠️ `quotation_follow_up` IS DELIBERATELY ABSENT FROM `no_response` AND
 * `re_engage`. Its approved text names a quotation — "regarding the quotation we
 * shared with you" — so a lead who went quiet before any quotation existed would
 * be sent a message about a document they never received. It is the nearest
 * match by name and the wrong thing to say, which is the one case where
 * returning nothing is better: the wizard says so, and a template that fits can
 * be approved once and used for ever.
 */
const INTENTS: ReadonlyArray<{
  purpose: string;
  words: readonly string[];
  /*
   * ⚠️ AND THE WORDS ALONE CANNOT EXPRESS IT. Dropping
   * `quotation_follow_up` from the list below changed nothing, because its name
   * CONTAINS `follow_up` — the test went on passing while the rule it described
   * was not in force. A name carrying any of these is refused outright.
   */
  avoid?: readonly string[];
  because: string;
}> = [
  /* ⚠️ EVERY INTENT NAMES WHAT IT MUST NOT TOUCH. Measured against the live
     account on 2026-09-21, the first version sent a PAYMENT reminder as the
     appointment reminder ("your site visit is…", because both names contain
     "reminder"), and a missing-information request and a visit check-in as the
     quotation follow-up ("regarding the quotation we shared with you", because
     its name contains "follow_up"). A loose word finds the nearest template;
     the avoid list is what stops the nearest one being about something else. */
  {
    purpose: 'appointment_reminder',
    words: ['appointment_reminder', 'visit_reminder', 'reminder'],
    avoid: ['payment', 'invoice', 'quotation', 'confirmed'],
    because: 'it reminds them about a booked appointment',
  },
  {
    purpose: 'quotation',
    words: ['quotation_follow_up', 'quotation', 'quote', 'proposal'],
    avoid: ['appointment', 'payment', 'invoice'],
    because: 'it follows up a quotation',
  },
  {
    purpose: 'no_response',
    words: ['no_response', 'follow_up', 'followup', 'check_in', 'checkin', 'nudge', 're_engage', 'reengage'],
    /* 'visit' and 'demo' too: after_visit_check_in contains "check_in" and sorts
       first, and a lead who never came would be thanked for their time with us. */
    avoid: ['quotation', 'quote', 'appointment', 'payment', 'invoice', 'visit', 'demo'],
    because: 'it re-opens a conversation that went quiet',
  },
  {
    purpose: 're_engage',
    words: ['re_engage', 'reengage', 'follow_up', 'followup', 'check_in', 'checkin'],
    avoid: ['quotation', 'quote', 'appointment', 'payment', 'invoice', 'visit', 'demo'],
    because: 'it re-opens a conversation that went quiet',
  },
  {
    purpose: 'payment_reminder',
    words: ['payment_reminder', 'payment', 'invoice', 'instalment', 'installment'],
    avoid: ['appointment', 'visit', 'quotation'],
    because: 'it chases a payment',
  },
  {
    purpose: 'site_visit_checkin',
    words: ['visit_checkin', 'after_visit', 'post_visit', 'site_visit'],
    avoid: ['quotation', 'reminder', 'confirmed', 'payment'],
    because: 'it follows up after a visit',
  },
  {
    purpose: 'missing_information',
    words: ['missing_information', 'more_information', 'information', 'details'],
    avoid: ['quotation', 'appointment', 'payment', 'invoice', 'visit', 'demo'],
    because: 'it asks for something still missing',
  },
  {
    purpose: 'approved_offer',
    words: ['approved_offer', 'offer', 'quotation_follow_up'],
    avoid: ['appointment', 'payment', 'invoice'],
    because: 'it carries an approved offer',
  },
];

/** A template name matches a word if the word appears in it, ignoring shape. */
function matches(name: string, word: string): boolean {
  const flat = name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  return flat.includes(word);
}

/**
 * The template to select for a follow-up of this purpose, or null when none of
 * the approved templates is a reasonable fit.
 *
 * ⚠️ NULL IS AN ANSWER, NOT A FAILURE. A business with two approved templates
 * has nothing sensible to offer a `payment_reminder`, and quietly attaching the
 * nearest one would send a client a message about the wrong thing. The wizard
 * says so instead.
 */
export function templateForPurpose(
  purpose: string,
  templates: ReadonlyArray<ApprovedTemplate>,
  /** Prefer this language when a template exists in several. */
  preferLanguage = 'en_GB',
): TemplateChoice | null {
  /* ⚠️ APPROVED, AND FILLABLE. A template whose blanks the wizard cannot fill
     is refused by Meta whatever it says — see TEMPLATE_FILL. */
  const approved = templates.filter((t) => t.status.toUpperCase() === 'APPROVED' && fillable(t));
  if (approved.length === 0) return null;

  const intent = INTENTS.find((i) => i.purpose === purpose);
  if (!intent) return null;

  const allowed = intent.avoid
    ? approved.filter((t) => !intent.avoid!.some((bad) => matches(t.name, bad)))
    : approved;

  for (const word of intent.words) {
    const hits = allowed.filter((t) => matches(t.name, word));
    if (hits.length === 0) continue;

    /* ⚠️ THE ONE WHOSE BLANKS WE CAN ACTUALLY FILL. A template with more
       variables is not better — an unfilled parameter is refused outright
       (#131008) and the whole message is dropped. Fewest blanks wins, then the
       preferred language, then the name, so the choice is stable rather than
       whatever order Meta happened to return. */
    const best = [...hits].sort((a, b) => {
      if (a.variables !== b.variables) return a.variables - b.variables;
      const al = a.language === preferLanguage ? 0 : 1;
      const bl = b.language === preferLanguage ? 0 : 1;
      if (al !== bl) return al - bl;
      return a.name.localeCompare(b.name);
    })[0];

    return { name: best.name, language: best.language, variables: best.variables, because: intent.because };
  }

  return null;
}

/**
 * Fill every WhatsApp auto-send step that has no template yet.
 *
 * ⚠️ THIS LIVES HERE, NOT IN THE "CHANNEL & MESSAGE" STEP, BECAUSE THAT IS
 * WHERE IT FAILED. Owner, 2026-09-21, on a follow-up saved with no template
 * although auto-selection existed: the list comes from Meta and took seconds on
 * the dev server, and the only code that applied it lived in a component that
 * exists on ONE stage. Clicking Next before the list arrived unmounted it, the
 * list landed nowhere, and nothing was ever chosen. The wizard now owns the
 * list and applies this on every render, and Save applies it once more.
 *
 * ⚠️ `cleared` IS THE PERSON SAYING NO. A step whose template was cleared on
 * purpose ("No template — only send inside the 24-hour window") is never
 * refilled behind their back.
 *
 * Returns the SAME array when nothing changes, so it can run during render
 * without looping.
 */
export function fillTemplates<S extends {
  readonly channel: string;
  readonly mode: string;
  readonly template: { readonly name: string; readonly language: string; readonly variables?: number } | null;
}>(
  steps: readonly S[],
  purpose: string,
  templates: ReadonlyArray<ApprovedTemplate>,
  cleared: ReadonlySet<number>,
): readonly S[] {
  const pick = templateForPurpose(purpose, templates);
  if (!pick) return steps;
  let changed = false;
  const next = steps.map((s, i) => {
    if (s.channel !== 'whatsapp' || s.mode !== 'auto_send' || s.template || cleared.has(i)) return s;
    changed = true;
    return { ...s, template: { name: pick.name, language: pick.language, variables: pick.variables } };
  });
  return changed ? next : steps;
}
