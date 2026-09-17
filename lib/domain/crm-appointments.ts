/* ============================================================================
 * APPOINTMENTS — a visit, a meeting, a call that is actually in the diary
 * ----------------------------------------------------------------------------
 * Pure: no database, no clock of its own, no framework. The form runs these so
 * nobody is told "no" after filling a panel in, and the server runs the same
 * ones because a rule that lives only in a component is not a rule.
 *
 * ── ⚠️ AN APPOINTMENT IS NOT A NEXT ACTION, AND THE DIFFERENCE MATTERS ─────
 * `next_action_at` is a reminder to the salesperson: *I should ring them
 * Tuesday.* An appointment is a promise made to somebody else: *they are coming
 * to the site at 4pm and someone has to be there.* Only one of those has a
 * second person's afternoon in it, which is why this has a duration, a place, an
 * owner and an outcome, and the other is a sentence and a date.
 *
 * ── ⚠️ AND IT IS WHAT MAKES "SITE VISITS BOOKED · 4 OF 6" A REAL FIGURE ────
 * That tile has been a drawing since the first design. Phase F counts these.
 * ========================================================================= */

export const APPOINTMENT_KINDS = ['site_visit', 'meeting', 'call'] as const;
export type AppointmentKind = (typeof APPOINTMENT_KINDS)[number];

/** Meta's word for it, and the DB enum's. */
export const APPOINTMENT_STATUSES = [
  'scheduled',
  'confirmed',
  'completed',
  'no_show',
  'cancelled',
  'rescheduled',
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

const KIND_LABEL: Record<AppointmentKind, string> = {
  site_visit: 'Site visit',
  meeting: 'Meeting',
  call: 'Call',
};

const STATUS_LABEL: Record<string, string> = {
  scheduled: 'Scheduled',
  confirmed: 'Confirmed',
  completed: 'Completed',
  no_show: 'Did not turn up',
  cancelled: 'Cancelled',
  rescheduled: 'Rescheduled',
};

const STATUS_TOKEN: Record<string, string> = {
  scheduled: 'accent-primary',
  confirmed: 'feedback-success',
  completed: 'feedback-success',
  no_show: 'feedback-error',
  cancelled: 'neutral-500',
  rescheduled: 'gold-700',
};

export function appointmentKindLabel(kind: string): string {
  return KIND_LABEL[kind as AppointmentKind] ?? kind;
}

export function appointmentStatusLabel(status: string): string {
  /* ⚠️ An unrecognised status shows ITSELF rather than "Unknown" — a value added
     to the enum and forgotten here should look odd on screen, not vanish into a
     word that conceals which one it was. Same rule as `stageLabel`. */
  return STATUS_LABEL[status] ?? status;
}

export function appointmentStatusToken(status: string): string {
  return STATUS_TOKEN[status] ?? 'neutral-500';
}

export function isAppointmentKind(value: string): value is AppointmentKind {
  return (APPOINTMENT_KINDS as readonly string[]).includes(value);
}

/** Statuses that mean it is over, one way or another. */
export function isClosedAppointment(status: string): boolean {
  return status === 'completed' || status === 'no_show' || status === 'cancelled';
}

/* ============================================================================
 * THE THREE QUESTIONS THE APPOINTMENTS SCREEN ANSWERS
 * ----------------------------------------------------------------------------
 * ⚠️ HERE RATHER THAN IN THE COMPONENT, and that is not tidiness. Which bucket a
 * row lands in is the whole meaning of that screen, and a rule living inside a
 * `useMemo` can only be tested by rendering the component and then CLICKING the
 * tab it puts the answer behind — which `renderToStaticMarkup` cannot do. The
 * first version of this lived in the component and its test could assert nothing
 * about two of the three buckets.
 *
 * ⚠️ AND THE ORDERS DIFFER ON PURPOSE. `owed` runs oldest-first, because the
 * visit from last Tuesday that nobody wrote up is more urgent than yesterday's.
 * Everything else runs soonest-first, where the nearest thing is what matters.
 * ========================================================================= */

export interface Bucketable {
  readonly status: string;
  readonly scheduledAt: string;
}

export interface AppointmentBuckets<T extends Bucketable> {
  /** Already happened, still open — somebody owes a write-up. */
  readonly owed: readonly T[];
  /** Still ahead, still open. */
  readonly upcoming: readonly T[];
  /** Over: completed, no-show, cancelled or superseded by a reschedule. */
  readonly done: readonly T[];
}

export function bucketAppointments<T extends Bucketable>(
  rows: readonly T[],
  nowMs: number,
): AppointmentBuckets<T> {
  const owed: T[] = [];
  const upcoming: T[] = [];
  const done: T[] = [];

  for (const a of rows) {
    /* ⚠️ `rescheduled` COUNTS AS DONE even though it is not in
       `isClosedAppointment` — that helper answers "did this reach an outcome",
       which a reschedule did not. For this screen the row has been replaced and
       showing it as still owed would ask somebody to write up a visit that was
       moved. Two different questions, deliberately not one function. */
    if (isClosedAppointment(a.status) || a.status === 'rescheduled') done.push(a);
    else if (Date.parse(a.scheduledAt) < nowMs) owed.push(a);
    else upcoming.push(a);
  }

  const by = (dir: 1 | -1) => (a: T, b: T) =>
    dir * (Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt));

  owed.sort(by(1));
  upcoming.sort(by(1));
  done.sort(by(-1));

  return { owed, upcoming, done };
}

