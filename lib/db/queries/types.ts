import type {
  AvailabilityType,
  ContentKind,
  EffortSize,
  Priority,
  ProjectStatus,
  ProjectType,
  Role,
  TaskStatus,
  TimerState,
} from '@/lib/domain/constants';

/* ============================================================================
 * ROW SHAPES — LAYER 1's public vocabulary
 * ----------------------------------------------------------------------------
 * The shapes the data layer hands upward. Deliberately NOT the raw table rows:
 * `snake_case` columns and `numeric` strings are a storage detail, and letting
 * them leak means every component knows how Postgres spells things.
 *
 * Nothing here is generated. `types/database.ts` is the generated mirror of the
 * schema (registry C-16); this is the hand-written *interface* between the data
 * layer and everything above it, and the two answer different questions.
 * ========================================================================= */

export interface ProjectRow {
  readonly id: string;
  readonly name: string;
  readonly type: ProjectType;
  readonly code: string;
  readonly description: string | null;
  readonly status: ProjectStatus;
  readonly statusReason: string | null;
  readonly ownerId: string;
  readonly ownerName: string | null;
  readonly startDate: string | null;
  /** 'HH:MM', or null for a day with no particular hour. Migration 020. */
  readonly startTime: string | null;
  readonly targetEndDate: string | null;
  /** 'HH:MM', or null. Migration 020. */
  readonly targetEndTime: string | null;
  readonly isPermanent: boolean;
  readonly typeFields: Record<string, unknown>;
  readonly createdAt: string;
  /** Aggregates, so a project card never needs a second query. */
  readonly taskCount: number;
  readonly openTaskCount: number;
  readonly doneTaskCount: number;
  readonly overdueTaskCount: number;
  readonly effortPoints: number;

  /* ── The commercial shape — migration 033 ─────────────────────────────────
     ⚠️ `assetsTargetMin` and friends are the project's OWN columns, copied from
     the package when it was created and editable since. They are NOT the
     package's current numbers, deliberately: editing a package must never
     change what an existing client was promised. */
  readonly clientKind: 'internal' | 'external' | null;
  readonly clientId: string | null;
  readonly clientName: string | null;
  readonly packageId: string | null;
  readonly packageName: string | null;
  readonly monthlyFeePkr: number | null;
  readonly assetsTargetMin: number | null;
  readonly assetsTargetMax: number | null;
  readonly reelsTargetMin: number | null;
  readonly renewsOn: string | null;

  /* ── The posting rhythm — migration 036 ───────────────────────────────────
     ⚠️ THESE ARE THE SOURCE; the three target figures above are DERIVED from
     them at write time. A screen that wants to show or edit the commitment should
     read these — the targets are the stored consequence, kept because every report
     reads them and because a contract must not shift with the length of a month.
     ISO weekdays: 1 = Monday … 7 = Sunday. */
  readonly staticPostsPerDay: number | null;
  readonly reelsPerWeek: number | null;
  readonly reelDays: readonly number[];
  readonly postingDays: readonly number[];

  /** Platforms this project manages, for the card and the detail header. `slug` is
   *  what `components/brand/platform-icon.tsx` draws the brand mark from. */
  readonly platforms: readonly {
    readonly id: string;
    readonly name: string;
    readonly slug: string;
    /** The client's page on this platform — migration 037. Null until recorded, which
     *  is why the header icon is only a link when there is something to link to. */
    readonly pageUrl: string | null;
    readonly handle: string | null;
  }[];
  readonly memberCount: number;

  /* ── From the PACKAGE, not copied onto the project ────────────────────────
     Null where no package is attached — which is not the same as false. "No
     package chosen" and "a package that excludes a website" are different
     answers, and a card that showed both as a grey cross would be lying about
     one of them. */
  readonly packageIncludesWebsite: boolean | null;
  readonly packageIncludesCrm: boolean | null;

  /* ── Progress: what actually went out THIS calendar month ─────────────────
     Counted on `published_on`, not on completion — a reel finished Monday and
     posted Friday belongs to Friday's month. */
  readonly assetsPublishedThisMonth: number;
  readonly reelsPublishedThisMonth: number;
}

