/* ============================================================================
 * CNI CRM — CANONICAL CONSTANTS
 * ----------------------------------------------------------------------------
 * THE single source of truth for every enum and numeric constant.
 * Derived from: docs/19-MASTER-SPECIFICATION-REGISTRY.md §4 and §5
 *
 * ⛔ RULES
 *    1. If a value appears both here and elsewhere, the other one is a bug.
 *    2. This file is LAYER 2 (Domain) — it imports nothing. Not the database,
 *       not the framework, not React. See docs/20-IMPLEMENTATION-CONTRACTS.md §1.
 *    3. Colours live in styles/tokens.css, never here. This file names the
 *       token; it never holds a hex value. (BR-025)
 * ========================================================================= */

/* ==========================================================================
 * IDENTITY
 * ========================================================================== */

/** The four roles. ADR-002. There is deliberately no in-app path to create a
 *  super_admin — see docs/16 §2. */
export const ROLES = ['super_admin', 'admin', 'team_coordinator', 'member'] as const;
export type Role = (typeof ROLES)[number];

/** Ordered most- to least-privileged. Used for "at least this role" checks. */
export const ROLE_RANK: Readonly<Record<Role, number>> = {
  super_admin: 4,
  admin: 3,
  team_coordinator: 2,
  member: 1,
} as const;

export const ROLE_LABEL: Readonly<Record<Role, string>> = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  team_coordinator: 'Team Coordinator',
  member: 'Team Member',
} as const;

/** Roles for which MFA is mandatory and cannot be skipped. FR-145. */
export const MFA_REQUIRED_ROLES: readonly Role[] = ['super_admin', 'admin'] as const;

/** Roles that must clear a second factor after the emailed code during a
 *  password reset. FR-155b — stops a compromised mailbox being sufficient. */
export const PRIVILEGED_RESET_ROLES: readonly Role[] = ['super_admin', 'admin'] as const;

/** Roles permitted to approve a time extension. FR-184, BR-018.
 *  Coordinators set limits but never extend them. */
export const EXTENSION_APPROVER_ROLES: readonly Role[] = ['super_admin', 'admin'] as const;

/** Roles permitted to override a hard capacity block. BR-003. */
export const CAPACITY_OVERRIDE_ROLES: readonly Role[] = ['super_admin', 'admin'] as const;

export const ACCOUNT_STATES = [
  'pending_activation',
  'active',
  'password_reset_required',
  'mfa_setup_required',
  'locked',
  'suspended',
  'deactivated',
] as const;
export type AccountState = (typeof ACCOUNT_STATES)[number];

/** Only `active` may reach the application. Everything else is redirected to a
 *  single remediation screen. FR-006. */
export const SIGNED_IN_ACCOUNT_STATE: AccountState = 'active';

export const AUTH_PROVIDERS = ['password', 'google', 'microsoft'] as const;
export type AuthProvider = (typeof AUTH_PROVIDERS)[number];

export const MFA_TYPES = ['totp', 'webauthn', 'recovery_codes'] as const;
export type MfaType = (typeof MFA_TYPES)[number];

/* ==========================================================================
 * TASK LIFECYCLE — doc 05
 * ========================================================================== */

