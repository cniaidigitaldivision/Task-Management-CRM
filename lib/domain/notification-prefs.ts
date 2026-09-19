import { NOTIFICATION_KINDS, type NotificationKind } from './constants';

/* ============================================================================
 * NOTIFICATION PREFERENCES — FR-078, doc 08
 * ----------------------------------------------------------------------------
 * ── SOME THINGS CANNOT BE TURNED OFF, AND THE SCREEN SAYS SO ─────────────────
 * A security alert and a task landing on your plate are not preferences. If
 * somebody can silence "you have been assigned this", the assignment still
 * happened and they now have a defensible reason for not knowing — which makes
 * the whole system less trustworthy for everybody else, not just them.
 *
 * The locked set is small on purpose. Everything else is genuinely optional,
 * because a notification feed nobody can quieten becomes wallpaper, and
 * wallpaper is how the important one gets missed.
 *
 * ── IN-APP AND EMAIL ARE SEPARATE ────────────────────────────────────────────
 * They fail differently. In-app is free and arrives when you look; email
 * interrupts and survives being logged out. Most people want the first for
 * everything and the second for very little, and a single on/off makes that
 * impossible to express.
 * ========================================================================= */

export interface ChannelPref {
  readonly inApp: boolean;
  readonly email: boolean;
}

export type NotificationPrefs = Record<NotificationKind, ChannelPref>;

export interface PrefDefinition {
  readonly kind: NotificationKind;
  readonly label: string;
  readonly help: string;
  readonly group: 'your work' | 'reviews' | 'time' | 'the team' | 'security';
  /** Cannot be silenced, and the screen explains why rather than hiding it. */
  readonly locked?: 'inApp' | 'both';
  readonly lockedReason?: string;
}

export const PREF_DEFINITIONS: readonly PrefDefinition[] = [
  {
    kind: 'task_assigned',
    label: 'Work assigned to you',
    help: 'Somebody puts a task on your plate.',
    group: 'your work',
    locked: 'inApp',
    lockedReason:
      'Cannot be turned off in-app. Work arriving on your plate without you knowing helps nobody.',
  },
  {
    kind: 'lead_assigned',
    label: 'A lead given to you',
    help: 'Somebody hands you an enquiry to work — or the system does.',
    group: 'your work',
    /* ⚠️ Locked for the same reason as `task_assigned`, and it matters more: a
       lead is a real person who filled in a form and is waiting for a call.
       Somebody who silenced this would lose leads quietly, and the first sign
       would be a stranger who was never rung. */
    locked: 'inApp',
    lockedReason:
      'Cannot be turned off in-app. A lead is somebody waiting for a call — not knowing you have it helps nobody.',
  },
  {
    kind: 'lead_due',
    label: 'Leads waiting on you',
    help: 'Once each morning, if any of your leads are due or overdue.',
    group: 'your work',
    /* ⚠️ NOT LOCKED, unlike `lead_assigned`. Somebody who works from the desk
       rather than the bell has a real reason to turn this off, and the desk
       shows the same thing without it. Being GIVEN a lead is different: nobody
       else will tell you. */
  },
  {
    kind: 'lead_replied',
    label: 'A lead writes back',
    help: 'Somebody you are working replies on WhatsApp.',
    group: 'your work',
    /* ⚠️ LOCKED IN-APP, like `lead_assigned`, and for a sharper reason than
       either of the others: WhatsApp's free-form window closes 24 hours after
       the customer's last message. Somebody who turned this off would not simply
       reply late — they would lose the ability to reply at all without an
       approved template, and the first sign would be a customer who was ignored
       for a day. Email stays optional; the clock is short enough that the bell
       is the channel that matters. */
    locked: 'inApp',
    lockedReason:
      'Cannot be turned off in-app. WhatsApp only allows a free reply for 24 hours after they write — missing one costs the conversation.',
  },
  {
    kind: 'agent_handover',
    label: 'The assistant needs you',
    help: 'The AI stopped in one of your conversations and says what it could not answer.',
    group: 'your work',
    /* ⚠️ LOCKED IN-APP, for the same reason as a reply: a handover means a client
       asked something the assistant would not answer and is now waiting on a
       person. Nobody else is going to answer them. */
    locked: 'inApp',
    lockedReason:
      'Cannot be turned off in-app. A handover means a client is waiting on you, and nobody else will answer.',
  },
  {
    kind: 'lead_request',
    label: 'Requests from the sales team',
    help: 'For the sales manager: a salesperson asks for an updated quotation or an invoice correction.',
    group: 'the team',
  },
  {
    kind: 'lead_neglected',
    label: 'Leads that have gone quiet',
    help: 'For the sales manager: whose leads have had no call, message or note for several days.',
    group: 'the team',
  },
  {
    kind: 'task_reassigned',
    label: 'Work taken off you',
    help: 'A task you held moves to somebody else.',
    group: 'your work',
  },
  {
    kind: 'task_status_changed',
    label: 'Status changes',
    help: 'Something you are assigned or following moves column.',
    group: 'your work',
  },
  {
    kind: 'task_blocked',
    label: 'Blocked',
    help: 'Work you are on is marked blocked, with the reason.',
    group: 'your work',
  },
  {
    kind: 'task_due_soon',
    label: 'Due soon',
    help: 'A day before something of yours is due.',
    group: 'your work',
  },
  {
    kind: 'task_overdue',
    label: 'Overdue',
    help: 'Something of yours has passed its due date.',
    group: 'your work',
  },
  {
    kind: 'task_comment',
    label: 'Comments',
    help: 'Somebody comments on a task you are assigned or following.',
    group: 'your work',
  },
  {
    kind: 'task_mention',
    label: 'Mentions',
    help: 'Somebody names you in a comment.',
    group: 'your work',
    locked: 'inApp',
    lockedReason:
      'Cannot be turned off in-app. Being named is somebody asking you directly for something.',
  },
  {
    kind: 'review_requested',
    label: 'Review requested',
    help: 'Something is waiting for you to look at it.',
    group: 'reviews',
  },
  {
    kind: 'review_approved',
    label: 'Your work approved',
    help: 'A review you submitted passed.',
    group: 'reviews',
  },
  {
    kind: 'revisions_requested',
    label: 'Revisions requested',
    help: 'Your work came back with changes asked for.',
    group: 'reviews',
    locked: 'inApp',
    lockedReason:
      'Cannot be turned off in-app. Somebody is waiting on a change you do not yet know about.',
  },
  {
    kind: 'time_limit_warning',
    label: 'Approaching a time limit',
    help: 'At 90% of the time budgeted for a task.',
    group: 'time',
  },
  {
    kind: 'time_extension_requested',
    label: 'Extension requested',
    help: 'Somebody has asked an Admin for more time. Admins only.',
    group: 'time',
  },
  {
    kind: 'time_extension_decided',
    label: 'Extension decided',
    help: 'Your request for more time has an answer.',
    group: 'time',
  },
  {
    kind: 'capacity_warning',
    label: 'Capacity warnings',
    help: 'Somebody on the team crosses a threshold. Coordinators and above.',
    group: 'the team',
  },
  {
    kind: 'project_status_changed',
    label: 'Project status',
    help: 'A project you have work in changes status.',
    group: 'the team',
  },
  {
    kind: 'security_alert',
    label: 'Security alerts',
    help: 'A new device signs in, an account locks, a password changes.',
    group: 'security',
    locked: 'both',
    lockedReason:
      'Cannot be turned off at all. An attacker who can silence the alert about their own sign-in has already won, so this one is not a preference.',
  },
];