export interface TaskRow {
  readonly id: string;
  readonly reference: string;
  readonly title: string;
  readonly description: string | null;
  readonly projectId: string;
  readonly projectName: string;
  readonly projectType: ProjectType;
  readonly projectCode: string;
  readonly otherDescription: string | null;
  readonly parentTaskId: string | null;
  readonly assigneeId: string | null;
  readonly assigneeName: string | null;
  /** Their uploaded picture, so a card can show a face rather than initials. */
  readonly assigneeAvatarUrl: string | null;
  readonly createdById: string;
  readonly createdByName: string | null;
  readonly status: TaskStatus;
  readonly priority: Priority;
  readonly effortSize: EffortSize | null;
  readonly effortPoints: number;
  readonly startDate: string | null;
  /** 'HH:MM', or null for a day with no particular hour. Migration 020. */
  readonly startTime: string | null;
  readonly dueDate: string | null;
  /** 'HH:MM', or null. Migration 020. */
  readonly dueTime: string | null;
  readonly completedAt: string | null;
  readonly blockedReason: string | null;
  readonly cancelledReason: string | null;
  readonly assignmentOverrideReason: string | null;
  readonly timeLimitMinutes: number | null;
  readonly timeSpentMinutes: number;
  readonly timerState: TimerState;
  readonly timerStartedAt: string | null;
  readonly extensionMinutesGranted: number;
  /** An RFC 5545 subset — see lib/domain/recurrence.ts. Null for a one-off. */
  readonly recurrenceRule: string | null;

  /* ── The deliverable — migrations 033/034 ─────────────────────────────────
     `contentKind` is what makes this task countable against a package target.
     Null means it is work rather than a deliverable, which is legitimate — a
     coordinator's admin task was never part of "14–16 assets". */
  readonly contentKind: ContentKind | null;
  readonly sourceDriveUrl: string | null;
  readonly assetDriveUrl: string | null;
  /** When it went live. NOT completedAt: a reel finished Monday and posted
   *  Friday counts against Friday. See migration 033. */
  readonly publishedOn: string | null;
  /** Where it was published, and how many of those are actually live. */
  readonly placementCount: number;
  readonly placementLiveCount: number;
  readonly commentCount: number;
  readonly attachmentCount: number;
  readonly checklistDone: number;
  readonly checklistTotal: number;
  readonly subtaskCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CommentRow {
  readonly id: string;
  readonly taskId: string;
  readonly authorId: string;
  readonly authorName: string | null;
  readonly body: string;
  readonly parentCommentId: string | null;
  readonly mentions: readonly string[];
  readonly createdAt: string;
  readonly editedAt: string | null;
}

export interface ChecklistRow {
  readonly id: string;
  readonly taskId: string;
  readonly text: string;
  readonly isDone: boolean;
  readonly sortOrder: number;
}

export interface PersonRow {
  readonly id: string;
  readonly fullName: string;
  readonly email: string;
  readonly role: Role;
  readonly roleTitle: string | null;
  readonly accountState: string;
  readonly isActive: boolean;
  readonly avatarUrl: string | null;
  readonly weeklyCapacityPoints: number;
  readonly maxConcurrentTasks: number;
  readonly timezone: string;
  readonly lastLoginAt: string | null;
  readonly lockedAt: string | null;
  readonly createdAt: string;
}

export interface ActivityRow {
  readonly id: string;
  readonly actorId: string | null;
  readonly actorName: string | null;
  /**
   * The actor's photo, for a feed that shows faces.
   *
   * ⚠️ Added 2026-08-25: the dashboard's activity feed drew initials for
   * everybody because this was never selected, and an initial is what `Avatar`
   * falls back to when it has no `src` — so the bug looked like a deliberate
   * style rather than missing data. Nullable because a person may genuinely have
   * no photo, and because a system-generated row has no actor at all.
   */
  readonly actorAvatarUrl: string | null;
  readonly entityType: string;
  readonly entityId: string;
  readonly action: string;
  readonly summary: string | null;
  readonly createdAt: string;
}

export interface NotificationRow {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly body: string | null;
  readonly linkTo: string | null;
  readonly isRead: boolean;
  readonly createdAt: string;
}

export interface AvailabilityRow {
  readonly id: string;
  readonly userId: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly type: AvailabilityType;
  readonly capacityMultiplier: number;
  readonly note: string | null;
}

export interface SkillRow {
  readonly id: string;
  readonly slug: string;
  readonly label: string;
  readonly category: string | null;
  readonly keywords: readonly string[];
  readonly isActive: boolean;
}

export interface UserSkillRow {
  readonly userId: string;
  readonly skillId: string;
  readonly skillLabel: string;
  readonly proficiency: number;
  readonly isPrimary: boolean;
}