export const TASK_STATUSES = [
  'backlog',
  'todo',
  'in_progress',
  'blocked',
  'in_review',
  'revisions',
  'done',
  'cancelled',
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const STATUS_CATEGORIES = [
  'not_started',
  'active',
  'waiting',
  'done',
  'cancelled',
] as const;
export type StatusCategory = (typeof STATUS_CATEGORIES)[number];

export interface StatusMeta {
  readonly slug: TaskStatus;
  readonly label: string;
  readonly category: StatusCategory;
  /** Multiplier applied to a task's load while it sits in this status.
   *  Backlog counts at 25% (real but not imminent); In Review at 50% (out of
   *  the member's hands, but it may come back). doc 05 §1. */
  readonly loadWeight: number;
  /** Tailwind colour fragment — resolves to a token in styles/tokens.css.
   *  Never a hex value. BR-025. */
  readonly token: string;
  /** Timer accrues while the task sits in this status. FR-174. */
  readonly timerRuns: boolean;
  readonly sortOrder: number;
}

export const STATUS_META: Readonly<Record<TaskStatus, StatusMeta>> = {
  backlog: {
    slug: 'backlog',
    label: 'Backlog',
    category: 'not_started',
    loadWeight: 0.25,
    token: 'status-backlog',
    timerRuns: false,
    sortOrder: 1,
  },
  todo: {
    slug: 'todo',
    label: 'To Do',
    category: 'not_started',
    loadWeight: 1,
    token: 'status-todo',
    timerRuns: false,
    sortOrder: 2,
  },
  in_progress: {
    slug: 'in_progress',
    label: 'In Progress',
    category: 'active',
    loadWeight: 1,
    token: 'status-progress',
    timerRuns: true,
    sortOrder: 3,
  },
  blocked: {
    slug: 'blocked',
    label: 'Blocked',
    category: 'waiting',
    loadWeight: 1,
    token: 'status-blocked',
    timerRuns: false,
    sortOrder: 4,
  },
  in_review: {
    slug: 'in_review',
    label: 'In Review',
    category: 'waiting',
    loadWeight: 0.5,
    token: 'status-review',
    timerRuns: false,
    sortOrder: 5,
  },
  revisions: {
    slug: 'revisions',
    label: 'Revisions',
    category: 'active',
    loadWeight: 1,
    token: 'status-revisions',
    timerRuns: true,
    sortOrder: 6,
  },
  done: {
    slug: 'done',
    label: 'Done',
    category: 'done',
    loadWeight: 0,
    token: 'status-done',
    timerRuns: false,
    sortOrder: 7,
  },
  cancelled: {
    slug: 'cancelled',
    label: 'Cancelled',
    category: 'cancelled',
    loadWeight: 0,
    token: 'status-cancelled',
    timerRuns: false,
    sortOrder: 8,
  },
} as const;

/** Statuses requiring a mandatory written reason to enter. FR-043. */
export const STATUS_REQUIRES_REASON: readonly TaskStatus[] = ['blocked', 'cancelled'] as const;

/** Leaving this status requires reviewer authority — a member can never
 *  approve their own work. BR-002. */
export const STATUS_REQUIRES_APPROVAL_TO_EXIT: readonly TaskStatus[] = ['in_review'] as const;

/* ==========================================================================
 * PRIORITY & EFFORT — doc 05 §4, §5
 * ========================================================================== */

export const PRIORITIES = ['urgent', 'high', 'medium', 'low'] as const;
export type Priority = (typeof PRIORITIES)[number];

/* ============================================================================
 * WHAT A TASK PRODUCES — migration 033's `content_kind`
 * ----------------------------------------------------------------------------
 * ⚠️ ORDER AND MEMBERSHIP MIRROR `public.content_kind`. Add a value here and it
 * must be added to the enum in the same commit, or the form will offer something
 * the database refuses.
 *
 * This is the field that makes a task COUNTABLE. A task without a content kind is
 * work that happened; a task with one is a deliverable that can be measured
 * against what the package promised. `static`, `reel` and `carousel` are the
 * three the packages actually name (STARTER: "static posts, reels and carousel
 * content mix"); the rest exist so non-content work is not forced to lie.
 * ========================================================================= */
export const CONTENT_KINDS = [
  'static',
  'reel',
  'carousel',
  'story',
  'video',
  'website',
  'ad',
  'report',
  'other',
] as const;
export type ContentKind = (typeof CONTENT_KINDS)[number];

export const CONTENT_KIND_LABEL: Readonly<Record<ContentKind, string>> = {
  static: 'Static post',
  reel: 'Reel / short video',
  carousel: 'Carousel',
  story: 'Story',
  video: 'Long video',
  website: 'Website work',
  ad: 'Ad creative',
  report: 'Report',
  other: 'Other',
};

/** The kinds that count toward a package's monthly asset target. Website work
 *  and internal reports are real work but were never part of "14–16 assets". */
export const COUNTS_AS_ASSET: readonly ContentKind[] = [
  'static',
  'reel',
  'carousel',
  'story',
  'video',
];

export const PRIORITY_LABEL: Readonly<Record<Priority, string>> = {
  urgent: 'Urgent',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
} as const;

/** Priority multiplies a task's capacity cost — urgent work genuinely consumes
 *  more of a person's attention. It is not merely a sort key. doc 05 §4. */
export const PRIORITY_WEIGHT: Readonly<Record<Priority, number>> = {
  urgent: 1.5,
  high: 1.25,
  medium: 1.0,
  low: 0.75,
} as const;

export const PRIORITY_TOKEN: Readonly<Record<Priority, string>> = {
  urgent: 'priority-urgent',
  high: 'priority-high',
  medium: 'priority-medium',
  low: 'priority-low',
} as const;

export const EFFORT_SIZES = ['XS', 'S', 'M', 'L', 'XL'] as const;
export type EffortSize = (typeof EFFORT_SIZES)[number];

/** One capacity point ≈ one working hour. doc 05 §5. */
export const EFFORT_POINTS: Readonly<Record<EffortSize, number>> = {
  XS: 1,
  S: 2,
  M: 4,
  L: 8,
  XL: 16,
} as const;

export const EFFORT_LABEL: Readonly<Record<EffortSize, string>> = {
  XS: 'Under an hour',
  S: 'Half a day',
  M: 'A full day',
  L: 'Two to three days',
  XL: 'A week — consider splitting',
} as const;

/** Anything at or above this prompts a split-into-subtasks suggestion. */
export const EFFORT_SPLIT_SUGGESTION_POINTS = EFFORT_POINTS.XL;

/* ==========================================================================
 * PROJECTS — doc 15
 * ========================================================================== */

export const PROJECT_TYPES = [
  'event',
  'client',
  'business',
  'self_promotion',
  'other',
] as const;
export type ProjectType = (typeof PROJECT_TYPES)[number];

export interface ProjectTypeMeta {
  readonly slug: ProjectType;
  readonly label: string;
  /** Reference prefix — makes a task ID self-describing in conversation.
   *  FR-113. Saying "OTH-205 is blocking me" says it is uncategorised work. */
  readonly code: string;
  readonly token: string;
  readonly icon: string;
  /** Order in which this type's work is shed when someone is overloaded.
   *  Lower = protected for longer. Client work is protected first, ad-hoc
   *  favours are dropped first. FR-118, Q-027. */
  readonly shedPriority: number;
}

export const PROJECT_TYPE_META: Readonly<Record<ProjectType, ProjectTypeMeta>> = {
  client: {
    slug: 'client',
    label: 'Client',
    code: 'CLI',
    token: 'project-client',
    icon: 'handshake',
    shedPriority: 1,
  },
  event: {
    slug: 'event',
    label: 'Event',
    code: 'EVT',
    token: 'project-event',
    icon: 'tent',
    shedPriority: 2,
  },
  business: {
    slug: 'business',
    label: 'Business',
    code: 'BIZ',
    token: 'project-business',
    icon: 'building',
    shedPriority: 3,
  },
  self_promotion: {
    slug: 'self_promotion',
    label: 'Self-Promotion',
    code: 'PRM',
    token: 'project-promo',
    icon: 'megaphone',
    shedPriority: 4,
  },
  other: {
    slug: 'other',
    label: 'Other',
    code: 'OTH',
    token: 'project-other',
    icon: 'package',
    shedPriority: 5,
  },
} as const;

/** Tasks in a project of this type require a written explanation of the work.
 *  BR-012 — this is what makes ad-hoc work visible instead of invisible. */
export const PROJECT_TYPE_REQUIRES_DESCRIPTION: readonly ProjectType[] = ['other'] as const;

export const PROJECT_STATUSES = [
  'planning',
  'active',
  'on_hold',
  'completed',
  'archived',
  'cancelled',
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

/** Entering these requires a written reason. */
export const PROJECT_STATUS_REQUIRES_REASON: readonly ProjectStatus[] = [
  'on_hold',
  'cancelled',
] as const;

/* ==========================================================================
 * TIMERS & TIME LIMITS — doc 17
 * ========================================================================== */

export const TIMER_STATES = ['not_started', 'running', 'paused', 'stopped'] as const;
export type TimerState = (typeof TIMER_STATES)[number];

export const TIMER_PAUSE_REASONS = [
  'status_change',
  'outside_hours',
  'leave',
  'idle',
  'manual',
] as const;
export type TimerPauseReason = (typeof TIMER_PAUSE_REASONS)[number];

export const TIME_ENTRY_SOURCES = ['timer', 'manual', 'adjustment'] as const;
export type TimeEntrySource = (typeof TIME_ENTRY_SOURCES)[number];

/** Manual sources always require a reason and are always visibly flagged.
 *  BR-020 — a timer everyone quietly edits is worse than no timer. */
export const TIME_SOURCE_REQUIRES_REASON: readonly TimeEntrySource[] = [
  'manual',
  'adjustment',
] as const;

export const EXTENSION_STATUSES = [
  'pending',
  'approved',
  'partially_approved',
  'declined',
  'cancelled',
] as const;
export type ExtensionStatus = (typeof EXTENSION_STATUSES)[number];

/** Default conversion from effort estimate to time limit. FR-171. */
export const MINUTES_PER_EFFORT_POINT = 60;

/** Percentages of the limit at which the member is reminded. FR-180.
 *  Deliberately silent below 75% — a reminder that fires constantly is noise. */
export const TIME_LIMIT_WARNING_THRESHOLDS: readonly number[] = [
  50, 75, 90, 100, 120, 150,
] as const;

/** What happens at 100%. ADR-010, Q-041.
 *  A hard lock cannot stop someone mid-render — it only pushes the work off
 *  the books and destroys the data this feature exists to collect. */
export const OVER_LIMIT_BEHAVIOURS = [
  'enforced_stop_and_account',
  'hard_stop',
  'soft_warning',
] as const;
export type OverLimitBehaviour = (typeof OVER_LIMIT_BEHAVIOURS)[number];

/* ==========================================================================
 * WORKLOAD — doc 06
 * ========================================================================== */

export const WORKLOAD_BANDS = ['available', 'healthy', 'warning', 'over'] as const;
export type WorkloadBand = (typeof WORKLOAD_BANDS)[number];

export interface WorkloadBandMeta {
  readonly slug: WorkloadBand;
  readonly label: string;
  readonly token: string;
  readonly minPct: number;
  readonly maxPct: number | null;
}

/** NFR-008: every band carries a text label. Colour alone is never the signal. */
export const WORKLOAD_BAND_META: Readonly<Record<WorkloadBand, WorkloadBandMeta>> = {
  available: {
    slug: 'available',
    label: 'Available',
    token: 'load-available',
    minPct: 0,
    maxPct: 60,
  },
  healthy: { slug: 'healthy', label: 'Healthy', token: 'load-healthy', minPct: 60, maxPct: 85 },
  warning: {
    slug: 'warning',
    label: 'Near limit',
    token: 'load-warning',
    minPct: 85,
    maxPct: 100,
  },
  over: { slug: 'over', label: 'Over limit', token: 'load-over', minPct: 100, maxPct: null },
} as const;

export const WORKLOAD_WINDOWS = ['day', 'week', 'fortnight'] as const;
export type WorkloadWindow = (typeof WORKLOAD_WINDOWS)[number];

/* ==========================================================================
 * ASSIGNMENT SCORING — doc 07 §3
 * ========================================================================== */

export interface ScoreWeights {
  readonly skill: number;
  readonly availability: number;
  readonly deadlineFit: number;
  readonly fairness: number;
  readonly performance: number;
  readonly projectFamiliarity: number;
}

/** ⚠️ These MUST sum to exactly 1.00.
 *
 *  When project familiarity was added the other five were not reduced, leaving
 *  the total at 1.05 — which would have inflated every score by 5% and made
 *  the "no good match" floor meaningless. Corrected in Session 04 (C-06), and
 *  asserted below so the error cannot recur silently. */
export const SCORE_WEIGHTS: ScoreWeights = {
  skill: 0.38,
  availability: 0.28,
  deadlineFit: 0.14,
  fairness: 0.09,
  performance: 0.05,
  projectFamiliarity: 0.06,
} as const;

export const SCORE_WEIGHT_TOTAL_TOLERANCE = 1e-9;

/** Returns the sum of the supplied weights. Exposed so the settings screen can
 *  validate a Super Admin's edits before saving. FR-057. */
export function sumScoreWeights(w: ScoreWeights): number {
  return (
    w.skill + w.availability + w.deadlineFit + w.fairness + w.performance + w.projectFamiliarity
  );
}

export function scoreWeightsAreValid(w: ScoreWeights): boolean {
  return Math.abs(sumScoreWeights(w) - 1) <= SCORE_WEIGHT_TOTAL_TOLERANCE;
}

/* Fail loudly at module load rather than quietly at runtime. */
if (!scoreWeightsAreValid(SCORE_WEIGHTS)) {
  throw new Error(
    `SCORE_WEIGHTS must sum to exactly 1.00 — got ${sumScoreWeights(SCORE_WEIGHTS)}. ` +
      `See docs/19-MASTER-SPECIFICATION-REGISTRY.md §9 contradiction C-06.`,
  );
}

/** Penalties applied after scoring. doc 07 §2 stage 3. */
export const SCORE_PENALTIES = {
  overSoftThreshold: -15,
  overHardThreshold: -40,
  atMaxConcurrent: -10,
  zeroSkillMatch: -25,
} as const;

/** Below this, the engine stops recommending people and starts recommending
 *  actions instead — extend the deadline, split the task, rebalance. FR-054. */
export const RECOMMENDATION_USABILITY_FLOOR = 35;

/** New members with fewer than this many completed tasks get a neutral
 *  performance score rather than being punished for having no history. */
export const PERFORMANCE_HISTORY_MINIMUM_TASKS = 5;
export const PERFORMANCE_NEUTRAL_SCORE = 75;

/* ==========================================================================
 * OTHER ENUMS
 * ========================================================================== */

export const DEPENDENCY_TYPES = ['blocks', 'relates_to'] as const;
export type DependencyType = (typeof DEPENDENCY_TYPES)[number];

export const AVAILABILITY_TYPES = ['leave', 'holiday', 'half_day', 'unavailable'] as const;
export type AvailabilityType = (typeof AVAILABILITY_TYPES)[number];

export const NOTIFICATION_CHANNELS = ['in_app', 'email', 'push'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/* ── 'system' RETIRED, session 15 ─────────────────────────────────────────
   Owner decision: light and dark only — a sun and a moon. "The system
   preference I don't want, just the light toggle and the moon toggle."

   The Postgres enum `public.theme_preference` still carries the value and
   `users.theme` still defaults to it, deliberately: dropping a value from a
   Postgres enum requires rewriting the type, and the only thing it buys is
   tidiness. The provider resolves a legacy 'system' to whatever the person is
   actually seeing, once, and never writes it again. */
export const THEMES = ['light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

/** The concrete value written to <html data-theme>. `system` is always
 *  resolved to one of these before it reaches the DOM, so CSS never has to
 *  reconcile an attribute against a media query. */
export const RESOLVED_THEMES = ['light', 'dark'] as const;
export type ResolvedTheme = (typeof RESOLVED_THEMES)[number];

/* ==========================================================================
 * WORKING CALENDAR — ADR-004
 * ========================================================================== */

export const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/** Monday–Saturday. Sunday is the weekend. */
export const DEFAULT_WORKING_DAYS: readonly Weekday[] = [
  'mon',
  'tue',
  'wed',
  'thu',
  'fri',
  'sat',
] as const;

export const DEFAULT_TIMEZONE = 'Asia/Karachi';
export const DEFAULT_WORKING_HOURS_START = '09:00';
export const DEFAULT_WORKING_HOURS_END = '17:00';

/** 6 days × 8 hours. Attendance, not output — see DEFAULT_WEEKLY_CAPACITY. */
export const NOMINAL_WEEKLY_HOURS = 48;

/* ==========================================================================
 * SYSTEM DEFAULTS — doc 19 §5
 * All are Super-Admin editable at runtime. These are the seed values.
 * ========================================================================== */

export const SYSTEM_DEFAULTS = {
  /* -- Capacity -----------------------------------------------------------
     36, not 48. Attendance hours are not productive hours: breaks, prayers,
     briefs, calls, context switching and render waits consume roughly 25%.
     Setting capacity to 48 would leave every threshold permanently silent —
     the most common way workload systems fail. ADR-004.                    */
  defaultWeeklyCapacity: 36,
  defaultMaxConcurrentTasks: 5,
  softThresholdPct: 85,
  hardThresholdPct: 100,
  criticalThresholdPct: 130,
  workloadWindow: 'week' as WorkloadWindow,
  sustainedOverloadDays: 3,

  /* -- Projects -- */
  otherWorkWarningPct: 15,

  /* -- Timers -- */
  minutesPerEffortPoint: MINUTES_PER_EFFORT_POINT,
  timerAutoPauseOutsideHours: true,
  timerIdlePromptMinutes: 120,
  timerIdleAutoPauseMinutes: 150,
  overLimitBehaviour: 'enforced_stop_and_account' as OverLimitBehaviour,
  requireReasonForManualTime: true,

  /* -- Security -- */
  failedLoginsToLock: 3,
  accountLockAutoClearMinutes: 30,
  recoveryCodeTtlMinutes: 15,
  recoveryCodeMaxAttempts: 5,
  activationTokenTtlHours: 48,
  temporaryPasswordTtlHours: 24,
  requireMfaOnPrivilegedReset: true,
  passwordMinLength: 12,
  superAdminPasswordMinLength: 16,
  passwordHistoryCount: 5,
  recoveryCodeCount: 10,

  /* -- Sessions (minutes) — doc 16 §4 --
     Privilege determines exposure: the Super Admin's window is hours, a
     Member's is weeks. Every value here is from doc 16 §4's session table. */
  accessTokenTtlMinutes: 15,
  refreshTtlSuperAdminMinutes: 8 * 60,
  refreshTtlAdminMinutes: 24 * 60,
  refreshTtlDefaultMinutes: 7 * 24 * 60,
  idleTimeoutSuperAdminMinutes: 30,
  idleTimeoutAdminMinutes: 120,
  /** No idle timeout for Coordinators and Members. doc 16 §4. */
  idleTimeoutDefaultMinutes: null,
  absoluteSessionCapSuperAdminMinutes: 12 * 60,
  /** doc 16 §4, "Absolute session cap — others 30 days". */
  absoluteSessionCapDefaultMinutes: 30 * 24 * 60,
  maxConcurrentSessionsSuperAdmin: 2,
  /** Unlimited for everyone else. doc 16 §4. */
  maxConcurrentSessionsDefault: null,
  stepUpValidityMinutes: 10,

  /* -- Calendar & delivery -- */
  teamTimezone: DEFAULT_TIMEZONE,
  workingDays: DEFAULT_WORKING_DAYS,
  workingHoursStart: DEFAULT_WORKING_HOURS_START,
  workingHoursEnd: DEFAULT_WORKING_HOURS_END,
  digestTime: '09:00',

  /* -- Appearance -- */
  defaultTheme: 'system' as Theme,
} as const;

/* ==========================================================================
 * TASK SKILL WEIGHTS — FR-055
 * --------------------------------------------------------------------------
 * How much a task needs a skill: 1 nice to have · 2 needed · 3 essential.
 * Three levels, because a matching engine given a five-point scale gets asked
 * to distinguish "quite important" from "fairly important", which nobody can
 * do consistently and the score cannot use.
 * ========================================================================== */

export const SKILL_WEIGHTS = [1, 2, 3] as const;
export type SkillWeight = (typeof SKILL_WEIGHTS)[number];

export const SKILL_WEIGHT_LABEL: Readonly<Record<number, string>> = {
  1: 'Nice to have',
  2: 'Needed',
  3: 'Essential',
};

/* ==========================================================================
 * NOTIFICATION KINDS
 * --------------------------------------------------------------------------
 * The eighteen values of `public.notification_kind`, in the order the enum
 * declares them.
 *
 * ── WHY THIS LIST EXISTS AT ALL ──────────────────────────────────────────────
 * `notify()` used to take `kind: string`, so an invented value — 'extension_
 * granted' where the enum says 'time_extension_decided' — compiled cleanly and
 * failed at the insert, at the end of a flow that had already written the
 * decision. The union turns that into a red squiggle. Adding a value here
 * without adding it to the enum fails at the same point it always did; the
 * migration remains the source of truth (C-16).
 * ========================================================================== */

export const NOTIFICATION_KINDS = [
  'task_assigned',
  'task_reassigned',
  'task_status_changed',
  'task_blocked',
  'task_due_soon',
  'task_overdue',
  'task_comment',
  'task_mention',
  'review_requested',
  'review_approved',
  'revisions_requested',
  'capacity_warning',
  'time_limit_warning',
  'time_extension_requested',
  'time_extension_decided',
  'project_status_changed',
  'security_alert',
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/* ==========================================================================
 * BRANDING
 * ========================================================================== */

export const ORGANISATION_NAME = 'Crescent Nova International';
export const ORGANISATION_SHORT_NAME = 'CNI';
export const DIVISION_NAME = 'AI & Digital Division';
export const APP_NAME = 'CNI CRM';

/** localStorage key holding the user's theme *preference* (light|dark|system).
 *  Distinct from the resolved value written to <html data-theme>. */
export const THEME_STORAGE_KEY = 'cni-theme';
