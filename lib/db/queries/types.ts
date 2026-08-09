import type {
  AvailabilityType,
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
  readonly targetEndDate: string | null;
  readonly isPermanent: boolean;
  readonly typeFields: Record<string, unknown>;
  readonly createdAt: string;
  /** Aggregates, so a project card never needs a second query. */
  readonly taskCount: number;
  readonly openTaskCount: number;
  readonly doneTaskCount: number;
  readonly overdueTaskCount: number;
  readonly effortPoints: number;
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
  readonly dueDate: string | null;
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