/**
 * Which tab the screen should open on.
 *
 * ⚠️ WHATEVER IS ACTIONABLE, and computed once on mount rather than on every
 * render — a tab that reshuffles itself under somebody who has just recorded the
 * last owed visit is the drawer bug (91153e4) again.
 *
 * ⚠️ AND AN EMPTY *Upcoming* BEATS AN EMPTY *Needs recording*. Both are empty,
 * but one is empty because there is nothing to do and the other because the
 * diary is — and only the second has a useful sentence to show somebody.
 */
export function openingTab(buckets: AppointmentBuckets<Bucketable>): 'owed' | 'upcoming' {
  return buckets.owed.length > 0 ? 'owed' : 'upcoming';
}

/** The DB constraint's range, restated so the form can refuse before the write. */
export const MIN_MINUTES = 5;
export const MAX_MINUTES = 600;

export interface NewAppointment {
  readonly kind: string;
  /** ISO. The moment it starts. */
  readonly scheduledAt: string | null;
  readonly durationMinutes: number;
  readonly location: string;
  readonly note: string;
}

/**
 * What the write path must refuse. Sentences, not a boolean — each names the
 * field and says why, the same stance `outcomeProblems` takes.
 *
 * `nowMs` is passed in rather than read here, so the rules stay pure and a test
 * can sit at any moment it likes.
 */
export function appointmentProblems(input: NewAppointment, nowMs: number): string[] {
  const problems: string[] = [];

  if (!isAppointmentKind(input.kind)) {
    problems.push('Choose what kind of appointment this is.');
  }

  if (!input.scheduledAt) {
    problems.push('Choose the date and time. An appointment without one is a hope, not a booking.');
  } else {
    const at = Date.parse(input.scheduledAt);
    if (Number.isNaN(at)) {
      problems.push('That date could not be read.');
    } else if (at < nowMs - 60_000) {
      /* ⚠️ A MINUTE OF SLACK, deliberately. Somebody booking "now" spends a few
         seconds on the form, and refusing them for being four seconds in the
         past is a rule that is technically right and useless. */
      problems.push(
        'That time has already passed. To record a visit that already happened, mark it complete instead.',
      );
    }
  }

  if (!Number.isFinite(input.durationMinutes)) {
    problems.push('How long should it last?');
  } else if (input.durationMinutes < MIN_MINUTES || input.durationMinutes > MAX_MINUTES) {
    problems.push(`Length should be between ${MIN_MINUTES} minutes and ${MAX_MINUTES / 60} hours.`);
  }

  /* ⚠️ A SITE VISIT NEEDS A PLACE, the others do not. Somebody is driving
     somewhere: "site visit, Tuesday 4pm" with no location is a booking the
     salesperson cannot act on and the client cannot be told about. A call has no
     place to be, and a meeting's location is often "the office" and obvious. */
  if (input.kind === 'site_visit' && !input.location.trim()) {
    problems.push('Say where. A site visit with no place is one nobody can turn up to.');
  }

  if (input.location.trim().length > 200) {
    problems.push('Keep the location under 200 characters.');
  }

  return problems;
}

/**
 * Does this clash with something already in the owner's diary?
 *
 * ⚠️ A WARNING, NEVER A REFUSAL, and that is a judgement worth stating. Two
 * bookings can legitimately overlap — a colleague covers one, a site visit runs
 * next door to the last, a client asks for the same slot and the salesperson
 * intends to move the other. Refusing would make the system wrong more often
 * than the person. But an unnoticed double-booking means somebody is stood up,
 * so it is said out loud and then allowed.
 *
 * ⚠️ AND IT COMPARES SPANS, NOT START TIMES. Two visits starting an hour apart
 * do not clash; a two-hour visit starting an hour before one does.
 */
export function clashesWith(
  candidate: { startMs: number; minutes: number },
  existing: ReadonlyArray<{ startMs: number; minutes: number; status: string }>,
): boolean {
  const aStart = candidate.startMs;
  const aEnd = aStart + candidate.minutes * 60_000;

  return existing.some((b) => {
    /* Something cancelled or already finished is not in the way. */
    if (isClosedAppointment(b.status)) return false;
    const bStart = b.startMs;
    const bEnd = bStart + b.minutes * 60_000;
    return aStart < bEnd && bStart < aEnd;
  });
}