export const PREF_BY_KIND: ReadonlyMap<NotificationKind, PrefDefinition> = new Map(
  PREF_DEFINITIONS.map((d) => [d.kind, d]),
);

/**
 * Everything on, except email for the noisy ones.
 *
 * A new person should hear about their work without configuring anything, and
 * should not have their inbox filled on day one — an application that emails
 * about every status change gets a mail rule within a week, and then the
 * important messages are filtered too.
 */
const EMAIL_BY_DEFAULT: ReadonlySet<NotificationKind> = new Set<NotificationKind>([
  'task_assigned',
  'lead_assigned',
  'task_mention',
  'revisions_requested',
  'review_requested',
  'task_overdue',
  'time_extension_requested',
  'time_extension_decided',
  'security_alert',
]);

export function defaultPrefs(): NotificationPrefs {
  const prefs = {} as Record<NotificationKind, ChannelPref>;
  for (const kind of NOTIFICATION_KINDS) {
    prefs[kind] = { inApp: true, email: EMAIL_BY_DEFAULT.has(kind) };
  }
  return prefs;
}

/**
 * Stored preferences over the defaults, with the locked ones forced back on.
 *
 * The forcing is here rather than only in the UI. A stored `false` for a locked
 * kind — written before it was locked, or by somebody posting to the action
 * directly — must not be honoured, and the merge is the one place every read
 * passes through.
 */
export function mergePrefs(stored: unknown): NotificationPrefs {
  const prefs = defaultPrefs();
  if (!stored || typeof stored !== 'object') return prefs;

  for (const kind of NOTIFICATION_KINDS) {
    const raw = (stored as Record<string, unknown>)[kind];
    if (!raw || typeof raw !== 'object') continue;

    const value = raw as { inApp?: unknown; email?: unknown };
    prefs[kind] = {
      inApp: typeof value.inApp === 'boolean' ? value.inApp : prefs[kind].inApp,
      email: typeof value.email === 'boolean' ? value.email : prefs[kind].email,
    };
  }

  return applyLocks(prefs);
}

export function applyLocks(prefs: NotificationPrefs): NotificationPrefs {
  const out = { ...prefs };
  for (const definition of PREF_DEFINITIONS) {
    if (!definition.locked) continue;
    out[definition.kind] = {
      inApp: true,
      email: definition.locked === 'both' ? true : out[definition.kind].email,
    };
  }
  return out;
}

/** Should this notification be written at all? */
export function wantsInApp(prefs: NotificationPrefs, kind: NotificationKind): boolean {
  return prefs[kind]?.inApp ?? true;
}

export function wantsEmail(prefs: NotificationPrefs, kind: NotificationKind): boolean {
  return prefs[kind]?.email ?? false;
}

export function isLocked(kind: NotificationKind, channel: 'inApp' | 'email'): boolean {
  const definition = PREF_BY_KIND.get(kind);
  if (!definition?.locked) return false;
  return definition.locked === 'both' || channel === 'inApp';
}
