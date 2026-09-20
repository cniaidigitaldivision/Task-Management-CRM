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
  {
    purpose: 'appointment_reminder',
    words: ['appointment_reminder', 'visit_reminder', 'reminder'],
    because: 'it reminds them about a booked appointment',
  },
  {
    purpose: 'quotation',
    words: ['quotation_follow_up', 'quotation', 'quote', 'proposal'],
    because: 'it follows up a quotation',
  },
  {
    purpose: 'no_response',
    words: ['no_response', 'follow_up', 'followup', 'check_in', 'checkin', 'nudge', 're_engage', 'reengage'],
    avoid: ['quotation', 'quote', 'appointment', 'payment', 'invoice'],
    because: 'it re-opens a conversation that went quiet',
  },
  {
    purpose: 're_engage',
    words: ['re_engage', 'reengage', 'follow_up', 'followup', 'check_in', 'checkin'],
    avoid: ['quotation', 'quote', 'appointment', 'payment', 'invoice'],
    because: 'it re-opens a conversation that went quiet',
  },
  {
    purpose: 'payment_reminder',
    words: ['payment_reminder', 'payment', 'invoice', 'reminder'],
    because: 'it chases a payment',
  },
  {
    purpose: 'site_visit_checkin',
    words: ['visit_checkin', 'after_visit', 'site_visit', 'follow_up'],
    because: 'it follows up after a visit',
  },
  {
    purpose: 'missing_information',
    words: ['missing_information', 'more_information', 'information', 'follow_up'],
    because: 'it asks for something still missing',
  },
  {
    purpose: 'approved_offer',
    words: ['approved_offer', 'offer', 'quotation_follow_up'],
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
  const approved = templates.filter((t) => t.status.toUpperCase() === 'APPROVED');
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

    return { name: best.name, language: best.language, because: intent.because };
  }

  return null;
}
