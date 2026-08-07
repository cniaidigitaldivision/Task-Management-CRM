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
